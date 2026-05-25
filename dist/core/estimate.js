/**
 * Pre-flight cost estimator.
 *
 * Before the call goes out, we want a number to show the developer:
 * "this turn is about to cost $0.18." We don't bundle a real tokenizer
 * (it would blow the zero-runtime-deps promise), so this uses the
 * industry-standard chars/4 heuristic — roughly correct for English,
 * off by a factor of ~1.5 in either direction for code-heavy or
 * non-Latin content. The estimate is always labelled "est" in the log
 * line so a curious user knows it's not authoritative.
 *
 * Whenever the OpenClaw context already carries a real token count
 * (`promptTokens`, `tokenEstimate`, etc.), the SDK reader uses it
 * directly and bypasses the heuristic.
 */
import { costUsd } from "./pricing.js";
const CHARS_PER_TOKEN = 4;
/** Approximate input-token count for arbitrary text. */
export function estimateTokensFromText(text) {
    if (!text) {
        return 0;
    }
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}
/**
 * Projected USD cost for a call given an input-token count. Output tokens
 * are unknown pre-call; default to 0 so the figure is a strict lower
 * bound — overshoot is the user's problem to investigate, not ours to
 * pretend away with a guess.
 */
export function estimateCallCostUsd(provider, model, inputTokens, outputTokens = 0) {
    return costUsd(provider, model, inputTokens, outputTokens);
}
//# sourceMappingURL=estimate.js.map