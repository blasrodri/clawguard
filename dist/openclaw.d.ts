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
    on(hook: string, handler: HookHandler): void;
    /** Plugin-scoped config object from `openclaw.json` (OpenClaw calls this `pluginConfig`). */
    readonly pluginConfig?: unknown;
    /** Gateway logger, if exposed. */
    readonly logger?: {
        info?(msg: string): void;
        warn?(msg: string): void;
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
export declare function readPromptText(ctx: unknown): string | undefined;
export interface PromptEstimate {
    readonly inputTokens: number;
    /** "reported" when the SDK gave us a real number; "estimated" via chars/4. */
    readonly source: "reported" | "estimated" | "unknown";
}
/**
 * Best-effort pre-flight input-token count from a `before_model_resolve`
 * context. Prefers a reported count if any obvious field carries one;
 * otherwise estimates from prompt / messages text via `chars/4`. Returns
 * `inputTokens: 0` when the context exposes nothing usable — callers
 * should treat that as "no estimate available."
 */
export declare function readPromptEstimate(ctx: unknown): PromptEstimate;
/**
 * Did a model call succeed? Read from `model_call_ended`. Defensive: an
 * explicit error, a failure-shaped outcome string, or an HTTP status >= 400
 * counts as failure; anything else is treated as success. This is the
 * signal the circuit breaker consumes.
 */
export declare function readCallOk(ctx: unknown): boolean;
//# sourceMappingURL=openclaw.d.ts.map