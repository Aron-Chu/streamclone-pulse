# Retention targets

| Data class | Store | Target | Notes |
|------------|-------|--------|-------|
| Extension diagnostics (RPR-3) | Sentry (extension project) | **30 days** | Owner must verify project retention before activation |
| Product analytics aggregates (RPR-5) | PostHog | **180 days** | Owner must verify project retention before activation |
| Support cases (RPR-4) | Postgres | Configurable; **activation-blocked** until owner approval of retention policy | Outbox + dead-letter included |
| Correlation IDs | Logs only | Per existing log retention | Not product analytics identity |
| Portal Sentry (website) | Existing portal project | Per current portal ops | Distinct from extension diagnostics |
| Client consent records | `chrome.storage.local` | Until user clears site/extension data or withdraws | Version bump clears grant |

Withdrawal of diagnostics/analytics consent stops **new** sends immediately and clears pending in-memory work; it does not delete already-accepted server-side aggregates or Sentry events (processor retention applies).
