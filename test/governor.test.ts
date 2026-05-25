import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, type ClarGuardConfig } from "../src/config.js";
import { Governor } from "../src/core/governor.js";
import { MemoryAuditSink } from "../src/core/audit.js";
import { MemoryStore } from "../src/core/store.js";

function makeConfig(over: Partial<ClarGuardConfig> = {}): ClarGuardConfig {
  return {
    ...DEFAULT_CONFIG,
    ...over,
    budget: { ...DEFAULT_CONFIG.budget, ...over.budget },
    downgrade: { ...DEFAULT_CONFIG.downgrade, ...over.downgrade },
    dlp: { ...DEFAULT_CONFIG.dlp, ...over.dlp },
    audit: { ...DEFAULT_CONFIG.audit, ...over.audit },
  };
}

function setup(config: ClarGuardConfig, fileExists?: (p: string) => boolean) {
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

describe("Governor per-call log line", () => {
  function setupWithLogs(config: ClarGuardConfig) {
    const logs: string[] = [];
    const logger = { info: (m: string) => logs.push(m), warn: () => {} };
    const governor = new Governor(config, {
      auditSink: new MemoryAuditSink(),
      store: new MemoryStore(),
      logger,
      clock: () => 0,
    });
    return { governor, logs };
  }

  it("emits a pre-flight estimate line when an input-token estimate is provided", () => {
    const { governor, logs } = setupWithLogs(
      makeConfig({ budget: { ...DEFAULT_CONFIG.budget, maxUsd: 5 } }),
    );
    governor.onModelResolve({
      provider: "anthropic",
      model: "claude-opus",
      estimatedInputTokens: 1_000,
    });
    expect(logs.some((l) => l.includes("est $") && l.includes("claude-opus"))).toBe(true);
  });

  it("emits an actual-cost line at usage time, showing budget percentage", () => {
    const { governor, logs } = setupWithLogs(
      makeConfig({ budget: { ...DEFAULT_CONFIG.budget, maxUsd: 10 } }),
    );
    governor.onUsage({
      provider: "anthropic",
      model: "claude-opus",
      inputTokens: 100_000,
      outputTokens: 0,
    });
    // 100k opus input = $1.50 of a $10 cap → 15%
    const line = logs.find((l) => l.startsWith("clarguard: claude-opus $"));
    expect(line).toBeDefined();
    expect(line).toContain("$1.5000");
    expect(line).toContain("(15%)");
  });

  it("is silent when logging.perCallLine is false", () => {
    const { governor, logs } = setupWithLogs(
      makeConfig({
        logging: { perCallLine: false },
        budget: { ...DEFAULT_CONFIG.budget, maxUsd: 5 },
      }),
    );
    governor.onModelResolve({
      provider: "anthropic",
      model: "claude-opus",
      estimatedInputTokens: 1_000,
    });
    governor.onUsage({
      provider: "anthropic",
      model: "claude-opus",
      inputTokens: 100,
      outputTokens: 0,
    });
    expect(logs).toEqual([]);
  });

  it("skips the pre-flight line for unknown models (no faking $0)", () => {
    const { governor, logs } = setupWithLogs(makeConfig());
    governor.onModelResolve({
      provider: "anthropic",
      model: "made-up-model",
      estimatedInputTokens: 1_000,
    });
    expect(logs).toEqual([]);
  });
});

describe("Governor budget-threshold notifications", () => {
  it("fires a webhook on the first call that crosses each threshold (no spam)", () => {
    const events: Array<{ type: string; threshold?: number }> = [];
    const sink = new MemoryAuditSink();
    let t = 0;
    const governor = new Governor(
      makeConfig({
        budget: { ...DEFAULT_CONFIG.budget, maxUsd: 10 },
        notifications: {
          ...DEFAULT_CONFIG.notifications,
          webhookUrl: "https://example/x",
          thresholds: [0.5, 0.9, 1.0],
          events: ["budget_threshold"],
        },
      }),
      {
        auditSink: sink,
        store: new MemoryStore(),
        clock: () => t,
        notifier: {
          send: (ev) => events.push({ type: ev.type, threshold: ev.threshold as number }),
        },
      },
    );

    // $5 → 50% → fires the 0.5 threshold once.
    governor.onUsage({ provider: "anthropic", model: "claude-opus", inputTokens: 333_333, outputTokens: 0 });
    // Another $5 → 100% → fires 0.9 and 1.0 in one go.
    governor.onUsage({ provider: "anthropic", model: "claude-opus", inputTokens: 333_333, outputTokens: 0 });
    // Further calls in the same window do NOT re-fire 0.5/0.9/1.0.
    governor.onUsage({ provider: "anthropic", model: "claude-opus", inputTokens: 100, outputTokens: 0 });

    const thresholds = events
      .filter((e) => e.type === "budget_threshold")
      .map((e) => e.threshold);
    expect(thresholds.sort()).toEqual([0.5, 0.9, 1.0]);
  });
});

describe("Governor custom DLP patterns", () => {
  it("uses an operator-defined pattern to cancel the send via per-pattern action", () => {
    const { governor, sink } = setup(
      makeConfig({
        dlp: {
          ...DEFAULT_CONFIG.dlp,
          onDetect: "log", // log by default
          customPatterns: [
            { name: "customer_id", regex: "CUST-[A-Z0-9]{8}", flags: "", action: "block" },
          ],
        },
      }),
    );
    const out = governor.onMessageSending("see CUST-AB12CD34");
    expect(out.cancel).toBe(true);
    expect(out.labels).toContain("customer_id");
    expect(sink.events().map((e) => e.type)).toContain("dlp_blocked");
  });

  it("skips invalid regexes and audits the failure", () => {
    const { governor, sink } = setup(
      makeConfig({
        dlp: {
          ...DEFAULT_CONFIG.dlp,
          customPatterns: [{ name: "broken", regex: "[unterminated", flags: "" }],
        },
      }),
    );
    // No throw on construction; the invalid pattern is recorded.
    expect(sink.events().map((e) => e.type)).toContain("dlp_pattern_invalid");
    // And the message scan still works for built-ins.
    expect(governor.onMessageSending("SSN: 123-45-6789").labels).toContain("ssn");
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
