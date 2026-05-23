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
import { rateFor } from "./pricing.js";
const REPLACEMENT_MODEL = {
    sonnet: "claude-sonnet-4-5",
    haiku: "claude-haiku-4-5",
    "gpt-4o": "gpt-4o",
    "gpt-3.5-turbo": "gpt-3.5-turbo",
};
/** Parse a `--downgrade-to`-style string. Case-insensitive, accepts aliases. */
export function parseTier(raw) {
    switch (raw.toLowerCase().trim()) {
        case "sonnet":
        case "claude-sonnet":
            return "sonnet";
        case "haiku":
        case "claude-haiku":
            return "haiku";
        case "gpt-4o":
        case "gpt4o":
        case "openai-mid":
            return "gpt-4o";
        case "gpt-3.5":
        case "gpt-3.5-turbo":
        case "openai-cheap":
            return "gpt-3.5-turbo";
        default:
            return undefined;
    }
}
/** Concrete model id substituted into the request when a downgrade fires. */
export function replacementModel(tier) {
    return REPLACEMENT_MODEL[tier];
}
const NO_DOWNGRADE = {
    wouldDowngrade: false,
    savedPerMillionUsd: 0,
};
/**
 * Decide whether `model` should be downgraded to `target`. Returns the
 * replacement model id and the input-rate saving when it should.
 */
export function evaluate(provider, model, target) {
    if (!model) {
        return NO_DOWNGRADE;
    }
    const detectedRate = rateFor(provider, model).inputPerMillionUsd;
    const replacement = replacementModel(target);
    const targetRate = rateFor(provider, replacement).inputPerMillionUsd;
    // Never "downgrade" to something equal or pricier, and never act on an
    // unknown (zero-rate) source model.
    if (detectedRate === 0 || targetRate >= detectedRate) {
        return NO_DOWNGRADE;
    }
    // Don't rewrite a model that is already the target id.
    if (model.toLowerCase() === replacement.toLowerCase()) {
        return NO_DOWNGRADE;
    }
    return {
        wouldDowngrade: true,
        replacement,
        savedPerMillionUsd: detectedRate - targetRate,
    };
}
/** USD saved on a single call of `inputTokens` given a downgrade decision. */
export function savingsUsd(decision, inputTokens) {
    if (!decision.wouldDowngrade) {
        return 0;
    }
    return (inputTokens / 1_000_000) * decision.savedPerMillionUsd;
}
//# sourceMappingURL=downgrade.js.map