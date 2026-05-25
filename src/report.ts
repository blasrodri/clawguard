/**
 * `clawguard report` — turn the audit JSONL into a human-readable digest.
 *
 * The same data the audit log already records, rendered as the readout
 * you'd actually paste into a status channel or screenshot for a video.
 * Designed to be the most-shared artifact the package produces.
 *
 * Pure with respect to the filesystem (the loaders are injectable), so
 * the rendering is unit-testable without any real audit/budget files.
 */

import { readFileSync } from "node:fs";

import type { BudgetState } from "./core/store.js";

export interface ReportOptions {
  /** ISO timestamp, a Date, or a relative shorthand like `24h`, `7d`. */
  readonly since?: string | Date;
  readonly auditPath?: string;
  readonly budgetPath?: string;
  /** Cap to compare current spend against (cap lives in plugin config). */
  readonly capUsd?: number;
  readonly capTokens?: number;
  /** Emit machine-readable JSON instead of markdown. */
  readonly json?: boolean;
  /** Injected for tests. */
  readonly now?: () => Date;
  readonly loadEvents?: (path: string) => AuditEvent[];
  readonly loadBudget?: (path: string) => BudgetState | undefined;
}

export interface AuditEvent {
  readonly v?: number;
  readonly ts: string;
  readonly type: string;
  readonly [key: string]: unknown;
}

export interface ReportAggregate {
  readonly generatedAt: string;
  readonly since: string;
  readonly window:
    | {
        readonly spentUsd: number;
        readonly spentTokens: number;
        readonly capUsd: number | undefined;
        readonly capTokens: number | undefined;
        readonly windowStartedAt: string;
      }
    | undefined;
  readonly totals: {
    readonly events: number;
    readonly budgetBlocks: number;
    readonly killSwitchEngages: number;
    readonly breakerOpens: number;
    readonly breakerResets: number;
    readonly downgrades: number;
    readonly savingsUsd: number;
    readonly dlpHits: number;
    readonly usageMissing: number;
    readonly persistenceDegraded: number;
  };
  readonly dlpByLabel: Record<string, number>;
  readonly downgradeRoutes: ReadonlyArray<{ from: string; to: string; count: number }>;
}

export function runReport(options: ReportOptions = {}): string {
  const now = (options.now ?? (() => new Date()))();
  const sinceDate = resolveSince(options.since, now);
  const auditPath = options.auditPath ?? defaultAuditPath();
  const budgetPath = options.budgetPath ?? defaultBudgetPath();

  const loadEvents = options.loadEvents ?? defaultLoadEvents;
  const loadBudget = options.loadBudget ?? defaultLoadBudget;

  const all = loadEvents(auditPath);
  const events = all.filter((e) => e.ts >= sinceDate.toISOString());
  const state = loadBudget(budgetPath);

  const aggregate = buildAggregate(events, state, sinceDate, now, options);
  return options.json ? JSON.stringify(aggregate, null, 2) : renderMarkdown(aggregate);
}

// --- aggregation -------------------------------------------------------------

function buildAggregate(
  events: AuditEvent[],
  state: BudgetState | undefined,
  since: Date,
  now: Date,
  options: ReportOptions,
): ReportAggregate {
  let budgetBlocks = 0;
  let killSwitchEngages = 0;
  let breakerOpens = 0;
  let breakerResets = 0;
  let downgrades = 0;
  let savingsUsd = 0;
  let dlpHits = 0;
  let usageMissing = 0;
  let persistenceDegraded = 0;
  const dlpByLabel: Record<string, number> = {};
  const routes = new Map<string, { from: string; to: string; count: number }>();

  for (const ev of events) {
    switch (ev.type) {
      case "budget_block":
        budgetBlocks++;
        break;
      case "kill_switch_engaged":
        killSwitchEngages++;
        break;
      case "breaker_open":
        breakerOpens++;
        break;
      case "breaker_reset":
        breakerResets++;
        break;
      case "downgrade": {
        downgrades++;
        const from = typeof ev.from === "string" ? ev.from : "?";
        const to = typeof ev.to === "string" ? ev.to : "?";
        const key = `${from}→${to}`;
        const r = routes.get(key);
        if (r) {
          r.count++;
        } else {
          routes.set(key, { from, to, count: 1 });
        }
        break;
      }
      case "savings": {
        if (typeof ev.usd === "number" && Number.isFinite(ev.usd)) {
          savingsUsd += ev.usd;
        }
        break;
      }
      case "dlp_detected":
      case "dlp_blocked":
      case "dlp_response": {
        if (Array.isArray(ev.labels)) {
          for (const label of ev.labels) {
            if (typeof label === "string") {
              dlpHits++;
              dlpByLabel[label] = (dlpByLabel[label] ?? 0) + 1;
            }
          }
        }
        break;
      }
      case "usage_missing":
        usageMissing++;
        break;
      case "persistence_degraded":
        persistenceDegraded++;
        break;
      default:
        break;
    }
  }

  return {
    generatedAt: now.toISOString(),
    since: since.toISOString(),
    window: state
      ? {
          spentUsd: state.usdUsed,
          spentTokens: state.tokensUsed,
          capUsd: options.capUsd,
          capTokens: options.capTokens,
          windowStartedAt: new Date(state.windowStart).toISOString(),
        }
      : undefined,
    totals: {
      events: events.length,
      budgetBlocks,
      killSwitchEngages,
      breakerOpens,
      breakerResets,
      downgrades,
      savingsUsd,
      dlpHits,
      usageMissing,
      persistenceDegraded,
    },
    dlpByLabel,
    downgradeRoutes: Array.from(routes.values()).sort((a, b) => b.count - a.count),
  };
}

