import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type ClawGuardConfig } from "../src/config.js";
import { Governor } from "../src/core/governor.js";
import { MemoryAuditSink } from "../src/core/audit.js";
import { MemoryStore } from "../src/core/store.js";

function makeConfig(over: Partial<ClawGuardConfig> = {}): ClawGuardConfig {
  return {
    ...DEFAULT_CONFIG,
    ...over,
    budget: { ...DEFAULT_CONFIG.budget, ...over.budget },
    downgrade: { ...DEFAULT_CONFIG.downgrade, ...over.downgrade },
    dlp: { ...DEFAULT_CONFIG.dlp, ...over.dlp },
    audit: { ...DEFAULT_CONFIG.audit, ...over.audit },
  };
}

function setup(config: ClawGuardConfig, fileExists?: (p: string) => boolean) {
  const sink = new MemoryAuditSink();
  let t = 0;
  const governor = new Governor(config, {
    auditSink: sink,
    store: new MemoryStore(),
    clock: () => t,
    fileExists,
  });
  return { governor, sink, advance: (ms: number) => (t += ms) };
}

describe("Governor.onModelResolve", () => {
  it("rewrites a costlier model to the configured tier in enforce mode", () => {
    const { governor, sink } = setup(makeConfig({ downgrade: { to: "haiku" } }));
    const out = governor.onModelResolve({ provider: "anthropic", model: "claude-opus" });
    expect(out.modelOverride).toBe("claude-haiku-4-5");
    expect(sink.events().map((e) => e.type)).toContain("downgrade");
  });

  it("only records, never rewrites, in shadow mode", () => {
    const { governor, sink } = setup(makeConfig({ mode: "shadow", downgrade: { to: "haiku" } }));
    const out = governor.onModelResolve({ provider: "anthropic", model: "claude-opus" });
    expect(out.modelOverride).toBeUndefined();
    expect(sink.events().map((e) => e.type)).toContain("downgrade_shadow");
  });

  it("leaves models at/below the target untouched", () => {
    const { governor } = setup(makeConfig({ downgrade: { to: "sonnet" } }));
    expect(
      governor.onModelResolve({ provider: "anthropic", model: "claude-haiku" }).modelOverride,
    ).toBeUndefined();
  });
});

describe("Governor.onRunGate", () => {
  it("blocks once the USD budget is spent (enforce)", () => {
    const { governor } = setup(makeConfig({ budget: { ...DEFAULT_CONFIG.budget, maxUsd: 1 } }));
    expect(governor.onRunGate().block).toBe(false);
    // 1M opus input tokens = $15, well over the $1 cap.
    governor.onUsage({ provider: "anthropic", model: "claude-opus", inputTokens: 1_000_000, outputTokens: 0 });
    expect(governor.onRunGate().block).toBe(true);
  });

  it("never blocks in shadow mode but records the would-block", () => {
    const { governor, sink } = setup(
      makeConfig({ mode: "shadow", budget: { ...DEFAULT_CONFIG.budget, maxUsd: 1 } }),
    );
    governor.onUsage({ provider: "anthropic", model: "claude-opus", inputTokens: 1_000_000, outputTokens: 0 });
    expect(governor.onRunGate().block).toBe(false);
    expect(sink.events().map((e) => e.type)).toContain("budget_would_block");
  });

  it("resets enforcement after the window rotates", () => {
    const { governor, advance } = setup(
      makeConfig({ budget: { ...DEFAULT_CONFIG.budget, maxUsd: 1, windowMs: 1000 } }),
    );
    governor.onUsage({ provider: "anthropic", model: "claude-opus", inputTokens: 1_000_000, outputTokens: 0 });
    expect(governor.onRunGate().block).toBe(true);
    advance(1001);
    expect(governor.onRunGate().block).toBe(false);
  });

  it("pre-charges a reserve so in-flight calls count against the budget", () => {
    const { governor } = setup(
      makeConfig({ budget: { ...DEFAULT_CONFIG.budget, maxUsd: 5, reserveUsd: 3 } }),
    );
    expect(governor.onRunGate().block).toBe(false); // reserves $3
    expect(governor.onRunGate().block).toBe(false); // reserves another $3 -> $6 > $5
    expect(governor.onRunGate().block).toBe(true); // next turn sees the overshoot
  });
});

