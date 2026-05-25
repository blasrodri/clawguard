/**
 * Persistence for budget state. The interface OpenClaw RFC #27442 asked
 * for ("a standard place for a plugin to hold shared, mutable state") —
 * here, scoped to the single global budget window.
 *
 * Deliberately NOT SQLite: a native addon (better-sqlite3) can fail to
 * build per-platform, and Node's built-in `node:sqlite` needs a runtime
 * flag we can't set inside the host gateway. The persisted state is three
 * numbers, so a zero-dependency JSON file with atomic writes is both
 * sufficient and keeps `npm install` from ever failing. SQLite/Redis can
 * slot in behind this interface later for multi-gateway deployments.
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export interface BudgetState {
  readonly windowStart: number;
  readonly tokensUsed: number;
  readonly usdUsed: number;
}

export interface GovernanceStore {
  /** Returns persisted state, or undefined if none / unreadable. */
  load(): BudgetState | undefined;
  /** Durably persist the latest state. Must not throw. */
  save(state: BudgetState): void;
}

/** Non-persistent store. Budget resets on gateway restart. */
export class MemoryStore implements GovernanceStore {
  private state: BudgetState | undefined;

  load(): BudgetState | undefined {
    return this.state;
  }

  save(state: BudgetState): void {
    this.state = state;
  }
}

export type StoreDegradeReason =
  /** A `save` call threw (disk full, EACCES, etc.). */
  | "save_failed"
  /** `save` succeeded after a prior failure — the store is healthy again. */
  | "save_recovered"
  /** The persisted file existed but was not valid JSON / wrong shape. */
  | "load_corrupt"
  /** The persisted file existed but couldn't be read (permissions, etc.). */
  | "load_unreadable";

export interface StoreDegradeEvent {
  readonly reason: StoreDegradeReason;
  readonly detail?: string;
}

export interface FileStoreOptions {
  /**
   * Acquire an advisory PID-based lock on the persistence directory at
   * construction. Default `true`. Prevents the silent budget drift that
   * happens when two gateways share a `persistPath` by accident — the
   * second instance throws with a clear "locked by pid N" error.
   */
  readonly lock?: boolean;
  /**
   * Called when persistence transitions between healthy and degraded, or
   * when a load fails. The governor wires this into the audit log so
   * operators see "persistence_degraded" events instead of a silent
   * fallback to in-memory behaviour.
   */
  readonly onDegrade?: (event: StoreDegradeEvent) => void;
}

/**
 * JSON file store with atomic, fsync'd writes (write temp + fsync +
 * rename + dir fsync) and a PID lock to prevent multi-gateway drift.
 * Survives gateway restarts so day/week budgets actually hold.
 *
 * Writes are synchronous but infrequent (once per LLM call, not per
 * token) and the payload is a few bytes — the durability is worth it. A
 * corrupt or missing file is treated as "no state" rather than an error,
 * so a bad file can never wedge the gateway. Failures are surfaced
 * through `onDegrade`, not swallowed.
 */
export class FileStore implements GovernanceStore {
  private dirEnsured = false;
  private saveDegraded = false;
  private readonly onDegrade: ((event: StoreDegradeEvent) => void) | undefined;
  private readonly useLock: boolean;
  private locked = false;
  private exitListener: (() => void) | undefined;

  constructor(
    private readonly path: string,
    options: FileStoreOptions = {},
  ) {
    this.useLock = options.lock !== false;
    this.onDegrade = options.onDegrade;
    if (this.useLock) {
      this.acquireLock();
    }
  }

