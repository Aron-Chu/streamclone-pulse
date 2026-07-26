# Phase 8 — Portal CSP / performance interim

**Date:** 2026-07-19  
**Portal tip:** `0473930` (post icon merge) + follow-up status honesty PR

## Live headers

- CSP: **report-only** (unchanged)
- HSTS: **not set** (comment in `_headers` requires all subdomains HTTPS-safe first)
- No Cloudflare Web Analytics beacon found in live HTML (findstr empty) — CSP `script-src 'self'` compatible for enforce trial

## CWV

Chrome DevTools performance MCP unavailable this session — **Core Web Vitals unmeasured**. Mark blocker for GA until measured.

## Code follow-up

- `/status` page shows `components.api|coverage|corpus` when API returns them (after backend promote)
- Hub stats-fallback no longer maps overall `degraded` → `databaseOk:false`

## Next (approval / Pages)

- Enforce CSP after a short report-only soak with no console violations
- Then consider HSTS
- Pages deploy of portal honesty PR when merged
