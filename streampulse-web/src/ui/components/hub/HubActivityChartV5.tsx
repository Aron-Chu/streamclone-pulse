/**
 * The hub activity card (plan §2.3 U6, d3-v2 hub.html #activity) on the
 * shared SpChart core: header row (heading, window seg, series chips,
 * "bars N-min avg", the (i)), the Now/hover readout, the chart with the stamp
 * and moment markers as layers, the d3 navigator, and the provider lanes.
 *
 * - Bars sit on the served bucket grid (`activity.bucketMinutes`, clock
 *   aligned); wider bars average whole buckets. No peak caps (F3).
 * - A bar click toggles the shared hub bucket selection (lib/hubBucketSelection);
 *   the card (U7) reads it. A 'latest' selection (Show on chart) pans to it.
 * - The chart bridge and the gesture flag are registered here.
 * - Per frame nothing renders: the chart, the navigator and the lanes follow
 *   the viewport store by direct writes; React commits only on settle.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Activity } from 'lucide-react'
import {
  SpChart,
  barAt,
  buildSpLevels,
  createSpHoverStore,
  createSpViewportStore,
  overviewPath,
  type SpChartHandle,
  type SpHit,
  type SpHoverStore,
  type SpLayer,
  type SpSelSlide,
  type SpSelection,
  type SpViewportStore,
} from '@streampulse/pulse-charts/spchart'
import { spMark } from '@streampulse/pulse-charts/perfMarks'
import type { HubActivityPoint, HubProviderCoverageMap } from '../../../lib/publicHub'
import {
  activityBucketMs,
  assessViewerCoverage,
  chartActivityPoints,
  formatActivityWindowLabel,
  hasViewerSample,
  isViewerCoverageQualified,
  maxConnectedGapMs,
  resolveHubActivityChartState,
} from '../../../lib/hubActivitySummary'
import { isAttestedActivityGap } from '../../../lib/hubActivityHonesty'
import { hubCardClock } from '../../../lib/hubBucketCardModel'
import {
  clearHubBucketSelection,
  escapeHubBucketSelection,
  hubBucketSelectionStore,
  selectHubBucket,
  setHubChartBridge,
  setHubGestureActive,
  toggleHubBucket,
} from '../../../lib/hubBucketSelection'
import { EmptyState, Skeleton } from './primitives'
import { HubRangeMenu, type HubActivityRangeControl } from './HubRangeMenuV5'
import { HubChartNavigator, type HubChartNavigatorPreset } from './HubChartNavigator'
import { HubToggletip } from './d3/HubToggletip'
import { HubActivityReadout, type HubReadoutSeries } from './HubActivityReadout'
import { HubProviderLanes } from './HubProviderLanes'
import { hubMarkersLayer, hubStampLayer } from './HubActivityLayers'
import { buildHubActivitySpModel, type HubActivitySpModel } from './hubActivitySpModel'
import '../../charts/sp-chart.css'
import '../../charts/sp-navigator.css'
import './hub-activity-d3.css'

export type { HubActivityRangeOption, HubActivityRangeControl } from './HubRangeMenuV5'

export interface HubActivityMomentMarker {
  key: string
  bucketT: number
  /** Exact event time in ms when known — markers use this, not a neighboring bucket. */
  at?: number
  kind?: string
}

export interface HubActivityChartProps {
  points: HubActivityPoint[]
  windowMinutes: number
  channelCount: number
  /** Live pool size for chart copy (corpus-wide series, pool-sized roster). */
  poolSize?: number
  /** Current live-pool sum shown as a separate KPI; never used to fill history. */
  livePoolViewerSum?: number
  expectedBuckets?: number
  missingBuckets?: number
  coveragePct?: number
  /** Honest empty-state copy when the hub serves an attested gap / no activity. */
  emptyTitle?: string
  emptyDescription?: string
  /** Backend payload contract issue; do not render misleading chart geometry. */
  dataIssue?: string | null
  loading?: boolean
  footnote?: string
  /** The activity window seg (30m / 24h / 7d, plus an active URL-only window). */
  rangeControl?: HubActivityRangeControl
  /** Fresh breakouts mounted between the readout and the plot. */
  annotationLane?: ReactNode
  /** Unix ms of a bucket the page selected; selects it (source 'latest') and pans to it. */
  selectedBucketT?: number | null
  /** A bucket tied to a moment row (Show on chart); selected and panned to like selectedBucketT. */
  accentBucketT?: number | null
  /** Kept for the page's props; bar clicks write the shared hub bucket selection instead. */
  onBucketSelect?: (bucketT: number | null) => void
  /** Hover preview: the hovered bar's start (unix ms), or null. */
  onBucketHover?: (bucketT: number | null) => void
  /** Moment markers: one hairline tick per marker at the top of the plot. */
  momentMarkers?: HubActivityMomentMarker[]
  selectedMomentKey?: string | null
  onSelectMomentKey?: (key: string | null) => void
  /** Kept for the page's props (the d3 card draws provider lanes, not overlays). */
  showProviderOverlay?: boolean
  /** Aggregate provider-completeness assertion from the activity payload. */
  providerTotalsComplete?: boolean
  /** Lowercase emote name → image URL, for the readout and the stamp. */
  emoteImages?: Map<string, string>
  /** `activity.bucketMinutes` from the API: the finest bar. */
  bucketMinutes?: number | null
  /** `activity.providerCoverage` from the API: lower-bound flags for the lanes. */
  providerCoverage?: HubProviderCoverageMap | null
  /** Opens "How this is measured" (the (i) link). */
  onOpenMeasured?: () => void
  /** The settled bar size, for "How this is measured" (bucket and bar minutes). */
  onBarsChange?: (bars: HubActivityBars) => void
}

