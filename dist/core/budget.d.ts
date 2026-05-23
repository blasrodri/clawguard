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
import type { GovernanceStore } from "./store.js";
export type BudgetAction = "pass" | "delay" | "block";
export interface BudgetConfig {
    /** Fixed window length in milliseconds. */
    readonly windowMs: number;
    /** Token ceiling per window. `undefined` or `0` means unlimited. */
    readonly maxTokens?: number;
    /** USD ceiling per window. `undefined` or `0` means unlimited. */
    readonly maxUsd?: number;
    /** Fraction of a ceiling at which to start delaying (e.g. 0.9). */
    readonly softLimitRatio: number;
    /** Delay applied (ms) when usage is in the soft-limit band. */
    readonly delayMs: number;
}
export interface BudgetDecision {
    readonly action: BudgetAction;
    readonly reason: string;
    readonly delayMs: number;
    readonly tokenRatio: number;
    readonly usdRatio: number;
}
export interface BudgetSnapshot {
    readonly windowStartedAt: number;
    readonly windowMs: number;
    readonly tokensUsed: number;
    readonly usdUsed: number;
    readonly outstandingReserves: number;
    readonly maxTokens: number | undefined;
    readonly maxUsd: number | undefined;
}
export type Clock = () => number;
export declare class BudgetWindow {
    private readonly config;
    private readonly store;
    private readonly now;
    private windowStart;
    private tokensUsed;
    private usdUsed;
    private readonly pending;
    constructor(config: BudgetConfig, store?: GovernanceStore, now?: Clock);
    /** Pre-charge an estimate for an in-flight call. */
    reserve(tokens: number, usd: number): void;
    /** Replace the oldest outstanding reserve with authoritative usage. */
    settle(tokens: number, usd: number): void;
    /** Evaluate the current window against the configured ceilings. */
    decide(): BudgetDecision;
    /** Current usage as a fraction of the tightest ceiling (0 if unlimited). */
    peakRatio(): number;
    snapshot(): BudgetSnapshot;
    /** Force-reset the window (operator "reset budget" action). */
    reset(): void;
    private rotateIfNeeded;
    private clampNonNegative;
    private persist;
}
//# sourceMappingURL=budget.d.ts.map