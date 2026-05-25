import { describe, expect, it, vi } from "vitest";

import { NullNotifier, WebhookNotifier, type FetchLike } from "../src/core/notifier.js";

describe("NullNotifier", () => {
  it("does nothing without throwing", () => {
    expect(() => new NullNotifier().send({ type: "kill_switch", ts: "x" })).not.toThrow();
  });
});

describe("WebhookNotifier", () => {
  it("POSTs the event as JSON to the configured URL", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, body: String(init?.body ?? "") });
      return { ok: true, status: 200 };
    };
    const n = new WebhookNotifier({ url: "https://example/x", fetch });
    n.send({ type: "budget_threshold", ts: "2026-05-23T00:00:00Z", ratio: 0.8 });
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://example/x");
    expect(JSON.parse(calls[0]?.body ?? "{}").type).toBe("budget_threshold");
  });

  it("routes a non-2xx response to onError", async () => {
    const onError = vi.fn();
    const fetch: FetchLike = async () => ({ ok: false, status: 500 });
    new WebhookNotifier({ url: "https://example/x", fetch, onError }).send({
      type: "kill_switch",
      ts: "x",
    });
    await new Promise((r) => setImmediate(r));
    expect(onError).toHaveBeenCalledOnce();
  });

  it("routes a fetch rejection (network error / timeout) to onError", async () => {
    const onError = vi.fn();
    const fetch: FetchLike = async () => {
      throw new Error("network");
    };
    new WebhookNotifier({ url: "https://example/x", fetch, onError }).send({
      type: "kill_switch",
      ts: "x",
    });
    await new Promise((r) => setImmediate(r));
    expect(onError).toHaveBeenCalledOnce();
  });
});