export interface HubActivityBars {
  bucketMinutes: number
  levelMinutes: number
}

export type CoreSeriesKey = 'viewers' | 'chat' | 'emotes'

/** Phone layout (d3-v2 hub.html @media (max-width:719px)). */
const HUB_CHART_COMPACT_MQ = '(max-width: 719px)'
const PLOT_HEIGHT = { wide: 420, compact: 300 } as const
const TICK_COLUMN = { wide: 68, compact: 44 } as const
/**
 * Narrowest view: two served buckets, prod's hub floor (ChartNavigator's
 * default, held by the wave-1 wheel matrix: "reached the zoom floor" <= 2).
 * The mockup's 60-min minSpan (d3-v2 hub.js) is not adopted: it would be an
 * unflagged behaviour change (plan §1.6), and Aron asked for deep re-bucketing.
 */
const MIN_VISIBLE_BUCKETS = 2
/** Marks the plot rows (SpChart's `.spc-plot`, the ancestor of every plot hit target) for specs and audits. */
const WHEEL_SURFACE_ATTR = 'data-hub-chart-wheel-surface'
/** pickBarLevel options as the mockup's pickStep: 5 px slots, 0.85 tolerance. */
const BAR_OPTIONS = { tolerance: 0.85 } as const
/** R5-8 (Aron 2026-10-15): the session page's sliding band marks the selected bar (190 ms; reduced motion jumps). */
const SEL_SLIDE: SpSelSlide = {}
const SERIES_KEYS: readonly CoreSeriesKey[] = ['chat', 'emotes', 'viewers']
const SERIES_CHIP_LABELS: Record<CoreSeriesKey, string> = {
  chat: 'Chat/min',
  emotes: 'Emotes/min',
  viewers: 'Viewers (sample)',
}

function presetsForBucket(windowMinutes: number, pointCount: number, bucketMinutes: number): HubChartNavigatorPreset[] {
  const durations = windowMinutes <= 30
    ? [{ label: '5m', minutes: 5 }, { label: '15m', minutes: 15 }]
    : windowMinutes <= 24 * 60
      ? [{ label: '1h', minutes: 60 }, { label: '6h', minutes: 360 }, { label: '12h', minutes: 720 }]
      : [{ label: '6h', minutes: 360 }, { label: '1d', minutes: 1440 }, { label: '3d', minutes: 4320 }]
  const seen = new Set<number>()
  return durations.flatMap(({ label, minutes }) => {
    const presetPointCount = Math.max(2, Math.round(minutes / bucketMinutes))
    if (presetPointCount >= pointCount || seen.has(presetPointCount)) return []
    seen.add(presetPointCount)
    return [{ label, pointCount: presetPointCount }]
  })
}

export function hubNavigatorPresets(
  windowMinutes: number,
  pointCount: number,
): HubChartNavigatorPreset[] {
  const bucketMinutes = Math.max(1, activityBucketMs(windowMinutes) / 60_000)
  return presetsForBucket(windowMinutes, pointCount, bucketMinutes)
}

/** A viewer value is measured only when the backend attests a viewer rollup or
 * supplies a positive sample. Zero in an activity bucket is not a measured
 * zero; it is an unavailable sample and must remain visibly distinct. */
