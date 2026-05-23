import { describe, expect, it } from "vitest";
import { costUsd, rateFor } from "../src/core/pricing.js";

describe("pricing.rateFor", () => {
  it("prices anthropic tiers by family substring", () => {
    expect(rateFor("anthropic", "claude-opus-4-5").inputPerMillionUsd).toBe(15);
    expect(rateFor("anthropic", "claude-sonnet-4-5").inputPerMillionUsd).toBe(3);
    expect(rateFor("anthropic", "claude-haiku-4-5").inputPerMillionUsd).toBe(0.8);
  });

  it("prices openai families with reasoning models first", () => {
    expect(rateFor("openai", "o3").inputPerMillionUsd).toBe(15);
    expect(rateFor("openai", "gpt-4o-2024-08-06").inputPerMillionUsd).toBe(5);
    expect(rateFor("openai", "gpt-3.5-turbo").inputPerMillionUsd).toBe(0.5);
  });

  it("returns zero for unknown provider or model", () => {
    expect(rateFor("anthropic", "made-up").inputPerMillionUsd).toBe(0);
    expect(rateFor("cohere", "command").inputPerMillionUsd).toBe(0);
    expect(rateFor("anthropic", undefined).inputPerMillionUsd).toBe(0);
  });

  it("computes total cost from input + output tokens", () => {
    // opus: 1M input @ $15 + 1M output @ $75 = $90
    expect(costUsd("anthropic", "claude-opus", 1_000_000, 1_000_000)).toBeCloseTo(90, 6);
  });
});
