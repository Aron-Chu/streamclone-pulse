# RPR-4 — Hosted support case schema

**Status:** Contract frozen. **Implemented, not activated.** The backend route and outbox and the
portal feedback form exists on `/feedback` (`/support` links to it, and keeps the `#send-feedback`
anchor); the hosted flag is off and the portal build has no Turnstile site key, so `/feedback`
shows the form as unavailable. Activation inputs are listed in
[activation.md](./activation.md#activation-inputs).

## Transport

- Portal only: `POST /v1/portal/support/cases` (hosted BFF).
- Turnstile challenge runs in the **portal**, never inside MV3.
- The extension's "Send feedback" opens `https://streampulse.stream/feedback` (no remote challenge
  script and no invite or form logic in the extension). "Join Discord" opens
  `https://streampulse.stream/discord`; the extension never embeds a Discord invite.

## Request constraints

| Rule | Value |
|------|-------|
| Content-Type | `application/json` |
| Encoding | identity |
| Cap | **16 KiB** pre-decode |
| Unknown fields | Rejected |
| Idempotency | Required `Idempotency-Key` header. The portal reuses a key only to retry an unchanged body; any edit, and every accepted case, starts a new key (the server answers a reused key with the earlier case) |
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
| `subject` | ≤ 120 UTF-8 bytes | Required; human text. The portal derives it from the first words of the message, cut on a character boundary |
| `description` | ≤ 4000 UTF-8 bytes | Required; human text. The portal counts bytes, not characters |
| `email` | optional | Only with explicit contact consent |
| `twitch_login` | optional | Manually entered, normalized, bounded — never auto-collected |
| `consent` | boolean | Explicit before human-readable submission |

## Portal card (v2, 2026-10-07)

- Two choices: "Something's wrong" → `bug`, "I have an idea" → `suggestion`. One message box,
  an optional reply email, and the explicit consent checkbox; the contact-consent checkbox
  appears only when an email is entered (current consent behaviour, kept until the owner decides).
- States: sending; sent with the server's `case_id` exactly as returned; could not send (text kept,
  same key on retry); too many attempts (honours `Retry-After`); unavailable (hosted form off or
  not configured: `503` `disabled`, `missing_turnstile_secret`, `missing_limiter`, `missing_store`,
  `missing_delivery_adapter` — keeps the GitHub issue and safe-diagnostics paths). The Turnstile token is reset after every attempt.
- Bot check: a `400` `turnstile_failed` keeps the text and offers "Try again". A widget error that
  Cloudflare marks retryable (timeouts `1106xx`, iframe load `200500`, challenge failures `300xxx` /
  `600xxx`) also keeps the form: the next Send starts a fresh challenge, and only a reader waiting on
  the check is told it failed. A configuration error (site key, domain, clock), a script that does not
  load, or the failure of a second fresh challenge shows unavailable.
- Retention stays **off** (`PULSE_SUPPORT_RETENTION_ENABLED=false`) until a duration is approved.

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
