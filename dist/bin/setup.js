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
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export function runSetup(opts) {
    const result = setup(opts.dryRun ?? false);
    if (opts.json) {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return 0;
    }
    const tag = opts.dryRun ? " (dry-run)" : "";
    process.stdout.write(`clawguard setup${tag}\n\n`);
    process.stdout.write(`  Device scopes   ${result.deviceFixed ? "✓ fixed — granted operator.write + operator.pairing" : "— " + result.deviceDetail}\n`);
    process.stdout.write(`  Hook coverage   ${result.hookCoverageNote}\n`);
    if (result.restartNeeded && !opts.dryRun) {
        process.stdout.write(`\nRestarting gateway to apply changes…\n`);
        try {
            spawnSync("openclaw", ["gateway", "restart"], { stdio: "inherit" });
        }
        catch {
            process.stdout.write("  (restart failed — run: openclaw gateway restart)\n");
        }
    }
    else if (!result.deviceFixed) {
        process.stdout.write("\nNothing to fix.\n");
    }
    return 0;
}
function setup(dryRun) {
    const result = {
        deviceFixed: false,
        deviceDetail: "already has operator.write",
        restartNeeded: false,
        hookCoverageNote: "",
    };
    // --- Device scope fix ---
    const pairedPath = join(homedir(), ".openclaw", "devices", "paired.json");
    if (existsSync(pairedPath)) {
        let paired;
        try {
            paired = JSON.parse(readFileSync(pairedPath, "utf8"));
        }
        catch {
            result.deviceDetail = "could not parse paired.json";
            paired = {};
        }
        let changed = false;
        for (const [id, raw] of Object.entries(paired)) {
            const dev = raw;
            const scopes = Array.isArray(dev.scopes) ? dev.scopes : [];
            const approved = Array.isArray(dev.approvedScopes) ? dev.approvedScopes : [];
            const needed = ["operator.write", "operator.pairing"];
            const missing = needed.filter((s) => !scopes.includes(s));
            if (missing.length === 0)
                continue;
            if (!dryRun) {
                dev.scopes = [...new Set([...scopes, ...needed])];
                dev.approvedScopes = [...new Set([...approved, ...needed])];
                const tokens = dev.tokens;
                if (tokens) {
                    for (const tok of Object.values(tokens)) {
                        const t = tok;
                        if (Array.isArray(t.scopes)) {
                            t.scopes = [...new Set([...t.scopes, ...needed])];
                        }
                    }
                }
                paired[id] = dev;
            }
            changed = true;
        }
        if (changed) {
            if (!dryRun) {
                writeFileSync(pairedPath, JSON.stringify(paired, null, 2) + "\n");
                const pendingPath = join(homedir(), ".openclaw", "devices", "pending.json");
                if (existsSync(pendingPath)) {
                    writeFileSync(pendingPath, "{}\n");
                }
            }
            result.deviceFixed = true;
            result.restartNeeded = true;
        }
    }
    else {
        result.deviceDetail = "paired.json not found — is OpenClaw installed?";
    }
    result.hookCoverageNote = hookCoverageNote();
    return result;
}
function hookCoverageNote() {
    const configPath = join(homedir(), ".openclaw", "openclaw.json");
    if (!existsSync(configPath))
        return "openclaw.json not found";
    let config;
    try {
        config = JSON.parse(readFileSync(configPath, "utf8"));
    }
    catch {
        return "could not read openclaw.json";
    }
    const auth = config.auth;
    const profiles = auth?.profiles;
    const hasAnthropicKey = profiles
        ? Object.values(profiles).some((p) => {
            const prof = p;
            return prof.provider === "anthropic" && prof.mode === "apikey";
        })
        : false;
    if (hasAnthropicKey) {
        return "full via OpenClaw anthropic runtime — all hooks fire";
    }
    return "partial — claude-cli runtime bypasses hooks; budget/DLP still work via before_agent_run";
}
//# sourceMappingURL=setup.js.map