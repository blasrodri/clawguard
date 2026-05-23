/**
 * Tails Claude Code session JSONL files and extracts token usage from
 * assistant messages. This is how clawguard gets token accounting when
 * OpenClaw uses the claude-cli runtime — the gateway doesn't expose usage
 * via plugin hooks in that mode, but Claude Code writes full usage data to
 * ~/.claude/projects/<workspace>/<sessionId>.jsonl after every turn.
 *
 * Usage is fed into the Governor via the same onUsage() path as the
 * llm_output hook, so budget accounting, DLP, and audit all work normally.
 */

import { createReadStream, watch, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export interface UsageRecord {
  provider: string;
  model: string | undefined;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  usageReported: boolean;
}

export type UsageCallback = (usage: UsageRecord) => void;

interface FileState {
  offset: number;
  watcher: ReturnType<typeof watch> | null;
}

export class SessionWatcher {
  private readonly watchDir: string;
  private readonly fileStates = new Map<string, FileState>();
  private dirWatcher: ReturnType<typeof watch> | null = null;
  private readonly onUsage: UsageCallback;
  private readonly onError: (err: unknown) => void;
  private stopped = false;

  constructor(opts: {
    watchDir?: string;
    onUsage: UsageCallback;
    onError?: (err: unknown) => void;
  }) {
    this.watchDir = opts.watchDir ?? defaultWatchDir();
    this.onUsage = opts.onUsage;
    this.onError = opts.onError ?? (() => {});
  }

  start(): void {
    if (this.stopped) return;
    // Tail all existing JSONL files from their current end (don't replay history).
    try {
      const files = readdirSync(this.watchDir).filter((f) => f.endsWith(".jsonl"));
      for (const f of files) {
        const path = join(this.watchDir, f);
        try {
          const size = statSync(path).size;
          this.fileStates.set(path, { offset: size, watcher: null });
          this.watchFile(path);
        } catch {
          // file disappeared between readdir and stat — skip
        }
      }
    } catch {
      // watchDir doesn't exist yet — will be created when first session starts
    }

    // Watch for new session files being created.
    try {
      this.dirWatcher = watch(this.watchDir, (_event, filename) => {
        if (!filename || !filename.endsWith(".jsonl")) return;
        const path = join(this.watchDir, filename);
        if (!this.fileStates.has(path)) {
          this.fileStates.set(path, { offset: 0, watcher: null });
          this.watchFile(path);
        }
      });
    } catch (err) {
      this.onError(err);
    }
  }

  stop(): void {
    this.stopped = true;
    this.dirWatcher?.close();
    this.dirWatcher = null;
    for (const [, state] of this.fileStates) {
      state.watcher?.close();
    }
    this.fileStates.clear();
  }

  private watchFile(path: string): void {
    let watcher: ReturnType<typeof watch>;
    try {
      watcher = watch(path, () => this.readNewLines(path));
    } catch {
      return;
    }
    const state = this.fileStates.get(path);
    if (state) state.watcher = watcher;
  }

  private readNewLines(path: string): void {
    const state = this.fileStates.get(path);
    if (!state) return;

    let fileSize: number;
    try {
      fileSize = statSync(path).size;
    } catch {
      return;
    }
    if (fileSize <= state.offset) return;

    const stream = createReadStream(path, {
      start: state.offset,
      end: fileSize - 1,
      encoding: "utf8",
    });

    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let bytesRead = 0;

    rl.on("line", (line) => {
      bytesRead += Buffer.byteLength(line, "utf8") + 1; // +1 for newline
      const usage = extractUsage(line);
      if (usage) {
        try {
          this.onUsage(usage);
        } catch (err) {
          this.onError(err);
        }
      }
    });

    rl.on("close", () => {
      state.offset = state.offset + bytesRead;
    });

    stream.on("error", (err) => this.onError(err));
  }
}

function extractUsage(line: string): UsageRecord | undefined {
  if (!line.trim()) return undefined;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line);
  } catch {
    return undefined;
  }

  // Only process assistant messages with usage blocks.
  if (obj.type !== "assistant") return undefined;
  const message = obj.message as Record<string, unknown> | undefined;
  if (!message) return undefined;
  const usage = message.usage as Record<string, unknown> | undefined;
  if (!usage) return undefined;

  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const cacheReadTokens = num(usage.cache_read_input_tokens);

  return {
    provider: "anthropic",
    model: typeof message.model === "string" ? message.model : undefined,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    usageReported: inputTokens + outputTokens + cacheReadTokens > 0,
  };
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function defaultWatchDir(): string {
  return join(homedir(), ".claude", "projects", "-Users-" + homedir().split("/").pop() + "--openclaw-workspace");
}
