/**
 * Tails Claude Code session JSONL files and extracts token usage from
 * assistant messages. This is how clarguard gets token accounting when
 * OpenClaw uses the claude-cli runtime — the gateway doesn't expose usage
 * via plugin hooks in that mode, but Claude Code writes full usage data to
 * ~/.claude/projects/<workspace>/<sessionId>.jsonl after every turn.
 *
 * Usage is fed into the Governor via the same onUsage() path as the
 * llm_output hook, so budget accounting, DLP, and audit all work normally.
 */
export interface UsageRecord {
    provider: string;
    model: string | undefined;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    usageReported: boolean;
}
export type UsageCallback = (usage: UsageRecord) => void;
export declare class SessionWatcher {
    private readonly watchDir;
    private readonly fileStates;
    private dirWatcher;
    private readonly onUsage;
    private readonly onError;
    private stopped;
    constructor(opts: {
        watchDir?: string;
        onUsage: UsageCallback;
        onError?: (err: unknown) => void;
    });
    start(): void;
    stop(): void;
    private watchFile;
    private readNewLines;
}
export declare function defaultWatchDir(): string;
//# sourceMappingURL=session-watcher.d.ts.map