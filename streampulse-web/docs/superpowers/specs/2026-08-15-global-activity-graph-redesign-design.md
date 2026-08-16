# Global Activity graph — redesign

**Date:** 2026-08-15
**Status:** Approved for planning
**Owners:** portal frontend (`streampulse-web`)
**Scope:** The chart geometry inside `FigmaGlobalActivityPanel` (the `/analytics` center panel). The right-rail `ActivityBucketInspector` and the lower `PulseMomentsLivePanel` are deliberately out of scope and remain unchanged.

---

## 1. Problem

The current Global Activity chart is a single line+bar overlay dominated by a "wave of purple". It carries three series — viewers, chat/min, emotes/min — but visually they collapse into one mushy curve. The viewer doesn't get a story at a glance:

- Peaks are not distinguished from baseline.
- The "moments" surface (small markers) is too subtle to register.
- The chart is static-looking between polls, even though the underlying data updates every 30 seconds.
- The chart sits alone above a separate Live Wire annotation lane and a separate Pulse Moments table — the same data is described three times in three visual languages.

The user wants a chart that (a) tells a story at a glance, (b) makes spikes feel alive, (c) keeps the existing inspector and Pulse Moments table untouched.

## 2. Goals

1. **Bars over lines.** Each bucket is a stacked contribution bar — viewers (purple) is the base, chat (cyan) is the middle segment, emotes (yellow) is the top segment. The bar's *shape* is the moment's fingerprint: a tall purple-only bar is a viewer surge; a tall cyan-heavy bar is chat hysteria.
2. **Spike moments feel alive.** Server-classified spike kinds (`chat_spike`, `emote_spike`, `viewer_spike`) get a glow halo on the bar and a glyph label.
3. **Regular moments are quiet.** Non-spike moments get a small stamp above the bar with a dotted connector.
4. **Subtle rhythm reference.** Two horizontal dashed lines mark the "avg" and "loud" basins for the active window. They are computed locally from the visible chart and exist as a constant yardstick, not data.
5. **Live trailing bucket.** The most recent (in-progress) bucket renders at 40% opacity and animates in on each 30-second poll.
6. **Do not touch the inspector or Pulse Moments table.** The right rail and the table below the chart stay as they are.

## 3. Non-goals

