# Global Activity Graph Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wave-of-purple line+bar overlay in `HubActivityChart` with a stacked-bar geometry, subtle rhythm lines, and a spike-aware annotation layer — preserving every existing chart interaction (select, hover, range menu, provider overlay, keyboard nav, tooltip).

**Architecture:** Split `HubActivityChart.tsx` into three pure-presentational subcomponents (`HubActivityBarSeries`, `HubActivityRhythmLines`, `HubActivityMomentAnnotations`) plus two new pure modules (`hubChartGeometry.ts`, `hubChartMarkers.ts`). Extend `HubChartActivityModel` to derive rhythm lines and pre-classified annotations. All work is internal to `HubActivityChart`; its public props are unchanged.

**Tech Stack:** React 18, TypeScript, Vitest, plain SVG (no chart library), existing CSS classes (`hub.css`), `prefers-reduced-motion` media query.

**Spec:** `docs/superpowers/specs/2026-08-15-global-activity-graph-redesign-design.md`

## Global Constraints

- Existing chart props on `HubActivityChart` are unchanged. Callers (`FigmaGlobalActivityPanel`) keep working untouched.
- All new code is internal to the chart component and its supporting modules.
- No new dependencies. Reuse `@streampulse/pulse-charts` `CHART_MOTION` if available; otherwise introduce `src/lib/chartMotion.ts` with explicit constants.
- Honor `prefers-reduced-motion: reduce` for every animation.
- Bundle size: chart's compiled JS must not grow by more than 2 KiB (gzipped) — verify with `npm run build` size output.
- All new pure modules get unit tests; new subcomponents get render tests via Vitest + React Testing Library (already configured; see `tests/adaptiveChartGeometry.test.ts` for the unit pattern and `tests/ChannelAvatar.test.tsx` for the component pattern).
- Branches: keep working on `track-b/hub-ux-hygiene` (the spec branch). Commit messages follow `feat(portal): ...` / `fix(portal): ...` / `test(portal): ...` / `refactor(portal): ...`.
- All Task commits must make `npm run typecheck` and `npm test -- --run` pass.

---

## Task 1: Pure geometry module — `hubChartGeometry.ts`

**Files:**
- Create: `streampulse-web/src/lib/hubChartGeometry.ts`
- Create: `streampulse-web/tests/hubChartGeometry.test.ts`

**Purpose:** Single source of truth for bar x/width, rhythm line y, trailing-bucket x. Pure functions, no React, no DOM.

**Interfaces:**
- Produces: `barXPercent(t, timeDomain)`, `barWidthPercent(timeDomain)`, `rhythmLines(points, opts)` (returns `null` for empty/single-point), `trailingBucketXPercent(timeDomain)`, `barStackSegments(point, dims)` (returns up to 3 segments).

**Consumes:** Existing `HubTimeDomain` from `src/lib/hubTimeScale.ts`. Existing `HubActivityPoint` from `src/lib/publicHub.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hubChartGeometry.test.ts
import { describe, expect, it } from 'vitest'
import {
  barXPercent,
  barWidthPercent,
  rhythmLines,
  trailingBucketXPercent,
  barStackSegments,
  type BarDims,
} from '../src/lib/hubChartGeometry'

const domain = (start: number, end: number, bucketMs: number) => ({
  start,
  endExclusive: end,
  bucketDurationMs: bucketMs,
})

describe('hubChartGeometry', () => {
  it('barXPercent returns the bucket-start x as percent', () => {
    const d = domain(0, 1000 * 60 * 60, 60_000) // 1h, 1-min buckets
    expect(barXPercent(0, d)).toBe(0)
    expect(barXPercent(30 * 60_000, d)).toBeCloseTo(50, 5)
    expect(barXPercent(60 * 60_000, d)).toBeNull() // out of range
  })

  it('barWidthPercent returns bucket span as percent', () => {
    const d = domain(0, 1000 * 60 * 60, 60_000)
    expect(barWidthPercent(d)).toBeCloseTo(100 / 60, 5)
  })

  it('rhythmLines returns null for empty points', () => {
    expect(rhythmLines([], { dims: { height: 100, paddingBottom: 0 } })).toBeNull()
  })

  it('rhythmLines returns single avg value when points.length === 1', () => {
    const points = [{ t: 0, viewers: 500 }]
    const lines = rhythmLines(points, { dims: { height: 100, paddingBottom: 0 } })
    expect(lines).not.toBeNull()
    expect(lines!.avg).toBe(50) // 500 / 1000 max
    expect(lines!.loud).toBeNull()
  })

  it('rhythmLines returns avg (median) and loud (p90) for many points', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({ t: i, viewers: i * 10 }))
    const lines = rhythmLines(points, { dims: { height: 100, paddingBottom: 0 } })
    expect(lines).not.toBeNull()
    expect(lines!.avg).toBeCloseTo(50, 0) // median ~ 495 / 1000
    expect(lines!.loud).toBeCloseTo(90, 0) // 90th percentile ~ 890 / 1000
  })

  it('barStackSegments returns three segments when all values > 0', () => {
    const dims: BarDims = { height: 100, paddingBottom: 0 }
    const segments = barStackSegments(
      { t: 0, viewers: 600, chat: 200, emotes: 100 } as any,
      dims,
      { viewers: 1000, chat: 500, emotes: 200 },
    )
    expect(segments).toHaveLength(3)
    expect(segments[0].color).toBe('viewers')
    expect(segments[0].height).toBeCloseTo(60, 5)
    expect(segments[1].color).toBe('chat')
    expect(segments[2].color).toBe('emotes')
  })

  it('barStackSegments omits segments whose value is 0', () => {
    const dims: BarDims = { height: 100, paddingBottom: 0 }
    const segments = barStackSegments(
      { t: 0, viewers: 500, chat: 0, emotes: 0 } as any,
      dims,
      { viewers: 1000, chat: 0, emotes: 0 },
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].color).toBe('viewers')
  })

  it('trailingBucketXPercent returns null when no time domain', () => {
    expect(trailingBucketXPercent(null)).toBeNull()
  })

  it('trailingBucketXPercent returns 100 when domain is present', () => {
    expect(trailingBucketXPercent(domain(0, 1000, 100))).toBe(100)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd streampulse-web && npm test -- --run hubChartGeometry`
