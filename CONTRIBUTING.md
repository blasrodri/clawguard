# Contributing to clarguard

Thanks for helping. clarguard governs people's money and their data, so the
bar is correctness and clarity over cleverness.

## Setup

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # tsc -> dist/
```

Requires Node ≥ 20. There are no runtime dependencies and we intend to keep
it that way — a new production dependency needs a strong justification in the
PR.

## Architecture (where things go)

- `src/core/` — **pure logic**, no OpenClaw imports: pricing, downgrade,
  budget, DLP, audit, persistence store. This is where most changes belong,
  and everything here must be unit-tested in isolation.
- `src/openclaw.ts` — **the only file that knows about the OpenClaw SDK.**
  Hook names and context-shape assumptions live here behind defensive
  readers. Adapt to SDK changes here, not in the core.
- `src/index.ts` — thin wiring: maps hooks onto the engine, wraps each in the
  fail-safe guard.

If you find yourself importing OpenClaw types into `src/core/`, stop and put
the adapter in `src/openclaw.ts` instead.

## Pull requests

- **Add or update tests.** A behavior change without a test won't be merged.
- Keep `npm run typecheck`, `npm test`, and `npm run build` green; CI runs
  all three on Node 20 and 22.
- Match the existing style: explain *why* in comments, not *what*. No
  comment is better than a comment that restates the code.
- Keep PRs focused. One concern per PR.
- Update `CHANGELOG.md` under `[Unreleased]` for any user-visible change.

## Reporting bugs vs. vulnerabilities

Functional bugs: open a GitHub issue. Security issues (enforcement/DLP
bypass, audit leakage, DoS): follow [SECURITY.md](./SECURITY.md) and report
privately.

## License

By contributing you agree your work is licensed under the project's dual
**MIT OR Apache-2.0** terms.
