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

import { estimateTokensFromText } from "./core/estimate.js";

export const HOOKS = {
  beforeModelResolve: "before_model_resolve",
  beforeAgentRun: "before_agent_run",
  llmOutput: "llm_output",
  modelCallEnded: "model_call_ended",
  messageSending: "message_sending",
} as const;

export type HookResult = unknown;
export type HookHandler = (ctx: unknown) => HookResult | Promise<HookResult>;

/**
 * Fallback provider used when a hook context omits the field. Set to
 * Anthropic because OpenClaw's primary user base targets Claude; an
 * OpenAI call without a provider field will be mis-priced. Replace with
 * a typed read once `@openclaw/plugin-sdk` is pinned.
 */
const DEFAULT_PROVIDER = "anthropic";

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

// --- defensive field readers -------------------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) {
      return v;
    }
  }
  return undefined;
}

function firstNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      return v;
    }
  }
  return 0;
}

export interface ModelCtx {
  provider: string;
  model: string | undefined;
}

export function readModelCtx(ctx: unknown): ModelCtx {
  const obj = asRecord(ctx);
  return {
    provider: firstString(obj, ["provider", "providerId", "providerName"]) ?? DEFAULT_PROVIDER,
    model: firstString(obj, ["model", "modelId", "modelName"]),
  };
}

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

export function readUsageCtx(ctx: unknown): UsageCtx {
  const obj = asRecord(ctx);
  const hasUsage = typeof obj.usage === "object" && obj.usage !== null;
  const usage = asRecord(obj.usage);
  return {
    provider: firstString(obj, ["provider", "providerId", "providerName"]) ?? DEFAULT_PROVIDER,
    model: firstString(obj, ["model", "modelId", "modelName"]),
    inputTokens: firstNumber(usage, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]),
    outputTokens: firstNumber(usage, [
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
    ]),
    cacheReadTokens: firstNumber(usage, ["cacheReadInputTokens", "cache_read_input_tokens"]),
    usageReported: hasUsage,
    text: firstString(obj, ["text", "output", "content"]),
  };
}

export function readMessageText(ctx: unknown): string | undefined {
  const obj = asRecord(ctx);
  return firstString(obj, ["text", "content", "body", "message"]);
}

export function readPromptText(ctx: unknown): string | undefined {
  const obj = asRecord(ctx);
  return firstString(obj, ["prompt", "text", "content", "body", "message"]);
}

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
export function readPromptEstimate(ctx: unknown): PromptEstimate {
  const obj = asRecord(ctx);
  const reported = firstNumber(obj, [
    "inputTokens",
    "input_tokens",
    "promptTokens",
    "prompt_tokens",
    "tokenEstimate",
    "contextTokenBudget",
  ]);
  if (reported > 0) {
    return { inputTokens: reported, source: "reported" };
  }
  const inline = firstString(obj, ["prompt", "text", "input", "content"]);
  if (inline) {
    return { inputTokens: estimateTokensFromText(inline), source: "estimated" };
  }
  if (Array.isArray(obj.messages)) {
    let chars = 0;
    for (const m of obj.messages) {
      const text = firstString(asRecord(m), ["content", "text"]);
      if (text) {
        chars += text.length;
      }
    }
    if (chars > 0) {
      return { inputTokens: estimateTokensFromText("x".repeat(chars)), source: "estimated" };
    }
  }
  return { inputTokens: 0, source: "unknown" };
}

/**
 * Did a model call succeed? Read from `model_call_ended`. Defensive: an
 * explicit error, a failure-shaped outcome string, or an HTTP status >= 400
 * counts as failure; anything else is treated as success. This is the
 * signal the circuit breaker consumes.
 */
export function readCallOk(ctx: unknown): boolean {
  const obj = asRecord(ctx);
  if (obj.error != null && obj.error !== false) {
    return false;
  }
  const status = firstNumber(obj, ["status", "statusCode", "httpStatus"]);
  if (status >= 400) {
    return false;
  }
  const outcome = firstString(obj, ["outcome", "status", "result"])?.toLowerCase();
  if (outcome && ["error", "failed", "failure", "timeout", "aborted"].includes(outcome)) {
    return false;
  }
  return true;
}
