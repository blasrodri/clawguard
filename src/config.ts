/**
 * Plugin configuration: types, defaults, and a defensive normalizer that
 * turns the untyped object OpenClaw hands a plugin into a fully-populated,
 * validated `ClawGuardConfig`. The JSON Schema in `openclaw.plugin.json`
 * mirrors these fields for the gateway's own validation; this normalizer
 * is the runtime backstop and the security boundary for untrusted config.
 */

import { parseTier, type DowngradeTier } from "./core/downgrade.js";
import { BUILTIN_LABELS, type DlpLabel } from "./core/dlp.js";
import type { NotificationKind } from "./core/notifier.js";

export type Mode = "enforce" | "shadow";
export type DlpAction = "log" | "block";
/** On an internal error, `open` lets the call proceed; `closed` blocks it. */
export type FailMode = "open" | "closed";

export interface ClawGuardConfig {
  /** `enforce` blocks/rewrites for real; `shadow` only records what it would do. */
  readonly mode: Mode;
  /** Behaviour when clawguard itself errors. Defaults to fail-open. */
  readonly failMode: FailMode;
  readonly budget: {
    readonly windowMs: number;
    readonly maxTokens: number | undefined;
    readonly maxUsd: number | undefined;
    readonly softLimitRatio: number;
    readonly delayMs: number;
    /** Tokens pre-charged per in-flight call to bound overshoot. 0 = reactive. */
    readonly reserveTokens: number;
    /** USD pre-charged per in-flight call to bound overshoot. 0 = reactive. */
    readonly reserveUsd: number;
    /** Persist budget state across restarts. */
    readonly persist: boolean;
    /** Override the persistence file path. */
    readonly persistPath: string | undefined;
  };
  readonly downgrade: {
    readonly to: DowngradeTier | undefined;
    /**
     * Only downgrade once budget usage reaches this fraction (0..1).
     * `0` (default) downgrades unconditionally whenever the model is
     * pricier than the target; `0.8` keeps the premium model until 80%
     * of the budget is spent, then downgrades.
     */
    readonly whenBudgetRatioAbove: number;
  };
  /** Halt all calls when engaged — config flag or presence of a file. */
  readonly killSwitch: {
    readonly enabled: boolean;
    readonly file: string | undefined;
  };
  /** Open the circuit (halt) after consecutive provider failures. */
  readonly breaker: {
    readonly enabled: boolean;
    readonly threshold: number;
    readonly cooldownMs: number;
  };
  /** Flag calls whose cost is much larger than the per-model median. */
  readonly anomaly: {
    readonly enabled: boolean;
    readonly ratio: number;
    readonly minSamples: number;
    readonly windowSize: number;
  };
  readonly dlp: {
    readonly enabled: boolean;
    /** Default action when a pattern fires and doesn't specify its own. */
    readonly onDetect: DlpAction;
    /** Also scan model *output*, not just outbound messages. */
    readonly scanResponses: boolean;
    /** Max characters scanned per payload (hot-path bound). */
    readonly maxScanChars: number;
    /** Which built-ins to run. `"all"` (default) or a subset. */
    readonly builtins: DlpLabel[] | "all";
    /** Operator-defined patterns. Invalid regexes are skipped at startup. */
    readonly customPatterns: ReadonlyArray<{
      readonly name: string;
      readonly regex: string;
      readonly flags: string;
      readonly action?: DlpAction;
    }>;
  };
  readonly audit: {
    readonly enabled: boolean;
    readonly path: string | undefined;
    /** Rotate the audit file once it exceeds this size in bytes. */
    readonly maxBytes: number;
  };
  readonly logging: {
    /** Emit one info log line per LLM call (pre-flight estimate + actual). */
    readonly perCallLine: boolean;
  };
  readonly notifications: {
    /** Webhook URL (Slack/Discord/anything that accepts POST JSON). Empty = off. */
    readonly webhookUrl: string | undefined;
    /** Budget % thresholds that trigger a notification on first crossing. */
    readonly thresholds: number[];
    /** Which event kinds to send. */
    readonly events: NotificationKind[];
    readonly timeoutMs: number;
  };
}