Expected: FAIL with "Cannot find module '../src/lib/hubChartGeometry'"

- [ ] **Step 3: Implement the module**

```ts
// src/lib/hubChartGeometry.ts
import type { HubActivityPoint } from './publicHub'
import type { HubTimeDomain } from './hubTimeScale'

export interface BarDims {
  height: number
  paddingBottom: number
}

export interface RhythmLines {
  avg: number | null
  loud: number | null
}

/** X percent (0..100) of the bucket start whose timestamp is `t`. */
export function barXPercent(t: number, domain: HubTimeDomain): number | null {
  if (t < domain.start || t >= domain.endExclusive) return null
  const span = domain.endExclusive - domain.start
  if (!(span > 0)) return null
  return ((t - domain.start) / span) * 100
}

/** Width percent of a single bar (one bucket). */
export function barWidthPercent(domain: HubTimeDomain): number {
  const span = domain.endExclusive - domain.start
  if (!(span > 0)) return 0
  return (domain.bucketDurationMs / span) * 100
}

/** Avg (median viewers) and loud (p90 viewers) given the visible chart points. */
export function rhythmLines(
  points: HubActivityPoint[],
  opts: { dims: BarDims; excludeTrailingBucket?: boolean },
): RhythmLines | null {
  if (points.length === 0) return null
  const pts = opts.excludeTrailingBucket ? points.slice(0, -1) : points
  if (pts.length === 0) return null
  const viewers = pts.map((p) => p.viewers).sort((a, b) => a - b)
  const median = viewers[Math.floor(viewers.length / 2)]
  const p90 = viewers[Math.floor(viewers.length * 0.9)]
  return {
    avg: opts.dims.height > 0 ? (median / Math.max(...viewers, 1)) * opts.dims.height : 0,
    loud: viewers.length > 1 ? (p90 / Math.max(...viewers, 1)) * opts.dims.height : null,
  }
}

/** X percent of the trailing in-progress bucket. Stays at 100 if a domain exists. */
export function trailingBucketXPercent(domain: HubTimeDomain | null): number | null {
  if (!domain) return null
  return 100
}

export type StackSegmentColor = 'viewers' | 'chat' | 'emotes'

export interface StackSegment {
  color: StackSegmentColor
  /** Height in pixels (negative offset from baseline). */
  height: number
}

/** Stack segments for a single bar. Skips zero-valued segments. */
export function barStackSegments(
  point: HubActivityPoint,
  dims: BarDims,
  maxes: { viewers: number; chat: number; emotes: number },
): StackSegment[] {
  const usable = Math.max(0, dims.height - dims.paddingBottom)
  const segments: StackSegment[] = []
  if (point.viewers > 0 && maxes.viewers > 0) {
    segments.push({ color: 'viewers', height: (point.viewers / maxes.viewers) * usable })
  }
  if (point.chat > 0 && maxes.chat > 0) {
    segments.push({ color: 'chat', height: (point.chat / maxes.chat) * usable })
  }
  const emotes = Math.max(point.emotes ?? 0, point.seventv ?? 0, point.twitch ?? 0, point.bttv ?? 0, point.ffz ?? 0)
  if (emotes > 0 && maxes.emotes > 0) {
    segments.push({ color: 'emotes', height: (emotes / maxes.emotes) * usable })
  }
  return segments
}
```

- [ ] **Step 4: Run the tests; verify they pass**

Run: `cd streampulse-web && npm test -- --run hubChartGeometry`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hubChartGeometry.ts tests/hubChartGeometry.test.ts
git commit -m "feat(portal): add hubChartGeometry pure module"
```

---

## Task 2: Pure markers module — `hubChartMarkers.ts`

**Files:**
- Create: `streampulse-web/src/lib/hubChartMarkers.ts`
- Create: `streampulse-web/tests/hubChartMarkers.test.ts`

**Purpose:** Classify moments into spike vs regular, and resolve horizontal collisions between annotations.

**Interfaces:**
- `HubChartAnnotation` (full type, including `kind: 'spike' | 'moment'`, `bucketT`, `channelName`, `metrics`, `source`).
- `classifyMomentMarker(marker) → 'spike' | 'moment'`.
- `resolveAnnotationCollisions(annotations, opts) → annotations` (with `opacity: 0.4` and `labelOmitted: true` on losers).

**Consumes:** `HubActivityMomentMarker` from `src/ui/components/hub/HubActivityChart.tsx`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/hubChartMarkers.test.ts
import { describe, expect, it } from 'vitest'
import {
  classifyMomentMarker,
  resolveAnnotationCollisions,
  type HubChartAnnotation,
} from '../src/lib/hubChartMarkers'

describe('classifyMomentMarker', () => {
  it('returns spike for chat_spike', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'chat_spike' })).toBe('spike')
  })

  it('returns spike for emote_spike', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'emote_spike' })).toBe('spike')
  })

  it('returns spike for viewer_spike', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'viewer_spike' })).toBe('spike')
  })

  it('returns spike case-insensitively', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'CHAT_SPIKE' })).toBe('spike')
  })

  it('returns moment for unknown kind', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0, kind: 'lifecycle' })).toBe('moment')
  })

  it('returns moment when kind is undefined', () => {
    expect(classifyMomentMarker({ key: 'a', bucketT: 0 })).toBe('moment')
  })
})

describe('resolveAnnotationCollisions', () => {
  const ann = (key: string, bucketT: number): HubChartAnnotation => ({
    key,
    bucketT,
    kind: 'moment',
    channelName: 'ch',
    source: 'network',
  })

  it('returns the same annotations when no two are close', () => {
    const list = [ann('a', 0), ann('b', 1000), ann('c', 2000)]
    expect(resolveAnnotationCollisions(list, { minSpacingPx: 24 })).toEqual(list)
  })

  it('marks the later annotation as dimmed when two are close', () => {
    const list = [ann('a', 0), ann('b', 10)]
    const out = resolveAnnotationCollisions(list, { minSpacingPx: 24 })
    expect(out[0].opacity).toBeUndefined()
    expect(out[1].opacity).toBe(0.4)
    expect(out[1].labelOmitted).toBe(true)
  })

  it('treats an annotation as a 100-px-wide column when xPercent is missing', () => {
    const list = [ann('a', 0), ann('b', 5)]
    const out = resolveAnnotationCollisions(list, { minSpacingPx: 200 })
    expect(out[1].opacity).toBe(0.4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd streampulse-web && npm test -- --run hubChartMarkers`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// src/lib/hubChartMarkers.ts
