import { describe, expect, it } from "vitest";

import { forecast, formatDuration } from "../src/core/forecast.js";

describe("forecast", () => {
  it("returns reliable=false when too early in the window", () => {
    const f = forecast({
      windowStartedAt: 0,
      windowMs: 60 * 60 * 1000, // 1h
      spentUsd: 0.5,
      spentTokens: 100,
      capUsd: 5,
      capTokens: undefined,
      now: 5_000, // 5 seconds in
    });
    expect(f.reliable).toBe(false);
    expect(f.hitsCapAt).toBeUndefined();
  });

  it("projects when the USD cap will be hit", () => {
    // 1 hour into a 24h window, spent $1 of a $20 cap → $1/h → hit cap in 19h
    const f = forecast({
      windowStartedAt: 0,
      windowMs: 24 * 60 * 60 * 1000,
      spentUsd: 1,
      spentTokens: 0,
      capUsd: 20,
      capTokens: undefined,
      now: 60 * 60 * 1000,
    });
    expect(f.reliable).toBe(true);
    expect(f.burnRateUsdPerHour).toBeCloseTo(1, 4);
    // remaining 19h, comfortably inside the 24h window
    expect(f.hitsCapAt).toBeCloseTo(60 * 60 * 1000 + 19 * 60 * 60 * 1000, -2);
  });

  it("reports cap already exceeded when spent >= cap", () => {
    const f = forecast({
      windowStartedAt: 0,
      windowMs: 60 * 60 * 1000,
      spentUsd: 10,
      spentTokens: 0,
      capUsd: 5,
      capTokens: undefined,
      now: 30 * 60 * 1000,
    });
    expect(f.hitsCapAt).toBe(30 * 60 * 1000); // = now
  });

  it("omits hitsCapAt when the burn rate won't cross the cap within the window", () => {
    const f = forecast({
      windowStartedAt: 0,
      windowMs: 24 * 60 * 60 * 1000,
      spentUsd: 0.01,
      spentTokens: 0,
      capUsd: 5,
      capTokens: undefined,
      now: 60 * 60 * 1000,
    });
    expect(f.hitsCapAt).toBeUndefined();
    expect(f.projectedEndOfWindowUsd).toBeCloseTo(0.01 + 0.01 * 23, 4);
  });

  it("picks the earlier of the USD and token cap hits", () => {
    const f = forecast({
      windowStartedAt: 0,
      windowMs: 24 * 60 * 60 * 1000,
      spentUsd: 1,
      spentTokens: 1000,
      capUsd: 100, // 100h to hit at $1/h
      capTokens: 2000, // 1h to hit at 1000 tok/h
      now: 60 * 60 * 1000,
    });
    expect(f.hitsCapAt).toBeCloseTo(60 * 60 * 1000 + 60 * 60 * 1000, -2);
  });
});

describe("formatDuration", () => {
  it("formats sub-minute, sub-hour, sub-day, and multi-day", () => {
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(60 * 60_000 + 12 * 60_000)).toBe("1h 12m");
    expect(formatDuration(2 * 24 * 60 * 60_000 + 4 * 60 * 60_000)).toBe("2d 4h");
    expect(formatDuration(-1)).toBe("?");
  });
});