export const DEFAULT_CONFIG: ClawGuardConfig = {
  mode: "enforce",
  failMode: "open",
  budget: {
    windowMs: 60_000,
    maxTokens: undefined,
    maxUsd: undefined,
    softLimitRatio: 0.9,
    delayMs: 250,
    reserveTokens: 0,
    reserveUsd: 0,
    persist: true,
    persistPath: undefined,
  },
  downgrade: { to: undefined, whenBudgetRatioAbove: 0 },
  killSwitch: { enabled: false, file: undefined },
  breaker: { enabled: false, threshold: 5, cooldownMs: 30_000 },
  anomaly: { enabled: false, ratio: 5, minSamples: 10, windowSize: 200 },
  dlp: {
    enabled: true,
    onDetect: "log",
    scanResponses: true,
    maxScanChars: 65_536,
    builtins: "all",
    customPatterns: [],
  },
  audit: { enabled: true, path: undefined, maxBytes: 16 * 1024 * 1024 },
  logging: { perCallLine: true },
  notifications: {
    webhookUrl: undefined,
    thresholds: [0.5, 0.9, 1.0],
    events: ["budget_threshold", "kill_switch", "breaker_open"],
    timeoutMs: 5_000,
  },
};

export function normalizeConfig(raw: unknown): ClawGuardConfig {
  const root = asRecord(raw);
  const budget = asRecord(root.budget);
  const downgrade = asRecord(root.downgrade);
  const killSwitch = asRecord(root.killSwitch);
  const breaker = asRecord(root.breaker);
  const anomaly = asRecord(root.anomaly);
  const dlp = asRecord(root.dlp);
  const audit = asRecord(root.audit);
  const logging = asRecord(root.logging);
  const notifications = asRecord(root.notifications);

  return {
    mode: enumOr(root.mode, ["enforce", "shadow"], DEFAULT_CONFIG.mode),
    failMode: enumOr(root.failMode, ["open", "closed"], DEFAULT_CONFIG.failMode),
    budget: {
      windowMs: positiveIntOr(budget.windowMs, DEFAULT_CONFIG.budget.windowMs),
      maxTokens: optionalPositiveInt(budget.maxTokens),
      maxUsd: optionalPositiveNumber(budget.maxUsd),
      softLimitRatio: ratioOr(budget.softLimitRatio, DEFAULT_CONFIG.budget.softLimitRatio),
      delayMs: nonNegativeIntOr(budget.delayMs, DEFAULT_CONFIG.budget.delayMs),
      reserveTokens: nonNegativeIntOr(budget.reserveTokens, DEFAULT_CONFIG.budget.reserveTokens),
      reserveUsd: nonNegativeNumberOr(budget.reserveUsd, DEFAULT_CONFIG.budget.reserveUsd),
      persist: boolOr(budget.persist, DEFAULT_CONFIG.budget.persist),
      persistPath: nonEmptyStringOr(budget.persistPath, undefined),
    },
    downgrade: {
      to: typeof downgrade.to === "string" ? parseTier(downgrade.to) : undefined,
      whenBudgetRatioAbove: ratioOrZero(
        downgrade.whenBudgetRatioAbove,
        DEFAULT_CONFIG.downgrade.whenBudgetRatioAbove,
      ),
    },
    killSwitch: {
      enabled: boolOr(killSwitch.enabled, DEFAULT_CONFIG.killSwitch.enabled),
      file: nonEmptyStringOr(killSwitch.file, undefined),
    },
    breaker: {
      enabled: boolOr(breaker.enabled, DEFAULT_CONFIG.breaker.enabled),
      threshold: positiveIntOr(breaker.threshold, DEFAULT_CONFIG.breaker.threshold),
      cooldownMs: positiveIntOr(breaker.cooldownMs, DEFAULT_CONFIG.breaker.cooldownMs),
    },
    anomaly: {
      enabled: boolOr(anomaly.enabled, DEFAULT_CONFIG.anomaly.enabled),
      ratio: positiveNumberOr(anomaly.ratio, DEFAULT_CONFIG.anomaly.ratio),
      minSamples: positiveIntOr(anomaly.minSamples, DEFAULT_CONFIG.anomaly.minSamples),
      windowSize: positiveIntOr(anomaly.windowSize, DEFAULT_CONFIG.anomaly.windowSize),
    },
    dlp: {
      enabled: boolOr(dlp.enabled, DEFAULT_CONFIG.dlp.enabled),
      onDetect: enumOr(dlp.onDetect, ["log", "block"], DEFAULT_CONFIG.dlp.onDetect),
      scanResponses: boolOr(dlp.scanResponses, DEFAULT_CONFIG.dlp.scanResponses),
      maxScanChars: positiveIntOr(dlp.maxScanChars, DEFAULT_CONFIG.dlp.maxScanChars),
      builtins: normalizeBuiltins(dlp.builtins),
      customPatterns: normalizeCustomPatterns(dlp.customPatterns),
    },
    audit: {
      enabled: boolOr(audit.enabled, DEFAULT_CONFIG.audit.enabled),
      path: nonEmptyStringOr(audit.path, undefined),
      maxBytes: positiveIntOr(audit.maxBytes, DEFAULT_CONFIG.audit.maxBytes),
    },
    logging: {
      perCallLine: boolOr(logging.perCallLine, DEFAULT_CONFIG.logging.perCallLine),
    },
    notifications: {
      webhookUrl: nonEmptyStringOr(notifications.webhookUrl, undefined),
      thresholds: normalizeThresholds(notifications.thresholds),
      events: normalizeNotificationEvents(notifications.events),
      timeoutMs: positiveIntOr(notifications.timeoutMs, DEFAULT_CONFIG.notifications.timeoutMs),
    },
  };
}

