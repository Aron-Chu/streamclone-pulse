# npm audit disposition — RPR-6 (2026-07)

Portal (`streampulse-web`) and root workspace audits report **two high**
findings that resolve to the same advisory:

| Package | Severity | Advisory |
|---------|----------|----------|
| `react-router` | high | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — RSC Mode CSRF bypass before 400 response |
| `react-router-dom` | high | Same (depends on `react-router`) |

**Installed range at disposition:** `react-router-dom@7.18.1` / `react-router@7.18.1`
(advisory range `>=7.12.0 <8.3.0`; fix published as `react-router@8.3.0`).

## Disposition (not a silent ignore)

1. **Exploit surface:** The advisory is scoped to **React Router RSC Mode**.
   StreamPulse portal is a **classic Vite + React SPA** (`streampulse-web`) with
   client-side `react-router-dom` only. It does **not** enable React Server
   Components or RSC-mode router actions.
2. **Why not bumped in this PR:** Moving to `react-router@8.3.0` is a **major**
   line change during RPR-6 package-distribution acceptance. Deferred to a
   focused follow-up so distribution gates are not conflated with a router
   migration.
3. **CI enforcement:** `scripts/ci-portal-npm-audit-disposition.mjs` allows
   **only** these two dispositioned package names. Any **new** high/critical
   finding fails portal CI until fixed or explicitly dispositioned here.

## Owner follow-up

- Schedule `react-router` / `react-router-dom` upgrade to `>=8.3.0` (or first
  patched 7.x if published) and re-run `npm audit` until highs are zero or
  newly dispositioned with evidence.
