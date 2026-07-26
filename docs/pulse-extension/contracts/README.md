# StreamPulse privacy / diagnostics / support / analytics contracts

**Status:** Contract freeze for RPR-3 / RPR-4 / RPR-5.  
**Implementation:** pending (disabled-by-default when code lands).  
**Activation:** pending owner/vendor configuration — **not active** on hosted production.

This document set freezes schemas, consent, retention, processors, failure behavior,
and dependency gates. It does **not** mark RPR-3/4/5 complete.

| Doc | Concern |
|-----|---------|
| [processors.md](./processors.md) | Named processors (Sentry / PostHog / Turnstile / Linear / email) |
| [consent.md](./consent.md) | Versioned, default-off, separate consents |
| [diagnostics-schema.md](./diagnostics-schema.md) | RPR-3 extension diagnostics |
| [support-schema.md](./support-schema.md) | RPR-4 hosted support cases |
| [product-analytics-schema.md](./product-analytics-schema.md) | RPR-5 PostHog aggregates |
| [retention.md](./retention.md) | Retention targets |
| [activation.md](./activation.md) | Current vs future; fail-closed; dependency graph |

## Verified public contact

Only **`privacy@streampulse.stream`** is verified for public use.

Do **not** publish as active: `support@`, `security@`, GitHub Private Vulnerability
Reporting, hosted support/diagnostics/analytics routes, or vendor project URLs.

## Hard rules (all RPR-3/4/5 surfaces)

- Extension content/UI remains **fetch-free**; all extension HTTP goes through the service worker.
- No Sentry DSN, PostHog key, Turnstile secret, Linear token, or service credential in MV3 source or store ZIPs.
- Local `pulseDebug` / debug logs are **never** uploaded.
- Diagnostics and analytics payloads never include: raw messages, raw stacks, URLs, page titles, channel logins, stream/VOD IDs, headers, bodies, cookies, locale, user agent, timestamps, email, free text, install ID, session ID, case ID, or durable identity.
- Public ingestion is hostile, anonymous, lossy, bounded, and **fail-closed**.
- Diagnostics/analytics failure must never affect Pulse product functionality.
- Support is durable and user-initiated; diagnostics/analytics are **not** durable.
- Do not use Cloudflare D1 for reports, telemetry, or outbox.
- Privacy/legal and security reports never enter ordinary Linear or Discord routing.
