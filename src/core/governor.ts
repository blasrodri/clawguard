/**
 * The governance engine. Pure with respect to OpenClaw — it knows
 * nothing about hooks or the gateway, only about the decisions it makes.
 * `src/index.ts` is the thin layer that maps OpenClaw hooks onto these
 * methods. This separation keeps the valuable logic fully unit-testable
 * without a running gateway.
 *
 * Charging is two-phase: `onRunGate` reserves an estimate before a call
 * goes out (so in-flight spend counts immediately and overshoot is
 * bounded), and `onUsage` settles that reserve against authoritative
 * usage once the response arrives. Downgrade savings are attributed by
 * matching each resolve-time decision (FIFO) to its later usage event.
 */

import { existsSync } from "node:fs";

import type { ClawGuardConfig } from "../config.js";
import { AnomalyDetector } from "./anomaly.js";
import { AuditLog, FileAuditSink, type AuditSink } from "./audit.js";
import { BudgetWindow, type Clock, type BudgetSnapshot } from "./budget.js";
import { Detectors, type CustomPattern } from "./dlp.js";
import {
  NullNotifier,
  WebhookNotifier,
  type NotificationEvent,
  type NotificationKind,
  type Notifier,
} from "./notifier.js";
import { evaluate, savingsUsd, type DowngradeDecision } from "./downgrade.js";
import { estimateCallCostUsd } from "./estimate.js";
import { costUsd, type Provider } from "./pricing.js";
import { FileStore, MemoryStore, type GovernanceStore } from "./store.js";

/** Cap on un-settled downgrade decisions, so a resolve-without-usage
 * (e.g. a blocked call) can't leak memory unbounded. */
const MAX_PENDING_DOWNGRADES = 1024;

export interface ModelResolveInput {
  readonly provider: Provider;
  readonly model: string | undefined;
  /** Pre-flight input-token estimate (0 = no usable estimate from the SDK). */
  readonly estimatedInputTokens?: number;
}

export interface ModelResolveOutcome {
  readonly modelOverride?: string;
}

export interface RunGateOutcome {
  readonly block: boolean;
  readonly reason: string;
  readonly delayMs: number;
}

export interface UsageInput {
  readonly provider: Provider;
  readonly model: string | undefined;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  /** Explicit signal that the provider reported a usage block. */
  readonly usageReported?: boolean;
  /** Optional response text for output-side DLP scanning. */
  readonly text?: string;
}

export interface MessageScanOutcome {
  readonly cancel: boolean;
  readonly labels: string[];
}

export interface GovernorStatus {
  readonly mode: string;
  readonly budget: ReturnType<BudgetWindow["snapshot"]>;
  readonly downgradeCount: number;
  readonly estimatedSavedUsd: number;
  readonly killSwitchEngaged: boolean;
  readonly breakerOpen: boolean;
  readonly consecutiveFailures: number;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
}

const NOOP_LOGGER: Logger = { info: () => {}, warn: () => {} };

export interface GovernorDeps {
  readonly logger?: Logger;
  readonly clock?: Clock;
  /** Override the budget store (tests). Defaults from config. */
  readonly store?: GovernanceStore;
  /** Override the audit sink (tests). Defaults from config. */
  readonly auditSink?: AuditSink;
  /** Override kill-switch file existence check (tests). */
  readonly fileExists?: (path: string) => boolean;
  /** Override the outbound notifier (tests). Defaults from config. */
  readonly notifier?: Notifier;
}

export class Governor {
  private readonly budget: BudgetWindow;
  private readonly audit: AuditLog;
  private readonly logger: Logger;
  private readonly now: Clock;
  private readonly fileExists: (path: string) => boolean;
  private readonly anomaly: AnomalyDetector;
  private readonly detectors: Detectors;
  private readonly notifier: Notifier;
  private readonly pendingDowngrades: DowngradeDecision[] = [];
  private downgradeCount = 0;
  private savedUsd = 0;
  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;
  /** Budget % thresholds crossed in the current window (deduplicates alerts). */
  private crossedThresholds = new Set<number>();
  /** Window start last seen, so we know to reset `crossedThresholds`. */
  private lastWindowStart = 0;
  /** Last observed kill-switch state, to fire only on false→true transitions. */
  private killSwitchAlerted = false;

