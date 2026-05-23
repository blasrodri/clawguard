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

import { appendFileSync, renameSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** Schema version stamped on every record for forward compatibility. */
export const AUDIT_SCHEMA_VERSION = 1;

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
export class FileAuditSink implements AuditSink {
  private readonly buffer: string[] = [];
  private scheduled = false;
  private dirEnsured = false;
  private readonly maxBytes: number;

  constructor(
    private readonly path: string,
    options: FileAuditOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  }

  write(line: string): void {
    this.buffer.push(line);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  /** Flush buffered lines. Safe to call directly (e.g. on shutdown). */
  flush(): void {
    this.scheduled = false;
    if (this.buffer.length === 0) {
      return;
    }
    const chunk = this.buffer.join("\n") + "\n";
    this.buffer.length = 0;
    try {
      this.ensureDir();
      this.rotateIfNeeded(chunk.length);
      appendFileSync(this.path, chunk);
    } catch {
      // Audit is best-effort evidence; a write failure must not crash the
      // gateway. Dropped lines are preferable to a thrown hook.
    }
  }

  private ensureDir(): void {
    if (!this.dirEnsured) {
      mkdirSync(dirname(this.path), { recursive: true });
      this.dirEnsured = true;
    }
  }

  private rotateIfNeeded(incoming: number): void {
    let size = 0;
    try {
      size = statSync(this.path).size;
    } catch {
      return; // file doesn't exist yet
    }
    if (size + incoming > this.maxBytes) {
      renameSync(this.path, `${this.path}.1`); // keep one generation
    }
  }
}

/** In-memory sink for tests and dry runs. */
export class MemoryAuditSink implements AuditSink {
  readonly lines: string[] = [];

  write(line: string): void {
    this.lines.push(line);
  }

  events(): AuditEvent[] {
    return this.lines.map((l) => JSON.parse(l) as AuditEvent);
  }
}

export class AuditLog {
  constructor(
    private readonly sink: AuditSink | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  record(type: string, fields: Record<string, unknown>): void {
    if (!this.sink) {
      return;
    }
    const event: AuditEvent = {
      v: AUDIT_SCHEMA_VERSION,
      ts: new Date(this.now()).toISOString(),
      type,
      ...fields,
    };
    this.sink.write(JSON.stringify(event));
  }

  flush(): void {
    this.sink?.flush?.();
  }
}
