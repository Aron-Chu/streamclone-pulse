---
name: coverage-triage
description: Triage Pulse live coverage, missing prefix, and VOD backfill UX against backend state. Use when coverage cards, backfill steppers, "Load missed moments", or protect-channel flows misbehave or need design review.
---

# Coverage triage

> **Go/backend work:** canonical skill is `../streampulse-backend/.cursor/skills/pulse/coverage-triage/SKILL.md`.
> This copy owns the **UX triage checklist** — coverage card copy, state labels, stepper honesty, UI-layer fixes.

## Read first

1. [live-coverage-requirements.md](https://github.com/Aron-Chu/streamclone-pulse/blob/master/docs/pulse-extension/live-coverage-requirements.md) — truth table, states, copy keys
2. Backend Go: **streampulse-backend** `internal/analytics/pulse_coverage.go`, `extension_api.go`

## Triage checklist

- [ ] UI shows **coverage start → now**, not fabricated 00:00 data
- [ ] Path A (live tracking) and Path B (VOD backfill) are not conflated in copy or charts
- [ ] Backfill CTA only when backend approves (`waiting_for_vod`, eligible missing prefix)
- [ ] Progress/stepper reflects real job status from `GET /v1/extension/pulse/backfill/{jobId}`
- [ ] `full_stream_tracked` only when `coverageStartOffsetSeconds ≤ 120s` tolerance

## Quick probes (hosted API only)

```bash
curl -s "https://api.streampulse.stream/v1/extension/pulse/channels/<login>?window=full" \
  | jq '{state, coverageStartOffsetSeconds, canBackfill, peaks: (.peaks|length)}'

curl -s "https://api.streampulse.stream/v1/extension/pulse/channels/<login>/coverage" \
  | jq '{canBackfillMissedMoments, coverageStartOffsetSeconds}'
```

Key fields: `state` (`waiting_for_vod`, `live_tracking`, …), `canBackfill`, `coverageStartOffsetSeconds`.

For local BFF debugging use **streampulse-backend** compose (`:8081`), not `:8090`.

## Report format

| Check | Expected | Actual | Fix area |
|-------|----------|--------|----------|

Flag **Critical** when UI implies data exists that backend did not produce.
