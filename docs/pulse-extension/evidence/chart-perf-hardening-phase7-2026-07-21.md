# Phase 7 — chart performance hardening (2026-07-21)

Measured in the release-candidate tree only
(`AppData/Local/Temp/streampulse-release-candidate`).

## Command

```bash
npm test -- tests/pulsePayloadMerge.test.ts tests/pulseBroadcastTargets.test.ts \
  tests/chatActivityEmotes.test.ts tests/chartPerfHardening.bench.test.ts \
  tests/chartCrosshair.test.ts
```

Result: **44 passed** / 5 files. `npx tsc --noEmit` clean.

## Benchmark numbers (vitest unit, median of repeated runs)

Workload: 480 densified minutes × 12 topEmotes; 6 selected traces.

| Metric | Before (ms) | After (ms) | Ratio |
|--------|-------------|------------|-------|
| Naive per-trace `topEmotes` scan | **1.268** | — | — |
| Indexed emote-count build (`buildEmoteCountIndex`) | — | **0.945** | **1.34×** faster |
| Overlay helpers using index (`buildEmoteOverlaySeries` + series) | — | **0.016** | (post-change path) |
| `prepareChartRollups` cold | **0.036** | — | — |
| `prepareChartRollups` cached (same payload ref) | — | **&lt;0.001** | **~35×** faster |

Raw JSON from the test run:

```json
{
  "benchmark": "chart-perf-hardening",
  "naiveScanMedianMs": 1.268,
  "indexedBuildMedianMs": 0.945,
  "overlayHelpersMedianMs": 0.016,
  "prepareChartRollupsColdMedianMs": 0.036,
  "prepareChartRollupsCachedMedianMs": 0,
  "prepareCacheSpeedup": 35.65,
  "speedupVsNaive": 1.34
}
```

Reproduce: `npm test -- tests/chartPerfHardening.bench.test.ts` (prints the JSON on stdout).

## What changed

- **Memoization:** `deriveLiveStats`, chart maxima/axis, `dashedOverlays`, prepared rollups cache, selected emote traces via indexed lookup.
- **RAF:** pointer hover uses direct bucket X; list/external selection keeps one smoother; removed duplicate active-highlight line; cached `prefers-reduced-motion` MQ.
- **No-op polls:** `mergePulsePayload` preserves array/object refs and can return the previous payload root; mount skips React when payload/error/coverage refs are unchanged; broadcast targets only matching channel tabs.
- **Tabs shell:** `Overlay` routes `sidebarPart="tabs"` to a lightweight shell without data-fetch/recap/chart effects.
- **Minor:** hoisted `Intl.NumberFormat`; ResizeObserver ignores unchanged rounded widths.