export function formatIncompleteCoveragePercent(
  pointCount: number,
  expectedBuckets: number,
): string {
  const expected = Math.max(0, Math.floor(expectedBuckets))
  const measured = Math.max(0, Math.floor(pointCount))
  if (expected === 0) return '0%'
  if (measured >= expected) return '100%'
  const pct = Math.floor(((measured / expected) * 100) * 10) / 10
  return `${pct.toFixed(1)}%`
}

/**
 * Display-only median filter for lower-confidence viewer trends. Hover values
 * and coverage-qualified peaks remain raw. Gaps and coverage-state boundaries
 * are hard stops, so smoothing cannot fabricate continuity.
 */
export function viewerTrendDisplayValues(
  source: HubActivityPoint[],
  windowMinutes: number,
): number[] {
  const maxGap = maxConnectedGapMs(windowMinutes)
  const sampled = source.map((point) => hasViewerSample(point) && !isAttestedActivityGap(point))
  const qualified = source.map(isViewerCoverageQualified)
  return source.map((point, index) => {
    if (!sampled[index]) return point.viewers
    // A gap elsewhere must not enable median filtering of verified peaks.
    if (qualified[index] && assessViewerCoverage(point).quality === 'complete') return point.viewers
    const previous = source[index - 1]
    const next = source[index + 1]
    if (
      !previous || !next || !sampled[index - 1] || !sampled[index + 1]
      || qualified[index - 1] !== qualified[index]
      || qualified[index + 1] !== qualified[index]
      || point.t - previous.t > maxGap
      || next.t - point.t > maxGap
    ) {
      return point.viewers
    }
    const values = [previous.viewers, point.viewers, next.viewers].sort((a, b) => a - b)
    return values[1] ?? point.viewers
  })
}

/* ---------- labels ---------- */

const SHORT_WINDOW_LABELS: Record<number, string> = {
  30: '30 min',
  1440: '24 h',
  10080: '7 days',
}

/** The heading's window: "24 h" (d3-v2 "Activity · last 24 h"), from the served window. */
export function hubActivityWindowShort(minutes: number): string {
  const known = SHORT_WINDOW_LABELS[minutes]
  if (known) return known
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))} min`
  if (minutes % 1440 === 0) return `${minutes / 1440} days`
  if (minutes % 60 === 0) return `${minutes / 60} h`
  return formatActivityWindowLabel(minutes)
}

/** The chart's accessible window: "24 hours" (d3-v2 hub.js ariaLabel). */
export function hubActivityWindowLong(minutes: number): string {
  if (minutes === 1440) return '24 hours'
  if (minutes % 1440 === 0 && minutes > 1440) return `${minutes / 1440} days`
  return formatActivityWindowLabel(minutes)
}

export function hubActivityHeading(minutes: number): string {
  return `Activity · last ${hubActivityWindowShort(minutes)}`
}

export function hubActivityAriaLabel(minutes: number): string {
  return `Activity, last ${hubActivityWindowLong(minutes)}. Arrow keys move the cursor, plus and minus zoom, 0 resets, Enter selects a bucket. With a card open, left and right step; Escape closes.`
}

/** The (i) under "About this chart" (d3-v2 hub.js barText). */
export function hubActivityTip(bucketMinutes: number, step: number): string {
  return `Tracked channels only. Each interval is ${bucketMinutes} minutes; ${step <= 1 ? 'one bar each.' : `bars average ${step}.`}`
}

/** The navigator's zoomed heading (d3-v2 shared.js spanLabel). */
export function hubSpanLabel(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h}h ${r}m` : `${h} h`
}

function navigatorTimeLabel(ms: number, windowMinutes: number): string {
  // A full day starts and ends on the same clock time, so 24 h and longer name the date too (screen-reader range only).
  if (windowMinutes < 24 * 60) return hubCardClock(ms)
  const date = new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
  return `${date} ${hubCardClock(ms)}`
}

/* ---------- hooks ---------- */

function readCompact(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(HUB_CHART_COMPACT_MQ).matches
}

