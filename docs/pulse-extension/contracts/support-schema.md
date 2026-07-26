# RPR-4 — Hosted support case schema

**Status:** Contract frozen. Implementation and hosted activation pending.

## Transport

- Portal only: `POST /v1/portal/support/cases` (hosted BFF).
- Turnstile challenge runs in the **portal**, never inside MV3.
- Extension Help eventually deep-links to the hosted form (no remote challenge script in the extension).

## Request constraints

| Rule | Value |
|------|-------|
| Content-Type | `application/json` |
| Encoding | identity |
| Cap | **16 KiB** pre-decode |
| Unknown fields | Rejected |
| Idempotency | Required header/key (implementation) |
| Bot protection | Hosted Turnstile verify (fail closed if misconfigured) |

## Categories

| Category | Routing |
|----------|---------|
| `bug` | Routine support outbox |
| `data_coverage` | Routine support outbox |
| `suggestion` | Routine support outbox |
| `product_complaint` | Routine support outbox |
| Privacy / legal | **Do not** accept on this route — direct users to `privacy@streampulse.stream` |
| Security | **Do not** accept until a verified private security channel exists |

## Fields

| Field | Bound | Notes |
|-------|-------|-------|
| `category` | enum above | Required |
| `subject` | ≤ 120 bytes | Required; human text |
| `description` | ≤ 4000 bytes | Required; human text |
| `email` | optional | Only with explicit contact consent |
| `twitch_login` | optional | Manually entered, normalized, bounded — never auto-collected |
| `consent` | boolean | Explicit before human-readable submission |

**Forbidden attachments** in v1. No automatic screenshots, logs, cookies, or IDs.

## Durability

1. Verify Turnstile + validate body.
2. Commit case row + transactional outbox in **Postgres** in one transaction.
3. Return opaque **case ID** only after durable commit.
4. Workers retry Linear/email adapters with dead-letter; vendor outage must not lose accepted cases.

## Adapter redaction

- **Linear:** case ID, category, state, coarse release/surface — **no** body, email, or Twitch context.
- **Email:** plain-text case content only to privately configured destination; never log body/email.
- Privacy/legal and security never enter ordinary Linear/Discord routing.
