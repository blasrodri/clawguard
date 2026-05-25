/**
 * Budget forecasting. Pure projection from current burn rate — no state
 * of its own. Used by `clarguard report` to render "at $X/hour you'll
 * hit the cap in Yh" and by future alerting that wants a lead time
 * rather than a threshold crossing.
 *
 * The hardest decision here is *reliability*: extrapolating from the
 * first 30 seconds of a 24-hour window is meaningless. We gate the
 * projection on `elapsed >= max(30s, windowMs * 1%)` — long enough that
 * a single spike doesn't dominate, but short enough that even a 60s
 * window produces a forecast after half a minute.
 */
const MS_PER_HOUR = 3_600_000;
export function forecast(input) {
    const elapsed = Math.max(0, input.now - input.windowStartedAt);
    const minimumElapsed = Math.max(30_000, input.windowMs * 0.01);
    if (elapsed < minimumElapsed) {
        return {
            projectedEndOfWindowUsd: undefined,
            projectedEndOfWindowTokens: undefined,
            hitsCapAt: undefined,
            burnRateUsdPerHour: 0,
            burnRateTokensPerHour: 0,
            reliable: false,
        };
    }
    const burnUsdPerMs = input.spentUsd / elapsed;
    const burnTokensPerMs = input.spentTokens / elapsed;
    const remainingMs = Math.max(0, input.windowMs - elapsed);
    const projectedEndOfWindowUsd = input.capUsd !== undefined ? input.spentUsd + burnUsdPerMs * remainingMs : undefined;
    const projectedEndOfWindowTokens = input.capTokens !== undefined
        ? input.spentTokens + burnTokensPerMs * remainingMs
        : undefined;
    const hitsCapAt = earliestCapHit(input, burnUsdPerMs, burnTokensPerMs);
    return {
        projectedEndOfWindowUsd,
        projectedEndOfWindowTokens,
        hitsCapAt,
        burnRateUsdPerHour: burnUsdPerMs * MS_PER_HOUR,
        burnRateTokensPerHour: burnTokensPerMs * MS_PER_HOUR,
        reliable: true,
    };
}
function earliestCapHit(input, burnUsdPerMs, burnTokensPerMs) {
    const windowEnd = input.windowStartedAt + input.windowMs;
    const candidates = [];
    const usdHit = capHit(input.spentUsd, input.capUsd, burnUsdPerMs, input.now, windowEnd);
    if (usdHit !== undefined) {
        candidates.push(usdHit);
    }
    const tokenHit = capHit(input.spentTokens, input.capTokens, burnTokensPerMs, input.now, windowEnd);
    if (tokenHit !== undefined) {
        candidates.push(tokenHit);
    }
    return candidates.length > 0 ? Math.min(...candidates) : undefined;
}
function capHit(spent, cap, burnPerMs, now, windowEnd) {
    if (cap === undefined || cap <= 0) {
        return undefined;
    }
    if (spent >= cap) {
        return now; // already over
    }
    if (burnPerMs <= 0) {
        return undefined;
    }
    const msToHit = (cap - spent) / burnPerMs;
    const hitAt = now + msToHit;
    return hitAt < windowEnd ? hitAt : undefined;
}
/** Render an ms duration as `1h 12m` / `45m` / `30s` for human reading. */
export function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) {
        return "?";
    }
    const seconds = Math.round(ms / 1000);
    if (seconds < 60) {
        return `${seconds}s`;
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours < 24) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}
//# sourceMappingURL=forecast.js.map