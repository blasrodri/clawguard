import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/config.js";

describe("normalizeConfig", () => {
  it("returns defaults for empty / non-object input", () => {
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig("nonsense")).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it("accepts valid values", () => {
    const c = normalizeConfig({
      mode: "shadow",
      failMode: "closed",
      budget: { windowMs: 86_400_000, maxUsd: 5, reserveUsd: 0.5 },
      downgrade: { to: "haiku" },
      dlp: { onDetect: "block" },
    });
    expect(c.mode).toBe("shadow");
    expect(c.failMode).toBe("closed");
    expect(c.budget.windowMs).toBe(86_400_000);
    expect(c.budget.maxUsd).toBe(5);
    expect(c.budget.reserveUsd).toBe(0.5);
    expect(c.downgrade.to).toBe("haiku");
    expect(c.dlp.onDetect).toBe("block");
  });

  it("rejects out-of-range and wrong-typed values, falling back to defaults", () => {
    const c = normalizeConfig({
      mode: "banana",
      budget: { windowMs: -5, softLimitRatio: 9, maxUsd: "free" },
      downgrade: { to: "opus" }, // can't downgrade TO opus
      dlp: { onDetect: "delete-everything" },
    });
    expect(c.mode).toBe("enforce");
    expect(c.budget.windowMs).toBe(DEFAULT_CONFIG.budget.windowMs);
    expect(c.budget.softLimitRatio).toBe(DEFAULT_CONFIG.budget.softLimitRatio);
    expect(c.budget.maxUsd).toBeUndefined();
    expect(c.downgrade.to).toBeUndefined();
    expect(c.dlp.onDetect).toBe("log");
  });

  it("defaults persistence on and reserves off", () => {
    const c = normalizeConfig({});
    expect(c.budget.persist).toBe(true);
    expect(c.budget.reserveUsd).toBe(0);
    expect(c.budget.reserveTokens).toBe(0);
  });

  it("defaults kill switch and breaker off", () => {
    const c = normalizeConfig({});
    expect(c.killSwitch.enabled).toBe(false);
    expect(c.breaker.enabled).toBe(false);
    expect(c.breaker.threshold).toBe(5);
    expect(c.downgrade.whenBudgetRatioAbove).toBe(0);
  });

  it("parses kill switch, breaker, and budget-aware downgrade", () => {
    const c = normalizeConfig({
      killSwitch: { file: "/tmp/halt" },
      breaker: { enabled: true, threshold: 3, cooldownMs: 5000 },
      downgrade: { to: "haiku", whenBudgetRatioAbove: 0.75 },
    });
    expect(c.killSwitch.file).toBe("/tmp/halt");
    expect(c.breaker.enabled).toBe(true);
    expect(c.breaker.threshold).toBe(3);
    expect(c.downgrade.whenBudgetRatioAbove).toBe(0.75);
  });
});
