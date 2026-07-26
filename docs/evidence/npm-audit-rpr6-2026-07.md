# npm audit disposition — RPR-6 / public security closeout (2026-07)

Portal (`streampulse-web`) and root workspace audits report **two high**
findings that resolve to the same advisory:

| Package | Severity | Advisory |
|---------|----------|----------|
| `react-router` | high | [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2) — RSC Mode CSRF bypass before 400 response |
| `react-router-dom` | high | Same (depends on `react-router`) |

**Installed range at disposition:** `react-router-dom@7.18.1` / `react-router@7.18.1`
(advisory range `>=7.12.0 <8.3.0`; fix published as `react-router@8.3.0`).

## Disposition: `vulnerable_code_not_used`

1. **Exploit surface:** The advisory is scoped to **React Router RSC Mode**.
   StreamPulse portal is a **classic Vite + React 18 SPA** (`streampulse-web`) with
   client-side `react-router-dom` only. It does **not** enable React Server
   Components, RSC-mode router actions, or React 19 server runtimes.
2. **Evidence scan:** No portal source matches RSC entry points
   (`react-server`, `createFromReadableStream`, `ServerRouter`, etc.).
3. **Why not bumped now:** Moving to `react-router@8.3.0` is a **major** line
   change and would force a React Router 8 / ecosystem jump. Per program rules:
   do **not** force React Router 8, React 19, or Node 22-only upgrades solely to
   clear this alert.
4. **CI enforcement:** `scripts/ci-portal-npm-audit-disposition.mjs` allows
   **only** these two dispositioned package names and requires the **exact**
   GHSA id `GHSA-qwww-vcr4-c8h2` in the audit `via` payload. Any **new**
   high/critical finding fails portal CI.
5. **GitHub Dependabot:** alerts dismissed as `vulnerable_code_not_used` with
   this evidence (public security closeout).

## Owner follow-up (optional, separate program)

- Schedule a dedicated React Router major upgrade when product-ready, then
  re-run `npm audit` until highs are zero or newly dispositioned with evidence.