function useHubChartCompact(): boolean {
  const [compact, setCompact] = useState(readCompact)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(HUB_CHART_COMPACT_MQ)
    const update = () => setCompact(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return compact
}

const noSelection = () => hubBucketSelectionStore.getServerSnapshot()

type SpBarLevel = ReturnType<typeof buildSpLevels>[number]
/** The built level whose slot is `minutes` long (the settled level the chart reported), else the finest. */
function levelAt(levels: readonly SpBarLevel[], minutes: number): SpBarLevel | null {
  return levels.find((level) => Math.round(level.slotMs / 60_000) === Math.round(minutes)) ?? levels[0] ?? null
}

/* ---------- header ---------- */

interface HeaderProps {
  windowMinutes: number
  rangeControl?: HubActivityRangeControl
  series?: HubReadoutSeries
  onToggleSeries?: (key: CoreSeriesKey) => void
  bucketMinutes?: number
  levelMinutes?: number
  onOpenMeasured?: () => void
}

function HubActivityHeader({ windowMinutes, rangeControl, series, onToggleSeries, bucketMinutes, levelMinutes, onOpenMeasured }: HeaderProps) {
  const step = bucketMinutes && levelMinutes ? Math.max(1, Math.round(levelMinutes / bucketMinutes)) : 1
  return (
    <div className="rh hx-chart-summary" data-hub-activity-header="">
      <h2>{hubActivityHeading(windowMinutes)}</h2>
      {rangeControl ? <HubRangeMenu control={rangeControl} /> : null}
      {series && onToggleSeries ? (
        <div className="toggles hx-chart-series-labels" role="group" aria-label="Series">
          {SERIES_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className="tg"
              data-hub-series-chip=""
              data-s={key}
              aria-pressed={series[key]}
              onClick={() => onToggleSeries(key)}
            >
              <i className={`sw ${key}`} aria-hidden="true" />
              {SERIES_CHIP_LABELS[key]}
            </button>
          ))}
        </div>
      ) : null}
      {bucketMinutes && levelMinutes ? (
        <>
          <span className="meta" data-hub-bars-note="">bars {levelMinutes}-min avg</span>
          <span className="hub-act-info">
            <HubToggletip label="About this chart" tip={hubActivityTip(bucketMinutes, step)} onOpenMeasured={onOpenMeasured} />
          </span>
        </>
      ) : null}
    </div>
  )
}

/* ---------- navigator host ---------- */

interface NavigatorHostProps {
  model: HubActivitySpModel
  store: SpViewportStore
  windowMinutes: number
  levelMinutes: number
  minVisibleCount: number
  wheelSurfaceRef: RefObject<HTMLElement | null>
  wheelAnchor: () => Element | null
}

function HubActivityNavigator({ model, store, windowMinutes, levelMinutes, minVisibleCount, wheelSurfaceRef, wheelAnchor }: NavigatorHostProps) {
  const target = useSyncExternalStore(store.subscribeTarget, store.getTarget, store.getTarget)
  const { startMs } = model.data
  const startLabel = navigatorTimeLabel(startMs + target.startIndex * model.bucketMs, windowMinutes)
  const endLabel = navigatorTimeLabel(startMs + (target.endIndex + 1) * model.bucketMs, windowMinutes)
  const visibleMinutes = (target.endIndex - target.startIndex + 1) * model.bucketMinutes
  const overview = useMemo(() => overviewPath(model.data.chat, 1000, { coverage: model.data.coverage }), [model])
  const presets = useMemo(() => presetsForBucket(windowMinutes, model.count, model.bucketMinutes), [windowMinutes, model.count, model.bucketMinutes])
  const onReset = useCallback(() => store.setTarget({ startIndex: 0, endIndex: store.getCount() - 1 }, { animate: true }), [store])
  return (
    <HubChartNavigator
      variant="d3"
      viewportSource={store}
      overview={overview}
      pointCount={model.count}
      startIndex={target.startIndex}
      endIndex={target.endIndex}
      startLabel={startLabel}
      endLabel={endLabel}
      presets={presets}
      wheelSurfaceRef={wheelSurfaceRef}
      wheelAnchor={wheelAnchor}
      minVisibleCount={minVisibleCount}
      onChange={noop}
      onReset={onReset}
      fullRangeLabel={`Full ${hubActivityWindowShort(windowMinutes)}`}
      zoomedRangeLabel={hubSpanLabel(visibleMinutes)}
      unitLabel={`${model.bucketMinutes}-min buckets`}
      readoutNote={`bars ${levelMinutes}-min`}
    />
  )
}

function noop() {}

/* ---------- the ready card ---------- */

interface ReadyProps {
  model: HubActivitySpModel
  windowMinutes: number
  rangeControl?: HubActivityRangeControl
  annotationLane?: ReactNode
  externalBucketT: number | null
  onBucketHover?: (bucketT: number | null) => void
  momentMarkers?: HubActivityMomentMarker[]
  emoteImages?: Map<string, string>
  onOpenMeasured?: () => void
  onBarsChange?: (bars: HubActivityBars) => void
}