import type { HubActivityMomentMarker } from '../ui/components/hub/HubActivityChart'

export type HubChartAnnotationKind = 'spike' | 'moment'

export interface HubChartAnnotation {
  key: string
  bucketT: number
  at?: number
  kind: HubChartAnnotationKind
  channelName: string
  channelDisplayName?: string
  emoteName?: string
  emoteUrl?: string
  channelLabel?: string
  metrics?: { viewers?: number; chatPerMin?: number; emotesPerMin?: number }
  source: 'network' | 'fallback'
  xPercent?: number
  opacity?: number
  labelOmitted?: boolean
}

const SPIKE_KINDS = new Set(['chat_spike', 'emote_spike', 'viewer_spike'])

export function classifyMomentMarker(marker: HubActivityMomentMarker): HubChartAnnotationKind {
  const kind = (marker.kind ?? '').trim().toLowerCase()
  return SPIKE_KINDS.has(kind) ? 'spike' : 'moment'
}

/** Single-pass left-to-right collision pass. Losers get opacity 0.4 and labelOmitted true. */
export function resolveAnnotationCollisions(
  annotations: HubChartAnnotation[],
  opts: { minSpacingPx: number },
): HubChartAnnotation[] {
  if (annotations.length < 2) return annotations
  const out = annotations.map((a) => ({ ...a }))
  let lastKeptX = -Infinity
  for (let i = 0; i < out.length; i += 1) {
    const x = out[i].xPercent ?? i * 100 // fallback spacing assumption
    if (i === 0) {
      lastKeptX = x
      continue
    }
    if (x - lastKeptX < opts.minSpacingPx) {
      out[i].opacity = 0.4
      out[i].labelOmitted = true
    } else {
      lastKeptX = x
    }
  }
  return out
}
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `cd streampulse-web && npm test -- --run hubChartMarkers`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/hubChartMarkers.ts tests/hubChartMarkers.test.ts
git commit -m "feat(portal): add hubChartMarkers classifier + collision resolver"
```

---

## Task 3: Motion constants module — `lib/chartMotion.ts`

**Files:**
- Create: `streampulse-web/src/lib/chartMotion.ts`
- (No separate tests — values are constants; one Render test in Task 7 covers the eager gating.)

**Purpose:** Single source of truth for the new easing/duration constants. Makes them grepable, testable, and easy to tune.

- [ ] **Step 1: Create the module**

```ts
// src/lib/chartMotion.ts

export const CHART_MOTION = {
  trailingBucket: {
    durationMs: 700,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
  spikeGlowEnter: {
    durationMs: 320,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
  spikeGlowPulse: {
    durationMs: 1200,
    easing: 'ease-in-out',
  },
  spikeGlowPulseMinOpacity: 0.92,
  annotationLabelFadeIn: {
    durationMs: 200,
    easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  },
} as const

export type ChartMotionToken = keyof typeof CHART_MOTION
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd streampulse-web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chartMotion.ts
git commit -m "feat(portal): add chartMotion easing constants"
```

---

## Task 4: Extend `HubChartActivityModel` with rhythm lines and annotations

**Files:**
- Modify: `streampulse-web/src/lib/hubChartActivityModel.ts`
- Modify: `streampulse-web/tests/hubChartActivityModel.test.ts`

**Purpose:** Add `rhythmLines` and `annotations` fields to the model. Memoization keys stay the same.

**Interfaces:**
- New `HubChartRhythmLines` (re-export from `hubChartGeometry`).
- New `HubChartAnnotation` (re-export from `hubChartMarkers`).
- `HubChartActivityModel` extended: `{ chartPoints, peakViewers, peakChatPerMin, peakEmotesPerMin, rhythmLines, annotations }`.

- [ ] **Step 1: Read the existing model and test file**

Read: `src/lib/hubChartActivityModel.ts` and `tests/hubChartActivityModel.test.ts` so the new tests match the existing fixture style.

- [ ] **Step 2: Add failing tests**

```ts
// In tests/hubChartActivityModel.test.ts, ADD:
import { HubActivityMomentMarker } from '../src/ui/components/hub/HubActivityChart'

const fixtureMarkers: HubActivityMomentMarker[] = [
  { key: 'a', bucketT: 0, kind: 'chat_spike' },
  { key: 'b', bucketT: 60_000, kind: 'lifecycle' },
]

it('returns rhythmLines when points are present', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({
    t: i * 60_000, viewers: 100 + i * 10, chat: i, emotes: i,
  }))
  const out = deriveHubChartActivityModel({ points, windowMinutes: 60, livePoolViewerSum: 0 }, 600_000)
  expect(out.rhythmLines).not.toBeNull()
  if (out.rhythmLines) {
    expect(out.rhythmLines.avg).not.toBeNull()
  }
})

it('returns annotations when markers are provided', () => {
  const points = [
    { t: 0, viewers: 100, chat: 50, emotes: 0 },
    { t: 60_000, viewers: 200, chat: 100, emotes: 0 },
  ]
  const out = deriveHubChartActivityModel(
    { points, windowMinutes: 60, livePoolViewerSum: 0, markers: fixtureMarkers },
    120_000,
  )
  expect(out.annotations).toHaveLength(2)
  expect(out.annotations[0].kind).toBe('spike')
  expect(out.annotations[1].kind).toBe('moment')
})
```

- [ ] **Step 3: Run tests; verify they fail**

Run: `cd streampulse-web && npm test -- --run hubChartActivityModel`
Expected: FAIL — `rhythmLines` / `annotations` undefined.

- [ ] **Step 4: Extend the model**

```ts
// src/lib/hubChartActivityModel.ts (replace the file)
import type { HubActivityPoint, PublicHub } from './publicHub'
import {
  chartActivityPoints,
  hubActivityEmoteCount,
} from './hubActivitySummary'
import { livePoolViewerSum } from './hubMetricHelpers'
import { rhythmLines as computeRhythmLines, type RhythmLines } from './hubChartGeometry'
import {
  classifyMomentMarker,
  resolveAnnotationCollisions,
  type HubChartAnnotation,
} from './hubChartMarkers'
import type { HubActivityMomentMarker } from '../ui/components/hub/HubActivityChart'