  constructor(
    private readonly config: ClawGuardConfig,
    deps: GovernorDeps = {},
  ) {
    this.now = deps.clock ?? Date.now;
    this.logger = deps.logger ?? NOOP_LOGGER;
    this.fileExists = deps.fileExists ?? existsSync;
    // Audit first: the FileStore may emit a degrade event during its
    // constructor (e.g. corrupt-on-load, lock_held) and we want those
    // surfaced in the audit log, not swallowed.
    this.audit = new AuditLog(resolveAuditSink(config, deps.auditSink), this.now);
    this.budget = new BudgetWindow(
      config.budget,
      deps.store ?? resolveStore(config, this.audit, this.logger),
      this.now,
    );
    this.anomaly = new AnomalyDetector(config.anomaly);
    this.detectors = new Detectors({
      builtins: config.dlp.builtins,
      custom: compileCustomPatterns(config.dlp.customPatterns, this.audit, this.logger),
      defaultAction: config.dlp.onDetect,
      maxChars: config.dlp.maxScanChars,
    });
    this.notifier = deps.notifier ?? buildNotifier(config, () => this.logger, () => this.audit);
  }

  private sendNotification(kind: NotificationKind, fields: Record<string, unknown>): void {
    if (!this.config.notifications.events.includes(kind)) {
      return;
    }
    const event: NotificationEvent = {
      type: kind,
      ts: new Date(this.now()).toISOString(),
      ...fields,
    };
    this.notifier.send(event);
  }

  private checkBudgetThresholds(): void {
    const snap = this.budget.snapshot();
    if (snap.windowStartedAt !== this.lastWindowStart) {
      this.crossedThresholds.clear();
      this.lastWindowStart = snap.windowStartedAt;
    }
    const ratio = this.budget.peakRatio();
    for (const threshold of this.config.notifications.thresholds) {
      if (ratio >= threshold && !this.crossedThresholds.has(threshold)) {
        this.crossedThresholds.add(threshold);
        this.sendNotification("budget_threshold", {
          threshold,
          ratio,
          spentUsd: snap.usdUsed,
          capUsd: snap.maxUsd,
          spentTokens: snap.tokensUsed,
          capTokens: snap.maxTokens,
        });
      }
    }
  }

  /** `before_model_resolve`: rewrite to a cheaper model when policy says so. */
  onModelResolve(input: ModelResolveInput): ModelResolveOutcome {
    const outcome = this.computeModelResolve(input);
    this.logPreFlight(input, outcome);
    return outcome;
  }

  private computeModelResolve(input: ModelResolveInput): ModelResolveOutcome {
    const target = this.config.downgrade.to;
    if (!target) {
      return {};
    }
    const decision = evaluate(input.provider, input.model, target);
    if (!decision.wouldDowngrade || !decision.replacement) {
      return {};
    }

    // Budget-aware: keep the premium model until usage crosses the
    // configured fraction of the budget, then start downgrading.
    const threshold = this.config.downgrade.whenBudgetRatioAbove;
    if (threshold > 0 && this.budget.peakRatio() < threshold) {
      return {};
    }

    if (this.config.mode === "shadow") {
      this.audit.record("downgrade_shadow", {
        provider: input.provider,
        from: input.model,
        to: decision.replacement,
      });
      return {};
    }

    this.downgradeCount++;
    this.rememberDowngrade(decision);
    this.audit.record("downgrade", {
      provider: input.provider,
      from: input.model,
      to: decision.replacement,
    });
    this.logger.info(`clawguard: downgraded ${input.model ?? "?"} -> ${decision.replacement}`);
    return { modelOverride: decision.replacement };
  }

