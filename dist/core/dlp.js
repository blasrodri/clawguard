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
export const BUILTIN_LABELS = [
    "email",
    "phone",
    "credit_card",
    "ssn",
    "api_key",
    "bearer_token",
];
/** Default cap on scanned characters — bounds regex cost on large payloads. */
export const DEFAULT_MAX_SCAN_CHARS = 65_536;
// Permissive local part to catch "first.last+tag@example.co.uk".
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
// E.164-ish: optional country code then 7-15 digits with separators.
const PHONE = /(?:\+?\d{1,3}[\s\-.]?)?(?:\(\d{2,4}\)[\s\-.]?)?\d{3,4}[\s\-.]?\d{3,4}(?:[\s\-.]?\d{2,4})?/g;
// 13-19 digit groups; Luhn applied separately to avoid order-id hits.
const CREDIT_CARD = /\b(?:\d[ \-]*?){13,19}\b/g;
// US SSN (XXX-XX-XXXX).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
// Common vendor API-key shapes; match the whole token, not just prefix.
const API_KEY = /\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{35}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/;
// Authorization / x-api-key header position with a token-length value.
const BEARER = /\b(?:authorization|x-api-key)\s*[:=]\s*(?:bearer\s+)?[A-Za-z0-9._\-]{20,}/i;
/** Stateful detector built from a config snapshot. */
export class Detectors {
    builtinsEnabled;
    custom;
    defaultAction;
    maxChars;
    constructor(options) {
        const b = options.builtins ?? "all";
        this.builtinsEnabled = new Set(b === "all" ? BUILTIN_LABELS : b);
        this.custom = options.custom ?? [];
        this.defaultAction = options.defaultAction;
        this.maxChars = options.maxChars ?? DEFAULT_MAX_SCAN_CHARS;
    }
    scan(input) {
        const text = input.length > this.maxChars ? input.slice(0, this.maxChars) : input;
        const hits = [];
        if (this.builtinsEnabled.has("email") && EMAIL.test(text)) {
            hits.push({ label: "email", action: this.defaultAction });
        }
        if (this.builtinsEnabled.has("phone")) {
            // Phone is noisy: require a separator-shaped match AND low overall digit
            // density, so JSON token blobs ("input_tokens": 554) don't false-positive.
            const phoneMatches = text.match(PHONE) ?? [];
            const phoneShaped = phoneMatches.some((m) => m.startsWith("+") || m.includes("-") || m.includes(" ") || m.includes("."));
            if (phoneShaped && phoneDensityOk(text)) {
                hits.push({ label: "phone", action: this.defaultAction });
            }
        }
        if (this.builtinsEnabled.has("credit_card")) {
            const cardMatches = text.match(CREDIT_CARD) ?? [];
            if (cardMatches.some(luhnOk)) {
                hits.push({ label: "credit_card", action: this.defaultAction });
            }
        }
        if (this.builtinsEnabled.has("ssn") && SSN.test(text)) {
            hits.push({ label: "ssn", action: this.defaultAction });
        }
        if (this.builtinsEnabled.has("api_key") && API_KEY.test(text)) {
            hits.push({ label: "api_key", action: this.defaultAction });
        }
        if (this.builtinsEnabled.has("bearer_token") && BEARER.test(text)) {
            hits.push({ label: "bearer_token", action: this.defaultAction });
        }
        for (const pattern of this.custom) {
            // RegExp.test() is stateful for /g patterns — reset lastIndex so a
            // detector instance reused across many scans behaves consistently.
            pattern.regex.lastIndex = 0;
            if (pattern.regex.test(text)) {
                hits.push({ label: pattern.name, action: pattern.action ?? this.defaultAction });
            }
        }
        return hits;
    }
}
/**
 * Convenience: scan with the six built-ins at `log` severity, no custom
 * patterns. Retained for callers that just want a label list — the
 * Detectors class is what the governor actually uses in production.
 */
export function scan(input, maxChars = DEFAULT_MAX_SCAN_CHARS) {
    const detector = new Detectors({ defaultAction: "log", maxChars });
    return detector.scan(input).map((d) => d.label);
}
/** Refuse to flag phone numbers in text that is mostly digits (JSON blobs). */
function phoneDensityOk(text) {
    const totalChars = text.length;
    if (totalChars === 0) {
        return false;
    }
    let digits = 0;
    for (const ch of text) {
        if (ch >= "0" && ch <= "9") {
            digits++;
        }
    }
    return (digits * 100) / totalChars < 40;
}
/** Luhn checksum over a 13-19 digit string with separators. */
function luhnOk(candidate) {
    const digits = [];
    for (const ch of candidate) {
        if (ch >= "0" && ch <= "9") {
            digits.push(ch.charCodeAt(0) - 48);
        }
    }
    if (digits.length < 13 || digits.length > 19) {
        return false;
    }
    let sum = 0;
    let alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
        let x = digits[i];
        if (alt) {
            x *= 2;
            if (x > 9) {
                x -= 9;
            }
        }
        sum += x;
        alt = !alt;
    }
    return sum % 10 === 0;
}
//# sourceMappingURL=dlp.js.map