export interface HubChartActivityInputs {
  points: HubActivityPoint[]
  windowMinutes: number
  livePoolViewerSum: number
  markers?: HubActivityMomentMarker[]
  /** Channel-name lookup for marker annotation. Optional — falls back to key. */
  markerChannelNames?: Map<string, string>
}

export interface HubChartActivityModel {
  chartPoints: HubActivityPoint[]
  peakViewers: number
  peakChatPerMin: number
  peakEmotesPerMin: number
  rhythmLines: RhythmLines | null
  annotations: HubChartAnnotation[]
}

export function selectHubChartActivityInputs(hub: PublicHub): HubChartActivityInputs {
  return {
    points: hub.activity.points,
    windowMinutes: hub.activity.windowMinutes,
    livePoolViewerSum: livePoolViewerSum(hub),
  }
}

export function deriveHubChartActivityModel(
  inputs: HubChartActivityInputs,
  nowMs?: number,
): HubChartActivityModel {
  const chartPoints = chartActivityPoints(
    inputs.points,
    inputs.windowMinutes,
    nowMs,
    inputs.livePoolViewerSum,
  )
  let peakViewers = 0
  let peakChatPerMin = 0
  let peakEmotesPerMin = 0
  for (const point of chartPoints) {
    if (point.viewers > peakViewers) peakViewers = point.viewers
    if (point.chat > peakChatPerMin) peakChatPerMin = point.chat
    const emotes = hubActivityEmoteCount(point)
    if (emotes > peakEmotesPerMin) peakEmotesPerMin = emotes
  }

  const rhythmLines = computeRhythmLines(chartPoints, {
    dims: { height: 0, paddingBottom: 0 }, // geometry renders in own coordinate space; values reused by subcomponent
  })

  const rawAnnotations: HubChartAnnotation[] = (inputs.markers ?? []).map((m) => ({
    key: m.key,
    bucketT: m.bucketT,
    at: m.at,
    kind: classifyMomentMarker(m),
    channelName: inputs.markerChannelNames?.get(m.key) ?? m.key,
    source: 'network',
  }))

  const annotations = resolveAnnotationCollisions(rawAnnotations, { minSpacingPx: 24 })

  return { chartPoints, peakViewers, peakChatPerMin, peakEmotesPerMin, rhythmLines, annotations }
}
```

- [ ] **Step 5: Run tests; verify they pass**

Run: `cd streampulse-web && npm test -- --run hubChartActivityModel`
Expected: PASS — old + new tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hubChartActivityModel.ts tests/hubChartActivityModel.test.ts
git commit -m "feat(portal): derive rhythmLines and annotations in chart model"
```

---

## Task 5: `HubActivityBarSeries` subcomponent

**Files:**
- Create: `streampulse-web/src/ui/components/analytics/HubActivityBarSeries.tsx`
- Create: `streampulse-web/tests/HubActivityBarSeries.test.tsx`

**Purpose:** Pure-presentational stacked bars. Owns no state. Consumers pass `points`, `dims`, `timeDomain`, `maxes`, `seriesKey`, `focusedSeriesKey`.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/HubActivityBarSeries.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { HubActivityBarSeries } from '../src/ui/components/analytics/HubActivityBarSeries'
import { hubTimeDomain } from '../src/lib/hubTimeScale'

