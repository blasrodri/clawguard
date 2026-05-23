/**
 * Append-only JSONL audit trail. The compliance/SOC2 evidence story,
 * kept simple: one JSON object per line, never any raw payload content —
 * only category labels, counts, models, and decisions.
 *
 * Writes are buffered and flushed once per tick (not once per event), so
 * a busy gateway never pays a synchronous disk write on the hot path, and
 * the file is size-capped with one rotation to bound growth. The sink is
 * injectable so the engine is unit-testable without touching disk.
 */
/** Schema version stamped on every record for forward compatibility. */
export declare const AUDIT_SCHEMA_VERSION = 1;
export interface AuditEvent {
    readonly v: number;
    readonly ts: string;
    readonly type: string;
    readonly [key: string]: unknown;
}
export interface AuditSink {
    write(line: string): void;
    /** Flush any buffered lines (called on shutdown). Optional. */
    flush?(): void;
}
export interface FileAuditOptions {
    /** Rotate to `<path>.1` once the file exceeds this size. Default 16 MiB. */
    readonly maxBytes?: number;
}
/**
 * Buffered, size-rotating file sink. `write` only enqueues; an actual
 * disk write happens at most once per microtask, batching all events
 * produced in the same tick into a single append.
 */
export declare class FileAuditSink implements AuditSink {
    private readonly path;
    private readonly buffer;
    private scheduled;
    private dirEnsured;
    private readonly maxBytes;
    constructor(path: string, options?: FileAuditOptions);
    write(line: string): void;
    /** Flush buffered lines. Safe to call directly (e.g. on shutdown). */
    flush(): void;
    private ensureDir;
    private rotateIfNeeded;
}
/** In-memory sink for tests and dry runs. */
export declare class MemoryAuditSink implements AuditSink {
    readonly lines: string[];
    write(line: string): void;
    events(): AuditEvent[];
}
export declare class AuditLog {
    private readonly sink;
    private readonly now;
    constructor(sink: AuditSink | undefined, now?: () => number);
    record(type: string, fields: Record<string, unknown>): void;
    flush(): void;
}
//# sourceMappingURL=audit.d.ts.map