/**
 * Regex-based DLP detectors for PII / secrets / operator-defined patterns.
 *
 * The six built-ins are ported verbatim (patterns and guards) from
 * turbo-flow's `compliance.rs`. Custom patterns come from the operator's
 * config — they get their own label and (optionally) their own action,
 * so a team can say "log internal codenames but BLOCK any leak of our
 * customer-id format" in one config block.
 *
 * Each detector is cheap enough to run on the hot path one message at a
 * time. Input is capped at `maxChars` (default 64 KiB) so a multi-MiB
 * payload or an adversarial digit run can't stall the gateway.
 */
export type DlpLabel = "email" | "phone" | "credit_card" | "ssn" | "api_key" | "bearer_token";
export declare const BUILTIN_LABELS: readonly DlpLabel[];
export type DlpAction = "log" | "block";
export interface CustomPattern {
    readonly name: string;
    readonly regex: RegExp;
    /** Overrides the detector's default action when this pattern matches. */
    readonly action?: DlpAction;
}
export interface Detection {
    readonly label: string;
    readonly action: DlpAction;
}
export interface DetectorOptions {
    /** Which built-ins to run. `"all"` (default) or a subset. */
    readonly builtins?: DlpLabel[] | "all";
    /** Pre-compiled operator-defined patterns. Invalid ones must be filtered
     *  upstream — Detectors trusts the regexes it receives. */
    readonly custom?: ReadonlyArray<CustomPattern>;
    /** Action used for any matched pattern that doesn't specify its own. */
    readonly defaultAction: DlpAction;
    /** Cap on scanned characters. */
    readonly maxChars?: number;
}
/** Default cap on scanned characters — bounds regex cost on large payloads. */
export declare const DEFAULT_MAX_SCAN_CHARS = 65536;
/** Stateful detector built from a config snapshot. */
export declare class Detectors {
    private readonly builtinsEnabled;
    private readonly custom;
    private readonly defaultAction;
    private readonly maxChars;
    constructor(options: DetectorOptions);
    scan(input: string): Detection[];
}
/**
 * Convenience: scan with the six built-ins at `log` severity, no custom
 * patterns. Retained for callers that just want a label list — the
 * Detectors class is what the governor actually uses in production.
 */
export declare function scan(input: string, maxChars?: number): DlpLabel[];
//# sourceMappingURL=dlp.d.ts.map