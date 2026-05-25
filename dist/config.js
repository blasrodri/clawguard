/**
 * Plugin configuration: types, defaults, and a defensive normalizer that
 * turns the untyped object OpenClaw hands a plugin into a fully-populated,
 * validated `ClarGuardConfig`. The JSON Schema in `openclaw.plugin.json`
 * mirrors these fields for the gateway's own validation; this normalizer
 * is the runtime backstop and the security boundary for untrusted config.
 */
import { parseTier } from "./core/downgrade.js";
import { BUILTIN_LABELS } from "./core/dlp.js";
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
export function normalizeConfig(raw) {
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
const ALLOWED_NOTIFICATION_KINDS = [
    "budget_threshold",
    "kill_switch",
    "breaker_open",
    "cost_anomaly",
];
function normalizeThresholds(v) {
    if (!Array.isArray(v)) {
        return [...DEFAULT_CONFIG.notifications.thresholds];
    }
    const filtered = v
        .filter((x) => typeof x === "number" && Number.isFinite(x) && x > 0 && x <= 1)
        .sort((a, b) => a - b);
    return filtered.length > 0 ? filtered : [...DEFAULT_CONFIG.notifications.thresholds];
}
function normalizeNotificationEvents(v) {
    if (!Array.isArray(v)) {
        return [...DEFAULT_CONFIG.notifications.events];
    }
    const allowed = new Set(ALLOWED_NOTIFICATION_KINDS);
    return v.filter((x) => typeof x === "string" && allowed.has(x));
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
function positiveNumberOr(v, fallback) {
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
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
function normalizeBuiltins(v) {
    if (v === undefined || v === "all") {
        return "all";
    }
    if (!Array.isArray(v)) {
        return "all";
    }
    const allowed = new Set(BUILTIN_LABELS);
    const filtered = v.filter((x) => typeof x === "string" && allowed.has(x));
    return filtered;
}
function normalizeCustomPatterns(v) {
    if (!Array.isArray(v)) {
        return [];
    }
    const out = [];
    for (const item of v) {
        if (typeof item !== "object" || item === null) {
            continue;
        }
        const r = item;
        const name = typeof r.name === "string" && r.name.length > 0 ? r.name : undefined;
        const regex = typeof r.regex === "string" && r.regex.length > 0 ? r.regex : undefined;
        if (!name || !regex) {
            continue;
        }
        const flags = typeof r.flags === "string" ? r.flags : "";
        const action = r.action === "block" || r.action === "log" ? r.action : undefined;
        out.push(action !== undefined ? { name, regex, flags, action } : { name, regex, flags });
    }
    return out;
}
//# sourceMappingURL=config.js.map