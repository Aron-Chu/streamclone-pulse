# Activation, failure, and dependency graph

## Current deployed behavior (truthful)

| Surface | Today |
|---------|-------|
| Extension diagnostics upload | **Not active** |
| Extension product analytics | **Not active** |
| Hosted support form / Turnstile | **Not active** — implemented; `/support` shows the form as unavailable |
| Discord entry points (site + extension) | **Not active** — hidden until a valid invite is configured; `/discord` says the server is not open yet |
| Portal Sentry | May initialize when portal build has `VITE_SENTRY_DSN` |
| Public mailbox | `privacy@streampulse.stream` only |
| Security reporting | GitHub Private Vulnerability Reporting **enabled** |
| Repository visibility | **public** (`Aron-Chu/streamclone-pulse`) |

RPR-3/4/5 are **implementation complete; activation pending**. Do **not** claim
active collection. Defaults and vendor credentials remain **disabled**.

Verified public mailbox: **`privacy@streampulse.stream` only**.

## Activation inputs

These are configuration, not code changes. None of them is committed to the repository.

| Input | Where | Effect when missing or invalid |
|-------|-------|-------------------------------|
| `VITE_TURNSTILE_SITE_KEY` | Portal build environment (public site key; mode comes from the key — Invisible is intended) | `/support` shows "The hosted form is unavailable right now" with the GitHub issue and safe-diagnostics paths |
| `VITE_PUBLIC_DISCORD_INVITE_URL` | Portal build environment. Must be exactly `https://discord.gg/<code>` or `https://discord.com/invite/<code>` (no query, fragment or extra path) | Every Discord link (landing nav, hero pill, footers, `/support` line) is hidden and `/discord` says the server isn't open yet |
| `PULSE_SUPPORT_CASES_ENABLED` + Turnstile secret | Backend (private ops) | `POST /v1/portal/support/cases` answers `503 disabled`, which the card shows as unavailable |
| Reply inbox / email adapter destination | Backend (private ops) | Cases are stored but nobody can reply; choose the inbox before telling people a reply is possible |
| Support retention | Backend (`PULSE_SUPPORT_RETENTION_ENABLED`) | Stays **off** until the owner approves a duration |

Both `VITE_*` values are read at build time (Vite inlines them) and also by the prerender step, so set
them in the environment of the whole `pages:deploy:prod` run. Changing either needs a site rebuild,
never an extension release: the extension only links to `/support` and `/discord`.

## Fail-closed defaults

Missing feature flag, DSN/API key, release allowlist, trusted proxy/IP config,
Redis limiter, queue capacity, Turnstile secrets, or PostHog credentials →
fixed error / drop; **no** partial open.

## Dependency graph (merge order)

```text
contract freeze (this docs set)
    │
    ├─► backend correlation (public ingress ID harden)
    ├─► Pulse RPR-6 in-repo packages (complete)
    ├─► RPR-7 clean public export (complete)
    ├─► RPR-8 ruleset active + recovery doc
    ├─► RPR-9 public-source cutover (complete; store pending)
    │
    ├─► backend diagnostics → Pulse diagnostics UI/consent/SW
    ├─► backend support + outbox → portal support form
    └─► backend PostHog aggregates → Pulse analytics consent/emit
         │
         └─► store RC + owner upload authorization (separate)
```

## Acceptance gates (high level)

| Gate | Required |
|------|----------|
| Contract | Schemas/consent/processors named; no false "active" claims |
| RPR-6 | Complete — clean checkout, tarball consumers, NOTICE |
| RPR-3 | Implementation complete; activation pending; flags off |
| RPR-4 | Implementation complete; activation pending; flags off |
| RPR-5 | Implementation complete; activation pending; flags off |
| RPR-7 | Clean public export + truthful contacts/PVR |
| RPR-8 | Active ruleset + owner recovery procedure |
| RPR-9 | Public-source cutover complete; **store release pending** |

## Explicit non-goals of this freeze

- Claiming RPR-3/4/5 activation
- Creating vendor projects or storing secrets
- Deploying or enabling hosted flags
- Publishing `support@` / `security@` as active mailboxes
- Uploading store ZIPs without a separate owner store gate