const ALLOWED_NOTIFICATION_KINDS: ReadonlyArray<NotificationKind> = [
  "budget_threshold",
  "kill_switch",
  "breaker_open",
  "cost_anomaly",
];

function normalizeThresholds(v: unknown): number[] {
  if (!Array.isArray(v)) {
    return [...DEFAULT_CONFIG.notifications.thresholds];
  }
  const filtered = v
    .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 1)
    .sort((a, b) => a - b);
  return filtered.length > 0 ? filtered : [...DEFAULT_CONFIG.notifications.thresholds];
}

function normalizeNotificationEvents(v: unknown): NotificationKind[] {
  if (!Array.isArray(v)) {
    return [...DEFAULT_CONFIG.notifications.events];
  }
  const allowed = new Set<string>(ALLOWED_NOTIFICATION_KINDS);
  return v.filter((x): x is NotificationKind => typeof x === "string" && allowed.has(x));
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function enumOr<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function positiveIntOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function nonNegativeIntOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}

function nonNegativeNumberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function optionalPositiveInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

function optionalPositiveNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function positiveNumberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

function ratioOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

/** Like ratioOr but allows 0 (meaning "disabled"). */
function ratioOrZero(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}

function nonEmptyStringOr(v: unknown, fallback: string | undefined): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function normalizeBuiltins(v: unknown): DlpLabel[] | "all" {
  if (v === undefined || v === "all") {
    return "all";
  }
  if (!Array.isArray(v)) {
    return "all";
  }
  const allowed = new Set<string>(BUILTIN_LABELS);
  const filtered = v.filter((x): x is DlpLabel => typeof x === "string" && allowed.has(x));
  return filtered;
}

function normalizeCustomPatterns(
  v: unknown,
): ClawGuardConfig["dlp"]["customPatterns"] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: Array<{
    readonly name: string;
    readonly regex: string;
    readonly flags: string;
    readonly action?: DlpAction;
  }> = [];
  for (const item of v) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" && r.name.length > 0 ? r.name : undefined;
    const regex = typeof r.regex === "string" && r.regex.length > 0 ? r.regex : undefined;
    if (!name || !regex) {
      continue;
    }
    const flags = typeof r.flags === "string" ? r.flags : "";
    const action: DlpAction | undefined =
      r.action === "block" || r.action === "log" ? r.action : undefined;
    out.push(action !== undefined ? { name, regex, flags, action } : { name, regex, flags });
  }
  return out;
}
