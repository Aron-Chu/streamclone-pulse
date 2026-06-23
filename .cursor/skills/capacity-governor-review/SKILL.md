---
name: capacity-governor-review
description: Review tracking pool caps, always-track eviction, rate limits, and hosted beta capacity before scaling collectors or watchlists. Use when changing always-track, watchlist size, Helix polling, or BearHost pulse profile env.
---

# Capacity governor review

## Read first

- [`docs/website-portal/design.md`](../../docs/website-portal/design.md) — tracking pool, principal scoping
- streamclone: `pulse_hosted.go`, `deploy/env/profile-bearhost-pulse.env`

## Checklist

- [ ] Always-track entries respect pool cap and idle eviction policy
- [ ] Beta-key principals cannot unboundedly expand watchlists
- [ ] Go-live detector SLA documented (Helix poll vs EventSub)
- [ ] Backfill concurrency capped per host/channel
- [ ] Public stats/status endpoints are aggregate-only and cached
- [ ] No new unauthenticated heavy endpoints

## Probes (streamclone stack up)

```bash
curl -s http://localhost:8090/v1/extension/health
# Hosted: https://api.streampulse.stream/v1/extension/health
```

## Escalate to ops-diagnostics-reviewer subagent when

Tunnel, Caddy route, or compose profile changes touch BearHost deployment.
