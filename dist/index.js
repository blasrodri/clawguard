/**
 * clarguard — OpenClaw governance plugin entry point.
 *
 * Wires OpenClaw lifecycle hooks onto the pure `Governor` engine. Every
 * hook body is wrapped so a bug or a disk error inside clarguard can never
 * crash the host turn: by default it fails *open* (the call proceeds);
 * set `failMode: "closed"` to fail safe (block) instead. Keep this layer
 * thin — all real decisions live in `core/`, which is exported below so
 * the package doubles as a library.
 */
// @ts-ignore — openclaw/plugin-sdk/plugin-entry is provided by the host runtime
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { normalizeConfig } from "./config.js";
import { Governor } from "./core/governor.js";
import { guarded } from "./core/guard.js";
import { SessionWatcher } from "./core/session-watcher.js";
import { HOOKS, readCallOk, readMessageText, readModelCtx, readPromptEstimate, readPromptText, readUsageCtx, } from "./openclaw.js";
export default definePluginEntry({
    id: "@blasrodri/clawguard",
    register(api) {
        const config = normalizeConfig(api.pluginConfig);
        const logger = makeLogger(api);
        const governor = new Governor(config, { logger });
        const guard = makeGuard(config, logger);
        // Model downgrade: rewrite to a cheaper model before the call is made.
        // The token estimate (reported by SDK or estimated chars/4) drives the
        // pre-flight cost log line.
        api.on(HOOKS.beforeModelResolve, (ctx) => guard("before_model_resolve", undefined, () => {
            const modelCtx = readModelCtx(ctx);
            const { inputTokens } = readPromptEstimate(ctx);
            const { modelOverride } = governor.onModelResolve({
                ...modelCtx,
                estimatedInputTokens: inputTokens,
            });
            return modelOverride ? { modelOverride } : undefined;
        }));
        // Budget gate + inbound DLP: refuse a new turn once the window's budget is
        // spent, or if the user's message contains a secret/PII and onDetect=block.
        api.on(HOOKS.beforeAgentRun, (ctx) => guard("before_agent_run", config.failMode === "closed" ? { block: true } : undefined, () => {
            const gate = governor.onRunGate();
            if (gate.block)
                return { block: true, reason: gate.reason };
            const { cancel, labels } = governor.onMessageSending(readPromptText(ctx));
            if (cancel)
                return { block: true, reason: `DLP: inbound message blocked (${labels.join(", ")})` };
            return undefined;
        }));
        // Usage accounting + response DLP. llmOutputFired disables the session
        // watcher below to avoid double-counting when the anthropic runtime is used.
        let llmOutputFired = false;
        api.on(HOOKS.llmOutput, (ctx) => guard("llm_output", undefined, () => {
            llmOutputFired = true;
            governor.onUsage(readUsageCtx(ctx));
            return undefined;
        }));
        // Circuit breaker: feed call outcomes (success/failure) to the breaker.
        api.on(HOOKS.modelCallEnded, (ctx) => guard("model_call_ended", undefined, () => {
            governor.onCallEnded(readCallOk(ctx));
            return undefined;
        }));
        // Outbound DLP: scan content and optionally cancel the send.
        api.on(HOOKS.messageSending, (ctx) => guard("message_sending", undefined, () => {
            const { cancel } = governor.onMessageSending(readMessageText(ctx));
            return cancel ? { cancel: true } : undefined;
        }));
        // Session watcher: tails Claude Code JSONL files for token usage when
        // claude-cli runtime is in use (llm_output doesn't fire then).
        // Disabled automatically if llm_output fires — that's the anthropic runtime.
        const watcher = new SessionWatcher({
            onUsage: (u) => { if (!llmOutputFired)
                governor.onUsage(u); },
            onError: (err) => logger.warn(`clarguard: session-watcher error — ${String(err)}`),
        });
        watcher.start();
        // Don't lose buffered audit lines if the gateway shuts down cleanly.
        process.once("beforeExit", () => { governor.flush(); watcher.stop(); });
        logger.info(`clarguard active — mode=${config.mode} fail=${config.failMode}` +
            `${config.downgrade.to ? ` downgrade=${config.downgrade.to}` : ""}` +
            `${config.budget.maxUsd ? ` maxUsd=${config.budget.maxUsd}/win` : ""}` +
            `${config.budget.maxTokens ? ` maxTokens=${config.budget.maxTokens}/win` : ""}` +
            ` dlp=${config.dlp.enabled ? config.dlp.onDetect : "off"}`);
    },
});
/** Run a hook body, returning `onError` (never throwing) if it fails. */
function makeGuard(config, logger) {
    return function guard(hook, onError, body) {
        return guarded(body, onError, (err) => logger.warn(`clarguard: ${hook} errored, failing ${config.failMode} — ${String(err)}`));
    };
}
function makeLogger(api) {
    const l = api.logger;
    return {
        info: (msg) => (l?.info ? l.info(msg) : console.log(msg)),
        warn: (msg) => (l?.warn ? l.warn(msg) : console.warn(msg)),
    };
}
export { Governor } from "./core/governor.js";
export { normalizeConfig, DEFAULT_CONFIG } from "./config.js";
export * as pricing from "./core/pricing.js";
export * as downgrade from "./core/downgrade.js";
export * as dlp from "./core/dlp.js";
export { BudgetWindow } from "./core/budget.js";
export { AuditLog, FileAuditSink, MemoryAuditSink } from "./core/audit.js";
export { MemoryStore, FileStore } from "./core/store.js";
//# sourceMappingURL=index.js.map