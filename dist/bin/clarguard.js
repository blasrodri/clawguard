#!/usr/bin/env node
/**
 * `clarguard` CLI. Today the only subcommand is `report`; structured so
 * `status`, `reset-budget`, etc. can land next without re-shuffling.
 */
import { parseArgs } from "node:util";
import { runReport } from "../report.js";
const TOP_LEVEL_HELP = `Usage: clarguard <command> [options]

Commands:
  report     Render a human-readable digest of the audit log.

Run \`clarguard <command> --help\` for command-specific options.`;
const REPORT_HELP = `Usage: clarguard report [options]

Render the audit log + budget state as markdown (or JSON).

Options:
  --since <range>        Time range (e.g. 24h, 7d) or ISO timestamp. Default: 24h.
  --audit-path <path>    Audit JSONL path. Default: ~/.clarguard/audit.jsonl.
  --budget-path <path>   Budget state path. Default: ~/.clarguard/budget.json.
  --cap-usd <number>     USD budget cap (so the report can show a percentage).
  --cap-tokens <number>  Token budget cap (so the report can show a percentage).
  --json                 Emit JSON instead of markdown.
  -h, --help             Show this help.`;
function main() {
    const [, , subcommand, ...rest] = process.argv;
    if (!subcommand || subcommand === "--help" || subcommand === "-h") {
        process.stdout.write(TOP_LEVEL_HELP + "\n");
        return 0;
    }
    switch (subcommand) {
        case "report":
            return reportCmd(rest);
        default:
            process.stderr.write(`unknown subcommand: ${subcommand}\n\n${TOP_LEVEL_HELP}\n`);
            return 2;
    }
}
function reportCmd(args) {
    let parsed;
    try {
        parsed = parseArgs({
            args,
            options: {
                since: { type: "string" },
                "audit-path": { type: "string" },
                "budget-path": { type: "string" },
                "cap-usd": { type: "string" },
                "cap-tokens": { type: "string" },
                json: { type: "boolean", default: false },
                help: { type: "boolean", short: "h", default: false },
            },
            strict: true,
        });
    }
    catch (err) {
        process.stderr.write(`${err.message}\n\n${REPORT_HELP}\n`);
        return 2;
    }
    const { values } = parsed;
    if (values.help) {
        process.stdout.write(REPORT_HELP + "\n");
        return 0;
    }
    process.stdout.write(runReport({
        since: typeof values.since === "string" ? values.since : undefined,
        auditPath: typeof values["audit-path"] === "string" ? values["audit-path"] : undefined,
        budgetPath: typeof values["budget-path"] === "string" ? values["budget-path"] : undefined,
        capUsd: parseNumber(values["cap-usd"]),
        capTokens: parseNumber(values["cap-tokens"]),
        json: values.json === true,
    }) + "\n");
    return 0;
}
function parseNumber(v) {
    if (typeof v !== "string") {
        return undefined;
    }
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
}
process.exit(main());
//# sourceMappingURL=clarguard.js.map