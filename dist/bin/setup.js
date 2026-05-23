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
import { execSync } from "node:child_process";
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
    process.stdout.write(`  Meridian plugin ${result.meridianFixed ? "✓ registered" : "— " + result.meridianDetail}\n`);
    process.stdout.write(`  Hook coverage   ${result.hookCoverageNote}\n`);
    if (result.restartNeeded && !opts.dryRun) {
        process.stdout.write(`\nRestarting gateway to apply changes…\n`);
        try {
            execSync("openclaw gateway restart", { stdio: "inherit" });
        }
        catch {
            process.stdout.write("  (restart failed — run: openclaw gateway restart)\n");
        }
    }
    else if (!result.deviceFixed && !result.meridianFixed) {
        process.stdout.write("\nNothing to fix.\n");
    }
    return 0;
}
function setup(dryRun) {
    const result = {
        deviceFixed: false,
        deviceDetail: "already has operator.write",
        meridianFixed: false,
        meridianDetail: "not installed or already registered",
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
    // --- Meridian plugin registration ---
    const meridianResult = registerMeridianPlugin(dryRun);
    result.meridianFixed = meridianResult.fixed;
    result.meridianDetail = meridianResult.detail;
    if (meridianResult.fixed)
        result.restartNeeded = true;
    // --- Hook coverage note ---
    result.hookCoverageNote = hookCoverageNote(meridianResult.installed);
    return result;
}
function registerMeridianPlugin(dryRun) {
    // Find the clawguard meridian plugin dist file relative to this binary.
    // __filename resolves to the compiled .js in dist/bin/, so go up two levels.
    const pluginPath = join(homedir(), ".config", "meridian");
    const pluginsJsonPath = join(pluginPath, "plugins.json");
    // Resolve the meridian.js dist path — same dir as this binary's parent.
    const selfDir = new URL(".", import.meta.url).pathname;
    const meridianDist = join(selfDir, "..", "meridian.js");
    if (!existsSync(meridianDist)) {
        return { fixed: false, detail: "dist/meridian.js not found — run npm run build first", installed: false };
    }
    // Check if Meridian config dir exists (i.e. Meridian is installed).
    if (!existsSync(pluginPath)) {
        return { fixed: false, detail: "Meridian not installed (~/.config/meridian not found)", installed: false };
    }
    // Read or create plugins.json.
    let pluginsConfig = { plugins: [] };
    if (existsSync(pluginsJsonPath)) {
        try {
            pluginsConfig = JSON.parse(readFileSync(pluginsJsonPath, "utf8"));
            if (!Array.isArray(pluginsConfig.plugins))
                pluginsConfig.plugins = [];
        }
        catch {
            pluginsConfig = { plugins: [] };
        }
    }
    // Already registered?
    const already = pluginsConfig.plugins.some((p) => p.path === meridianDist);
    if (already) {
        return { fixed: false, detail: "already registered in plugins.json", installed: true };
    }
    if (!dryRun) {
        pluginsConfig.plugins.push({ path: meridianDist, enabled: true });
        writeFileSync(pluginsJsonPath, JSON.stringify(pluginsConfig, null, 2) + "\n");
    }
    return { fixed: true, detail: `registered ${meridianDist}`, installed: true };
}
function hookCoverageNote(meridianInstalled) {
    if (meridianInstalled) {
        return "full via Meridian — all hooks fire (budget, downgrade, DLP, token accounting)";
    }
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
    return "partial — claude-cli runtime bypasses hooks. Install Meridian for full coverage: https://github.com/rynfar/meridian";
}
//# sourceMappingURL=setup.js.map