/**
 * `clawguard setup` — one-shot post-install fixer.
 *
 * Fixes the device scope catch-22: the CLI device ships with only
 * `operator.read`. Without `operator.write`, every `openclaw agent` call
 * fails with an approval loop that requires write access to resolve.
 * We patch paired.json directly (the gateway is local, so the file is
 * authoritative) and restart the gateway.
 *
 * Note on hook coverage: clawguard hooks (budget, downgrade, DLP) fire only
 * when the OpenClaw gateway makes direct Anthropic API calls (the `anthropic`
 * agentRuntime). If your gateway is configured to use `claude-cli` as the
 * agentRuntime — which is the default when Claude Code is installed — only
 * the `before_agent_run` and `message_sending` hooks fire. Token accounting
 * and model downgrade require the `anthropic` runtime with a direct API key.
 */
export interface SetupResult {
    deviceFixed: boolean;
    deviceDetail: string;
    meridianFixed: boolean;
    meridianDetail: string;
    restartNeeded: boolean;
    hookCoverageNote: string;
}
export declare function runSetup(opts: {
    dryRun?: boolean;
    json?: boolean;
}): number;
//# sourceMappingURL=setup.d.ts.map