/**
 * Plugin configuration: types, defaults, and a defensive normalizer that
 * turns the untyped object OpenClaw hands a plugin into a fully-populated,
 * validated `ClawGuardConfig`. The JSON Schema in `openclaw.plugin.json`
 * mirrors these fields for the gateway's own validation; this normalizer
 * is the runtime backstop and the security boundary for untrusted config.
 */
import { parseTier } from "./core/downgrade.js";
export const DEFAULT_CONFIG = {
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
    dlp: { enabled: true, onDetect: "log", scanResponses: true, maxScanChars: 65_536 },
    audit: { enabled: true, path: undefined, maxBytes: 16 * 1024 * 1024 },
};
export function normalizeConfig(raw) {
    const root = asRecord(raw);
    const budget = asRecord(root.budget);
    const downgrade = asRecord(root.downgrade);
    const killSwitch = asRecord(root.killSwitch);
    const breaker = asRecord(root.breaker);
    const dlp = asRecord(root.dlp);
    const audit = asRecord(root.audit);
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
            whenBudgetRatioAbove: ratioOrZero(downgrade.whenBudgetRatioAbove, DEFAULT_CONFIG.downgrade.whenBudgetRatioAbove),
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
        dlp: {
            enabled: boolOr(dlp.enabled, DEFAULT_CONFIG.dlp.enabled),
            onDetect: enumOr(dlp.onDetect, ["log", "block"], DEFAULT_CONFIG.dlp.onDetect),
            scanResponses: boolOr(dlp.scanResponses, DEFAULT_CONFIG.dlp.scanResponses),
            maxScanChars: positiveIntOr(dlp.maxScanChars, DEFAULT_CONFIG.dlp.maxScanChars),
        },
        audit: {
            enabled: boolOr(audit.enabled, DEFAULT_CONFIG.audit.enabled),
            path: nonEmptyStringOr(audit.path, undefined),
            maxBytes: positiveIntOr(audit.maxBytes, DEFAULT_CONFIG.audit.maxBytes),
        },
    };
}
function asRecord(v) {
    return typeof v === "object" && v !== null ? v : {};
}
function boolOr(v, fallback) {
    return typeof v === "boolean" ? v : fallback;
}
function enumOr(v, allowed, fallback) {
    return typeof v === "string" && allowed.includes(v) ? v : fallback;
}
function positiveIntOr(v, fallback) {
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}
function nonNegativeIntOr(v, fallback) {
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;
}
function nonNegativeNumberOr(v, fallback) {
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}
function optionalPositiveInt(v) {
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}
function optionalPositiveNumber(v) {
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}
function ratioOr(v, fallback) {
    return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}
/** Like ratioOr but allows 0 (meaning "disabled"). */
function ratioOrZero(v, fallback) {
    return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : fallback;
}
function nonEmptyStringOr(v, fallback) {
    return typeof v === "string" && v.length > 0 ? v : fallback;
}
//# sourceMappingURL=config.js.map