function HubActivityReady({ model, windowMinutes, rangeControl, annotationLane, externalBucketT, onBucketHover, momentMarkers, emoteImages, onOpenMeasured, onBarsChange }: ReadyProps) {
  const compact = useHubChartCompact()
  const plotHeight = compact ? PLOT_HEIGHT.compact : PLOT_HEIGHT.wide
  const tickColumn = compact ? TICK_COLUMN.compact : TICK_COLUMN.wide
  const [series, setSeries] = useState<HubReadoutSeries>({ chat: true, emotes: true, viewers: true })
  // Buckets per bar at the settled level (onLevel fires when it changes); a new bucket length keeps it.
  const [levelStep, setLevelStep] = useState(1)
  const levelMinutes = levelStep * model.bucketMinutes
  useEffect(() => {
    onBarsChange?.({ bucketMinutes: model.bucketMinutes, levelMinutes })
  }, [onBarsChange, model.bucketMinutes, levelMinutes])
  const chartRef = useRef<SpChartHandle>(null)
  const stackRef = useRef<HTMLDivElement>(null)
  /** Box-only hook with the exact plot box (PW x H): the wheel anchor and the bridge's bounds. */
  const plotBoxRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef(model)
  modelRef.current = model
  // The chart's bar levels (the served grid, UTC-aligned, as SpChart builds them): the card's ‹ › stepper reads them.
  const levels = useMemo(
    () => buildSpLevels(model.data, 0, Math.max(1, Math.round((model.bucketMinutes * 60_000) / model.data.stepMs))),
    [model.data, model.bucketMinutes],
  )
  const levelsRef = useRef(levels)
  levelsRef.current = levels
  const levelMinutesRef = useRef(levelMinutes)
  levelMinutesRef.current = levelMinutes
  /** The bar before or after the one holding `ms` at the settled level (the mockup's step over chart.groups). */
  const stepFrom = useCallback((ms: number, dir: -1 | 1) => {
    const level = levelAt(levelsRef.current, levelMinutesRef.current)
    if (!level) return null
    const buckets = level.buckets
    let i = -1
    for (let k = 0; k < buckets.length && buckets[k]!.startMs <= ms; k += 1) i = k
    const inside = i >= 0 && ms < buckets[i]!.startMs + level.slotMs
    const next = buckets[dir > 0 ? i + 1 : inside ? i - 1 : i]
    const bar = next ? barAt(modelRef.current.data, level, next.from) : null
    return bar ? { t: bar.startMs, endT: bar.endMs, barMinutes: level.slotMs / 60_000 } : null
  }, [])

  const minVisibleCount = Math.min(MIN_VISIBLE_BUCKETS, model.count)
  const store = useMemo(
    () => createSpViewportStore({ count: model.count, minSpan: minVisibleCount - 1 }),
    // A new grid (window or bucket length) starts a new view; live growth uses setCount below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model.bucketMs, windowMinutes],
  )
  useEffect(() => () => store.destroy(), [store])
  useEffect(() => {
    store.setCount(model.count)
  }, [store, model.count])
  const hover: SpHoverStore = useMemo(createSpHoverStore, [])

  // Plot width: the stack's width minus the value-axis column (as spLayout).
  const [stackWidth, setStackWidth] = useState(0)
  useLayoutEffect(() => {
    const element = stackRef.current
    if (!element) return
    const read = () => setStackWidth(Math.round(element.clientWidth))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const plotWidth = stackWidth > 0 ? Math.max(40, stackWidth - tickColumn) : 0

  // The wheel-surface hook goes on the plot rows themselves (SpChart's `.spc-plot`),
  // so it contains the plot's hit targets: `closest('[data-hub-chart-wheel-surface]')`
  // from a wheel or pointer target over the plot finds it (wave-1 wheel matrix),
  // and hover/click on it land on the plot. Only an attribute; React never owns it.
  useLayoutEffect(() => {
    const plotRows = stackRef.current?.querySelector<HTMLElement>('.spc-plot')
    if (plotRows && !plotRows.hasAttribute(WHEEL_SURFACE_ATTR)) plotRows.setAttribute(WHEEL_SURFACE_ATTR, '')
  })

  // The settled view on the stack (specs and the bench compare it with the navigator).
  useLayoutEffect(() => {
    const write = (range: { startIndex: number; endIndex: number }) => {
      const element = stackRef.current
      if (!element) return
      element.setAttribute('data-hub-chart-viewport-start', String(range.startIndex))
      element.setAttribute('data-hub-chart-viewport-end', String(range.endIndex))
    }
    write(store.getTarget())
    return store.subscribeSettle(write)
  }, [store])

  // The gesture flag (idle work waits) and the wheel marks, from the store.
  useEffect(() => {
    const off = store.subscribeGesture((active: boolean) => {
      setHubGestureActive(active)
      spMark(active ? 'sp:wheel-start' : 'sp:wheel-settle')
    })
    return () => {
      off()
      setHubGestureActive(false)
    }
  }, [store])

  // The chart bridge for the card (U7) and Latest moments (U4).
  useEffect(() => {
    const dispose = setHubChartBridge({
      subscribeFrame(listener) {
        const chart = chartRef.current
        if (chart) return chart.frame().subscribe(() => listener())
        return store.subscribeFrame(() => listener())
      },
      xOfMs(ms) {
        const chart = chartRef.current
        const width = chart?.layout()?.plotWidth ?? 0
        if (!chart || !(width > 0)) return null
        const x = chart.xOfMs(ms)
        return Number.isFinite(x) && x >= 0 && x <= width ? x : null
      },
      plotElement: () => plotBoxRef.current,
      stepBar: stepFrom,
      zoomToMs(startMs, endMs) {
        const data = modelRef.current.data
        const a = Math.round((startMs - data.startMs) / data.stepMs)
        const b = Math.round((endMs - data.startMs) / data.stepMs)
        if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return
        store.setTarget({ startIndex: Math.max(0, a), endIndex: Math.min(store.getCount() - 1, b) }, { animate: true })
      },
      focusPlot() {
        chartRef.current?.plotElement()?.focus({ preventScroll: true })
      },
      panToMs(ms) {
        const current = modelRef.current
        const index = Math.floor((ms - current.data.startMs) / current.bucketMs)
        if (!Number.isFinite(index)) return
        const target = store.getTarget()
        if (index >= target.startIndex && index <= target.endIndex) return
        const span = target.endIndex - target.startIndex
        const start = Math.max(0, Math.min(store.getCount() - 1 - span, Math.round(index - span / 2)))
        store.setTarget({ startIndex: start, endIndex: start + span }, { animate: true })
      },
    })
    return dispose
  }, [store, stepFrom])

  // The selection: bar highlight here, the card (U7) elsewhere, one store.
  const selection = useSyncExternalStore(hubBucketSelectionStore.subscribe, hubBucketSelectionStore.getSnapshot, noSelection).selection
  const selected: SpSelection | null = useMemo(
    () => (selection ? { startMs: selection.t, endMs: selection.endT, kind: 'bar' } : null),
    [selection],
  )

  // Show on chart (a page-picked bucket): select it as 'latest'; the pan follows below.
  useEffect(() => {
    if (externalBucketT == null) return
    const current = modelRef.current
    selectHubBucket({ t: externalBucketT, endT: externalBucketT + current.bucketMs, barMinutes: current.bucketMinutes, source: 'latest' })
  }, [externalBucketT])

  // A 'latest' selection pans the chart to it (span kept).
  useEffect(() => {
    // Starts empty so a 'latest' selection made before this effect subscribed still pans.
    let previous: ReturnType<typeof hubBucketSelectionStore.getSnapshot>['selection'] = null
    const follow = () => {
      const next = hubBucketSelectionStore.getSnapshot().selection
      if (next && next !== previous && next.source === 'latest') {
        const current = modelRef.current
        const index = Math.floor((next.t - current.data.startMs) / current.bucketMs)
        const target = store.getTarget()
        if (index < target.startIndex || index > target.endIndex) {
          const span = target.endIndex - target.startIndex
          const start = Math.max(0, Math.min(store.getCount() - 1 - span, Math.round(index - span / 2)))
          store.setTarget({ startIndex: start, endIndex: start + span }, { animate: true })
        }
      }
      previous = next
    }
    follow()
    return hubBucketSelectionStore.subscribe(follow)
  }, [store])

  // Hover preview for the page (only when it asks).
  useEffect(() => {
    if (!onBucketHover) return
    let last: number | null = null
    return hover.subscribe(() => {
      const t = hover.get()?.bar?.startMs ?? null
      if (t === last) return
      last = t
      onBucketHover(t)
    })
  }, [hover, onBucketHover])

  const onBarClick = useCallback((hit: SpHit) => {
    const bar = hit.bar
    if (!bar) return
    toggleHubBucket({ t: bar.startMs, endT: bar.endMs, barMinutes: hit.levelMinutes, source: hit.source === 'keyboard' ? 'keyboard' : 'bar' })
  }, [])
  const onEscape = useCallback(() => {
    escapeHubBucketSelection()
  }, [])
  const onLevel = useCallback((minutes: number) => setLevelStep(Math.max(1, Math.round(minutes / modelRef.current.bucketMinutes))), [])

  // A new bar level re-selects the bar that holds the selection at that level (the mockup's onLevel), so the card
  // always describes a bar the chart draws.
  useEffect(() => {
    const selection = hubBucketSelectionStore.getSnapshot().selection
    const level = levelAt(levels, levelMinutes)
    if (!selection || !level || Math.round(level.slotMs / 60_000) === Math.round(selection.barMinutes)) return
    const data = modelRef.current.data
    const hit = level.buckets.find((b) => b.startMs + level.slotMs > selection.t && b.startMs < selection.endT)
    const bar = hit ? barAt(data, level, hit.from) : null
    if (bar) selectHubBucket({ ...selection, t: bar.startMs, endT: bar.endMs, barMinutes: level.slotMs / 60_000 })
  }, [levels, levelMinutes])

  // With a card open, left and right on the plot step to the next bar (the mockup's card keys); otherwise they move the cursor.
  const onPlotKeyCapture = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const selection = hubBucketSelectionStore.getSnapshot().selection
    if (!selection || event.target !== chartRef.current?.plotElement()) return
    event.preventDefault()
    event.stopPropagation()
    const next = stepFrom(selection.t, event.key === 'ArrowLeft' ? -1 : 1)
    if (next) selectHubBucket({ ...next, source: 'keyboard' })
  }, [stepFrom])

  const toggleSeries = useCallback((key: CoreSeriesKey) => {
    setSeries((current) => {
      const next = { ...current, [key]: !current[key] }
      // At least one series stays on.
      return next.chat || next.emotes || next.viewers ? next : current
    })
  }, [])

  const markerInputs = useMemo(
    () => (momentMarkers ?? []).map((marker) => ({ key: marker.key, ms: marker.at ?? marker.bucketT })).filter((marker) => Number.isFinite(marker.ms)),
    [momentMarkers],
  )
  const layers = useMemo(
    () => [series.chat ? hubStampLayer(model, emoteImages) : null, hubMarkersLayer(markerInputs)].filter((layer): layer is SpLayer => layer != null),
    [model, emoteImages, markerInputs, series.chat],
  )
  const chartSeries = useMemo(() => ({ chat: series.chat, emotes: series.emotes, viewers: series.viewers }), [series])
  const frame = useCallback(() => chartRef.current?.frame() ?? null, [])
  const wheelAnchor = useCallback(() => plotBoxRef.current, [])

  // The wheel zooms over the graph only (plot, time axis, navigator): over the header,
  // readout and provider lanes it scrolls the page (Aron 2026-10-15).
  const navigator = (
    <HubActivityNavigator
      model={model}
      store={store}
      windowMinutes={windowMinutes}
      levelMinutes={levelMinutes}
      minVisibleCount={minVisibleCount}
      wheelSurfaceRef={stackRef}
      wheelAnchor={wheelAnchor}
    />
  )

  return (
    <>
      <HubActivityHeader
        windowMinutes={windowMinutes}
        rangeControl={rangeControl}
        series={series}
        onToggleSeries={toggleSeries}
        bucketMinutes={model.bucketMinutes}
        levelMinutes={levelMinutes}
        onOpenMeasured={onOpenMeasured}
      />
      <HubActivityReadout model={model} hover={hover} series={series} emoteImages={emoteImages} />
      {annotationLane}
      <div ref={stackRef} className="hx-plot-stack hub-act-stack" data-hub-chart-state="ready" data-hub-chart-wheel-zone="" onKeyDownCapture={onPlotKeyCapture}>
        <SpChart
          ref={chartRef}
          data={model.data}
          viewport={store}
          hover={hover}
          series={chartSeries}
          barOptions={BAR_OPTIONS}
          fixedLevelMinutes={model.bucketMinutes}
          plotHeight={plotHeight}
          density="hub"
          tickColumnPx={tickColumn}
          alignMs={0}
          ariaLabel={hubActivityAriaLabel(windowMinutes)}
          selected={selected}
          selSlide={SEL_SLIDE}
          layers={layers}
          navigator={navigator}
          onBarClick={onBarClick}
          onLevel={onLevel}
          onEscape={onEscape}
        />
        {/* Box-only hooks: the exact plot box (bridge bounds, wheel anchor) and the time-axis row. */}
        <div
          ref={plotBoxRef}
          className="hub-act-hook"
          data-hub-plot-box=""
          aria-hidden="true"
          style={{ top: 0, width: plotWidth, height: plotHeight }}
        />
        <div className="hub-act-hook hx-axis" aria-hidden="true" style={{ top: plotHeight, width: plotWidth, height: 22 }} />
      </div>
      <HubProviderLanes model={model} plotWidth={plotWidth} frame={frame} />
    </>
  )
}

