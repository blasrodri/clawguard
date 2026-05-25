# Changelog

All notable changes to clarguard are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Budget forecasting.** `clarguard report` now shows the current burn
  rate and the projected time to cap ("at $1.20/hour you'll hit the cap
  in ~3h 14m"), or the projected end-of-window spend when the cap won't
  be hit. Pure projection — gated on a minimum elapsed time
  (`max(30s, 1% of window)`) so the first call of a window doesn't drive
  a junk number.
- **Webhook alerts.** Optional `notifications.webhookUrl` POSTs JSON to
  Slack/Discord/anything on: budget threshold crossings (default 50/90/100%),
  kill-switch engagement, circuit-breaker openings, and (opt-in) cost
  anomalies. Fire-and-forget (the gateway hot path never waits on HTTP),
  abort-on-timeout, and webhook failures are themselves audited as
  `notification_failed` so a bad URL is visible in `report`, not silent.
  De-duplicated: each threshold and each kill-switch engagement fires once
  per occurrence, not once per call.
- **Custom DLP patterns + selectable built-ins.** New `dlp.customPatterns`
  config: `[{ name, regex, flags?, action? }]`. The `name` is the audit
  label (so an operator's domain term, e.g. `customer_id`, shows up in
  reports). `action` is optional and overrides the global `dlp.onDetect`
  per pattern — so a team can `log` internal codenames while `block`-ing
  any leak of a customer-id format. `dlp.builtins` accepts `"all"` (default)
  or a subset like `["api_key", "bearer_token"]`. Invalid regexes are
  skipped at startup and audited as `dlp_pattern_invalid` — no crash.
- **Pre-flight cost estimate + per-call log line.** Every LLM call now
  emits a one-line log through the gateway's logger: a pre-flight `est`
  line at `before_model_resolve` (if any input-token estimate is available
  from the SDK or extractable from prompt/messages text via `chars/4`)
  and an `actual` line at `llm_output`, each with current window
  percentage. Disable via `logging.perCallLine: false`. Pre-flight is
  skipped silently when no estimate is available and when the model rate
  is unknown — no faked numbers in stdout.
- New `src/core/estimate.ts` exports `estimateTokensFromText` and
  `estimateCallCostUsd`, reusable by future features (forecasting, alerts).
- **Cost anomaly detection** — flags an `llm_output` whose cost exceeds
  `anomaly.ratio` × the per-(provider, model) median over the last
  `windowSize` calls. Per-model bucketing avoids the obvious false
  positives, a cold-start `minSamples` skip avoids the empty-baseline
  trap, and zero-cost calls are ignored. Emits a `cost_anomaly` audit
  event and surfaces in `clarguard report`. Disabled by default.
- **`clarguard report` CLI** — renders the audit JSONL + budget state as a
  human-readable markdown digest (or `--json` for machine consumers). Shows
  current spend vs cap, DLP hits by category, downgrade routes and savings,
  circuit-breaker / kill-switch / persistence health. Designed to be the
  artifact you actually screenshot or paste into a status channel.
- A new audit event type `savings` (emitted on `llm_output` when a
  downgrade is settled) so `clarguard report` can show real savings totals,
  not just downgrade counts.

### Changed

- `FileStore` is now durable and harder to misconfigure:
  - **fsync** the temp file before `rename`, and best-effort fsync the
    directory after, so a power loss can no longer leave a renamed-but-empty
    budget file.
  - **Advisory PID lock** on the persistence directory at construction. A
    second gateway pointing at the same `persistPath` throws on startup
    with a clear "locked by pid N" error instead of silently drifting the
    shared budget. Stale locks (dead PIDs) are auto-reclaimed.
  - **Failures are audited**, not swallowed. Save errors, corrupt files,
    and lock contention emit `persistence_degraded` events with a clear
    reason and recover with `save_recovered`. Operators see disk-full /
    permission problems instead of guessing why the budget reset.

### Added

- **Kill switch** — halt all calls via a config flag or the presence of a
  watch-file (toggle at runtime, no gateway restart).
- **Circuit breaker** — open (halt) after N consecutive provider failures,
  fed by `model_call_ended`, with an auto-recovering cooldown.
- **Budget-aware downgrade** — `downgrade.whenBudgetRatioAbove` keeps the
  premium model until usage crosses a fraction of the budget, then downgrades.

With these, clarguard now implements all three governance patterns from
OpenClaw RFC #27442 (budgets, circuit breaker, kill switch).

## [0.1.0] - 2026-05-22

Initial release. In-process OpenClaw governance plugin.

### Added

- **Budget enforcement** — global, fixed-window token + USD ceilings via the
  `before_agent_run` hook, with a soft-limit back-pressure delay before a
  hard block.
- **Two-phase charging** — `reserve` an estimate before a call, `settle`
  against authoritative usage on `llm_output`, so in-flight and concurrent
  spend counts immediately and overshoot is bounded.
- **Persistence** — budget state survives gateway restarts via a
  zero-dependency JSON `GovernanceStore` (atomic writes; no SQLite/native
  addon). Pluggable for SQL/Redis later.
- **Model downgrade** — real model rewrite to a cheaper tier via
  `before_model_resolve`, with correct savings attribution (FIFO match from
  resolve to usage).
- **DLP** — regex detectors for email, phone, credit card (Luhn), SSN, API
  keys, and bearer tokens, on outbound messages (`message_sending`) and
  responses; `log` or `block`, with a hot-path length cap.
- **Audit** — append-only JSONL of decisions (labels and counts only, never
  raw content), buffered and size-rotated, with a schema version field.
- **Fail-safe hooks** — every hook is wrapped fail-open by default
  (configurable fail-closed); an internal error can never crash the host
  turn.
- **Shadow mode** — observe and record what enforcement *would* do without
  acting.

[Unreleased]: https://github.com/blasrodri/clawguard/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/blasrodri/clawguard/releases/tag/v0.1.0
