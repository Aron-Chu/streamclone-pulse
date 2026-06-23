# Stream Pulse sidebar parity (web ↔ extension)

Source of truth: **Streamclone web** Channel → **Stream Pulse** tab (`StreamPulsePanel.tsx`). The Chrome extension sidebar must match that compact experience — not the full `/analytics` multi-layer chart.

## Component mapping

| Web (streamclone) | Extension (streamclone-pulse) | Shared logic |
|-------------------|-------------------------------|--------------|
| `frontend/src/components/channel/StreamPulsePanel.tsx` | `src/ui/Overlay.tsx` (Pulse tab body) | — |
| `frontend/src/components/analytics/LiveStatsBand.tsx` | `src/ui/LiveStatsBand.tsx` | `@streamclone/pulse-core` `deriveLiveStats`, `toLiveStatsInputFromExtension` |
| `frontend/src/components/analytics/MostReactedLive.tsx` | `src/ui/MostReactedSection.tsx` | `@streamclone/pulse-core` `deriveLiveHeat`, `toLiveHeatInputFromExtension` |

**Removed from extension (non-parity):** `LiveActivityChart`, `analyticsMiniChart`, sidebar chart toggles (`showViewers`, emote spike keys, 60m/Full toggle).

## Data field mapping

| Web `GET /v1/analytics/channels/{login}/live` | Extension `GET /v1/extension/pulse/channels/{login}` (`PulsePayload`) | Adapter |
|-----------------------------------------------|-----------------------------------------------------------------------|---------|
| `state: live \| historical \| …` | `isLive: boolean` | `isLive ? 'live' : 'historical'` |
| `stream.startedAt` | `startedAt` | `streamStartedAt` / minute timestamps |
| `rollups[].minuteTs` | `rollups[].offsetSeconds` | `startedAt + offsetSeconds` → ISO minute |
| `rollups[].chatCount` | `rollups[].chatCount` | direct |
| `rollups[].totalEmoteCount` | `rollups[].totalEmoteCount` | direct |
| `rollups[].seventvEmoteCount` | `rollups[].sevenTvEmoteCount` | field rename |
| `rollups[].viewerLatest` / samples | `rollups[].viewerCount` | `viewerLatest` + `viewerSamples: 1` |
| `rollups[].emotes` map | `rollups[].topEmotes[]` | catalog keys `provider:id:name` |
| `topEmotes[]` (stream) | `topEmotes[]` | direct + provider display normalize |
| BFF `peaks[]` (optional) | `peaks[]` | **not used** for sidebar ranking — client `deriveLiveHeat` only |

## Visual tokens

| Element | Spec |
|---------|------|
| Live Now header | Title “Live now” + confidence pill (Synced / Collecting / …) |
| Metrics grid | Viewers (+5m delta), Chat/min (+ trend), Emotes/min (7TV / Other) |
| Top emotes | Image + **uppercase provider chip** (not count-only) |
| Sparkline | Canvas, **chat-only**, 36px tall, violet fill `rgba(139,92,246,0.18)`, line `rgba(167,139,250,0.9)`, 60 points |
| Most Reacted | `~score` when estimated; Collecting row on trailing minute; emote stack (3 max) |

## Acceptance checklist (~340px sidebar)

- [ ] Live Now metrics match web for same channel (viewers number in row, not in chart)
- [ ] Sparkline is chat-only — **no cyan viewer band**
- [ ] Top emotes show provider chip (e.g. `7TV`)
- [ ] Most Reacted ranks match web for identical rollup fixture (offsets + scores within tolerance)
- [ ] Trailing live minute shows muted “Collecting” row
- [ ] Options page has no misleading chart layer toggles
- [ ] “Open full analytics →” opens Streamclone multi-layer chart

## Tests

- `packages/pulse-core/tests/liveStats.test.ts` — shared derivation
- `packages/pulse-core/tests/extensionAdapters.test.ts` — payload mapping
- `packages/pulse-core/tests/liveHeatParity.test.ts` — web vs extension adapter equivalence
- `streamclone-pulse/tests/extensionAdapters.test.ts` — extension smoke on fixtures