  private logPreFlight(input: ModelResolveInput, outcome: ModelResolveOutcome): void {
    if (!this.config.logging.perCallLine) {
      return;
    }
    const tokens = input.estimatedInputTokens ?? 0;
    if (tokens <= 0) {
      return; // no usable estimate from the SDK — skip the line, don't fake it
    }
    const finalModel = outcome.modelOverride ?? input.model;
    const est = estimateCallCostUsd(input.provider, finalModel, tokens);
    if (est <= 0) {
      return; // unknown model rate — a "$0.0000 est" line is just noise
    }
    const budget = formatBudgetForLog(this.budget.snapshot(), this.config.budget);
    this.logger.info(
      `clawguard: ${finalModel ?? "?"} est $${est.toFixed(4)} (${tokens} input tok)` +
        (budget ? ` · ${budget}` : ""),
    );
  }

  private logActualCall(model: string | undefined, cost: number): void {
    if (!this.config.logging.perCallLine) {
      return;
    }
    const budget = formatBudgetForLog(this.budget.snapshot(), this.config.budget);
    this.logger.info(
      `clawguard: ${model ?? "?"} $${cost.toFixed(4)}` + (budget ? ` · ${budget}` : ""),
    );
  }

  /**
   * `before_agent_run`: refuse to start a turn if the kill switch is
   * engaged, the circuit breaker is open, or the budget is spent.
   */
  onRunGate(): RunGateOutcome {
    const decision = this.budget.decide();
    const stop = this.hardStop(decision);
    if (stop) {
      if (this.config.mode === "enforce") {
        this.audit.record(stop.type, { reason: stop.reason });
        this.logger.warn(`clawguard: blocking run — ${stop.reason}`);
        if (stop.type === "kill_switch_engaged" && !this.killSwitchAlerted) {
          this.killSwitchAlerted = true;
          this.sendNotification("kill_switch", { reason: stop.reason });
        }
        return { block: true, reason: stop.reason, delayMs: 0 };
      }
      this.audit.record(stop.shadowType, { reason: stop.reason });
    } else {
      // Reset the kill-switch latch when the operator removes the file.
      this.killSwitchAlerted = false;
    }

    // The call is going out (passed, delayed, or shadow-allowed): pre-charge
    // its estimate so concurrent and in-flight spend counts immediately.
    this.budget.reserve(this.config.budget.reserveTokens, this.config.budget.reserveUsd);
    return { block: false, reason: stop?.reason ?? decision.reason, delayMs: decision.delayMs };
  }

  /** `model_call_ended`: feed call outcomes to the circuit breaker. */
  onCallEnded(ok: boolean): void {
    if (!this.config.breaker.enabled) {
      return;
    }
    if (ok) {
      if (this.consecutiveFailures > 0 || this.breakerOpenUntil !== 0) {
        this.audit.record("breaker_reset", {});
      }
      this.consecutiveFailures = 0;
      this.breakerOpenUntil = 0;
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.config.breaker.threshold) {
      this.breakerOpenUntil = this.now() + this.config.breaker.cooldownMs;
      this.audit.record("breaker_open", {
        consecutiveFailures: this.consecutiveFailures,
        cooldownMs: this.config.breaker.cooldownMs,
      });
      this.sendNotification("breaker_open", {
        consecutiveFailures: this.consecutiveFailures,
        cooldownMs: this.config.breaker.cooldownMs,
      });
    }
  }

