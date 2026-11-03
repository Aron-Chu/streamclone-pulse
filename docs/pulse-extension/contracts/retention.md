# Retention targets

| Data class | Store | Target | Notes |
|------------|-------|--------|-------|
| Extension diagnostics (RPR-3) | Sentry (extension project) | **30 days** | Owner must verify project retention before activation |
| Product analytics aggregates (RPR-5) | PostHog | **Six calendar months**, with expired events permanently deleted at the following monthly cleanup | Project 509107 override saved and read back November 2, 2026; reverify before extension activation. Not an exact 180-day deadline. |
| Support cases (RPR-4) | Postgres | Configurable; **activation-blocked** until owner approval of retention policy | Outbox + dead-letter included |
| Correlation IDs | Logs only | Per existing log retention | Not product analytics identity |
| Portal Sentry (website) | Existing portal project | Per current portal ops | Distinct from extension diagnostics |
| Client consent records | `chrome.storage.local` | Until user clears site/extension data or withdraws | Version bump clears grant |

Withdrawal of diagnostics/analytics consent stops **new** sends immediately and clears pending in-memory work; it does not delete already-accepted server-side aggregates or Sentry events (processor retention applies).

The PostHog event window also covers the separately consented public website
events and closed-choice tool feedback in this project. It does not set retention
for publisher snapshots in Data Warehouse tables. Configuring the project window
does not activate extension ingestion or prove that monthly cleanup has run.
