/**
 * Plugin configuration: types, defaults, and a defensive normalizer that
 * turns the untyped object OpenClaw hands a plugin into a fully-populated,
 * validated `ClawGuardConfig`. The JSON Schema in `openclaw.plugin.json`
 * mirrors these fields for the gateway's own validation; this normalizer
 * is the runtime backstop and the security boundary for untrusted config.
 */
import { type DowngradeTier } from "./core/downgrade.js";
import { type DlpLabel } from "./core/dlp.js";
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
export declare const DEFAULT_CONFIG: ClawGuardConfig;
export declare function normalizeConfig(raw: unknown): ClawGuardConfig;
//# sourceMappingURL=config.d.ts.map