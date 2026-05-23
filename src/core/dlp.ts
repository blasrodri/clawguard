/**
 * Regex-based DLP detectors for PII / secrets. Ported verbatim (patterns
 * and guards) from turbo-flow's `compliance.rs`. Each detector is cheap
 * enough to run on the hot path, one message at a time.
 *
 * `scan` returns a stable-ordered list of category labels; empty when
 * nothing fires.
 */

export type DlpLabel =
  | "email"
  | "phone"
  | "credit_card"
  | "ssn"
  | "api_key"
  | "bearer_token";

// Permissive local part to catch "first.last+tag@example.co.uk".
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
// E.164-ish: optional country code then 7-15 digits with separators.
const PHONE = /(?:\+?\d{1,3}[\s\-.]?)?(?:\(\d{2,4}\)[\s\-.]?)?\d{3,4}[\s\-.]?\d{3,4}(?:[\s\-.]?\d{2,4})?/g;
// 13-19 digit groups; Luhn applied separately to avoid order-id hits.
const CREDIT_CARD = /\b(?:\d[ \-]*?){13,19}\b/g;
// US SSN (XXX-XX-XXXX).
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;
// Common vendor API-key shapes; match the whole token, not just prefix.
const API_KEY =
  /\b(?:sk-[A-Za-z0-9_-]{20,}|sk_live_[A-Za-z0-9]{20,}|sk_test_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{35}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b/;
// Authorization / x-api-key header position with a token-length value.
const BEARER = /\b(?:authorization|x-api-key)\s*[:=]\s*(?:bearer\s+)?[A-Za-z0-9._\-]{20,}/i;

/** Default cap on scanned characters — bounds regex cost on large payloads. */
export const DEFAULT_MAX_SCAN_CHARS = 65_536;

export function scan(input: string, maxChars: number = DEFAULT_MAX_SCAN_CHARS): DlpLabel[] {
  // Cap the scanned length so a multi-megabyte (or adversarial) payload
  // can't stall the gateway's hot path on backtracking regexes.
  const text = input.length > maxChars ? input.slice(0, maxChars) : input;
  const hits: DlpLabel[] = [];

  if (EMAIL.test(text)) {
    hits.push("email");
  }

  // Phone is noisy: require a separator-shaped match AND low overall digit
  // density, so JSON token blobs ("input_tokens": 554) don't false-positive.
  const phoneMatches = text.match(PHONE) ?? [];
  const phoneShaped = phoneMatches.some(
    (m) => m.startsWith("+") || m.includes("-") || m.includes(" ") || m.includes("."),
  );
  if (phoneShaped && phoneDensityOk(text)) {
    hits.push("phone");
  }

  const cardMatches = text.match(CREDIT_CARD) ?? [];
  if (cardMatches.some(luhnOk)) {
    hits.push("credit_card");
  }

  if (SSN.test(text)) {
    hits.push("ssn");
  }
  if (API_KEY.test(text)) {
    hits.push("api_key");
  }
  if (BEARER.test(text)) {
    hits.push("bearer_token");
  }

  return hits;
}

/** Refuse to flag phone numbers in text that is mostly digits (JSON blobs). */
function phoneDensityOk(text: string): boolean {
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
function luhnOk(candidate: string): boolean {
  const digits: number[] = [];
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
    let x = digits[i] as number;
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
