/**
 * clawguard — OpenClaw governance plugin entry point.
 *
 * Wires OpenClaw lifecycle hooks onto the pure `Governor` engine. Every
 * hook body is wrapped so a bug or a disk error inside clawguard can never
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
import { HOOKS, readCallOk, readMessageText, readModelCtx, readUsageCtx, } from "./openclaw.js";
export default definePluginEntry({
    id: "clawguard",
    register(api) {
        const config = normalizeConfig(api.pluginConfig);
        const logger = api.logger;
        const governor = new Governor(config, { logger });
        const guard = makeGuard(config, logger);
        // Model downgrade: rewrite to a cheaper model before the call is made.
        api.on(HOOKS.beforeModelResolve, (ctx) => guard("before_model_resolve", undefined, () => {
            const { modelOverride } = governor.onModelResolve(readModelCtx(ctx));
            return modelOverride ? { modelOverride } : undefined;
        }));
        // Budget gate: refuse a new turn once the window's budget is spent.
        api.on(HOOKS.beforeAgentRun, () => guard("before_agent_run", config.failMode === "closed" ? { outcome: "block", reason: "clawguard fail-closed" } : undefined, () => {
            const gate = governor.onRunGate();
            return gate.block ? { outcome: "block", reason: gate.reason } : { outcome: "pass" };
        }));
        // Usage accounting + response DLP.
        api.on(HOOKS.llmOutput, (ctx) => guard("llm_output", undefined, () => {
            llmOutputFired = true; // anthropic runtime — disable session watcher
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
        // Don't lose buffered audit lines if the gateway shuts down cleanly.
        api.on("gateway_stop", () => guard("gateway_stop", undefined, () => { governor.flush(); watcher.stop(); return undefined; }));
        // Session watcher: tails Claude Code JSONL files for token usage when
        // the claude-cli runtime is in use (llm_output hook doesn't fire then).
        // Disabled automatically if llm_output fires — that means the anthropic
        // runtime is in use and we'd otherwise double-count every call.
        let llmOutputFired = false;
        const watcher = new SessionWatcher({
            onUsage: (u) => {
                if (!llmOutputFired)
                    governor.onUsage(u);
            },
            onError: (err) => logger.warn(`clawguard: session-watcher error — ${String(err)}`),
        });
        watcher.start();
        logger.info(`clawguard active — mode=${config.mode} fail=${config.failMode}` +
            `${config.downgrade.to ? ` downgrade=${config.downgrade.to}` : ""}` +
            `${config.budget.maxUsd ? ` maxUsd=${config.budget.maxUsd}/win` : ""}` +
            `${config.budget.maxTokens ? ` maxTokens=${config.budget.maxTokens}/win` : ""}` +
            ` dlp=${config.dlp.enabled ? config.dlp.onDetect : "off"}`);
    },
});
function makeGuard(config, logger) {
    return function guard(hook, onError, body) {
        return guarded(body, onError, (err) => logger.warn(`clawguard: ${hook} errored, failing ${config.failMode} — ${String(err)}`));
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