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
import { type Provider } from "./pricing.js";
/** Approximate input-token count for arbitrary text. */
export declare function estimateTokensFromText(text: string | undefined | null): number;
/**
 * Projected USD cost for a call given an input-token count. Output tokens
 * are unknown pre-call; default to 0 so the figure is a strict lower
 * bound — overshoot is the user's problem to investigate, not ours to
 * pretend away with a guess.
 */
export declare function estimateCallCostUsd(provider: Provider, model: string | undefined, inputTokens: number, outputTokens?: number): number;
//# sourceMappingURL=estimate.d.ts.map