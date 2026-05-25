/**
 * Budget forecasting. Pure projection from current burn rate — no state
 * of its own. Used by `clawguard report` to render "at $X/hour you'll
 * hit the cap in Yh" and by future alerting that wants a lead time
 * rather than a threshold crossing.
 *
 * The hardest decision here is *reliability*: extrapolating from the
 * first 30 seconds of a 24-hour window is meaningless. We gate the
 * projection on `elapsed >= max(30s, windowMs * 1%)` — long enough that
 * a single spike doesn't dominate, but short enough that even a 60s
 * window produces a forecast after half a minute.
 */
export interface ForecastInput {
    readonly windowStartedAt: number;
    readonly windowMs: number;
    readonly spentUsd: number;
    readonly spentTokens: number;
    readonly capUsd: number | undefined;
    readonly capTokens: number | undefined;
    readonly now: number;
}
export interface BudgetForecast {
    /** Linear projection of spend at window end (`undefined` when no cap). */
    readonly projectedEndOfWindowUsd: number | undefined;
    readonly projectedEndOfWindowTokens: number | undefined;
    /** Wall-clock timestamp when the tightest cap is projected to be hit. */
    readonly hitsCapAt: number | undefined;
    readonly burnRateUsdPerHour: number;
    readonly burnRateTokensPerHour: number;
    /** False when too early in the window for a meaningful projection. */
    readonly reliable: boolean;
}
export declare function forecast(input: ForecastInput): BudgetForecast;
/** Render an ms duration as `1h 12m` / `45m` / `30s` for human reading. */
export declare function formatDuration(ms: number): string;
//# sourceMappingURL=forecast.d.ts.map