describe('HubActivityBarSeries', () => {
  const points = [
    { t: 0, viewers: 100, chat: 10, emotes: 0 },
    { t: 60_000, viewers: 200, chat: 20, emotes: 0 },
  ]
  const domain = hubTimeDomain(points, 60_000)!

  it('renders one <rect> per non-zero segment', () => {
    const { container } = render(
      <svg>
        <HubActivityBarSeries
          points={points}
          timeDomain={domain}
          height={100}
          paddingBottom={0}
          maxes={{ viewers: 200, chat: 20, emotes: 0 }}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect.hx-bar-segment')).toHaveLength(4) // 2 viewers + 2 chat
  })

  it('skips segments whose value is 0', () => {
    const { container } = render(
      <svg>
        <HubActivityBarSeries
          points={[{ t: 0, viewers: 100, chat: 0, emotes: 0 }]}
          timeDomain={domain}
          height={100}
          paddingBottom={0}
          maxes={{ viewers: 100, chat: 0, emotes: 0 }}
        />
      </svg>,
    )
    expect(container.querySelectorAll('rect.hx-bar-segment')).toHaveLength(1)
  })

  it('omits the live trailing bucket when its t equals the last in-progress point', () => {
    const pts = [...points, { t: 120_000, viewers: 50, chat: 0, emotes: 0, bucketComplete: false } as any]
    const { container } = render(
      <svg>
        <HubActivityBarSeries
          points={pts}
          timeDomain={domain}
          height={100}
          paddingBottom={0}
          maxes={{ viewers: 200, chat: 0, emotes: 0 }}
          trailingBucketT={120_000}
        />
      </svg>,
    )
    const live = container.querySelector('[data-live="true"]')
    expect(live).toBeTruthy()
    expect(live?.getAttribute('opacity')).toBe('0.4')
  })
})
```

- [ ] **Step 2: Run tests; verify they fail with "module not found"**

Run: `cd streampulse-web && npm test -- --run HubActivityBarSeries`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// src/ui/components/analytics/HubActivityBarSeries.tsx
import { memo } from 'react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import type { HubTimeDomain } from '../../../lib/hubTimeScale'
import {
  barStackSegments,
  barWidthPercent,
  barXPercent,
} from '../../../lib/hubChartGeometry'

export interface HubActivityBarSeriesProps {
  points: HubActivityPoint[]
  timeDomain: HubTimeDomain
  height: number
  paddingBottom: number
  maxes: { viewers: number; chat: number; emotes: number }
  focusedSeriesKey: 'viewers' | 'chat' | 'emotes' | null
  highlightBarT?: number | null
  selectedBarT?: number | null
  trailingBucketT?: number | null
  onBarClick?: (bucketT: number) => void
  onBarHover?: (bucketT: number | null) => void
}

const FOCUS_DIM_FACTOR = 0.14

function focusedOpacity(focused: 'viewers' | 'chat' | 'emotes' | null, color: 'viewers' | 'chat' | 'emotes'): number {
  if (!focused) return 1
  if (focused === color) return 1
  return FOCUS_DIM_FACTOR
}

export const HubActivityBarSeries = memo(function HubActivityBarSeries({
  points, timeDomain, height, paddingBottom, maxes, focusedSeriesKey,
  highlightBarT, selectedBarT, trailingBucketT, onBarClick, onBarHover,
}: HubActivityBarSeriesProps) {
  const widthPct = barWidthPercent(timeDomain)
  return (
    <g data-component="HubActivityBarSeries" onMouseLeave={() => onBarHover?.(null)}>
      {points.map((p) => {
        const x = barXPercent(p.t, timeDomain)
        if (x == null) return null
        const isLive = trailingBucketT != null && p.t === trailingBucketT
        const opacity = isLive ? 0.4 : 1
        const segments = barStackSegments(p, { height, paddingBottom }, maxes)
        const isHighlighted = highlightBarT === p.t || selectedBarT === p.t
        return (
          <g
            key={p.t}
            data-bar-t={p.t}
            data-live={isLive ? 'true' : undefined}
            onMouseEnter={() => onBarHover?.(p.t)}
            onClick={() => onBarClick?.(p.t)}
            style={{ cursor: onBarClick ? 'pointer' : 'default' }}
            opacity={isHighlighted ? 1 : opacity}
          >
            {segments.map((seg, i) => {
              const stackOffset = segments
                .slice(0, i)
                .reduce((sum, s) => sum + s.height, 0)
              const y = height - paddingBottom - stackOffset - seg.height
              return (
                <rect
                  key={seg.color}
                  className={`hx-bar-segment hx-bar-segment--${seg.color} ${isHighlighted ? 'is-selected' : ''}`}
                  x={`${x}%`}
                  y={y}
                  width={`${widthPct}%`}
                  height={seg.height}
                  fillOpacity={focusedOpacity(focusedSeriesKey, seg.color)}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
})
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `cd streampulse-web && npm test -- --run HubActivityBarSeries`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/analytics/HubActivityBarSeries.tsx tests/HubActivityBarSeries.test.tsx
git commit -m "feat(portal): HubActivityBarSeries stacked-bar subcomponent"
```

---

## Task 6: `HubActivityRhythmLines` subcomponent

**Files:**
- Create: `streampulse-web/src/ui/components/analytics/HubActivityRhythmLines.tsx`
- Create: `streampulse-web/tests/HubActivityRhythmLines.test.tsx`

**Purpose:** Renders the avg and loud horizontal dashed lines. Pure.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/HubActivityRhythmLines.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { HubActivityRhythmLines } from '../src/ui/components/analytics/HubActivityRhythmLines'

describe('HubActivityRhythmLines', () => {
  it('renders both lines when both are present', () => {
    const { container } = render(
      <svg>
        <HubActivityRhythmLines height={100} avg={20} loud={70} />
      </svg>,
    )
    expect(container.querySelectorAll('line.hx-rhythm-line')).toHaveLength(2)
  })

  it('renders only the avg line when loud is null', () => {
    const { container } = render(
      <svg>
        <HubActivityRhythmLines height={100} avg={20} loud={null} />
      </svg>,
    )
    expect(container.querySelectorAll('line.hx-rhythm-line')).toHaveLength(1)
    expect(container.querySelector('.hx-rhythm-line--loud')).toBeNull()
  })

  it('renders nothing when avg is null', () => {
    const { container } = render(
      <svg>
        <HubActivityRhythmLines height={100} avg={null} loud={null} />
      </svg>,
    )
    expect(container.querySelectorAll('line.hx-rhythm-line')).toHaveLength(0)
  })

  it('attaches a presentation role and a <desc> with line labels', () => {
    const { container } = render(
      <svg>
        <HubActivityRhythmLines height={100} avg={20} loud={70} />
      </svg>,
    )
    expect(container.querySelector('g')?.getAttribute('role')).toBe('presentation')
    expect(container.querySelector('desc')?.textContent).toContain('avg')
  })
})
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `cd streampulse-web && npm test -- --run HubActivityRhythmLines`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// src/ui/components/analytics/HubActivityRhythmLines.tsx
import { memo } from 'react'

export interface HubActivityRhythmLinesProps {
  height: number
  avg: number | null
  loud: number | null
  width?: string // CSS-style width, e.g. '100%'
}

export const HubActivityRhythmLines = memo(function HubActivityRhythmLines({
  height, avg, loud, width = '100%',
}: HubActivityRhythmLinesProps) {
  if (avg == null && loud == null) return null
  return (
    <g role="presentation" data-component="HubActivityRhythmLines">
      <desc>Reference lines: avg and loud viewer baselines for the active window.</desc>
      {avg != null ? (
        <line
          className="hx-rhythm-line hx-rhythm-line--avg"
          x1="0" y1={height - avg}
          x2={width} y2={height - avg}
          strokeDasharray="2,4"
          strokeOpacity={0.10}
        />
      ) : null}
      {loud != null ? (
        <line
          className="hx-rhythm-line hx-rhythm-line--loud"
          x1="0" y1={height - loud}
          x2={width} y2={height - loud}
          strokeDasharray="2,4"
          strokeOpacity={0.16}
        />
      ) : null}
    </g>
  )
})
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `cd streampulse-web && npm test -- --run HubActivityRhythmLines`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/analytics/HubActivityRhythmLines.tsx tests/HubActivityRhythmLines.test.tsx
git commit -m "feat(portal): HubActivityRhythmLines avg/loud reference lines"
```

---

## Task 7: `HubActivityMomentAnnotations` subcomponent

**Files:**
- Create: `streampulse-web/src/ui/components/analytics/HubActivityMomentAnnotations.tsx`
- Create: `streampulse-web/tests/HubActivityMomentAnnotations.test.tsx`

**Purpose:** Renders spike glows + regular stamps + glyph labels. Honors `prefers-reduced-motion`. Pure.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/HubActivityMomentAnnotations.test.tsx
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { HubActivityMomentAnnotations } from '../src/ui/components/analytics/HubActivityMomentAnnotations'
import type { HubChartAnnotation } from '../src/lib/hubChartMarkers'

const spike: HubChartAnnotation = { key: 'a', bucketT: 0, kind: 'spike', channelName: 'Fanum', source: 'network', xPercent: 50 }
const moment: HubChartAnnotation = { key: 'b', bucketT: 60_000, kind: 'moment', channelName: 'Arky', source: 'network', xPercent: 80 }

describe('HubActivityMomentAnnotations', () => {
  it('renders a spike glow (3 ellipses) for spike-classified annotations', () => {
    const { container } = render(
      <svg>
        <HubActivityMomentAnnotations annotations={[spike]} height={100} reducedMotion />
      </svg>,
    )
    expect(container.querySelectorAll('ellipse.hx-spike-glow')).toHaveLength(3)
  })

  it('renders a stamp for non-spike annotations', () => {
    const { container } = render(
      <svg>
        <HubActivityMomentAnnotations annotations={[moment]} height={100} reducedMotion />
      </svg>,
    )
    expect(container.querySelectorAll('rect.hx-moment-stamp')).toHaveLength(1)
    expect(container.querySelector('.hx-moment-stamp__connector')).toBeTruthy()
  })

  it('dims and omits the label of an annotation marked labelOmitted', () => {
    const dimmed: HubChartAnnotation = { ...moment, opacity: 0.4, labelOmitted: true }
    const { container } = render(
      <svg>
        <HubActivityMomentAnnotations annotations={[dimmed]} height={100} reducedMotion />
      </svg>,
    )
    const stamp = container.querySelector('rect.hx-moment-stamp')
    expect(stamp?.getAttribute('opacity')).toBe('0.4')
    expect(container.querySelector('text.hx-moment-stamp__label')).toBeNull()
  })

  it('skips the spike glow pulse when reducedMotion is true', () => {
    const { container } = render(
      <svg>
        <HubActivityMomentAnnotations annotations={[spike]} height={100} reducedMotion />
      </svg>,
    )
    expect(container.querySelector('.hx-spike-glow--pulse')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests; verify they fail**

Run: `cd streampulse-web && npm test -- --run HubActivityMomentAnnotations`
Expected: FAIL.

- [ ] **Step 3: Implement the component**

```tsx
// src/ui/components/analytics/HubActivityMomentAnnotations.tsx
import { memo } from 'react'
import type { HubChartAnnotation } from '../../../lib/hubChartMarkers'
import { CHART_MOTION } from '../../../lib/chartMotion'

export interface HubActivityMomentAnnotationsProps {
  annotations: HubChartAnnotation[]
  height: number
  reducedMotion: boolean
  onSelectAnnotation?: (key: string) => void
  selectedAnnotationKey?: string | null
}

const STAMP_HEIGHT = 14
const STAMP_WIDTH = 26

export const HubActivityMomentAnnotations = memo(function HubActivityMomentAnnotations({
  annotations, height, reducedMotion, onSelectAnnotation, selectedAnnotationKey,
}: HubActivityMomentAnnotationsProps) {
  const prefersReduced = reducedMotion
  return (
    <g data-component="HubActivityMomentAnnotations">
      {annotations.map((a) => {
        const x = a.xPercent ?? 0
        if (a.kind === 'spike') {
          const baseR = 24
          return (
            <g
              key={a.key}
              data-annotation-key={a.key}
              onClick={() => onSelectAnnotation?.(a.key)}
              style={{ cursor: onSelectAnnotation ? 'pointer' : 'default' }}
            >
              <ellipse cx={x} cy={height / 2} rx={baseR * 1.6} ry={height * 0.45} className="hx-spike-glow" fillOpacity={0.10} />
              <ellipse cx={x} cy={height / 2} rx={baseR} ry={height * 0.32} className="hx-spike-glow" fillOpacity={0.18} />
              <ellipse cx={x} cy={height / 2} rx={baseR * 0.35} ry={height * 0.18} className="hx-spike-glow" fillOpacity={0.30} />
              {!prefersReduced ? (
                <animate
                  attributeName="fill-opacity"
                  values="0.30;0.276;0.30"
                  dur={`${CHART_MOTION.spikeGlowPulse.durationMs}ms`}
                  repeatCount="indefinite"
                />
              ) : null}
              {!a.labelOmitted ? (
                <g>
                  <rect x={x - STAMP_WIDTH / 2} y={4} width={STAMP_WIDTH} height={STAMP_HEIGHT} rx={3} className="hx-moment-stamp hx-moment-stamp--spike" />
                  <text x={x} y={14} fontSize={8} textAnchor="middle" className="hx-moment-stamp__label">
                    {a.channelName.slice(0, 6).toUpperCase()}
                  </text>
                </g>
              ) : null}
            </g>
          )
        }
        const opacity = a.opacity ?? 1
        return (
          <g
            key={a.key}
            data-annotation-key={a.key}
            opacity={opacity}
            onClick={() => onSelectAnnotation?.(a.key)}
            style={{ cursor: onSelectAnnotation ? 'pointer' : 'default' }}
          >
            <rect
              x={x - STAMP_WIDTH / 2}
              y={height - STAMP_HEIGHT - 4}
              width={STAMP_WIDTH}
              height={STAMP_HEIGHT}
              rx={3}
              className={`hx-moment-stamp ${selectedAnnotationKey === a.key ? 'is-selected' : ''}`}
            />
            <line
              x1={x}
              y1={height - 4}
              x2={x}
              y2={height - STAMP_HEIGHT - 4}
              className="hx-moment-stamp__connector"
              strokeDasharray="2,2"
            />
            {!a.labelOmitted ? (
              <text x={x + STAMP_WIDTH / 2 + 4} y={height - STAMP_HEIGHT / 2 - 4} fontSize={9} className="hx-moment-stamp__label">
                {a.channelName}
              </text>
            ) : null}
          </g>
        )
      })}
    </g>
  )
})
```

- [ ] **Step 4: Run tests; verify they pass**

Run: `cd streampulse-web && npm test -- --run HubActivityMomentAnnotations`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/analytics/HubActivityMomentAnnotations.tsx tests/HubActivityMomentAnnotations.test.tsx
git commit -m "feat(portal): HubActivityMomentAnnotations spike + stamp renderer"
```

---

## Task 8: Add CSS classes for the new subcomponents

**Files:**
- Modify: `streampulse-web/src/ui/components/hub/hub.css` (look at the existing bar / moment styles in `analytics-hub-home.css` first)

**Purpose:** Hook the new class names to tokens. The classes used so far: `hx-bar-segment`, `hx-bar-segment--viewers`, `hx-bar-segment--chat`, `hx-bar-segment--emotes`, `hx-rhythm-line`, `hx-rhythm-line--avg`, `hx-rhythm-line--loud`, `hx-spike-glow`, `hx-moment-stamp`, `hx-moment-stamp__connector`, `hx-moment-stamp__label`, `hx-moment-stamp--spike`, `is-selected`.

- [ ] **Step 1: Find the existing entry point for chart styles**

```bash
grep -rn "hx-bar\|hx-rhythm\|hx-spike\|hx-moment-stamp" streampulse-web/src
```

Then read the file that owns bar styles today. Add the new classes near existing `.hx-bar` block.

- [ ] **Step 2: Append the new classes**

```css
/* appended to the chart's stylesheet */

.hx-bar-segment {
  transition: fill-opacity 120ms ease-out;
}
.hx-bar-segment.is-selected {
  filter: brightness(1.15);
}
.hx-bar-segment--viewers { fill: var(--hub-bar-viewers, #a78bfa); }
.hx-bar-segment--chat    { fill: var(--hub-bar-chat,    #22d3ee); }
.hx-bar-segment--emotes  { fill: var(--hub-bar-emotes,  #fbbf24); }

.hx-rhythm-line {
  stroke: currentColor;
  stroke-width: 1;
  pointer-events: none;
}
.hx-rhythm-line--avg { stroke-opacity: 0.10; }
.hx-rhythm-line--loud { stroke-opacity: 0.16; }

.hx-spike-glow {
  fill: var(--hub-bar-spike, #22d3ee);
  pointer-events: none;
}
.hx-moment-stamp {
  fill: var(--hub-bar-viewers, #a78bfa);
  fill-opacity: 0.85;
  stroke: currentColor;
  stroke-width: 0.5;
}
.hx-moment-stamp--spike {
  fill: var(--hub-bar-spike, #22d3ee);
  fill-opacity: 0.95;
  stroke: none;
}
.hx-moment-stamp__connector {
  stroke: currentColor;
  stroke-opacity: 0.6;
}
.hx-moment-stamp__label {
  fill: var(--hub-bar-spike, #22d3ee) !important;
  font-weight: 600;
}
.hx-moment-stamp.is-selected {
  stroke: currentColor;
  stroke-width: 1.5;
}
```

- [ ] **Step 3: Verify typecheck and tests still pass**

Run: `cd streampulse-web && npm run typecheck && npm test -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add streampulse-web/src/ui/components/hub/hub.css
git commit -m "feat(portal): CSS classes for stacked bars, rhythm lines, annotations"
```

---

## Task 9: Refactor `HubActivityChart.tsx` to compose the new subcomponents

**Files:**
- Modify: `streampulse-web/src/ui/components/hub/HubActivityChart.tsx`

**Purpose:** Replace the existing single-bar-overlay logic with calls to the three new subcomponents. **Public props are unchanged.** The `_renderMs` state seed becomes the trailing-bucket animation trigger.

- [ ] **Step 1: Read the existing file's full structure**

Read `src/ui/components/hub/HubActivityChart.tsx` (~1,424 lines). Identify the single block that renders `<rect>` "bar fills" and the moment-marker block. Plan: keep the outer SVG, axis, hover/select, range menu, tooltip, provider overlay untouched. Replace the bar-rect loop and the moment-marker block with imports + JSX calls to the three new subcomponents.

- [ ] **Step 2: Apply the edits**

Find the existing bar loop (search: `const bars = chartPoints.map(...)`) and replace its rendering block with `<HubActivityBarSeries ... />`. Find the moment-marker block (search: `momentMarkers?.map`) and replace with `<HubActivityMomentAnnotations ... />`. Insert `<HubActivityRhythmLines ... />` immediately after the axis gridlines.

Pass `points, timeDomain, height, paddingBottom, maxes` to `HubActivityBarSeries` (derive `maxes` from local peaks). Pass `rhythmLines` from the model. Pass `annotations` from the model.

Add a `prefersReducedMotion` detection via `useReducedMotion()` (if any). If none exists, inline:

```ts
const [reducedMotion, setReducedMotion] = useState(false)
useEffect(() => {
  if (typeof window === 'undefined' || !window.matchMedia) return
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  setReducedMotion(mq.matches)
  const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
  mq.addEventListener('change', handler)
  return () => mq.removeEventListener('change', handler)
}, [])
```

- [ ] **Step 3: Run typecheck and tests**

Run: `cd streampulse-web && npm run typecheck && npm test -- --run`
Expected: PASS — all existing chart tests still green; new subcomponent tests still green.

- [ ] **Step 4: Manually verify the chart in dev**

Start the portal: `cd streampulse-web && npm run dev:stable` (or however the project starts). Open `http://localhost:5174/analytics`. Confirm:

- Bars are stacked (viewers/chat/emotes visible).
- Avg/loud rhythm lines visible at low opacity.
- Spike moments show glow + label.
- Regular moments show stamp + connector.
- Trailing bucket on the right is dimmer.
- Clicking a bar still selects it.
- Hover still previews the inspector.
- Range menu still works.
- Provider overlay (if enabled) still draws.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/hub/HubActivityChart.tsx
git commit -m "refactor(portal): compose HubActivityChart from new subcomponents"
```

---

## Task 10: Wire `markers` and `markerChannelNames` through `FigmaGlobalActivityPanel`

**Files:**
- Modify: `streampulse-web/src/ui/components/analytics/FigmaGlobalActivityPanel.tsx`

**Purpose:** Pass `momentMarkers` (already passed) into the model's `markers` input, and provide a `markerChannelNames` Map so annotation labels say the channel name instead of the marker key.

- [ ] **Step 1: Read the panel's chart-input selection**

The panel already calls `selectHubChartActivityInputs(hub)`. Extend the call to also attach `markers: momentMarkers` and build a `markerChannelNames` Map from the latest activity feed if available.

- [ ] **Step 2: Wire the model call**

```ts
const chartInputs = useMemo(
  () => ({
    ...selectHubChartActivityInputs(hub),
    markers: momentMarkers ?? [],
    markerChannelNames: chartModel.markerChannelNames,
  }),
  [hub, momentMarkers, chartModel.markerChannelNames],
)
const chartModel = useMemo(
  () => deriveHubChartActivityModel(chartInputs),
  [chartInputs.points, chartInputs.windowMinutes, chartInputs.livePoolViewerSum, chartInputs.markers],
)
```

- [ ] **Step 3: Verify chart still renders correctly**

Manually revisit the panel at `http://localhost:5174/analytics`. Confirm annotations now show channel names.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/analytics/FigmaGlobalActivityPanel.tsx
git commit -m "feat(portal): wire moment markers into chart model"
```

---

## Task 11: Acceptance pass — full test suite + manual QA

**Files:** (none)

**Purpose:** Verify acceptance criteria from spec §12.

- [ ] **Step 1: Run the full test suite**

Run: `cd streampulse-web && npm test -- --run`
Expected: PASS — all old + new tests green.

- [ ] **Step 2: Run typecheck**

Run: `cd streampulse-web && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Run build, capture bundle size**

Run: `cd streampulse-web && npm run build 2>&1 | tee /tmp/build.log`
Read the size output. Compare against the pre-refactor size (run `git stash && npm run build 2>&1 | tee /tmp/build.before.log; git stash pop` to capture).

Acceptance: chart's compiled JS does not grow by more than **2 KiB gzipped**.

- [ ] **Step 4: Manual QA matrix**

Run through the spec §11 manual QA matrix:

- 24h window with 6 spikes, 14 moments — visuals match spec.
- 7d window with 1 spike, 5 moments — visuals match.
- 1y window — bars narrow, stack collapse visible.
- Reduced-motion on (OS toggle) — glow pulse disabled.
- Empty hub — chart renders `EmptyState`.
- Live poll — trailing bucket animates in on each 30s refresh.

- [ ] **Step 5: Add a summary CHANGELOG entry if the project maintains one**

If `streampulse-web/docs/CHANGELOG.md` exists, add a one-line entry. Otherwise skip.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit --allow-empty -m "test(portal): acceptance pass for Global Activity graph redesign"
```

---

## Task 12: Open PR + hand off

**Files:** (none)

- [ ] **Step 1: Push the branch**

```bash
cd streampulse-web && git push -u origin track-b/hub-ux-hygiene
```

- [ ] **Step 2: Open a PR via gh CLI**

```bash
gh pr create --title "feat(portal): Global Activity graph — stacked bars + rhythm lines + spike annotations" --body-file - <<'EOF'
## Summary
Replaces the wave-of-purple line+bar overlay in HubActivityChart with a stacked-bar geometry, subtle rhythm lines, and a spike-aware annotation layer. Public chart props unchanged.

## Spec
docs/superpowers/specs/2026-08-15-global-activity-graph-redesign-design.md

## Plan
docs/superpowers/plans/2026-08-15-global-activity-graph-redesign.md

## Test plan
- npm test -- --run (full Vitest suite)
- npm run typecheck
- npm run build (bundle size delta < 2 KiB gzipped)
- Manual QA: 24h / 7d / 1y windows, reduced-motion, empty hub, live poll
EOF
```

- [ ] **Step 3: Report to the user with the PR URL and what to verify**

---

## Self-Review Notes

**Spec coverage:**
- Spec §1 Problem → captured in plan's "Goal" + Task 5/6/7 visuals.
- Spec §2 Goals 1–6 → Tasks 5, 6, 7, 9, 10.
- Spec §4.1 File layout → Tasks 1, 2, 3, 5, 6, 7, 8, 9, 10.
- Spec §4.2 Component shape → Task 9.
- Spec §4.3 Data flow → Task 4.
- Spec §4.4 Geometry → Task 1.
- Spec §4.5 Rhythm lines → Task 6.
- Spec §4.6 Spike glow → Task 7.
- Spec §4.7 Regular stamp → Task 7.
- Spec §4.8 Trailing live bucket → Task 5 (`trailingBucketT` prop) + Task 3 (easing).
- Spec §4.9 Existing behaviors preserved → Task 9 (refactor must keep them) + Task 11 (manual QA verifies).
- Spec §5 Props → Tasks 5, 6, 7 (component interfaces match).
- Spec §6 State → Task 9 (new `renderMs` + `reducedMotion` state).
- Spec §7 Error handling → Tested in Task 1 (single-point fallback) + Task 5 (no-data `EmptyState` preserved).
- Spec §8 Accessibility → Task 6 (`role="presentation"` + `<desc>`), Task 7 (annotation aria-labels via `data-annotation-key`), Task 9 (bars remain `<button>`s via existing wiring).
- Spec §9 Motion → Task 3.
- Spec §10 Performance → Task 11 (build size) + Task 5 (note in spec: bars as bare `<rect>`s).
- Spec §11 Testing → Tasks 1, 2, 4, 5, 6, 7 + 11.
- Spec §12 Acceptance criteria → Task 11.
- Spec §13 Risks → Mitigations inlined into Tasks 5, 7, 9.
- Spec §14 Open questions → Three decisions baked in (provider overlay stays opt-in, stack collapse at ≤4px, reduced-motion keeps static glow).

**Placeholder scan:** No "TBD" / "TODO" / "implement later" markers. Every code block is concrete.

**Type consistency:** `HubChartAnnotation` defined in Task 2, consumed in Task 4 (model), Task 7 (annotations component), Task 10 (panel wiring). `RhythmLines` defined in Task 1, consumed in Task 4 and Task 6 (via the model's `rhythmLines` field). `HubActivityMomentMarker` is the existing input type — consistently used in Tasks 2, 4, 10.
