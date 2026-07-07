---
name: backfill-safety-review
description: Review VOD backfill jobs, rate limits, and capacity before enabling or widening backfill. Use when changing PulseBackfillManager, backfill API routes, job polling, or "Load missed moments" triggers.
---

# Backfill safety review

## Read first

- [live-coverage-requirements.md § backfill](https://github.com/Aron-Chu/streamclone-pulse/blob/master/docs/pulse-extension/live-coverage-requirements.md) (sibling `docs/pulse-extension/live-coverage-requirements.md`)
- streamclone: `internal/analytics/pulse_backfill.go`, `pulse_backfill_api.go`

## Safety checklist

- [ ] Backfill requires resolvable `vodId` + Twitch archive chat — never silent no-op success
- [ ] Job states are terminal and honest (`failed`, `vod_unavailable`, not stuck `fetching_chat`)
- [ ] No unbounded concurrent backfills per channel/principal
- [ ] Extension/portal poll interval is reasonable (no tight loops hammering BFF)
- [ ] Rollups written server-side only; client never merges raw chat
- [ ] Hosted mode respects beta-key principal scoping

## Script

```bash
# streamclone-pulse checkout (canonical skill path)
python .cursor/skills/backfill-safety-review/scripts/backfill-smoke.py --login <login> --base https://api.streampulse.stream

# streamclone checkout (mirrored under pulse/)
python .cursor/skills/pulse/backfill-safety-review/scripts/backfill-smoke.py --login <login> --base https://api.streampulse.stream

# Local stack debugging only
python .cursor/skills/backfill-safety-review/scripts/backfill-smoke.py --login <login> --base http://localhost:8090
```

## Block merge if

- Fake progress bars without job status backing
- Client-side rollup merge or Pulse rescoring
- Public endpoint triggers backfill without auth
