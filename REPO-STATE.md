# Repo state snapshot — last verified 2026-08-09

This file is a working-tree-only snapshot. It will drift as files are committed; update it whenever the dirty diff changes.

## Branch & HEAD

- Branch: `master`
- HEAD: `7f9b16e fix(portal): live VOD-link merge, motion plumbing, dev port hardening`
- HEAD does **not** include any of the chart zoom, hover-only dividers, mutation filter, or popup banner work — that all lives in the dirty tree.

## Dirty diff (uncommitted)

21 modified files + 12 untracked = 33 files. 1625 insertions, 402 deletions.

### New files (12)

| File | Lines | Source |
|---|---|---|
| `src/shared/releaseManifest.ts` | 81 | this session (banner helper) |
| `src/ui/ChartPositionRail.tsx` | 460 | restored from pulse-history-rescue |
| `src/ui/chartViewport.ts` | 306 | restored from pulse-history-rescue |
| `streampulse-web/tests/e2e/hosted-24h-read-canary.spec.ts` | — | pre-existing from prior session |
| `tests/PulseOverviewChart.hover.test.tsx` | — | restored |
| `tests/__bench.chart.test.ts` | — | restored |
| `tests/__bench.pipeline.test.ts` | — | restored |
| `tests/__bench.render.test.ts` | — | restored |
| `tests/chartViewport.test.ts` | — | restored |
| `tests/chatMutationFilter.test.ts` | — | restored |
| `tests/e2e/specs/pressure.mocked.spec.ts` | — | restored |
| `tests/overviewBarGeometry.test.ts` | — | restored |

### Modified files (21)

| File | +/- | What changed |
|---|---|---|
| `src/content/entry.ts` | +30 | document-wide MutationObserver filtered, rAF coalescing for live-state sync |
| `src/content/twitchChat.ts` | +1/-1 | `export` keyword on `isIgnoredChatSnapMutationTarget` |
| `src/content/twitchLayout.ts` | +23 | MutationObserver + scroll listener filtered; teardown leak fix |
| `src/popup/popup.tsx` | rewritten | "What's new" inline changelog card + subtle bottom-of-popup `Updated · v` pill (this session, redesign) |
| `src/ui/PulseSettingsPanel.tsx` | redesign | "What's new" formatted card moved to top of settings sidebar (initial load, before Connection); old bottom "About & updates" reduced to install-version line; bullets render new/improved/fixed from CURRENT_RELEASE. Plus "Release history" toggle in the sidebar nav — clicking swaps the inline card for a full history view (all entries from release-notes.json, current build highlighted with "Current build" badge). |
| `src/shared/releaseManifest.ts` | +20 | exports new `ReleaseEntry` type + `allReleases()` helper for the history view |
| `src/ui/theme.ts` | +28 | adds `.pulse-settings-nav-history` button styles (pill, hover, pressed) |
| `streampulse-backend/docs/proposals/2026-08-10-v0.2.9-sparse-gap-backport.md` | new | read-only proposal: 5-line patch + test for v0.2.9 backport of sparse-gap fix + minute-floor bug fix (audit P0a) |
| `streampulse-backend/docs/proposals/2026-08-10-health-endpoint-build-sha.md` | new | read-only proposal: add BuildSha/BuildId/ImageDigest/ServiceGeneration/IdentityComplete to /v1/extension/health (audit P0b) |
| `streampulse-backend/docs/proposals/2026-08-10-provenance-rollout.md` | new | meta-doc with sequenced rollout checklist referencing both v0.2.9 proposals |
| `streamclone-pulse/docs/audits/2026-08-10-extension-speed-security.md` | new | read-only extension deep audit: 10 ranked speed findings + 7 security findings + bundle stats |
| `src/shared/storage.ts` | +11 | added `getChartZoomHintDismissed` / `setChartZoomHintDismissed` |
| `src/ui/GamesPlayedStrip.tsx` | +49 | header restructure so long game names don't squeeze the trail |
| `src/ui/LiveStatsBand.tsx` | +194 | wires `onViewportChange` and `<ChartPositionRail>` |
| `src/ui/PulseOverviewChart.tsx` | +667/-134 | zoom engine, position rail integration, hover-only game dividers, instrumentation |
| `src/ui/PulseSettingsPanel.tsx` | +16/-N | dedupe CHANGELOG_URL/CURRENT_RELEASE/installedExtensionVersion to shared module |
| `src/ui/RecapTimelineChart.tsx` | +200 | wires `onViewportChange` and `<ChartPositionRail>` |
| `src/ui/SevenTvEmotePanel.tsx` | +86 | refactor |
| `src/ui/StreamRecapSection.tsx` | +81 | refactor |
| `src/ui/chartRollupUtils.ts` | +180 | new exports: `chatWhisperVisualLayer`, `emoteDenseVisualLayer`, `emoteSpikeIndices`, `snappedBarGeometry` |
| `src/ui/chartTheme.ts` | +89 | new fields: `hoverRadius`, `guide` |
| `src/ui/twitchGameArt.ts` | +2 | small fix |
| `streampulse-web/src/routes/public/Landing.tsx` | +/-0 | removed `Changelog` link from public footer (changelog is now extension-only per user direction) |
| `tests/PulseOverviewChart.test.tsx` | +1 | refactor |
| `tests/chartRollupUtils.test.ts` | +103 | rewritten |
| `tests/chartSelectedMoment.test.ts` | +22 | tolerance boundaries adjusted to current `EXTENSION_CHART_MAX_POINTS = 120` |
| `tests/e2e/specs/chart-inspection.mocked.spec.ts` | +158 | rewritten |
| `tests/twitchGameArt.test.ts` | +6 | small fix |

## Verification (last run)

- `npm run typecheck` → exit 0
- `npm test` → 773 tests / 103 files pass
- `npm run build` → `dist/content/twitch.js` 557.94 kB / 162.05 gz, under 600 kB budget

## Manual Chrome pass (NOT done — requires user)

The tree builds clean but the user has not reloaded the unpacked extension in Chrome since this session's work landed. Until `chrome://extensions` → Reload Streamclone Pulse → hard-refresh Twitch is done, the running build is `0.2.0 (7f9b16e3-dirty)` from the start of this session (no zoom, no banner).

## Where things live outside git

- `/mnt/c/Users/Aron/pulse-history-rescue/` — flattened snapshots of every file this repo ever had. Most are older than HEAD. Only files dated within the most recent session window are restore candidates. **Do not recursively copy from this directory.**
- `/tmp/pulse-banner-backup/` — backup of the four dirty files from this session before the restore. Rollback path if the stash disappears.

## Outstanding decisions (from prior session)

- p95 channel-baseline y-axis (each lane self-normalises today)
- Escape clears pin?
- Wheel-zoom policy (current behavior: plain wheel zooms, no modifier required; `Ctrl+wheel` is ignored)
- Phase 4 (range-scoped Most Reacted)
- Phase 5 (moment bucket collisions — `heatPointMatchesOffset` 90s tolerance vs pinned card's widened `chartPinPeakToleranceSeconds`)