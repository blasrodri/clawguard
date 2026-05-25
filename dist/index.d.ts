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
declare const _default: any;
export default _default;
export { Governor } from "./core/governor.js";
export { normalizeConfig, DEFAULT_CONFIG } from "./config.js";
export type { ClawGuardConfig } from "./config.js";
export * as pricing from "./core/pricing.js";
export * as downgrade from "./core/downgrade.js";
export * as dlp from "./core/dlp.js";
export { BudgetWindow } from "./core/budget.js";
export { AuditLog, FileAuditSink, MemoryAuditSink } from "./core/audit.js";
export { MemoryStore, FileStore } from "./core/store.js";
export type { GovernanceStore, BudgetState } from "./core/store.js";
//# sourceMappingURL=index.d.ts.map