  load(): BudgetState | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.path, "utf8");
    } catch (err) {
      // ENOENT (missing file) is the common, expected case on first run.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.onDegrade?.({ reason: "load_unreadable", detail: String(err) });
      }
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      const state = coerceState(parsed);
      if (!state) {
        this.onDegrade?.({ reason: "load_corrupt" });
      }
      return state;
    } catch (err) {
      this.onDegrade?.({ reason: "load_corrupt", detail: String(err) });
      return undefined;
    }
  }

  save(state: BudgetState): void {
    try {
      this.ensureDir();
      const tmp = `${this.path}.${process.pid}.tmp`;
      const fd = openSync(tmp, "w");
      try {
        writeSync(fd, JSON.stringify(state));
        // Force the data to disk before the rename, so a power loss or
        // kernel panic can't leave a renamed-but-empty file. Without this
        // the rename is atomic at the filesystem level but the *data*
        // may still be in the OS page cache for seconds.
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.path);
      // Best-effort directory fsync to make the rename itself durable.
      // Not supported on Windows (`open` a directory raises EISDIR); the
      // platform's own write semantics make this safe to skip there.
      this.fsyncDirectory();

      if (this.saveDegraded) {
        this.saveDegraded = false;
        this.onDegrade?.({ reason: "save_recovered" });
      }
    } catch (err) {
      // Don't spam: only emit on the transition from healthy → degraded.
      if (!this.saveDegraded) {
        this.saveDegraded = true;
        this.onDegrade?.({ reason: "save_failed", detail: String(err) });
      }
    }
  }

  /** Release the advisory lock. Idempotent; safe to call on shutdown. */
  release(): void {
    if (this.locked) {
      try {
        unlinkSync(lockPathFor(this.path));
      } catch {
        // Already gone or unwritable — nothing we can do.
      }
      this.locked = false;
    }
    if (this.exitListener) {
      process.removeListener("exit", this.exitListener);
      this.exitListener = undefined;
    }
  }

  private acquireLock(): void {
    const lockPath = lockPathFor(this.path);
    this.ensureDir();
    // Two-attempt acquisition: one stale-lock cleanup is allowed, then
    // we give up. We never loop indefinitely on lock contention.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fd = openSync(lockPath, "wx"); // O_CREAT|O_EXCL
        try {
          writeSync(fd, String(process.pid));
        } finally {
          closeSync(fd);
        }
        this.locked = true;
        // Best-effort cleanup on graceful exit. We do NOT hook SIGINT/SIGTERM
        // to avoid interfering with the host gateway's signal handling; a
        // killed process simply leaves a stale lock that the next start
        // recognises and removes.
        this.exitListener = () => {
          try {
            unlinkSync(lockPath);
          } catch {
            // ignore
          }
        };
        process.once("exit", this.exitListener);
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw err;
        }
        const holder = readLockHolder(lockPath);
        if (holder === process.pid) {
          // Re-acquiring our own lock (e.g. config hot-reload): treat as held.
          this.locked = true;
          return;
        }
        if (holder !== undefined && isProcessAlive(holder)) {
          // Another live process holds the lock (e.g. the gateway while this
          // is a CLI in-process load). Run without a lock — reads still work
          // and saves are skipped via onDegrade.
          this.onDegrade?.({
            reason: "save_failed",
            detail: `persistence locked by pid ${holder}`,
          });
          return;
        }
        // Stale (dead PID, or empty/garbled lock file): remove and retry.
        try {
          unlinkSync(lockPath);
        } catch {
          // racing with another reaper — fine, next attempt will resolve
        }
      }
    }
    throw new Error(`clarguard: could not acquire persistence lock at ${lockPath}`);
  }

  private fsyncDirectory(): void {
    try {
      const dfd = openSync(dirname(this.path), "r");
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    } catch {
      // EISDIR on Windows, or simply unsupported — best-effort only.
    }
  }

  private ensureDir(): void {
    if (!this.dirEnsured) {
      mkdirSync(dirname(this.path), { recursive: true });
      this.dirEnsured = true;
    }
  }
}

function lockPathFor(path: string): string {
  return `${path}.lock`;
}

function readLockHolder(lockPath: string): number | undefined {
  try {
    const raw = readFileSync(lockPath, "utf8").trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: process exists but we lack permission to signal it. EPERM
    // alive, ESRCH (no such process) dead, anything else treat as dead
    // so we don't refuse to start over an unfamiliar errno.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function coerceState(v: unknown): BudgetState | undefined {
  if (typeof v !== "object" || v === null) {
    return undefined;
  }
  const o = v as Record<string, unknown>;
  if (
    typeof o.windowStart === "number" &&
    typeof o.tokensUsed === "number" &&
    typeof o.usdUsed === "number"
  ) {
    return { windowStart: o.windowStart, tokensUsed: o.tokensUsed, usdUsed: o.usdUsed };
  }
  return undefined;
}