// --- rendering ---------------------------------------------------------------

function renderMarkdown(a: ReportAggregate): string {
  const lines: string[] = [];
  lines.push(`# clawguard report`);
  lines.push(`_generated ${a.generatedAt} · since ${a.since}_`);
  lines.push("");

  if (a.window) {
    lines.push(`## Budget`);
    lines.push(formatBudgetLine(a.window));
    lines.push(`_window started ${a.window.windowStartedAt}_`);
    lines.push("");
  }

  lines.push(`## Activity`);
  if (a.totals.events === 0) {
    lines.push(`_no audit events in this range — has the plugin run yet?_`);
    lines.push("");
    return lines.join("\n");
  }
  lines.push(`- ${a.totals.events} events recorded`);
  lines.push(
    `- ${a.totals.budgetBlocks} budget blocks · ${a.totals.killSwitchEngages} kill switch · ${a.totals.breakerOpens} circuit breaker`,
  );
  lines.push(
    `- ${a.totals.dlpHits} DLP hits across ${Object.keys(a.dlpByLabel).length} categor${Object.keys(a.dlpByLabel).length === 1 ? "y" : "ies"}`,
  );
  lines.push(
    `- ${a.totals.downgrades} model downgrades · ${formatUsd(a.totals.savingsUsd)} saved (est.)`,
  );
  if (a.totals.usageMissing > 0) {
    lines.push(`- ${a.totals.usageMissing} calls with missing usage`);
  }
  lines.push("");

  if (a.downgradeRoutes.length > 0) {
    lines.push(`## Downgrades`);
    for (const r of a.downgradeRoutes) {
      lines.push(`- ${r.from} → ${r.to}: ${r.count}`);
    }
    lines.push("");
  }

  if (Object.keys(a.dlpByLabel).length > 0) {
    lines.push(`## DLP`);
    lines.push(`| Category | Count |`);
    lines.push(`|---|---:|`);
    for (const [label, count] of Object.entries(a.dlpByLabel).sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${label} | ${count} |`);
    }
    lines.push("");
  }

  lines.push(`## Health`);
  lines.push(`- Breaker: ${a.totals.breakerOpens === 0 ? "closed" : `opened ${a.totals.breakerOpens}× (${a.totals.breakerResets} resets)`}`);
  lines.push(`- Persistence: ${a.totals.persistenceDegraded === 0 ? "healthy" : `degraded (${a.totals.persistenceDegraded} events)`}`);
  return lines.join("\n");
}

function formatBudgetLine(w: NonNullable<ReportAggregate["window"]>): string {
  const spent = formatUsd(w.spentUsd);
  if (w.capUsd && w.capUsd > 0) {
    const pct = Math.min(100, Math.round((w.spentUsd / w.capUsd) * 100));
    return `**${spent} of ${formatUsd(w.capUsd)}** spent (${pct}%) · ${w.spentTokens.toLocaleString()} tokens`;
  }
  return `**${spent}** spent · ${w.spentTokens.toLocaleString()} tokens · _cap not provided (pass --cap-usd to show %)_`;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

// --- defaults ----------------------------------------------------------------

function defaultLoadEvents(path: string): AuditEvent[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: AuditEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as AuditEvent;
      if (typeof parsed.ts === "string" && typeof parsed.type === "string") {
        out.push(parsed);
      }
    } catch {
      // Skip a corrupt line rather than failing the whole report.
    }
  }
  return out;
}

function defaultLoadBudget(path: string): BudgetState | undefined {
  try {
    const v: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof v !== "object" || v === null) {
      return undefined;
    }
    const o = v as Record<string, unknown>;
    if (
      typeof o.windowStart === "number" &&
      typeof o.tokensUsed === "number" &&
      typeof o.usdUsed === "number"
    ) {
      return { windowStart: o.windowStart, tokensUsed: o.tokensUsed, usdUsed: o.usdUsed };
    }
  } catch {
    // missing or corrupt — report renders without a budget section
  }
  return undefined;
}

function resolveSince(since: string | Date | undefined, now: Date): Date {
  if (since instanceof Date) {
    return since;
  }
  if (!since) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  const rel = since.match(/^(\d+)([hd])$/i);
  if (rel) {
    const n = Number(rel[1]);
    const ms = n * (rel[2]?.toLowerCase() === "h" ? 3_600_000 : 86_400_000);
    return new Date(now.getTime() - ms);
  }
  const parsed = new Date(since);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

function defaultAuditPath(): string {
  return `${homeDir()}/.clawguard/audit.jsonl`;
}

function defaultBudgetPath(): string {
  return `${homeDir()}/.clawguard/budget.json`;
}

function homeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? ".";
}
