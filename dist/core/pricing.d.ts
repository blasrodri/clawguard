/**
 * Per-model token pricing. Ported from turbo-flow's `pricing.rs` rate
 * table. Rates are USD per million tokens and are matched by substring
 * so that dated model ids (`claude-opus-4-5`, `gpt-4o-2024-08-06`, ...)
 * resolve to their family rate without an exhaustive id list.
 */
export interface PricingRate {
    readonly inputPerMillionUsd: number;
    readonly outputPerMillionUsd: number;
}
export type Provider = "anthropic" | "openai" | (string & {});
/** Resolve the pricing rate for a provider/model pair. */
export declare function rateFor(provider: Provider, model: string | undefined): PricingRate;
/**
 * Total USD cost for a call. `cacheReadTokens` are billed separately from
 * `inputTokens` at ~10% of the input rate (Anthropic's prompt-caching
 * read price), so passing them as ordinary input would overcount. Cache
 * *creation* surcharges (5m/1h) are not modelled — a documented
 * approximation, conservative for budgeting.
 */
export declare function costUsd(provider: Provider, model: string | undefined, inputTokens: number, outputTokens: number, cacheReadTokens?: number): number;
//# sourceMappingURL=pricing.d.ts.map