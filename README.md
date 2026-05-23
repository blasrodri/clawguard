# clawguard

An [OpenClaw](https://openclaw.ai) plugin that puts a governance layer in front of every LLM call: budget enforcement, automatic model downgrade, DLP scanning, circuit breaking, and an append-only audit log.

## What it does

| Feature | How it works |
|---|---|
| **Budget enforcement** | Tracks token and USD spend in a fixed window. Delays calls when spend approaches the soft limit; blocks when the ceiling is hit. |
| **Model downgrade** | Rewrites expensive model requests (Opus, GPT-4) to a cheaper tier before the call goes out. Can be budget-aware — keep the premium model until X% of the budget is spent, then switch. |
| **DLP scanning** | Scans outbound messages and model responses for PII and secrets (email, phone, credit card, SSN, API keys, bearer tokens). Can log or block. |
| **Circuit breaker** | Opens after N consecutive provider failures; blocks calls during the cooldown window to avoid hammering a degraded provider. |
| **Kill switch** | Halts all calls immediately — either via a config flag (needs restart) or a file on disk (toggle at runtime, no restart). |
| **Audit log** | Append-only JSONL at `~/.clawguard/audit.jsonl`. Every decision is recorded; no raw prompt/response content, only labels, models, and counts. |

## Installation

```bash
git clone https://github.com/blasrodri/clawguard
cd clawguard
npm install && npm run build
node dist/bin/clawguard.js setup
```

`setup` does three things automatically:
- Grants the OpenClaw device the `operator.write` scope it needs (avoids the manual-approval catch-22)
- Registers the Meridian plugin if [Meridian](https://github.com/rynfar/meridian) is installed
- Restarts the gateway so changes take effect

Then add clawguard to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "clawguard": {
        "enabled": true,
        "config": {
          "mode": "enforce",
          "budget": { "windowMs": 3600000, "maxUsd": 5 },
          "downgrade": { "to": "haiku" }
        }
      }
    },
    "load": {
      "paths": ["/path/to/clawguard/dist"]
    }
  }
}
```

Restart OpenClaw. You should see `clawguard active — …` in the gateway log.

## Hook coverage by runtime

OpenClaw supports two agent runtimes. Which hooks fire depends on which one is in use:

| Feature | `anthropic` runtime | `claude-cli` runtime |
|---|---|---|
| Budget gate | ✅ | ✅ |
| Token accounting | ✅ via `llm_output` | ✅ via session watcher¹ |
| DLP scan (outbound) | ✅ | ✅ |
| Circuit breaker | ✅ | ✅ |
| Model downgrade | ✅ | ❌ hook never fires |

¹ **Session watcher**: when `claude-cli` is the runtime, clawguard tails `~/.claude/projects/<workspace>/*.jsonl` for token usage. This introduces a one-turn lag (usage from turn N is accounted at turn N+1). Budgets based on hourly windows are unaffected; sub-minute rate limiting is not supported in this mode.

For full hook coverage including model downgrade, install [Meridian](https://github.com/rynfar/meridian) as a proxy layer and run `clawguard setup` — it will register the Meridian plugin automatically.

## Configuration

```json
{
  "mode": "enforce",
  "failMode": "open",
  "budget": {
    "windowMs": 3600000,
    "maxTokens": 500000,
    "maxUsd": 5.0,
    "softLimitRatio": 0.9,
    "delayMs": 250,
    "reserveTokens": 0,
    "reserveUsd": 0,
    "persist": true
  },
  "downgrade": {
    "to": "haiku",
    "whenBudgetRatioAbove": 0.8
  },
  "killSwitch": {
    "enabled": false,
    "file": "/tmp/clawguard-halt"
  },
  "breaker": {
    "enabled": true,
    "threshold": 5,
    "cooldownMs": 30000
  },
  "dlp": {
    "enabled": true,
    "onDetect": "log",
    "scanResponses": true
  },
  "audit": {
    "enabled": true,
    "path": "~/.clawguard/audit.jsonl"
  }
}
```

### Key options

**`mode`** — `enforce` (default) applies decisions for real. `shadow` records what it *would* do without blocking or rewriting anything. Start with `shadow` to validate before enforcing.

**`failMode`** — `open` (default) lets calls through if clawguard itself errors. `closed` blocks on internal errors (fail-safe).

**`downgrade.to`** — `sonnet`, `haiku`, `gpt-4o`, or `gpt-3.5-turbo`. Any model pricier than the target is rewritten; models already at or below the target are untouched.

**`downgrade.whenBudgetRatioAbove`** — `0` (default) downgrades every call unconditionally. `0.8` keeps the premium model until 80% of the budget window is spent, then starts downgrading.

**`killSwitch.file`** — Drop a file at this path to halt all calls immediately, no restart needed. Delete the file to resume.

**`budget.reserveTokens` / `budget.reserveUsd`** — Pre-charge an estimate per in-flight call so concurrent calls can't all slip through a budget check simultaneously. Leave at `0` for purely reactive accounting.

## Testing DLP

Send a message to your agent containing a recognisable secret pattern. With `onDetect: "block"` the message is cancelled before it reaches the model — you'll get no response and an audit entry:

```
# Telegram / any channel — send one of these:
my key is sk-ant-api03-xxxxxxxx...
charge this: 4111 1111 1111 1111
contact me at user@example.com
```

Then verify the audit log:

```bash
cat ~/.clawguard/audit.jsonl | grep dlp | tail -5
```

You should see a `dlp_block` (or `dlp_redact`) entry with the matched category. With `onDetect: "redact"` the message goes through with the secret replaced by `[REDACTED]`.

## Report

```bash
node dist/bin/clawguard.js report
node dist/bin/clawguard.js report --since 7d
node dist/bin/clawguard.js report --cap-usd 5 --json
```

Output:

```
# clawguard report
_generated 2026-05-23T20:33:40Z · since 2026-05-22T20:33:40Z_

## Budget
**$3.21 of $5.00** spent (64%) · 412,309 tokens
_window started 2026-05-23T19:00:00Z_

## Activity
- 47 events recorded
- 1 budget blocks · 0 kill switch · 0 circuit breaker
- 0 DLP hits across 0 categories
- 12 model downgrades · $1.84 saved (est.)

## Downgrades
- claude-opus-4-7 → claude-haiku-4-5: 12

## Health
- Breaker: closed
- Persistence: healthy
```

## Development

```bash
npm test           # run all tests
npm run typecheck  # type-check without emitting
npm run build      # compile to dist/
```

Tests use [vitest](https://vitest.dev) and run entirely in-process — no OpenClaw gateway needed.

## License

MIT OR Apache-2.0
