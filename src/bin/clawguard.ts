#!/usr/bin/env node
/**
 * `clawguard` CLI. Today the only subcommand is `report`; structured so
 * `status`, `reset-budget`, etc. can land next without re-shuffling.
 */

import { parseArgs } from "node:util";

import { runReport } from "../report.js";
import { runSetup } from "./setup.js";

const TOP_LEVEL_HELP = `Usage: clawguard <command> [options]

Commands:
  setup      Fix OpenClaw config so clawguard hooks actually fire (run once after install).
  report     Render a human-readable digest of the audit log.

Run \`clawguard <command> --help\` for command-specific options.`;

const REPORT_HELP = `Usage: clawguard report [options]

Render the audit log + budget state as markdown (or JSON).

Options:
  --since <range>        Time range (e.g. 24h, 7d) or ISO timestamp. Default: 24h.
  --audit-path <path>    Audit JSONL path. Default: ~/.clawguard/audit.jsonl.
  --budget-path <path>   Budget state path. Default: ~/.clawguard/budget.json.
  --cap-usd <number>     USD budget cap (so the report can show a percentage).
  --cap-tokens <number>  Token budget cap (so the report can show a percentage).
  --json                 Emit JSON instead of markdown.
  -h, --help             Show this help.`;

function main(): number {
  const [, , subcommand, ...rest] = process.argv;

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    process.stdout.write(TOP_LEVEL_HELP + "\n");
    return 0;
  }

  switch (subcommand) {
    case "setup":
      return setupCmd(rest);
    case "report":
      return reportCmd(rest);
    default:
      process.stderr.write(`unknown subcommand: ${subcommand}\n\n${TOP_LEVEL_HELP}\n`);
      return 2;
  }
}

const SETUP_HELP = `Usage: clawguard setup [options]

Fix OpenClaw configuration so clawguard hooks actually fire.
Run this once after installing clawguard.

What it does:
  1. Grants operator.write + operator.pairing to your local CLI device
     (fixes the approval catch-22 that blocks \`openclaw agent\` commands).
  2. Removes claude-cli agentRuntime overrides so models use the anthropic
     runtime, which is the only runtime where clawguard hooks fire.
  3. Restarts the OpenClaw gateway to apply changes.

Options:
  --dry-run    Show what would change without writing anything.
  --json       Emit result as JSON.
  -h, --help   Show this help.`;

function setupCmd(args: string[]): number {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      options: {
        "dry-run": { type: "boolean", default: false },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
      strict: true,
    });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${SETUP_HELP}\n`);
    return 2;
  }
  const { values } = parsed;
  if (values.help) {
    process.stdout.write(SETUP_HELP + "\n");
    return 0;
  }
  return runSetup({ dryRun: values["dry-run"] === true, json: values.json === true });
}

function reportCmd(args: string[]): number {
  let parsed: ReturnType<typeof parseArgs>;
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
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${REPORT_HELP}\n`);
    return 2;
  }

  const { values } = parsed;
  if (values.help) {
    process.stdout.write(REPORT_HELP + "\n");
    return 0;
  }

  process.stdout.write(
    runReport({
      since: typeof values.since === "string" ? values.since : undefined,
      auditPath: typeof values["audit-path"] === "string" ? values["audit-path"] : undefined,
      budgetPath: typeof values["budget-path"] === "string" ? values["budget-path"] : undefined,
      capUsd: parseNumber(values["cap-usd"]),
      capTokens: parseNumber(values["cap-tokens"]),
      json: values.json === true,
    }) + "\n",
  );
  return 0;
}

function parseNumber(v: unknown): number | undefined {
  if (typeof v !== "string") {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

process.exit(main());
