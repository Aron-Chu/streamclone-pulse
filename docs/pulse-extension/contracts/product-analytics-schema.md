# RPR-5 — Product analytics schema (PostHog)

**Status:** Contract frozen. Implementation and hosted activation pending.  
**Processor:** PostHog (server-side aggregates only) — see [processors.md](./processors.md).

## Transport

- Extension → service worker → `POST /v1/extension/analytics/events`.
- No PostHog SDK; no PostHog host permission in MV3.
- Diagnostics consent does **not** enable analytics and vice versa.

## Request constraints

| Rule | Value |
|------|-------|
| Cap | **8 KiB** |
| Events per request | ≤ **20** fixed events |
| Counting | Each listed event contributes one count |
| Unknown events / fields | Rejected |
| Consent | Versioned analytics consent must be on; else drop client-side |

## Initial allowlist

| Event name | Meaning | Emit to PostHog |
|------------|---------|-----------------|
| `pulse_load_completed` | Overlay/load completed successfully (coarse) | Yes when activated + consented |
| `extension_error_shown` | User-visible extension error UI shown (coarse class only) | Yes when activated + consented |
| `support_report_submitted` | Reserved | **Schema-reserved** — do not emit to PostHog until a privacy-approved consent path exists |

## Aggregation

- Fixed **5-minute** Redis buckets; bounded keys and cardinality.
- Lossy bounded delivery queue; deterministic non-user bucket idempotency.
- Constant non-user `distinct_id`; `$process_person_profile=false`; IP capture disabled.
- Never include request/correlation/case/install/session/channel/stream/VOD IDs or free text.

## Failure

Redis, PostHog, limiter, queue, or flag failures → drop / fail closed **without** affecting Pulse product or support durability.