  private hardStop(
    decision: ReturnType<BudgetWindow["decide"]>,
  ): { type: string; shadowType: string; reason: string } | undefined {
    if (this.killActive()) {
      return {
        type: "kill_switch_engaged",
        shadowType: "kill_switch_would_engage",
        reason: "kill switch engaged",
      };
    }
    if (this.breakerActive()) {
      return {
        type: "breaker_open",
        shadowType: "breaker_would_block",
        reason: `circuit breaker open after ${this.consecutiveFailures} consecutive failures`,
      };
    }
    if (decision.action === "block") {
      return { type: "budget_block", shadowType: "budget_would_block", reason: decision.reason };
    }
    return undefined;
  }

  private killActive(): boolean {
    const k = this.config.killSwitch;
    if (k.enabled) {
      return true;
    }
    return k.file ? this.fileExists(k.file) : false;
  }

  private breakerActive(): boolean {
    return this.config.breaker.enabled && this.now() < this.breakerOpenUntil;
  }

  /** `llm_output`: reconcile usage, attribute savings, scan the response. */
  onUsage(input: UsageInput): void {
    const cacheReadTokens = input.cacheReadTokens ?? 0;
    const reported =
      input.usageReported ?? input.inputTokens + input.outputTokens + cacheReadTokens > 0;

    // Match this call to its resolve-time downgrade decision (if any).
    const downgrade = this.pendingDowngrades.shift();

    if (!reported) {
      // No usage block: keep any reserve standing (fail-safe over-count)
      // rather than settling it to zero and silently under-enforcing.
      this.audit.record("usage_missing", { provider: input.provider, model: input.model });
      return;
    }

    const cost = costUsd(
      input.provider,
      input.model,
      input.inputTokens,
      input.outputTokens,
      cacheReadTokens,
    );
    this.budget.settle(input.inputTokens + input.outputTokens + cacheReadTokens, cost);

    if (this.config.anomaly.enabled) {
      const detection = this.anomaly.observe(input.provider, input.model, cost);
      if (detection.isAnomaly) {
        this.audit.record("cost_anomaly", {
          provider: input.provider,
          model: input.model,
          costUsd: cost,
          medianUsd: detection.median,
          observedRatio: detection.observedRatio,
        });
        this.logger.warn(
          `clawguard: cost anomaly — $${cost.toFixed(4)} is ${detection.observedRatio.toFixed(1)}× the median for ${input.model ?? "?"}`,
        );
        this.sendNotification("cost_anomaly", {
          provider: input.provider,
          model: input.model,
          costUsd: cost,
          medianUsd: detection.median,
          observedRatio: detection.observedRatio,
        });
      }
    }

    if (downgrade) {
      const saved = savingsUsd(downgrade, input.inputTokens);
      this.savedUsd += saved;
      if (saved > 0) {
        this.audit.record("savings", { usd: saved, replacement: downgrade.replacement });
      }
    }

    if (this.config.dlp.enabled && this.config.dlp.scanResponses && input.text) {
      const detections = this.detectors.scan(input.text);
      if (detections.length > 0) {
        this.audit.record("dlp_response", {
          provider: input.provider,
          model: input.model,
          labels: detections.map((d) => d.label),
        });
      }
    }

    this.logActualCall(input.model, cost);
    this.checkBudgetThresholds();
  }

  /** `message_sending`: scan outbound content; optionally cancel the send. */
  onMessageSending(text: string | undefined): MessageScanOutcome {
    if (!this.config.dlp.enabled || !text) {
      return { cancel: false, labels: [] };
    }
    const detections = this.detectors.scan(text);
    if (detections.length === 0) {
      return { cancel: false, labels: [] };
    }
    const labels = detections.map((d) => d.label);
    // Any pattern's *resolved* action of "block" cancels the send in
    // enforce mode. Per-pattern actions override the global default.
    const wantsBlock = detections.some((d) => d.action === "block");
    const enforceBlock = wantsBlock && this.config.mode === "enforce";
    this.audit.record(enforceBlock ? "dlp_blocked" : "dlp_detected", { labels });
    if (enforceBlock) {
      this.logger.warn(`clawguard: cancelled outbound message — DLP hit ${labels.join(",")}`);
    }
    return { cancel: enforceBlock, labels };
  }

