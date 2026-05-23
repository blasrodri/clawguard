/**
 * The governance engine. Pure with respect to OpenClaw — it knows
 * nothing about hooks or the gateway, only about the decisions it makes.
 * `src/index.ts` is the thin layer that maps OpenClaw hooks onto these
 * methods. This separation keeps the valuable logic fully unit-testable
 * without a running gateway.
 *
 * Charging is two-phase: `onRunGate` reserves an estimate before a call
 * goes out (so in-flight spend counts immediately and overshoot is
 * bounded), and `onUsage` settles that reserve against authoritative
 * usage once the response arrives. Downgrade savings are attributed by
 * matching each resolve-time decision (FIFO) to its later usage event.
 */
import type { ClawGuardConfig } from "../config.js";
import { type AuditSink } from "./audit.js";
import { BudgetWindow, type Clock } from "./budget.js";
import { type DlpLabel } from "./dlp.js";
import { type Provider } from "./pricing.js";
import { type GovernanceStore } from "./store.js";
export interface ModelResolveInput {
    readonly provider: Provider;
    readonly model: string | undefined;
}
export interface ModelResolveOutcome {
    readonly modelOverride?: string;
}
export interface RunGateOutcome {
    readonly block: boolean;
    readonly reason: string;
    readonly delayMs: number;
}
export interface UsageInput {
    readonly provider: Provider;
    readonly model: string | undefined;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens?: number;
    /** Explicit signal that the provider reported a usage block. */
    readonly usageReported?: boolean;
    /** Optional response text for output-side DLP scanning. */
    readonly text?: string;
}
export interface MessageScanOutcome {
    readonly cancel: boolean;
    readonly labels: DlpLabel[];
}
export interface GovernorStatus {
    readonly mode: string;
    readonly budget: ReturnType<BudgetWindow["snapshot"]>;
    readonly downgradeCount: number;
    readonly estimatedSavedUsd: number;
    readonly killSwitchEngaged: boolean;
    readonly breakerOpen: boolean;
    readonly consecutiveFailures: number;
}
export interface Logger {
    info(msg: string): void;
    warn(msg: string): void;
}
export interface GovernorDeps {
    readonly logger?: Logger;
    readonly clock?: Clock;
    /** Override the budget store (tests). Defaults from config. */
    readonly store?: GovernanceStore;
    /** Override the audit sink (tests). Defaults from config. */
    readonly auditSink?: AuditSink;
    /** Override kill-switch file existence check (tests). */
    readonly fileExists?: (path: string) => boolean;
}
export declare class Governor {
    private readonly config;
    private readonly budget;
    private readonly audit;
    private readonly logger;
    private readonly now;
    private readonly fileExists;
    private readonly pendingDowngrades;
    private downgradeCount;
    private savedUsd;
    private consecutiveFailures;
    private breakerOpenUntil;
    constructor(config: ClawGuardConfig, deps?: GovernorDeps);
    /** `before_model_resolve`: rewrite to a cheaper model when policy says so. */
    onModelResolve(input: ModelResolveInput): ModelResolveOutcome;
    /**
     * `before_agent_run`: refuse to start a turn if the kill switch is
     * engaged, the circuit breaker is open, or the budget is spent.
     */
    onRunGate(): RunGateOutcome;
    /** `model_call_ended`: feed call outcomes to the circuit breaker. */
    onCallEnded(ok: boolean): void;
    private hardStop;
    private killActive;
    private breakerActive;
    /** `llm_output`: reconcile usage, attribute savings, scan the response. */
    onUsage(input: UsageInput): void;
    /** Scan content for DLP hits; optionally cancel the message. */
    onMessageSending(text: string | undefined, direction?: "inbound" | "outbound"): MessageScanOutcome;
    /** Flush any buffered audit records (call on shutdown). */
    flush(): void;
    /** Point-in-time view for status reporting. */
    status(): GovernorStatus;
    private rememberDowngrade;
}
//# sourceMappingURL=governor.d.ts.map