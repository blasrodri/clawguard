/**
 * Policy-driven model downgrade. Ported from turbo-flow's `downgrade.rs`,
 * but where turbo-flow could only run this in *shadow* mode (it observed
 * traffic out-of-band and could not rewrite it), the OpenClaw
 * `before_model_resolve` hook lets us return a real `modelOverride` —
 * the downgrade actually happens.
 *
 * A request is downgraded only when its model is *strictly more
 * expensive* (by input rate) than the configured target. Requests
 * already at or below the target tier pass through untouched.
 */
import { type Provider } from "./pricing.js";
export type DowngradeTier = "sonnet" | "haiku" | "gpt-4o" | "gpt-3.5-turbo";
/** Parse a `--downgrade-to`-style string. Case-insensitive, accepts aliases. */
export declare function parseTier(raw: string): DowngradeTier | undefined;
/** Concrete model id substituted into the request when a downgrade fires. */
export declare function replacementModel(tier: DowngradeTier): string;
export interface DowngradeDecision {
    readonly wouldDowngrade: boolean;
    /** Replacement model id, present only when `wouldDowngrade` is true. */
    readonly replacement?: string;
    /** Input-rate delta (USD per million tokens) saved by the downgrade. */
    readonly savedPerMillionUsd: number;
}
/**
 * Decide whether `model` should be downgraded to `target`. Returns the
 * replacement model id and the input-rate saving when it should.
 */
export declare function evaluate(provider: Provider, model: string | undefined, target: DowngradeTier): DowngradeDecision;
/** USD saved on a single call of `inputTokens` given a downgrade decision. */
export declare function savingsUsd(decision: DowngradeDecision, inputTokens: number): number;
//# sourceMappingURL=downgrade.d.ts.map