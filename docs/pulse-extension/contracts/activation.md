# Activation, failure, and dependency graph

## Current deployed behavior (truthful)

| Surface | Today |
|---------|-------|
| Extension diagnostics upload | **Not active** |
| Extension product analytics | **Not active** |
| Hosted support form / Turnstile | **Not active** |
| Portal Sentry | May initialize when portal build has `VITE_SENTRY_DSN` |
| Public mailbox | `privacy@streampulse.stream` only |

RPR-3/4/5 code may be under **acceptance repair** with **activation pending**. Do **not** label “implementation complete” or claim active collection until private ops activation and acceptance evidence land. Defaults remain **disabled**.

Verified public mailbox: **`privacy@streampulse.stream` only**.

## Fail-closed defaults

Missing feature flag, DSN/API key, release allowlist, trusted proxy/IP config, Redis limiter, queue capacity, Turnstile secrets, or PostHog credentials → fixed error / drop; **no** partial open.

## Dependency graph (merge order)

```text
contract freeze (this docs set)
    │
    ├─► backend correlation (public ingress ID harden)
    ├─► Pulse RPR-6 in-repo packages (source ownership done; distribution acceptance in progress)
    ├─► RPR-7 governance foundation (partial)
    ├─► ops values-free activation scaffold
    │
    ├─► backend diagnostics ──► Pulse diagnostics UI/consent/SW
    ├─► backend support + outbox ──► portal support form
    └─► backend PostHog aggregates ──► Pulse analytics consent/emit
         │
         └─► closure evidence + one force-full (no store upload)
```

## Acceptance gates (high level)

| Gate | Required |
|------|----------|
| Contract | Schemas/consent/processors named; no false “active” claims |
| RPR-6 | Clean checkout builds without sibling repos/tokens; tarball allowlists + consumer tests; mandatory NOTICE |
| RPR-3 | Hostile HTTP + PII canaries; hosted flag off in CI evidence; acceptance repair (not “impl complete”) |
| RPR-4 | Durable case before 200; Linear redaction; portal CSP/Turnstile tests; flag off |
| RPR-5 | Zero events without consent; PostHog privacy canaries; flag off |
| RPR-7 | Truthful LICENSE/contacts; non-destructive audit summary (partial) |
| RPR-8 / RPR-9 | Owner-only; stay pending |

## Explicit non-goals of this freeze

- Marking RPR-3/4/5/6 complete or claiming activation
- Creating vendor projects or storing secrets
- Deploying or enabling hosted flags
- Publishing `support@` / `security@` or claiming PVR
- Bumping extension version or uploading store ZIPs
