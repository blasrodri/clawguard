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

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { normalizeConfig } from "./config.js";
import { Governor } from "./core/governor.js";

// --- Meridian type shims (provided by @rynfar/meridian at runtime) ----------

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

// ---------------------------------------------------------------------------

function loadConfig(): ReturnType<typeof normalizeConfig> {
  const path = join(homedir(), ".clawguard", "config.json");
  if (!existsSync(path)) {
    return normalizeConfig(undefined);
  }
  try {
    return normalizeConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return normalizeConfig(undefined);
  }
}

const config = loadConfig();
const governor = new Governor(config);

// Key in RequestContext.metadata where we stash the request start time
// so onTelemetry can attribute it to the right request.
const META_PROVIDER = "clawguard.provider";

const plugin = {
  name: "clawguard",
  version: "0.1.0",
  description: "Budget enforcement, model downgrade, and DLP for Claude Code via Meridian",

  onRequest(ctx: RequestContext): RequestContext {
    // Infer provider from adapter name (meridian adapters: opencode, crush,
    // droid, pi, forgecode, passthrough — all claude-cli based = anthropic).
    const provider = "anthropic";

    // --- Budget gate ---
    const gate = governor.onRunGate();
    if (gate.block) {
      // Meridian doesn't have a veto mechanism in onRequest — throw so the
      // proxy surfaces an error to the client instead of sending the call.
      throw new Error(`clawguard: request blocked — ${gate.reason}`);
    }

    // --- Model downgrade ---
    const { modelOverride } = governor.onModelResolve({
      provider,
      model: ctx.model,
    });

    return {
      ...ctx,
      model: modelOverride ?? ctx.model,
      metadata: { ...ctx.metadata, [META_PROVIDER]: provider },
    };
  },

  onResponse(ctx: ResponseContext): ResponseContext {
    // Outbound DLP: scan the text content of the response.
    const text = extractText(ctx.content);
    if (text) {
      governor.onMessageSending(text);
    }
    return ctx;
  },

  onTelemetry(ctx: TelemetryContext): void {
    const provider = "anthropic";
    governor.onUsage({
      provider,
      model: ctx.model,
      inputTokens: ctx.inputTokens,
      outputTokens: ctx.outputTokens,
      cacheReadTokens: ctx.cacheReadTokens,
      usageReported: ctx.inputTokens + ctx.outputTokens > 0,
    });
    // Feed circuit breaker — telemetry only fires on success.
    governor.onCallEnded(true);
  },
};

export default plugin;

// ---------------------------------------------------------------------------

function extractText(content: unknown[]): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (
      typeof block === "object" &&
      block !== null &&
      "type" in block &&
      (block as Record<string, unknown>).type === "text" &&
      typeof (block as Record<string, unknown>).text === "string"
    ) {
      parts.push((block as Record<string, unknown>).text as string);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}
