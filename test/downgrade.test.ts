import { describe, expect, it } from "vitest";
import { evaluate, parseTier, savingsUsd } from "../src/core/downgrade.js";

describe("downgrade.parseTier", () => {
  it("parses aliases case-insensitively", () => {
    expect(parseTier("sonnet")).toBe("sonnet");
    expect(parseTier("HAIKU")).toBe("haiku");
    expect(parseTier("gpt-3.5-turbo")).toBe("gpt-3.5-turbo");
    expect(parseTier("openai-cheap")).toBe("gpt-3.5-turbo");
    expect(parseTier("")).toBeUndefined();
    expect(parseTier("opus")).toBeUndefined(); // can't downgrade TO opus
  });
});

describe("downgrade.evaluate", () => {
  it("downgrades opus to sonnet and reports the saving", () => {
    const d = evaluate("anthropic", "claude-opus", "sonnet");
    expect(d.wouldDowngrade).toBe(true);
    expect(d.replacement).toBe("claude-sonnet-4-5");
    // opus $15 - sonnet $3 = $12 per MTok
    expect(savingsUsd(d, 1_000_000)).toBeCloseTo(12, 6);
  });

  it("saves more downgrading opus to haiku", () => {
    const d = evaluate("anthropic", "claude-opus", "haiku");
    // opus $15 - haiku $0.80 = $14.20 per MTok
    expect(savingsUsd(d, 1_000_000)).toBeCloseTo(14.2, 6);
  });

  it("downgrades openai o3 to gpt-4o", () => {
    const d = evaluate("openai", "o3", "gpt-4o");
    expect(d.wouldDowngrade).toBe(true);
    expect(savingsUsd(d, 1_000_000)).toBeCloseTo(10, 6); // $15 - $5
  });

  it("does not downgrade when already at or below the target tier", () => {
    expect(evaluate("anthropic", "claude-sonnet", "sonnet").wouldDowngrade).toBe(false);
    expect(evaluate("anthropic", "claude-haiku", "sonnet").wouldDowngrade).toBe(false);
  });

  it("does not downgrade unknown or missing models", () => {
    expect(evaluate("anthropic", undefined, "sonnet").wouldDowngrade).toBe(false);
    expect(evaluate("anthropic", "made-up", "sonnet").wouldDowngrade).toBe(false);
  });

  it("does not cross-provider downgrade (anthropic model with openai target and vice versa)", () => {
    // openai call with an anthropic target tier must not rewrite to claude-haiku
    expect(evaluate("openai", "gpt-4o", "haiku").wouldDowngrade).toBe(false);
    expect(evaluate("openai", "o3", "sonnet").wouldDowngrade).toBe(false);
    // anthropic call with an openai target tier must not rewrite to gpt-3.5-turbo
    expect(evaluate("anthropic", "claude-opus", "gpt-3.5-turbo").wouldDowngrade).toBe(false);
    expect(evaluate("anthropic", "claude-opus", "gpt-4o").wouldDowngrade).toBe(false);
  });
});
