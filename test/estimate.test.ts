import { describe, expect, it } from "vitest";

import { estimateCallCostUsd, estimateTokensFromText } from "../src/core/estimate.js";

describe("estimateTokensFromText", () => {
  it("returns 0 for empty / undefined input", () => {
    expect(estimateTokensFromText(undefined)).toBe(0);
    expect(estimateTokensFromText("")).toBe(0);
  });

  it("applies the chars/4 heuristic, rounded up", () => {
    expect(estimateTokensFromText("a")).toBe(1);
    expect(estimateTokensFromText("abcd")).toBe(1);
    expect(estimateTokensFromText("abcde")).toBe(2);
    expect(estimateTokensFromText("a".repeat(400))).toBe(100);
  });
});

describe("estimateCallCostUsd", () => {
  it("projects cost from input tokens using the pricing table", () => {
    // opus input: $15 per MTok → 1M input tokens = $15
    expect(estimateCallCostUsd("anthropic", "claude-opus", 1_000_000)).toBeCloseTo(15, 6);
    // haiku input: $0.80 per MTok → 1M input tokens = $0.80
    expect(estimateCallCostUsd("anthropic", "claude-haiku", 1_000_000)).toBeCloseTo(0.8, 6);
  });

  it("returns 0 for unknown providers / models (no faking)", () => {
    expect(estimateCallCostUsd("anthropic", "made-up", 1_000_000)).toBe(0);
    expect(estimateCallCostUsd("nobody", "anything", 1_000_000)).toBe(0);
  });
});
