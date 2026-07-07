---
name: capacity-governor-review
description: Review tracking pool caps, always-track eviction, rate limits, and hosted beta capacity before scaling collectors or watchlists. Use when changing always-track, watchlist size, Helix polling, or streampulse-vps hosted capacity.
---

# Capacity governor review

## Read first

- [website-portal/design.md](https://github.com/Aron-Chu/streamclone-pulse/blob/master/docs/website-portal/design.md) — tracking pool, principal scoping
- [docs/streampulse-vps.md](https://github.com/Aron-Chu/streamclone/blob/master/docs/streampulse-vps.md) — current hosted production SoT
- streamclone: `pulse_hosted.go`, [`docs/pulse-extension/collector-service.md`](https://github.com/Aron-Chu/streamclone/blob/master/docs/pulse-extension/collector-service.md)
- Production env (private): **streampulse-ops** `env/production.local.env`
- Legacy example only: `deploy/env/profile-bearhost-pulse.env`

## Checklist

- [ ] Always-track entries respect pool cap and idle eviction policy
- [ ] Top-roster admission refreshes idle on steady-state skip outcomes (`duplicate_stream`, `already_tracking`) via `TouchAdmissionObservation` — see [top-roster-idle-churn-p1-2026-07.md](https://github.com/Aron-Chu/streamclone/blob/master/docs/agent-notes/top-roster-idle-churn-p1-2026-07.md) before raising IRC cap
- [ ] Beta-key principals cannot unboundedly expand watchlists
- [ ] Go-live detector SLA documented (Helix poll vs EventSub)
- [ ] Backfill concurrency capped per host/channel
- [ ] Public stats/status endpoints are aggregate-only and cached
- [ ] No new unauthenticated heavy endpoints
- [ ] Pulse-collector leases respect pool caps when scaling IRC collectors

## Probes

```bash
# Hosted (default for StreamPulse / extension)
curl -s https://api.streampulse.stream/v1/extension/health
curl -s https://api.streampulse.stream/v1/public/hub | head -c 500

# Local stack (Streamclone backend debugging only)
curl -s http://localhost:8090/v1/extension/health
```

Live caps are operator-configured on streampulse-vps — check health/hub for current values.

## Escalate to ops-diagnostics-reviewer subagent when

Tunnel, Caddy route, or compose profile changes touch the **streampulse-vps / streampulse-ops** deploy boundary.
