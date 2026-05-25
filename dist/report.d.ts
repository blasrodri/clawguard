/**
 * `clarguard report` — turn the audit JSONL into a human-readable digest.
 *
 * The same data the audit log already records, rendered as the readout
 * you'd actually paste into a status channel or screenshot for a video.
 * Designed to be the most-shared artifact the package produces.
 *
 * Pure with respect to the filesystem (the loaders are injectable), so
 * the rendering is unit-testable without any real audit/budget files.
 */
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
    readonly window: {
        readonly spentUsd: number;
        readonly spentTokens: number;
        readonly capUsd: number | undefined;
        readonly capTokens: number | undefined;
        readonly windowStartedAt: string;
    } | undefined;
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
    readonly downgradeRoutes: ReadonlyArray<{
        from: string;
        to: string;
        count: number;
    }>;
}
export declare function runReport(options?: ReportOptions): string;
//# sourceMappingURL=report.d.ts.map