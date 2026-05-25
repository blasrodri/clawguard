# ClarGuard

**Stop surprise LLM bills. Block secrets before they leave your machine.**

ClarGuard is an [OpenClaw](https://openclaw.ai) plugin that puts a governance layer in front of every LLM call — enforcing budgets, auto-downgrading expensive models, and scanning messages for API keys, PII, and secrets before they reach the model.

```
clarguard active — mode=enforce downgrade=haiku maxUsd=5/win dlp=block
```

---

## Why ClarGuard

- You're paying $40/month in Claude API costs and have no idea where it's going
- A script or agent accidentally sends an API key or SSN to the model
- You want Opus for important work but Haiku for routine tasks — automatically
- You need an audit trail of every LLM decision for compliance

---

## Quickstart

Install via ClawHub:

```bash
openclaw plugins install clawhub:@blasrodri/clawguard
openclaw gateway restart
```

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "clawguard": {
        "enabled": true,
        "hooks": { "allowConversationAccess": true },
        "pluginConfig": {
          "mode": "enforce",
          "budget": { "windowMs": 3600000, "maxUsd": 5 },
          "downgrade": { "to": "haiku" },
          "dlp": { "enabled": true, "onDetect": "block" }
        }
      }
    }
  }
}
```

Restart the gateway. You'll see the startup line above in your logs — you're live.

---

## Features

### Budget enforcement
Track token and USD spend in a rolling window. Calls are delayed when approaching the soft limit and blocked when the ceiling is hit. Budget state persists across restarts.

```json
"budget": {
  "windowMs": 3600000,
  "maxUsd": 5.00,
  "softLimitRatio": 0.9
}
```

### Automatic model downgrade
Rewrite expensive model requests to a cheaper tier before the call goes out. Optionally hold the premium model until a budget threshold is crossed.

```json
"downgrade": {
  "to": "haiku",
  "whenBudgetRatioAbove": 0.8
}
```

> Keep Opus until 80% of your budget is spent, then switch to Haiku automatically.

### DLP scanning
Detect and block API keys, bearer tokens, credit cards, SSNs, email addresses, and phone numbers — in both inbound messages and model responses. Add custom regex patterns with per-pattern actions.

```json
"dlp": {
  "enabled": true,
  "onDetect": "block",
  "builtins": "all",
  "customPatterns": [
    { "name": "internal-id", "regex": "EMP-\\d{6}", "action": "block" }
  ]
}
```

### Circuit breaker
Open the circuit after N consecutive provider failures. Blocks calls during the cooldown window to avoid hammering a degraded API endpoint.

### Kill switch
Halt all LLM calls instantly — via config flag (restart needed) or a file on disk (no restart, toggle at runtime).

```bash
touch /tmp/clarguard-halt    # stop all calls
rm /tmp/clarguard-halt       # resume
```

### Audit log
Append-only JSONL at `~/.clarguard/audit.jsonl`. Every budget decision, DLP hit, downgrade, and breaker event is recorded. No raw prompt/response content — only labels, models, and counts.

---

## Verify it's working

Send a message with a fake API key from any channel (Telegram, CLI, etc.):

```
my key is sk-ant-api03-xxxxxxxx...
```

With `onDetect: "block"` the message is cancelled before reaching the model. Check the audit log:

```bash
grep dlp ~/.clarguard/audit.jsonl | tail -3
# {"type":"dlp_blocked","labels":["api_key"],"direction":"inbound"}
```

---

## Budget report

```bash
clarguard report
clarguard report --since 7d
clarguard report --cap-usd 5 --json
```

```
# ClarGuard report
_generated 2026-05-23T20:33:40Z · since 2026-05-22T20:33:40Z_

## Budget
$3.21 of $5.00 spent (64%) · 412,309 tokens

## Activity
- 47 events recorded
- 1 budget block · 0 kill switch · 0 circuit breaker
- 12 model downgrades · $1.84 saved (est.)
```

---

## Hook coverage

ClarGuard works with both OpenClaw runtimes:

| Feature | `anthropic` runtime | `claude-cli` runtime |
|---|---|---|
| Budget gate | ✅ | ✅ |
| Token accounting | ✅ live | ✅ via session watcher¹ |
| DLP (inbound + outbound) | ✅ | ✅ |
| Circuit breaker | ✅ | ✅ |
| Model downgrade | ✅ | ❌ |

¹ Session watcher tails `~/.claude/projects/` JSONL files. One-turn lag; hourly budgets are unaffected.

---

## Shadow mode

Not ready to enforce? Start in shadow mode — ClarGuard records every decision it *would* make without blocking or rewriting anything.

```json
"mode": "shadow"
```

Switch to `"enforce"` when you're confident in your config.

---

## Full configuration reference

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
    "persist": true
  },
  "downgrade": {
    "to": "haiku",
    "whenBudgetRatioAbove": 0.8
  },
  "killSwitch": {
    "enabled": false,
    "file": "/tmp/clarguard-halt"
  },
  "breaker": {
    "enabled": true,
    "threshold": 5,
    "cooldownMs": 30000
  },
  "anomaly": {
    "enabled": true,
    "ratio": 5
  },
  "dlp": {
    "enabled": true,
    "onDetect": "block",
    "scanResponses": true,
    "builtins": "all",
    "customPatterns": []
  },
  "audit": {
    "enabled": true
  }
}
```

**`mode`** — `enforce` applies decisions for real. `shadow` logs without acting.

**`failMode`** — `open` lets calls through if ClarGuard itself errors. `closed` blocks on internal errors (fail-safe).

**`downgrade.to`** — `sonnet`, `haiku`, `gpt-4o`, or `gpt-3.5-turbo`. Models pricier than the target are rewritten; others are untouched.

**`killSwitch.file`** — Drop a file at this path to halt all calls immediately. Delete it to resume.

---

## Development

```bash
npm test           # run all tests (no gateway needed)
npm run typecheck  # type-check without emitting
npm run build      # compile to dist/
```

---

## License

MIT OR Apache-2.0 · [GitHub](https://github.com/blasrodri/clawguard)
