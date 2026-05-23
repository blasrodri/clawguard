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

const ZERO_RATE: PricingRate = {
  inputPerMillionUsd: 0,
  outputPerMillionUsd: 0,
};

export type Provider = "anthropic" | "openai" | (string & {});

/** Resolve the pricing rate for a provider/model pair. */
export function rateFor(provider: Provider, model: string | undefined): PricingRate {
  const m = (model ?? "").toLowerCase();
  switch (provider) {
    case "anthropic":
      return anthropicRate(m);
    case "openai":
      return openaiRate(m);
    default:
      return ZERO_RATE;
  }
}

function anthropicRate(model: string): PricingRate {
  if (model.includes("opus")) {
    return { inputPerMillionUsd: 15.0, outputPerMillionUsd: 75.0 };
  }
  if (model.includes("sonnet")) {
    return { inputPerMillionUsd: 3.0, outputPerMillionUsd: 15.0 };
  }
  if (model.includes("haiku")) {
    return { inputPerMillionUsd: 0.8, outputPerMillionUsd: 4.0 };
  }
  return ZERO_RATE;
}

function openaiRate(model: string): PricingRate {
  // Order matters: reasoning models first, then gpt-4 family, then 3.5.
  if (model.includes("o3") || model.includes("o1")) {
    return { inputPerMillionUsd: 15.0, outputPerMillionUsd: 60.0 };
  }
  if (model.includes("gpt-4")) {
    return { inputPerMillionUsd: 5.0, outputPerMillionUsd: 15.0 };
  }
  if (model.includes("gpt-3.5")) {
    return { inputPerMillionUsd: 0.5, outputPerMillionUsd: 1.5 };
  }
  return ZERO_RATE;
}

function inputCostUsd(rate: PricingRate, tokens: number): number {
  return (tokens / 1_000_000) * rate.inputPerMillionUsd;
}

function outputCostUsd(rate: PricingRate, tokens: number): number {
  return (tokens / 1_000_000) * rate.outputPerMillionUsd;
}

/**
 * Total USD cost for a call. `cacheReadTokens` are billed separately from
 * `inputTokens` at ~10% of the input rate (Anthropic's prompt-caching
 * read price), so passing them as ordinary input would overcount. Cache
 * *creation* surcharges (5m/1h) are not modelled — a documented
 * approximation, conservative for budgeting.
 */
export function costUsd(
  provider: Provider,
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
): number {
  const rate = rateFor(provider, model);
  const cacheReadCost = (cacheReadTokens / 1_000_000) * rate.inputPerMillionUsd * 0.1;
  return inputCostUsd(rate, inputTokens) + outputCostUsd(rate, outputTokens) + cacheReadCost;
}
