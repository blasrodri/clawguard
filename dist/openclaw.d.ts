/**
 * OpenClaw plugin SDK boundary.
 *
 * This is the ONLY file that encodes assumptions about OpenClaw's plugin
 * API. The exact TypeScript types ship with `@openclaw/plugin-sdk`; until
 * this package depends on it directly, we model the minimal surface we use
 * and read hook-context fields defensively from `unknown`, so a small
 * shape difference in the live SDK can't crash the gateway. Adjusting to
 * the published types is a single-file change.
 *
 * Hook names and semantics are taken from the OpenClaw plugin hooks
 * reference:
 *   - before_model_resolve  → return { providerOverride?, modelOverride? }
 *   - before_agent_run      → return { block?, reason? } (veto)
 *   - llm_output            → observe { provider, model, usage, text }
 *   - model_call_ended      → observe sanitized call metadata (usage)
 *   - message_sending       → return { cancel? } to drop the outbound msg
 */
export declare const HOOKS: {
    readonly beforeModelResolve: "before_model_resolve";
    readonly beforeAgentRun: "before_agent_run";
    readonly llmOutput: "llm_output";
    readonly modelCallEnded: "model_call_ended";
    readonly messageSending: "message_sending";
};
export type HookResult = unknown;
export type HookHandler = (ctx: unknown) => HookResult | Promise<HookResult>;
export interface PluginApi {
    /** Register a handler for a named lifecycle hook. */
    registerHook(hook: string, handler: HookHandler): void;
    /** Plugin-scoped config from `plugins.entries.<id>.config` in openclaw.json. */
    readonly pluginConfig?: unknown;
    /** Gateway logger. */
    readonly logger: {
        info(msg: string): void;
        warn(msg: string): void;
        error?(msg: string): void;
    };
}
export interface ModelCtx {
    provider: string;
    model: string | undefined;
}
export declare function readModelCtx(ctx: unknown): ModelCtx;
export interface UsageCtx {
    provider: string;
    model: string | undefined;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    /** False when the provider sent no usage block — drives "usage_missing". */
    usageReported: boolean;
    text: string | undefined;
}
export declare function readUsageCtx(ctx: unknown): UsageCtx;
export declare function readMessageText(ctx: unknown): string | undefined;
/**
 * Did a model call succeed? Read from `model_call_ended`. Defensive: an
 * explicit error, a failure-shaped outcome string, or an HTTP status >= 400
 * counts as failure; anything else is treated as success. This is the
 * signal the circuit breaker consumes.
 */
export declare function readCallOk(ctx: unknown): boolean;
//# sourceMappingURL=openclaw.d.ts.map