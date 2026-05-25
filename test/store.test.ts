import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileStore, MemoryStore, type StoreDegradeEvent } from "../src/core/store.js";

describe("MemoryStore", () => {
  it("round-trips state", () => {
    const s = new MemoryStore();
    expect(s.load()).toBeUndefined();
    s.save({ windowStart: 1, tokensUsed: 2, usdUsed: 3 });
    expect(s.load()).toEqual({ windowStart: 1, tokensUsed: 2, usdUsed: 3 });
  });
});

describe("FileStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clarguard-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists across instances (the restart case)", () => {
    const path = join(dir, "budget.json");
    const a = new FileStore(path, { lock: false });
    a.save({ windowStart: 10, tokensUsed: 20, usdUsed: 30 });
    const b = new FileStore(path, { lock: false });
    expect(b.load()).toEqual({ windowStart: 10, tokensUsed: 20, usdUsed: 30 });
  });

  it("returns undefined for a missing file (the first-run case)", () => {
    expect(new FileStore(join(dir, "nope.json"), { lock: false }).load()).toBeUndefined();
  });

  it("returns undefined and audits load_corrupt for invalid JSON", () => {
    const path = join(dir, "corrupt.json");
    writeFileSync(path, "{ not valid json");
    const onDegrade = vi.fn<(e: StoreDegradeEvent) => void>();
    expect(new FileStore(path, { lock: false, onDegrade }).load()).toBeUndefined();
    expect(onDegrade).toHaveBeenCalledWith(expect.objectContaining({ reason: "load_corrupt" }));
  });

  it("returns undefined and audits load_corrupt for a structurally wrong file", () => {
    const path = join(dir, "wrong.json");
    writeFileSync(path, JSON.stringify({ foo: "bar" }));
    const onDegrade = vi.fn<(e: StoreDegradeEvent) => void>();
    expect(new FileStore(path, { lock: false, onDegrade }).load()).toBeUndefined();
    expect(onDegrade).toHaveBeenCalledWith(expect.objectContaining({ reason: "load_corrupt" }));
  });

  it("writes a complete file (atomic rename leaves no torn content)", () => {
    const path = join(dir, "budget.json");
    new FileStore(path, { lock: false }).save({ windowStart: 1, tokensUsed: 2, usdUsed: 3.5 });
    // After save, the file is either fully present or absent — never partial.
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed).toEqual({ windowStart: 1, tokensUsed: 2, usdUsed: 3.5 });
  });

  it("transitions degraded → recovered on save failure then success", () => {
    const path = join(dir, "budget.json");
    const onDegrade = vi.fn<(e: StoreDegradeEvent) => void>();
    const store = new FileStore(path, { lock: false, onDegrade });
    // First save succeeds, so onDegrade is not called.
    store.save({ windowStart: 1, tokensUsed: 0, usdUsed: 0 });
    expect(onDegrade).not.toHaveBeenCalled();
    // Wipe the dir while the store thinks it's healthy → next save fails.
    rmSync(dir, { recursive: true, force: true });
    // Force a non-recoverable path: parent path is now a file, not a dir.
    writeFileSync(dir, "block");
    store.save({ windowStart: 2, tokensUsed: 0, usdUsed: 0 });
    expect(onDegrade).toHaveBeenCalledWith(expect.objectContaining({ reason: "save_failed" }));
  });
});

describe("FileStore lock", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clarguard-lock-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("degrades (not throws) when locked by another live process", () => {
    const path = join(dir, "budget.json");
    const lockPath = `${path}.lock`;
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(lockPath, String(process.ppid));
    const events: string[] = [];
    const store = new FileStore(path, { onDegrade: (e) => events.push(e.reason) });
    expect(store).toBeDefined();
    expect(events).toContain("save_failed");
  });

  it("cleans up a stale lock (dead pid) and proceeds", () => {
    const path = join(dir, "budget.json");
    const lockPath = `${path}.lock`;
    require("node:fs").mkdirSync(dir, { recursive: true });
    // PID 2_000_000_000 is well above any plausible live process on Linux
    // (max_pid default is 32768/4194304); kill(2_000_000_000, 0) returns
    // ESRCH and acquireLock treats it as stale.
    writeFileSync(lockPath, "2000000000");
    const store = new FileStore(path);
    store.save({ windowStart: 1, tokensUsed: 0, usdUsed: 0 });
    expect(store.load()).toEqual({ windowStart: 1, tokensUsed: 0, usdUsed: 0 });
    store.release();
  });

  it("release is idempotent", () => {
    const path = join(dir, "budget.json");
    const store = new FileStore(path);
    store.release();
    expect(() => store.release()).not.toThrow();
  });
});
