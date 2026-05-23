/**
 * clawguard — Meridian plugin entry point.
 *
 * Wires the pure Governor engine onto Meridian's Transform hooks so
 * clawguard works with the claude-cli runtime (Claude Code SDK proxy).
 *
 * Hook mapping:
 *   onRequest   → budget gate (block if over limit) + model downgrade
 *   onTelemetry → token / USD accounting (settles the reserve)
 *   onResponse  → outbound DLP scan
 *
 * Install:
 *   1. Add to ~/.config/meridian/plugins.json:
 *      { "path": "/path/to/clawguard/dist/meridian.js", "enabled": true }
 *   2. Restart Meridian (or POST /plugins/reload).
 *
 * Config is read from ~/.clawguard/config.json (same schema as the
 * OpenClaw plugin config). Missing file = safe defaults.
 */
interface RequestContext {
    readonly adapter: string;
    model: string;
    messages: unknown[];
    metadata: Record<string, unknown>;
    [key: string]: unknown;
}
interface ResponseContext {
    readonly adapter: string;
    content: unknown[];
    metadata: Record<string, unknown>;
}
interface TelemetryContext {
    readonly adapter: string;
    readonly model: string;
    readonly requestId: string;
    readonly durationMs: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheCreationTokens: number;
}
declare const plugin: {
    name: string;
    version: string;
    description: string;
    onRequest(ctx: RequestContext): RequestContext;
    onResponse(ctx: ResponseContext): ResponseContext;
    onTelemetry(ctx: TelemetryContext): void;
};
export default plugin;
//# sourceMappingURL=meridian.d.ts.map