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
export declare class MemoryStore implements GovernanceStore {
    private state;
    load(): BudgetState | undefined;
    save(state: BudgetState): void;
}
export type StoreDegradeReason = 
/** A `save` call threw (disk full, EACCES, etc.). */
"save_failed"
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
export declare class FileStore implements GovernanceStore {
    private readonly path;
    private dirEnsured;
    private saveDegraded;
    private readonly onDegrade;
    private readonly useLock;
    private locked;
    private exitListener;
    constructor(path: string, options?: FileStoreOptions);
    load(): BudgetState | undefined;
    save(state: BudgetState): void;
    /** Release the advisory lock. Idempotent; safe to call on shutdown. */
    release(): void;
    private acquireLock;
    private fsyncDirectory;
    private ensureDir;
}
//# sourceMappingURL=store.d.ts.map