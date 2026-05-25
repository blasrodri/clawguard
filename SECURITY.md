# Security Policy

clawguard is a governance and data-loss-prevention tool: people run it to
*enforce* spend limits and to *catch* secrets leaving their agents. A
vulnerability here can let cost or sensitive data slip through silently, so
we take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab → "Report a vulnerability"), or email the
maintainer.

We aim to acknowledge within 3 business days and to ship a fix or mitigation
for confirmed, in-scope issues within 30 days. We'll credit you in the
release notes unless you prefer to stay anonymous.

## In scope

- **Enforcement bypass** — a request that should be blocked by the budget
  gate but isn't, or a downgrade policy that fails to apply.
- **DLP bypass** — content containing a supported detector category (email,
  phone, credit card, SSN, API key, bearer token) that is not flagged, or a
  way to defeat the scan (e.g. crafted input).
- **Audit integrity** — raw payload content leaking into the audit log, or a
  way to suppress/forge audit records.
- **Denial of service** — input that stalls a hook (e.g. catastrophic regex
  backtracking) and degrades the host gateway.
- **Supply chain** — anything involving the published package, its build, or
  its provenance.

## Out of scope

- Misconfiguration (e.g. setting `mode: "shadow"` and expecting enforcement).
- Issues in OpenClaw itself or in models/providers; report those upstream.
- The inherent limitations documented in the README (turn-boundary
  enforcement, fixed window, single-gateway scope).

## Supply-chain assurances

- **Zero runtime dependencies.** clawguard ships no production `node_modules`,
  so its production attack surface is its own source.
- **Build provenance.** Releases are published from CI with
  [npm provenance](https://docs.npmjs.com/generating-provenance-statements),
  giving a signed, verifiable link from the published tarball back to the
  exact source commit and workflow.
- **No raw content in logs.** The audit trail records detector *labels*,
  counts, models, and decisions — never prompt or response text.

## Supported versions

Until 1.0, only the latest published `0.x` release receives security fixes.
