/**
 * Regex-based DLP detectors for PII / secrets. Ported verbatim (patterns
 * and guards) from turbo-flow's `compliance.rs`. Each detector is cheap
 * enough to run on the hot path, one message at a time.
 *
 * `scan` returns a stable-ordered list of category labels; empty when
 * nothing fires.
 */
export type DlpLabel = "email" | "phone" | "credit_card" | "ssn" | "api_key" | "bearer_token";
/** Default cap on scanned characters — bounds regex cost on large payloads. */
export declare const DEFAULT_MAX_SCAN_CHARS = 65536;
export declare function scan(input: string, maxChars?: number): DlpLabel[];
//# sourceMappingURL=dlp.d.ts.map