- Server-side spike detection. The server already emits pre-classified moment kinds; the frontend does not and will not compute spikes.
- Replacing the Live Wire annotation lane above the chart. Live Wire stays.
- Replacing the right-rail inspector.
- Replacing the Pulse Moments Live panel below the chart.
- A separate emote-provider overlay chart (today's `showProviderOverlay` toggle). We preserve it but it stays behind the same opt-in.

## 4. Architecture

### 4.1 File layout

```
src/ui/components/analytics/
├── FigmaGlobalActivityPanel.tsx          (existing; small wiring change)
├── HubActivityChart.tsx                  (existing; refactor — see 4.2)
├── HubActivityChart.test.tsx             (new; replaces any chart-internal tests)
├── FigmaSessionAnalytics.tsx (n/a)
└── analytics-hub-home.css                (existing; new token classes)

src/lib/
├── hubActivitySummary.ts                 (existing; unchanged)
├── hubChartActivityModel.ts              (existing; new exported helpers)
├── hubChartGeometry.ts                   (new; pure geometry — bar x/width, rhythm lines)
└── hubChartMarkers.ts                    (new; moment classifier + spike detection OR mapping)
```

### 4.2 Component shape

`HubActivityChart` becomes a composition of three small subcomponents:

- **`HubActivityBarSeries`** — renders the stacked bars from a `HubActivityPoint[]`. Pure presentational. Owns no state. Receives `points`, `windowMinutes`, `rangeColor`, `dims`, `highlight?.barT`.
- **`HubActivityRhythmLines`** — renders the two horizontal reference lines ("avg", "loud"). Computes the y-position of each from the visible `points` so the lines are stable for the current window. Pure presentational.
- **`HubActivityMomentAnnotations`** — renders the moment layer (glow halos for spikes, stamps for regular moments, glyph labels). Receives `annotations: HubChartAnnotation[]` (pre-classified) and y-position helpers.

`HubActivityChart` keeps:
- The outer SVG, axis ticks, bucket selection cue, hover/click handlers, range menu, tooltip, and existing provider overlay.
- All accessibility wiring (keyboard nav for buckets, ARIA labels, focusable bars).
- The trailing live bucket animation hook.

The existing `HubActivityChart.tsx` is 1,424 lines. The refactor must not increase that size. The three new subcomponents together should be ≤ 600 lines combined, and `HubActivityChart.tsx` should drop to ≤ 900 lines.

### 4.3 Data flow

```
PublicHub.activity.points  ──┐
PublicHub.activity.windowMinutes ──┤
                              ├─►  selectHubChartActivityInputs(hub)
                              │          ↓
                              │   HubChartActivityInputs
                              │          ↓
                              │   deriveHubChartActivityInputs(input)
                              │          ↓
                              │   HubChartActivityModel {
                              │     chartPoints, peakViewers, peakChatPerMin,
                              │     peakEmotesPerMin, rhythmLines, annotations
                              │   }
                              │          ↓
                              │   HubActivityChart ──►  BarSeries, RhythmLines, Annotations
                              │
momentMarkers + moment kind ──┘
```

`HubChartActivityModel.annotations` is the new pre-classified list. Each item:

```ts
export type HubChartAnnotationKind = 'spike' | 'moment';

export interface HubChartAnnotation {
  key: string;
  bucketT: number;
  at?: number;             // exact ms if known
  kind: HubChartAnnotationKind;
  channelName: string;
  channelDisplayName?: string;
  emoteName?: string;
  emoteUrl?: string;
  channelLabel?: string;   // toggle accent (peak value)
  metrics?: {
    viewers?: number;
    chatPerMin?: number;
    emotesPerMin?: number;
  };
  source: 'network' | 'fallback';
}
```

The classification rule: a `HubActivityMomentMarker` whose `kind` is one of `chat_spike`, `emote_spike`, `viewer_spike` (lowercased, trimmed) maps to `kind: 'spike'`. Everything else maps to `kind: 'moment'`. The mapping lives in `hubChartMarkers.ts` as a single function `classifyMomentMarker(marker): HubChartAnnotationKind`.

The function is unit-tested with a table of inputs.

### 4.4 Geometry

`HubChartGeometry` is a pure module. It owns:

- `barBucketX(t, points, windowMinutes, dims)` — returns the x-left of the bar for a given bucket time.
- `barWidth(windowMinutes, dims)` — fixed bar width per window (1min in 24h = >1px; 1mo has many buckets and bars get narrower; cap at 50px, floor at 3px).
- `barY(viewers, dims)` — inverse of `viewersY → y`.
- `rhythmLineY(chartPoints, mode: 'avg' | 'loud', dims)` — `avg` = median of chart viewers, `loud` = 90th percentile of chart viewers. Computed once per render, memoized.
- `trailingBucketX(chartPoints, dims)` — x position of the in-progress trailing bucket.

The bar width adapts to bucket count: from 50px at 30m window down to 3px at 1y window. When bars get too narrow, the chat/emote stack segments collapse to a single colored cap (the "stack collapses" rule).

### 4.5 Rhythm lines

`avg` and `loud` are computed from the visible chart points only — not the trailing live bucket. Median for avg (robust to extreme peaks), 90th percentile for loud. Both rendered as `stroke-dasharray="2,4"`, `stroke-opacity: 0.10` (avg) and `0.16` (loud). Right-aligned end labels at 8px font. No data label inside the chart area.

### 4.6 Spike glow

The glow is a radial gradient ellipse on the bar's bucket — three concentric ellipses with decreasing opacity at fixed ratios (0.10, 0.18, 0.30). The center of the glow is the geometric center of the bar. The radius is proportional to the bar's height (clamped: 1× to 1.5× the bar height at 100% scale). Animation: opacity 0 → target on a 320ms ease-out, then a 1.2s pulse that drops to 92% and back, repeating infinitely. Honors `prefers-reduced-motion` — no pulse, no entry fade.

A glyph label (the channel name or emote name, whichever is shorter) sits above the bar with a thin dotted connector. The label is rendered only when the bucket is visible AND the bar is visible AND the bucket is not the trailing live bucket. Hide rule: skip the label if its x-position is within 30px of the chart's left or right edge (would clip) or within 24px of another visible annotation label (would collide). The label fades in (opacity 0 → 1, 200ms ease-out) on the first frame after the bucket enters the viewport via `IntersectionObserver` on the chart's outermost `<svg>`.

When two annotations conflict on the same bucket-x, the later one (in chronological order) is rendered at 0.4 opacity with its label omitted. The remaining label is the earlier one. This is independent of the chart's existing bucket collision cue.

### 4.7 Regular moment stamp

A 26×14 rounded rectangle with the emote name (or channel display name if no emote) sits 6px above the bar. A dotted 1px line drops from the stamp to the top of the bar. Stamps are rendered in batched order (zIndex = annotation layer) and never overlap each other — if two stamps would collide horizontally, the later one is dimmed (`opacity: 0.4`) and its label is omitted. This is a simple greedy collision pass in `hubChartMarkers.ts` (`resolveAnnotationCollisions(annotations): Annonation[]`).

### 4.8 Trailing live bucket

The bucket is rendered at 40% opacity. When a poll fires, the new bucket's height animates from 0 → final height on a 700ms ease-out. There's no flash, no shimmer — just the bar growing. The "live" label sits below the bar in 8px text. When the chart's active window changes (24h → 7d), the trailing bucket snaps to its new position (no animation across windows).

### 4.9 Existing behaviors preserved

The following behaviors are part of the existing chart and must not regress:

- Bucket selection (click → filter Pulse Moments).
- Bucket hover (preview inspector rail).
- Range menu (24h / 7d / 1mo / 3mo / 6mo / 1yr).
- Provider overlay (`showProviderOverlay` opt-in).
- Keyboard navigation (arrow keys walk buckets).
- Tooltip with bucket totals + emote thumbnails.
- Focus dimming (focus a series, others dim).
- Bucket axis ticks and labels.
- Missing-bucket coverage shading.

## 5. Props design

`HubActivityChart` props are unchanged from a caller perspective, except `rangeControl` and `missingBuckets` continue to work. Internal subcomponents are only exportable for tests.

```ts
// HubActivityBarSeries
export interface HubActivityBarSeriesProps {
  points: HubActivityPoint[];
  windowMinutes: number;
  dims: { width: number; height: number; paddingBottom: number };
  focusedSeriesKey: CoreSeriesKey | null;
  highlightBarT?: number | null;
  selectedBarT?: number | null;
  pulseEmoteStackAtT?: number | null;
}

// HubActivityRhythmLines
export interface HubActivityRhythmLinesProps {
  points: HubActivityPoint[];
  excludeTrailingBucket?: boolean;
  dims: { width: number; height: number; paddingBottom: number };
}

// HubActivityMomentAnnotations
export interface HubActivityMomentAnnotationsProps {
  annotations: HubChartAnnotation[];
  points: HubActivityPoint[];
  windowMinutes: number;
  dims: { width: number; height: number; paddingBottom: number };
  reducedMotion: boolean;
  onSelectMoment?: (key: string) => void;
  selectedAnnotationKey?: string | null;
}
```

PublicHub.input changes: none. The chart derives everything from existing fields.

## 6. State management

No new state on a parent component. All state is local to `HubActivityChart`:

- `focusedSeriesKey` (existing).
- `hoverBarT` (existing).
- `selectedBarT` (existing, lifted to parent).
- `accentBarT` (existing, lifted to parent).
- `bucketSelectEnabled` (existing).
- `renderMs` (new) — set on each successful poll, used to trigger the trailing bucket animation. Reset to `null` on window change.

The collision resolution in `hubChartMarkers.ts` is a pure function, no state.

## 7. Error handling

- **Hot module replacement**: `HubActivityChart` must tolerate a prop change that swaps `points` while the chart is mid-animation. The trailing bucket animation on the new bar starts from the previous bar's height if the bucket is the same one, otherwise from 0.
- **Empty window**: when `points.length === 0`, the chart renders the existing `EmptyState` (no geometry). The rhythm lines and annotations render nothing.
- **Single-point window**: rhythm lines omit the `loud` line (90th percentile is undefined); `avg` falls back to the single value.
- **Missing bars**: existing coverage shading stays. No new shading.
- **Out-of-range annotations**: if an annotation's `bucketT` doesn't match any point, it's anchored to the bar at-or-before the time, with a tiny arrow pointing right. Two unit tests cover this.

## 8. Accessibility

- Each bar is a `<button>` with `role="button"`, `aria-label="<channel> · <time> · <viewers> viewers"`. Existing keyboard navigation (arrow keys) is preserved.
- Spike glows are `aria-hidden="true"` — the bar carries the announcement.
- Rhythm lines render inside `<g role="presentation">` with a single `<desc>` element describing them.
- The trailing live bucket has `aria-live="polite"` and an `aria-label` of "Current minute, updating live."
- The stamp labels use `<text>` with `aria-label` only when truncated.
- Existing focus management is preserved; no new focus targets are introduced.

## 9. Motion

All motion is gated by `prefers-reduced-motion`:

- **Trailing bucket growth**: 700ms ease-out from 0 → final height. Disabled under reduced-motion.
- **Spike glow entry**: 320ms ease-out from 0 → target alpha. Disabled under reduced-motion.
- **Spike glow pulse**: 1.2s sine, 92% → 100% alpha. Disabled under reduced-motion.
- **Range menu change**: existing fade of `plotRef`. Preserved.
- **Bucket selection cue**: existing. Preserved.

All easing curves are explicit constants in `lib/chartMotion.ts`:

```ts
export const CHART_MOTION = {
  trailingBucket: { duration: 700, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  spikeGlowEnter: { duration: 320, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
  spikeGlowPulse: { duration: 1200, easing: 'ease-in-out' },
};
```

## 10. Performance

- `HubChartActivityModel` derivation is memoized on `[points, windowMinutes, livePoolViewerSum]`. Existing.
- The bar `rect` elements are rendered as bare SVG, not React components per bar. One `<g>` containing N `<rect>`s. The pre-refactor chart already does this.
- The annotations are at most ~20 elements in any window. Rendering 20 SVG elements on each poll is well under the 16ms budget.
- The collision pass is O(N) over annotations, runs once per render.
- The rhythm-line statistic is computed once per points swap, not per frame.

## 11. Testing

Existing tests:

- `tests/hubActivitySummary.test.ts` — unchanged.
- `tests/hubChartActivityModel.test.ts` — extended with `deriveHubChartActivityModel` tests for the new `rhythmLines` and `annotations` fields.

New tests:

- `src/lib/hubChartGeometry.test.ts` — table-driven: bucket-to-x across widths, bar width across windows, trailing-bucket x, single-point fallback.
- `src/lib/hubChartMarkers.test.ts` — `classifyMomentMarker` table-driven; `resolveAnnotationCollisions` table-driven (no overlap, two-collision chain, mixed spike+moment).
- `src/ui/components/analytics/HubActivityBarSeries.test.tsx` — empty, single, many; stack collapse at narrow widths; focused-series dimming.
- `src/ui/components/analytics/HubActivityRhythmLines.test.tsx` — two lines, single-point fallback, trailing-bucket excluded.
- `src/ui/components/analytics/HubActivityMomentAnnotations.test.tsx` — spike glow renders, regular stamp renders, collision dimming, reduced-motion skips pulse.

Manual QA matrix:

- 24h window with 6 spikes, 14 moments.
- 7d window with 1 spike, 5 moments.
- 1y window — bars get narrow, stack collapses.
- Reduced-motion on.
- Empty hub (no IRC collectors).
- Live poll while chart is mid-animation.

## 12. Acceptance criteria

1. `HubActivityChart` renders the new geometry (stacked bars + rhythm lines + annotations) with no regression in the inspector, Pulse Moments, or Live Wire.
2. Spike moments (`chat_spike`, `emote_spike`, `viewer_spike`) render with a glow halo and glyph label.
3. Non-spike moments render with a small stamp and dotted connector.
4. Rhythm lines ("avg" / "loud") appear within the chart and update with the window.
5. The trailing live bucket is dimmer and animates in on each poll.
6. All existing chart interactions work: select, hover, range menu, provider overlay, keyboard nav, tooltip.
7. `prefers-reduced-motion: reduce` disables the spike glow pulse and the entry animation.
8. All new code has unit tests. Existing tests pass.
9. Bundle size: the chart's compiled JS does not grow by more than 2 KiB (gzipped).
10. Visual check: a senior frontend engineer reviewing the page for the first time can describe the chart's story ("there's a peak around 8:42 AM, chat-driven, on Fanum") without clicking anything.

## 13. Risks

- **Per-bar React boundaries**: drawing 30+ bars individually in React can hit 16ms. Mitigation: keep bars as bare `<rect>`s inside one `<g>`. Existing.
- **SVG element count**: each spike adds ~6 elements (3 ellipses + rect + label + line). Worst case 20 spikes × 6 = 120 elements. Acceptable.
- **Annotation overlap on dense windows**: the collision dimmer is a UX mitigation, not a fix. If users see many dimmed stamps, that's a signal to consider a "show >5 moments" toggle. Not in this spec.
- **Trailing bucket animation timing**: requires a stable `renderMs` that resets when window changes. One source of truth, lifecycle-managed in `useEffect`.

## 14. Open questions

- **Provider overlay under the new geometry**: does the per-provider line still draw on top of the bars? Recommendation: yes, same dashed lines, but opt-in via `showProviderOverlay`. No change in this spec.
- **Stack collapse threshold**: at 3px bar width, the chat/emote segments collapse to a single cap. Is that the right threshold? Recommendation: 4px or fewer means collapse. Defer to implementation tuning.
- **Reduced-motion pulse**: should the entire glow be removed under reduced-motion, or just the pulse? Recommendation: keep the static glow, drop the pulse and entry animation. Trades "I don't see a spike" for "I see it but it's not animated."
