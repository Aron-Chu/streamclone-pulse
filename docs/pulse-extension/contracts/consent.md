# Consent contracts

## Principles

- Diagnostics consent and product-analytics consent are **separate**.
- Both are versioned records in `chrome.storage.local`, **default off**.
- Missing, malformed, or older-than-current schema versions mean **off**.
- No first-run consent modal. Controls live in **Options** as unchecked toggles with purpose disclosure.
- Withdrawal immediately prevents new sends and clears pending **in-memory** work (no durable client queue).

## Diagnostics consent (RPR-3)

| Field | Rule |
|-------|------|
| Storage key | Versioned key (implementation chooses exact name; document in Options UI) |
| Schema version | Integer; bump invalidates prior grants |
| Default | Off |
| Control | Unchecked “Share crash diagnostics” |
| Disclosure | Purpose, exact field classes, Sentry processor, ~30-day retention target, withdrawal behavior |
| Scope | Extension crash/diagnostic events only — does **not** enable product analytics |

## Product-analytics consent (RPR-5)

| Field | Rule |
|-------|------|
| Storage key | Separate versioned key from diagnostics |
| Schema version | Integer; bump invalidates prior grants |
| Default | Off |
| Control | Unchecked “Share anonymous product usage” (wording may vary; must stay accurate) |
| Disclosure | Purpose, fixed event names only, PostHog processor, ~180-day retention target, withdrawal |
| Scope | Fixed aggregate events only — does **not** enable diagnostics |

## Support consent (RPR-4)

- Separate from diagnostics/analytics.
- Explicit consent before human-readable subject/description/email is submitted.
- Optional email is contact-consent gated.
- Twitch context is optional, **manually entered**, never auto-collected.

## Independence matrix

| Grant | Enables diagnostics | Enables analytics | Enables support form |
|-------|---------------------|-------------------|----------------------|
| Diagnostics on | Yes | No | No |
| Analytics on | No | Yes | No |
| Support submit | No | No | Yes (one-shot durable case) |
| All off | No | No | Form may render as unavailable until activation |