  /** Flush any buffered audit records (call on shutdown). */
  flush(): void {
    this.audit.flush();
  }

  /** Point-in-time view for status reporting. */
  status(): GovernorStatus {
    return {
      mode: this.config.mode,
      budget: this.budget.snapshot(),
      downgradeCount: this.downgradeCount,
      estimatedSavedUsd: this.savedUsd,
      killSwitchEngaged: this.killActive(),
      breakerOpen: this.breakerActive(),
      consecutiveFailures: this.consecutiveFailures,
    };
  }

  private rememberDowngrade(decision: DowngradeDecision): void {
    if (this.pendingDowngrades.length >= MAX_PENDING_DOWNGRADES) {
      this.pendingDowngrades.shift();
    }
    this.pendingDowngrades.push(decision);
  }
}

function resolveStore(
  config: ClawGuardConfig,
  audit: AuditLog,
  logger: Logger,
): GovernanceStore {
  if (!config.budget.persist) {
    return new MemoryStore();
  }
  return new FileStore(config.budget.persistPath ?? defaultPath("budget.json"), {
    onDegrade: (event) => {
      audit.record("persistence_degraded", {
        reason: event.reason,
        detail: event.detail,
      });
      logger.warn(
        `clawguard: persistence ${event.reason}` +
          (event.detail ? ` (${event.detail})` : ""),
      );
    },
  });
}

function resolveAuditSink(config: ClawGuardConfig, override: AuditSink | undefined): AuditSink | undefined {
  if (override) {
    return override;
  }
  if (!config.audit.enabled) {
    return undefined;
  }
  return new FileAuditSink(config.audit.path ?? defaultPath("audit.jsonl"), {
    maxBytes: config.audit.maxBytes,
  });
}

function defaultPath(file: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return `${home}/.clawguard/${file}`;
}

function buildNotifier(
  config: ClawGuardConfig,
  getLogger: () => Logger,
  getAudit: () => AuditLog,
): Notifier {
  const url = config.notifications.webhookUrl;
  if (!url) {
    return new NullNotifier();
  }
  return new WebhookNotifier({
    url,
    timeoutMs: config.notifications.timeoutMs,
    onError: (event, err) => {
      getLogger().warn(`clawguard: notification ${event.type} failed — ${String(err)}`);
      getAudit().record("notification_failed", { type: event.type, error: String(err) });
    },
  });
}

function compileCustomPatterns(
  raw: ClawGuardConfig["dlp"]["customPatterns"],
  audit: AuditLog,
  logger: Logger,
): CustomPattern[] {
  const out: CustomPattern[] = [];
  for (const p of raw) {
    try {
      const regex = new RegExp(p.regex, p.flags);
      out.push(p.action !== undefined ? { name: p.name, regex, action: p.action } : { name: p.name, regex });
    } catch (err) {
      audit.record("dlp_pattern_invalid", { name: p.name, reason: String(err) });
      logger.warn(`clawguard: skipping invalid DLP pattern "${p.name}": ${String(err)}`);
    }
  }
  return out;
}

function formatBudgetForLog(snap: BudgetSnapshot, cfg: ClawGuardConfig["budget"]): string {
  if (cfg.maxUsd && cfg.maxUsd > 0) {
    const pct = Math.min(100, Math.round((snap.usdUsed / cfg.maxUsd) * 100));
    return `window $${snap.usdUsed.toFixed(2)} / $${cfg.maxUsd.toFixed(2)} (${pct}%)`;
  }
  if (cfg.maxTokens && cfg.maxTokens > 0) {
    const pct = Math.min(100, Math.round((snap.tokensUsed / cfg.maxTokens) * 100));
    return `window ${snap.tokensUsed} / ${cfg.maxTokens} tok (${pct}%)`;
  }
  return "";
}