/* ---------- states ---------- */

function StateBox({ state, className, children }: { state: string; className?: string; children: ReactNode }) {
  return (
    <div className={`hx-chart-state hub-act-state${className ? ` ${className}` : ''}`} data-hub-chart-state={state} role="status" aria-live="polite">
      {children}
    </div>
  )
}

export function HubActivityChart({
  points,
  windowMinutes,
  livePoolViewerSum,
  emptyTitle,
  emptyDescription,
  dataIssue,
  loading,
  rangeControl,
  annotationLane,
  selectedBucketT,
  accentBucketT,
  onBucketHover,
  momentMarkers,
  emoteImages,
  bucketMinutes,
  providerCoverage,
  onOpenMeasured,
  onBarsChange,
}: HubActivityChartProps) {
  // A new window drops the selection (it belongs to the old grid); so does leaving the page.
  const windowRef = useRef(windowMinutes)
  useEffect(() => {
    if (windowRef.current === windowMinutes) return
    windowRef.current = windowMinutes
    clearHubBucketSelection()
  }, [windowMinutes])
  useEffect(() => () => clearHubBucketSelection(), [])

  const chartState = useMemo(
    () => (points.length < 2 ? 'unmeasured' : resolveHubActivityChartState(chartActivityPoints(points, windowMinutes, undefined, livePoolViewerSum))),
    [points, windowMinutes, livePoolViewerSum],
  )
  const model = useMemo(
    () => (chartState === 'ready' ? buildHubActivitySpModel(points, windowMinutes, { bucketMinutes, providerCoverage }) : null),
    [chartState, points, windowMinutes, bucketMinutes, providerCoverage],
  )
  const header = <HubActivityHeader windowMinutes={windowMinutes} rangeControl={rangeControl} />

  if (loading) {
    return (
      <>
        {header}
        {annotationLane}
        <StateBox state="loading" className="hx-chart-state--loading hub-act-state--loading">
          Loading measured activity…
        </StateBox>
        <div className="hub-act-skeleton" aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 220, marginTop: '0.7rem' }}>
          {Array.from({ length: 24 }).map((_, i) => (
            <Skeleton key={i} width={10} height={`${30 + ((i * 37) % 60)}%`} radius="3px" style={{ flex: 1 }} />
          ))}
        </div>
      </>
    )
  }

  if (points.length < 2) {
    return (
      <>
        {header}
        {annotationLane}
        <StateBox state="unmeasured">
          <EmptyState icon={<Activity aria-hidden="true" />}>
            {emptyTitle ? (
              <>
                <strong>{emptyTitle}</strong>
                {emptyDescription ? <> — {emptyDescription}</> : null}
              </>
            ) : (
              'Waiting for live activity — the chart draws once channels start sending chat and emotes.'
            )}
          </EmptyState>
        </StateBox>
      </>
    )
  }

  if (dataIssue) {
    return (
      <>
        {header}
        {annotationLane}
        <StateBox state="unavailable">
          <EmptyState icon={<Activity aria-hidden="true" />}>
            <strong>Activity payload unavailable</strong> — {dataIssue} The chart is withheld until the served window and timestamps agree.
          </EmptyState>
        </StateBox>
      </>
    )
  }

  if (chartState !== 'ready' || !model) {
    const state = chartState === 'ready' ? 'unmeasured' : chartState
    const title = state === 'unmeasured' ? emptyTitle ?? 'No measured activity in this window' : 'Measured activity is quiet'
    const description = state === 'unmeasured'
      ? emptyDescription ?? 'The backend has not supplied usable viewer, chat, or emote buckets for the served window.'
      : 'The served buckets are measured, but viewer, chat, and emote counts are all zero.'
    return (
      <>
        {header}
        {annotationLane}
        <StateBox state={state}>
          <EmptyState icon={<Activity aria-hidden="true" />}>
            <strong>{title}</strong> — {description}
          </EmptyState>
        </StateBox>
      </>
    )
  }

  return (
    <HubActivityReady
      model={model}
      windowMinutes={windowMinutes}
      rangeControl={rangeControl}
      annotationLane={annotationLane}
      externalBucketT={selectedBucketT ?? accentBucketT ?? null}
      onBucketHover={onBucketHover}
      momentMarkers={momentMarkers}
      emoteImages={emoteImages}
      onOpenMeasured={onOpenMeasured}
      onBarsChange={onBarsChange}
    />
  )
}
