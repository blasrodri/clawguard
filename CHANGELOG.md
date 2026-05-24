# Changelog

## 0.1.0 — 2026-05-23

Initial release.

- Budget enforcement: per-window token and USD caps with soft-limit delay and hard block
- Model downgrade: rewrite expensive model requests to a cheaper tier; cross-provider guard prevents mismatched rewrites
- DLP scanning: inbound (before_agent_run) and outbound (message_sending + llm_output) — log or block on API keys, PII, secrets
- Circuit breaker: open after N consecutive provider failures; auto-reset after cooldown
- Kill switch: config flag or on-disk file for immediate halt without restart
- Session watcher: tails Claude Code JSONL files for token accounting when claude-cli runtime is in use
- Audit log: append-only JSONL at ~/.clawguard/audit.jsonl
- `clawguard setup`: one-shot install — patches device scopes, registers Meridian plugin if present, restarts gateway
- `clawguard report`: spending summary with downgrade savings estimate
