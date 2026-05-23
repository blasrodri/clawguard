/**
 * Global, single-instance, **fixed-window** token+cost budget.
 *
 * "Fixed window" (not sliding): usage accumulates until `windowMs` since
 * the window start elapses, then resets to zero. This is simple and
 * cheap; the known trade-off is that a burst straddling a window boundary
 * can briefly exceed the nominal rate. A sliding window can slot in later
 * without changing the public surface.
 *
 * Two-phase charging (the honest version of "enforcement"):
 *   - `reserve(tokens, usd)` is called before a call goes out, so an
 *     in-flight (and not-yet-billed) call already counts against the
 *     budget. This bounds overshoot and stops N concurrent calls from all
 *     sailing through a check that only sees already-billed usage.
 *   - `settle(tokens, usd)` swaps the oldest outstanding reserve for the
 *     authoritative usage once the response arrives.
 * With `reserve` amounts left at zero this degrades to purely reactive
 * accounting — correct, just looser.
 *
 * State is persisted through a {@link GovernanceStore} so day/week budgets
 * survive a gateway restart.
 */
import { MemoryStore } from "./store.js";
export class BudgetWindow {
    config;
    store;
    now;
    windowStart;
    tokensUsed = 0;
    usdUsed = 0;
    pending = [];
    constructor(config, store = new MemoryStore(), now = Date.now) {
        this.config = config;
        this.store = store;
        this.now = now;
        const persisted = store.load();
        if (persisted && now() - persisted.windowStart < config.windowMs) {
            this.windowStart = persisted.windowStart;
            this.tokensUsed = persisted.tokensUsed;
            this.usdUsed = persisted.usdUsed;
        }
        else {
            this.windowStart = now();
        }
    }
    /** Pre-charge an estimate for an in-flight call. */
    reserve(tokens, usd) {
        this.rotateIfNeeded();
        const r = { tokens: Math.max(0, tokens), usd: Math.max(0, usd) };
        if (r.tokens === 0 && r.usd === 0) {
            return; // reserve disabled; nothing to track
        }
        this.pending.push(r);
        this.tokensUsed += r.tokens;
        this.usdUsed += r.usd;
        this.persist();
    }
    /** Replace the oldest outstanding reserve with authoritative usage. */
    settle(tokens, usd) {
        this.rotateIfNeeded();
        const r = this.pending.shift();
        if (r) {
            this.tokensUsed += Math.max(0, tokens) - r.tokens;
            this.usdUsed += Math.max(0, usd) - r.usd;
        }
        else {
            this.tokensUsed += Math.max(0, tokens);
            this.usdUsed += Math.max(0, usd);
        }
        this.clampNonNegative();
        this.persist();
    }
    /** Evaluate the current window against the configured ceilings. */
    decide() {
        this.rotateIfNeeded();
        const tokenRatio = ratio(this.tokensUsed, this.config.maxTokens);
        const usdRatio = ratio(this.usdUsed, this.config.maxUsd);
        const peak = Math.max(tokenRatio, usdRatio);
        if (peak >= 1) {
            const which = tokenRatio >= usdRatio ? "token" : "usd";
            return {
                action: "block",
                reason: `${which} budget exhausted for current window`,
                delayMs: 0,
                tokenRatio,
                usdRatio,
            };
        }
        if (peak >= this.config.softLimitRatio) {
            return {
                action: "delay",
                reason: "approaching budget ceiling",
                delayMs: this.config.delayMs,
                tokenRatio,
                usdRatio,
            };
        }
        return { action: "pass", reason: "within budget", delayMs: 0, tokenRatio, usdRatio };
    }
    /** Current usage as a fraction of the tightest ceiling (0 if unlimited). */
    peakRatio() {
        this.rotateIfNeeded();
        return Math.max(ratio(this.tokensUsed, this.config.maxTokens), ratio(this.usdUsed, this.config.maxUsd));
    }
    snapshot() {
        this.rotateIfNeeded();
        return {
            windowStartedAt: this.windowStart,
            windowMs: this.config.windowMs,
            tokensUsed: this.tokensUsed,
            usdUsed: this.usdUsed,
            outstandingReserves: this.pending.length,
            maxTokens: this.config.maxTokens,
            maxUsd: this.config.maxUsd,
        };
    }
    /** Force-reset the window (operator "reset budget" action). */
    reset() {
        this.windowStart = this.now();
        this.tokensUsed = 0;
        this.usdUsed = 0;
        this.pending.length = 0;
        this.persist();
    }
    rotateIfNeeded() {
        if (this.now() - this.windowStart >= this.config.windowMs) {
            this.windowStart = this.now();
            this.tokensUsed = 0;
            this.usdUsed = 0;
            this.pending.length = 0;
            this.persist();
        }
    }
    clampNonNegative() {
        if (this.tokensUsed < 0) {
            this.tokensUsed = 0;
        }
        if (this.usdUsed < 0) {
            this.usdUsed = 0;
        }
    }
    persist() {
        this.store.save({
            windowStart: this.windowStart,
            tokensUsed: this.tokensUsed,
            usdUsed: this.usdUsed,
        });
    }
}
function ratio(used, ceiling) {
    if (!ceiling || ceiling <= 0) {
        return 0;
    }
    return used / ceiling;
}
//# sourceMappingURL=budget.js.map