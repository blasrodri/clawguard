import { describe, expect, it } from "vitest";
import { BudgetWindow, type BudgetConfig } from "../src/core/budget.js";
import { MemoryStore } from "../src/core/store.js";

function cfg(over: Partial<BudgetConfig> = {}): BudgetConfig {
  return { windowMs: 60_000, softLimitRatio: 0.9, delayMs: 100, ...over };
}

describe("BudgetWindow", () => {
  it("passes when usage is under the ceilings", () => {
    const b = new BudgetWindow(cfg({ maxTokens: 1000 }));
    b.settle(100, 0);
    expect(b.decide().action).toBe("pass");
  });

  it("delays in the soft-limit band", () => {
    const b = new BudgetWindow(cfg({ maxTokens: 1000 }));
    b.settle(950, 0);
    const d = b.decide();
    expect(d.action).toBe("delay");
    expect(d.delayMs).toBe(100);
  });

  it("blocks at or over a ceiling", () => {
    const b = new BudgetWindow(cfg({ maxTokens: 1000 }));
    b.settle(1000, 0);
    expect(b.decide().action).toBe("block");
  });

  it("enforces the USD ceiling independently", () => {
    const b = new BudgetWindow(cfg({ maxUsd: 5 }));
    b.settle(0, 5.01);
    expect(b.decide().action).toBe("block");
  });

  it("treats missing ceilings as unlimited", () => {
    const b = new BudgetWindow(cfg());
    b.settle(1_000_000, 9999);
    expect(b.decide().action).toBe("pass");
  });

  it("rotates the window on a fake clock", () => {
    let t = 0;
    const b = new BudgetWindow(cfg({ maxTokens: 1000, windowMs: 1000 }), new MemoryStore(), () => t);
    b.settle(1000, 0);
    expect(b.decide().action).toBe("block");
    t = 1001; // advance past the window
    expect(b.decide().action).toBe("pass");
    expect(b.snapshot().tokensUsed).toBe(0);
  });
});

describe("BudgetWindow reserve/settle", () => {
  it("counts a reserve immediately and swaps it for actual usage", () => {
    const b = new BudgetWindow(cfg({ maxUsd: 10 }));
    b.reserve(0, 2);
    expect(b.snapshot().usdUsed).toBe(2);
    expect(b.snapshot().outstandingReserves).toBe(1);
    b.settle(0, 3); // actual cost was higher than the estimate
    expect(b.snapshot().usdUsed).toBe(3);
    expect(b.snapshot().outstandingReserves).toBe(0);
  });

  it("adds actual usage directly when there is no outstanding reserve", () => {
    const b = new BudgetWindow(cfg({ maxUsd: 10 }));
    b.settle(0, 4);
    expect(b.snapshot().usdUsed).toBe(4);
  });

  it("never lets a generous reserve drive usage negative on settle", () => {
    const b = new BudgetWindow(cfg({ maxUsd: 10 }));
    b.reserve(0, 5);
    b.settle(0, 1);
    expect(b.snapshot().usdUsed).toBeGreaterThanOrEqual(0);
  });
});

describe("BudgetWindow persistence", () => {
  it("restores state from the store within the same window", () => {
    const store = new MemoryStore();
    const a = new BudgetWindow(cfg({ maxUsd: 10, windowMs: 100_000 }), store, () => 1000);
    a.settle(0, 4);
    // Simulate a restart: a fresh window backed by the same store.
    const b = new BudgetWindow(cfg({ maxUsd: 10, windowMs: 100_000 }), store, () => 1500);
    expect(b.snapshot().usdUsed).toBe(4);
  });

  it("starts fresh when the persisted window has expired", () => {
    const store = new MemoryStore();
    const a = new BudgetWindow(cfg({ maxUsd: 10, windowMs: 1000 }), store, () => 0);
    a.settle(0, 4);
    const b = new BudgetWindow(cfg({ maxUsd: 10, windowMs: 1000 }), store, () => 2000);
    expect(b.snapshot().usdUsed).toBe(0);
  });
});