describe("Governor savings attribution", () => {
  it("credits real savings against the call's actual input tokens", () => {
    const { governor } = setup(makeConfig({ downgrade: { to: "haiku" } }));
    governor.onModelResolve({ provider: "anthropic", model: "claude-opus" });
    // usage arrives for the (already downgraded) call.
    governor.onUsage({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    // opus $15 - haiku $0.80 = $14.20 per MTok input.
    expect(governor.status().estimatedSavedUsd).toBeCloseTo(14.2, 4);
  });
});

describe("Governor missing usage", () => {
  it("records usage_missing and keeps the reserve standing", () => {
    const { governor, sink } = setup(
      makeConfig({ budget: { ...DEFAULT_CONFIG.budget, maxUsd: 10, reserveUsd: 2 } }),
    );
    governor.onRunGate(); // reserves $2
    governor.onUsage({
      provider: "anthropic",
      model: "claude-opus",
      inputTokens: 0,
      outputTokens: 0,
      usageReported: false,
    });
    expect(sink.events().map((e) => e.type)).toContain("usage_missing");
    expect(governor.status().budget.usdUsed).toBe(2); // reserve not settled away
  });
});

describe("Governor kill switch", () => {
  it("blocks every run when enabled (enforce)", () => {
    const { governor, sink } = setup(makeConfig({ killSwitch: { enabled: true, file: undefined } }));
    expect(governor.onRunGate().block).toBe(true);
    expect(sink.events().map((e) => e.type)).toContain("kill_switch_engaged");
  });

  it("records but does not block in shadow mode", () => {
    const { governor, sink } = setup(
      makeConfig({ mode: "shadow", killSwitch: { enabled: true, file: undefined } }),
    );
    expect(governor.onRunGate().block).toBe(false);
    expect(sink.events().map((e) => e.type)).toContain("kill_switch_would_engage");
  });

  it("engages based on a file's presence at runtime", () => {
    let present = false;
    const { governor } = setup(
      makeConfig({ killSwitch: { enabled: false, file: "/tmp/halt" } }),
      () => present,
    );
    expect(governor.onRunGate().block).toBe(false);
    present = true; // operator drops the file — no restart
    expect(governor.onRunGate().block).toBe(true);
  });
});

describe("Governor circuit breaker", () => {
  function breakerConfig() {
    return makeConfig({ breaker: { enabled: true, threshold: 2, cooldownMs: 1000 } });
  }

  it("opens after consecutive failures and blocks runs", () => {
    const { governor, sink } = setup(breakerConfig());
    governor.onCallEnded(false);
    expect(governor.onRunGate().block).toBe(false); // one failure, still closed
    governor.onCallEnded(false);
    expect(governor.onRunGate().block).toBe(true); // threshold reached
    expect(sink.events().map((e) => e.type)).toContain("breaker_open");
  });

  it("recovers after the cooldown and resets on success", () => {
    const { governor, sink, advance } = setup(breakerConfig());
    governor.onCallEnded(false);
    governor.onCallEnded(false);
    expect(governor.onRunGate().block).toBe(true);
    advance(1001); // cooldown elapses -> half-open trial allowed
    expect(governor.onRunGate().block).toBe(false);
    governor.onCallEnded(true); // trial succeeded -> closed
    expect(governor.status().consecutiveFailures).toBe(0);
    expect(sink.events().map((e) => e.type)).toContain("breaker_reset");
  });

  it("does nothing when disabled", () => {
    const { governor } = setup(makeConfig());
    governor.onCallEnded(false);
    governor.onCallEnded(false);
    governor.onCallEnded(false);
    expect(governor.onRunGate().block).toBe(false);
  });
});

describe("Governor budget-aware downgrade", () => {
  it("keeps the premium model until the budget threshold, then downgrades", () => {
    const { governor } = setup(
      makeConfig({
        downgrade: { to: "haiku", whenBudgetRatioAbove: 0.8 },
        budget: { ...DEFAULT_CONFIG.budget, maxUsd: 10 },
      }),
    );
    // Under threshold: stay on opus.
    expect(
      governor.onModelResolve({ provider: "anthropic", model: "claude-opus" }).modelOverride,
    ).toBeUndefined();
    // Spend $9 of the $10 cap (90% > 80%).
    governor.onUsage({ provider: "anthropic", model: "claude-opus", inputTokens: 600_000, outputTokens: 0 });
    expect(
      governor.onModelResolve({ provider: "anthropic", model: "claude-opus" }).modelOverride,
    ).toBe("claude-haiku-4-5");
  });
});

describe("Governor.onMessageSending", () => {
  it("cancels an outbound message with secrets when onDetect=block", () => {
    const { governor, sink } = setup(makeConfig({ dlp: { ...DEFAULT_CONFIG.dlp, onDetect: "block" } }));
    const out = governor.onMessageSending("here is my SSN: 123-45-6789");
    expect(out.cancel).toBe(true);
    expect(out.labels).toContain("ssn");
    expect(sink.events().map((e) => e.type)).toContain("dlp_blocked");
  });

  it("logs but does not cancel when onDetect=log", () => {
    const { governor, sink } = setup(makeConfig({ dlp: { ...DEFAULT_CONFIG.dlp, onDetect: "log" } }));
    const out = governor.onMessageSending("SSN: 123-45-6789");
    expect(out.cancel).toBe(false);
    expect(sink.events().map((e) => e.type)).toContain("dlp_detected");
  });

  it("passes clean content through", () => {
    const { governor } = setup(makeConfig());
    expect(governor.onMessageSending("just a normal message").cancel).toBe(false);
  });
});
