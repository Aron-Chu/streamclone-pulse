# Processors (named)

| Concern | Processor | Status |
|---------|-----------|--------|
| Portal website error monitoring | **Sentry** (portal SDK, build-time DSN) | May be active when `VITE_SENTRY_DSN` is set at portal build — distinct from extension diagnostics |
| Extension crash diagnostics (RPR-3) | **Sentry** (backend-constructed events; dedicated extension DSN in private ops) | **Implementation pending; activation pending** |
| Product analytics (RPR-5) | **PostHog** (server-side aggregates only) | **Implementation pending; activation pending** |
| Support bot protection (RPR-4) | **Cloudflare Turnstile** (portal client + backend verify) | **Implementation pending; activation pending** |
| Support ticket mirror (RPR-4) | **Linear** (minimal non-sensitive fields only) | **Implementation pending; activation pending** |
| Support human inbox (RPR-4) | Private email adapter destination (ops-configured) | **Implementation pending; activation pending** |

## PostHog (RPR-5) — locked product decision

- Provider: **PostHog**.
- Path: **backend aggregates only**.
- Forbidden: browser SDK, autocapture, session replay, person profiles, cookies, client-side PostHog host permission.
- Delivery uses a constant non-user `distinct_id`, `$process_person_profile=false`, and disabled IP capture.
- Correlation IDs, case IDs, install/session IDs, channel/stream/VOD identifiers, and free text are **never** sent to PostHog.

## Sentry (RPR-3 extension diagnostics)

- Backend constructs the Sentry event from sanitized enums + bounded frames.
- MV3 never embeds a Sentry SDK or DSN.
- Target retention: **30 days** (owner must verify in the vendor project before activation).
