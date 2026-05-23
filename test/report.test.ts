import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runReport, type AuditEvent } from "../src/report.js";

const NOW = new Date("2026-05-23T12:00:00Z");
const now = () => NOW;

function ev(type: string, fields: Record<string, unknown> = {}, tsOffsetSec = -60): AuditEvent {
  return {
    v: 1,
    ts: new Date(NOW.getTime() + tsOffsetSec * 1000).toISOString(),
    type,
    ...fields,
  };
}

describe("runReport", () => {
  it("renders an empty placeholder when there are no events", () => {
    const out = runReport({ now, loadEvents: () => [], loadBudget: () => undefined });
    expect(out).toContain("# clawguard report");
    expect(out).toContain("no audit events");
  });

  it("renders a full digest from a representative audit stream", () => {
    const events: AuditEvent[] = [
      ev("downgrade", { from: "claude-opus", to: "claude-haiku-4-5" }),
      ev("savings", { usd: 0.91, replacement: "claude-haiku-4-5" }),
      ev("downgrade", { from: "claude-opus", to: "claude-haiku-4-5" }),
      ev("savings", { usd: 0.92, replacement: "claude-haiku-4-5" }),
      ev("dlp_detected", { labels: ["email", "api_key"] }),
      ev("dlp_blocked", { labels: ["ssn"] }),
      ev("budget_block", { reason: "usd budget exhausted" }),
      ev("breaker_open", { consecutiveFailures: 5 }),
      ev("breaker_reset", {}),
      ev("usage_missing", {}),
    ];
    const out = runReport({
      now,
      loadEvents: () => events,
      loadBudget: () => ({ windowStart: NOW.getTime() - 3600_000, tokensUsed: 12_345, usdUsed: 4.27 }),
      capUsd: 5,
      since: "24h",
    });

    expect(out).toContain("$4.27 of $5.00");
    expect(out).toContain("85%");
    expect(out).toContain("1 budget blocks");
    expect(out).toContain("1 circuit breaker");
    expect(out).toContain("2 model downgrades");
    expect(out).toContain("$1.83 saved");
    expect(out).toContain("claude-opus → claude-haiku-4-5: 2");
    expect(out).toContain("| email | 1 |");
    expect(out).toContain("| ssn | 1 |");
    expect(out).toContain("1 calls with missing usage");
    expect(out).toContain("opened 1×");
  });

  it("emits machine-readable JSON when requested", () => {
    const events = [ev("budget_block", {})];
    const out = runReport({
      now,
      json: true,
      loadEvents: () => events,
      loadBudget: () => undefined,
    });
    const parsed = JSON.parse(out);
    expect(parsed.totals.budgetBlocks).toBe(1);
    expect(parsed.window).toBeUndefined();
  });

  it("filters events outside the since window", () => {
    const inside = ev("budget_block", {}, -60); // 1 min ago
    const outside = ev("budget_block", {}, -86_400 - 60); // > 24h ago
    const out = runReport({
      now,
      since: "24h",
      loadEvents: () => [inside, outside],
      loadBudget: () => undefined,
    });
    expect(out).toContain("1 budget blocks");
  });
});

describe("runReport file IO", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawguard-report-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads JSONL from disk and skips garbled lines", () => {
    const path = join(dir, "audit.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ v: 1, ts: NOW.toISOString(), type: "budget_block" }),
        "{this is not json",
        "",
        JSON.stringify({ v: 1, ts: NOW.toISOString(), type: "downgrade", from: "a", to: "b" }),
      ].join("\n"),
    );
    const out = runReport({
      now,
      auditPath: path,
      budgetPath: join(dir, "nope.json"),
      since: new Date(NOW.getTime() - 3600_000),
    });
    expect(out).toContain("1 budget blocks");
    expect(out).toContain("1 model downgrades");
  });
});
