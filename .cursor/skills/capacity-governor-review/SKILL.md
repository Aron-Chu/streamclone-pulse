---
name: capacity-governor-review
description: Review tracking pool caps, always-track eviction, rate limits, and hosted beta capacity before scaling collectors or watchlists. Use when changing always-track, watchlist size, Helix polling, or hosted-production-vps capacity.
---

# Capacity governor review

**Canonical copy:** `../streampulse-backend/.cursor/skills/pulse/capacity-governor-review/SKILL.md`

Use the canonical skill in **streampulse-backend** for the full checklist, live-cap probe guidance, and escalation rules.

This stub exists so Cursor discovers the skill from the streamclone-pulse checkout. Live caps are operator-configured on hosted-production-vps — probe via hosted API only:

```bash
curl -s https://api.streampulse.stream/v1/extension/health
curl -s https://api.streampulse.stream/v1/public/hub
```

Do not use `http://localhost:8090` probes here. For tunnel/Caddy/compose changes escalate to the ops-diagnostics-reviewer (now in **streampulse-ops**).
