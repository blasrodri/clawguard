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
import { AuditLog, FileAuditSink } from "./audit.js";
import { BudgetWindow } from "./budget.js";
import { scan } from "./dlp.js";
import { evaluate, savingsUsd } from "./downgrade.js";
import { costUsd } from "./pricing.js";
import { FileStore, MemoryStore } from "./store.js";
/** Cap on un-settled downgrade decisions, so a resolve-without-usage
 * (e.g. a blocked call) can't leak memory unbounded. */
const MAX_PENDING_DOWNGRADES = 1024;
const NOOP_LOGGER = { info: () => { }, warn: () => { } };
export class Governor {
    config;
    budget;
    audit;
    logger;
    now;
    fileExists;
    pendingDowngrades = [];
    downgradeCount = 0;
    savedUsd = 0;
    consecutiveFailures = 0;
    breakerOpenUntil = 0;
    constructor(config, deps = {}) {
        this.config = config;
        this.now = deps.clock ?? Date.now;
        this.logger = deps.logger ?? NOOP_LOGGER;
        this.fileExists = deps.fileExists ?? existsSync;
        // Audit first: the FileStore may emit a degrade event during its
        // constructor (e.g. corrupt-on-load, lock_held) and we want those
        // surfaced in the audit log, not swallowed.
        this.audit = new AuditLog(resolveAuditSink(config, deps.auditSink), this.now);
        this.budget = new BudgetWindow(config.budget, deps.store ?? resolveStore(config, this.audit, this.logger), this.now);
    }
    /** `before_model_resolve`: rewrite to a cheaper model when policy says so. */
    onModelResolve(input) {
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
    /**
     * `before_agent_run`: refuse to start a turn if the kill switch is
     * engaged, the circuit breaker is open, or the budget is spent.
     */
    onRunGate() {
        const decision = this.budget.decide();
        const stop = this.hardStop(decision);
        if (stop) {
            if (this.config.mode === "enforce") {
                this.audit.record(stop.type, { reason: stop.reason });
                this.logger.warn(`clawguard: blocking run — ${stop.reason}`);
                return { block: true, reason: stop.reason, delayMs: 0 };
            }
            this.audit.record(stop.shadowType, { reason: stop.reason });
        }
        // The call is going out (passed, delayed, or shadow-allowed): pre-charge
        // its estimate so concurrent and in-flight spend counts immediately.
        this.budget.reserve(this.config.budget.reserveTokens, this.config.budget.reserveUsd);
        return { block: false, reason: stop?.reason ?? decision.reason, delayMs: decision.delayMs };
    }
    /** `model_call_ended`: feed call outcomes to the circuit breaker. */
    onCallEnded(ok) {
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
        }
    }
    hardStop(decision) {
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
    killActive() {
        const k = this.config.killSwitch;
        if (k.enabled) {
            return true;
        }
        return k.file ? this.fileExists(k.file) : false;
    }
    breakerActive() {
        return this.config.breaker.enabled && this.now() < this.breakerOpenUntil;
    }
    /** `llm_output`: reconcile usage, attribute savings, scan the response. */
    onUsage(input) {
        const cacheReadTokens = input.cacheReadTokens ?? 0;
        const reported = input.usageReported ?? input.inputTokens + input.outputTokens + cacheReadTokens > 0;
        // Match this call to its resolve-time downgrade decision (if any).
        const downgrade = this.pendingDowngrades.shift();
        if (!reported) {
            // No usage block: keep any reserve standing (fail-safe over-count)
            // rather than settling it to zero and silently under-enforcing.
            this.audit.record("usage_missing", { provider: input.provider, model: input.model });
            return;
        }
        const cost = costUsd(input.provider, input.model, input.inputTokens, input.outputTokens, cacheReadTokens);
        this.budget.settle(input.inputTokens + input.outputTokens + cacheReadTokens, cost);
        if (downgrade) {
            const saved = savingsUsd(downgrade, input.inputTokens);
            this.savedUsd += saved;
            if (saved > 0) {
                this.audit.record("savings", { usd: saved, replacement: downgrade.replacement });
            }
        }
        if (this.config.dlp.enabled && this.config.dlp.scanResponses && input.text) {
            const labels = scan(input.text, this.config.dlp.maxScanChars);
            if (labels.length > 0) {
                this.audit.record("dlp_response", { provider: input.provider, model: input.model, labels });
            }
        }
    }
    /** `message_sending`: scan outbound content; optionally cancel the send. */
    onMessageSending(text) {
        if (!this.config.dlp.enabled || !text) {
            return { cancel: false, labels: [] };
        }
        const labels = scan(text, this.config.dlp.maxScanChars);
        if (labels.length === 0) {
            return { cancel: false, labels: [] };
        }
        const enforceBlock = this.config.dlp.onDetect === "block" && this.config.mode === "enforce";
        this.audit.record(enforceBlock ? "dlp_blocked" : "dlp_detected", { labels });
        if (enforceBlock) {
            this.logger.warn(`clawguard: cancelled outbound message — DLP hit ${labels.join(",")}`);
        }
        return { cancel: enforceBlock, labels };
    }
    /** Flush any buffered audit records (call on shutdown). */
    flush() {
        this.audit.flush();
    }
    /** Point-in-time view for status reporting. */
    status() {
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
    rememberDowngrade(decision) {
        if (this.pendingDowngrades.length >= MAX_PENDING_DOWNGRADES) {
            this.pendingDowngrades.shift();
        }
        this.pendingDowngrades.push(decision);
    }
}
function resolveStore(config, audit, logger) {
    if (!config.budget.persist) {
        return new MemoryStore();
    }
    return new FileStore(config.budget.persistPath ?? defaultPath("budget.json"), {
        onDegrade: (event) => {
            audit.record("persistence_degraded", {
                reason: event.reason,
                detail: event.detail,
            });
            logger.warn(`clawguard: persistence ${event.reason}` +
                (event.detail ? ` (${event.detail})` : ""));
        },
    });
}
function resolveAuditSink(config, override) {
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
function defaultPath(file) {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    return `${home}/.clawguard/${file}`;
}
//# sourceMappingURL=governor.js.map