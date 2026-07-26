# RPR-3 — Extension diagnostics schema

**Status:** Contract frozen. Implementation and hosted activation pending.

## Transport

- Extension → service worker runtime message → `POST /v1/extension/diagnostics/errors` (hosted BFF).
- Content/UI never `fetch` this route.
- Flag/DSN/allowlist/limiter/queue missing → fail closed (fixed status; no retries).

## Request constraints

| Rule | Value |
|------|-------|
| Content-Type | `application/json` only |
| Content-Encoding | identity only |
| Body | Exactly one JSON value; no trailing data; unknown fields rejected |
| Pre-decode cap | **16 KiB** |
| Auth | Hosted extension auth as for other `/v1/extension/*` mutations (implementation) |

## Accepted fields (enums + frames only)

Allowed keys (exact set enforced server-side):

- `schema_version` (uint)
- `release` (allowlisted exact release string)
- `manifest_version` (enum)
- `target` (enum: `development` \| `cws` \| `edge` — store builds only when activated)
- `surface` (enum derived/validated in service worker; not free text)
- `feature` (fixed enum)
- `event` (fixed enum)
- `error` (fixed enum / coarse class)
- `status` (fixed enum)
- `frames` — at most **20** sanitized frames: `{ bundle, line, column }` only  
  - `bundle` must be a known generated extension bundle identifier  
  - No function names, URLs, paths, or message text

**Forbidden:** raw `message`, raw `stack`, URLs, titles, logins, stream/VOD IDs, headers, bodies, cookies, locale, UA, timestamps, email, free text, install/session/case IDs, correlation IDs as identity.

## Server behavior

- Re-sanitize all fields; construct Sentry event **on the backend**.
- Dedicated extension Sentry DSN (ops secret-file); bounded in-memory queue; **no** DB/outbox.
- Responses: fixed **202 / 400 / 413 / 415 / 429 / 503** with `Cache-Control: no-store`.
- No client retries; no durable client queue; never upload `pulseDebug`.

## Correlation

Public ingress generates a fresh 128-bit (32 lowercase hex) `X-Correlation-ID`.  
Caller-supplied values are **ignored** on public ingress.  
Correlation IDs are for logs/ops only — **never** forwarded to PostHog or used as identity.
