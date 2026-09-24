import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { formatHeatOffset, momentClockDisplay, reactionAnalyticalOffset } from '@streampulse/pulse-core'
import {
  GameSegmentOverlay,
  gameSegmentKey,
  gameSegmentPlotBounds,
  gameSegmentPlotBoundsByOffsets,
  normalizeGameSegments as normalizeChartGameSegments,
  buildChartHitRegions,
  chartHitRegionAtX,
  buildViewerGeometry,
  ViewerNoDotPath,
  viewerScaleBounds,
  type ChartGameSegment,
  type ViewerTimedValue,
} from '@streampulse/pulse-charts'
import type { ExtensionGameSegment, ExtensionPeak, ExtensionRollup } from '../shared/messages.ts'
import { activityAxisBoundsFromZero, overlaySeriesAxisMax } from './chatActivityEmotes.ts'
import type { EmoteOverlaySeries } from './chatActivityEmotes.ts'
import { CHART_BAR_ALPHA, CHART_INTERACTION, CHART_THEME, hexToRgba } from './chartTheme.ts'
import {
  barDisplayAxisMax,
  chartBarBucketOpacity,
  chartDurationSeconds,
  extendSeriesToTrailingEdge,
  minuteEmoteTotal,
  overviewBarWidth,
  plotXForIndex,
  rampNullableSeriesFromStreamStart,
  rollupsToChartMinuteRollups,
  seriesMax,
  smoothLinePathInBand,
  smoothNullableSeriesValues,
  smoothSeriesValues,
  trendSmoothingWindow,
} from './chartRollupUtils.ts'
import { prefersReducedMotion } from './motion/useSmoothedScalar.ts'
import { downsampleRollupsForChart, EXTENSION_CHART_MAX_POINTS, nearestRollupIndex } from './extensionChartPoints.ts'
import { panDeltaSecondsFromPointer } from './chartPanMath.ts'
import { FOLLOW_LIVE_EPSILON_SECONDS, MIN_VIEWPORT_SECONDS, viewportBuckets, wheelZoom, zoomViewport, panViewport, type ChartViewport } from './chartViewport.ts'
import {
  chartMomentMarkerKey,
  chartMomentMarkerPresentation,
  chartMomentMarkerY,
  MAX_CHART_MOMENT_MARKERS,
  selectVisibleChartMomentPeaks,
} from './chartMomentMarkers.ts'

export interface PulseOverviewChartProps {
  rollups: ExtensionRollup[]
  games?: ExtensionGameSegment[]
  durationSeconds?: number
  streamStartedAt?: string
  height?: number
  chartRegionId?: string
  selectedIndex?: number | null
  previewIndex?: number | null
  activityExpanded?: boolean
  activityExpansionProgress?: number
  showViewerStrip?: boolean
  /** Keep the dedicated lane reserved while a known viewer provider is warming up. */
  viewerLaneExpected?: boolean
  /** Paused samples get a slimmer lane so a long empty viewer gap does not dominate the chart. */
  viewerLaneCompact?: boolean
  /** Extension refresh is disabled; distinguish this from backend absence. */
  viewerUpdatesPaused?: boolean
  /** Stream-level peak keeps the viewers axis honest when the visible window is sparse. */
  viewerPeak?: number | null
  /** First and latest real viewer samples; these annotate the honest sampling window. */
  viewerSampleStartOffsetSeconds?: number | null
  viewerSampleEndOffsetSeconds?: number | null
  /** Completed streams can label the last sample as the end of viewer tracking. */
  viewerSampleWindowComplete?: boolean
  onSelectIndex?: (index: number) => void
  /** Select the backend-ranked moment represented by an opt-in marker. */
  onSelectMoment?: (peak: ExtensionPeak) => void
  onClearSelection?: () => void
  /** Clicks inside this node (e.g. Selected moment card below chart) must not clear the pin. */
  clearSelectionBoundaryRef?: RefObject<HTMLElement | null>
  onHoverOffsetChange?: (offsetSeconds: number | null) => void
  emptyMessage?: string
  loading?: boolean
  isLive?: boolean
  emoteSyncTone?: 'ok' | 'warn' | 'muted'
  overlayLines?: EmoteOverlaySeries[]
  /** Backend-authored top moments; the owning surface controls visibility. */
  peakMarkers?: readonly ExtensionPeak[]
  showPeakMarkers?: boolean
  normalizeOverlaySeries?: boolean
  reducedMotion?: boolean
  focusedSeriesKey?: string | null
  onFocusedSeriesKeyChange?: (key: string | null) => void
  highlightedGameSegmentKey?: string | null
  viewport?: ChartViewport
  coverageStartSeconds?: number
  onViewportChange?: (viewport: ChartViewport) => void
  onJumpToOffset?: (offsetSeconds: number) => void
  backendUrl?: string
  /** Reset ephemeral chart interaction when the live stream/channel changes. */
  interactionResetKey?: string
}

/**
 * Chart actions live beside the plot, so they must not be mistaken for a
 * passive outside click. Keeping this as an explicit marker avoids treating
 * every button in the surrounding Twitch panel as part of the chart.
 */
export function isChartActionPointerTarget(event: Pick<PointerEvent, 'composedPath' | 'target'>): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : []
  const candidates = path.length > 0 ? path : [event.target]
  return candidates.some(node => (
    typeof Element !== 'undefined'
    && node instanceof Element
    && (node.getAttribute('data-chart-action') === 'true' || Boolean(node.closest?.('[data-chart-action="true"]')))
  ))
}

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 160
const PAD_LEFT = 4
const PAD_RIGHT = 12
const PAD_TOP = 14
const PAD_BOTTOM = 12
const VIEWER_STRIP_SHARE_COLLAPSED = 0.28
const VIEWER_STRIP_SHARE_EXPANDED = 0.22
const ACTIVITY_CHAT_FRACTION = 0.54
const ACTIVITY_EMOTE_TRACE_FRACTION = 0.12
const ACTIVITY_EMOTE_BARS_FRACTION = 0.34
const SIDEBAR_CHAT_FRACTION = 0.5
const SIDEBAR_EMOTE_TRACE_FRACTION = 0.18
const SIDEBAR_EMOTE_BARS_FRACTION = 0.32
const ACTIVITY_CHAT_FRACTION_EXPANDED = 0.62
const ACTIVITY_EMOTE_BARS_FRACTION_EXPANDED = 0.26
const RESTING_TREND_STROKE = 2
const CHAT_TREND_STROKE = RESTING_TREND_STROKE
const EMOTE_TREND_STROKE = RESTING_TREND_STROKE
const TRACE_LANE_MIN_HEIGHT = 16
const TRACE_LINE_STROKE = 2.5
const TRACE_LINE_OPACITY = 0.95
const FOCUS_DIM_FACTOR = 0.18
const FOCUS_LANE_BOOST = 0.78
const CHART_MOMENT_MARKER_COLORS = {
  chat: '#a78bfa',
  emotes: '#34d399',
  viewers: '#67e8f9',
} as const
const CHART_SELECTION_PIN_WASH = 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.18)'
const CHART_SELECTION_PREVIEW_WASH = 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.09)'
const CHART_SELECTION_PREVIEW_MIN_WIDTH = 6
const CHART_SELECTION_PIN_MIN_WIDTH = 8
// Hover chrome fades in/out with one short ease-out; plotted data geometry is
// always immediate (no line morphing, no delayed data animation).
const MARKER_FADE_MS = 160
const MARKER_FADE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const PLOT_DRAG_THRESHOLD_PX = 5
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type ActivityZone = 'activity-chat' | 'activity-emote-trace' | 'activity-emote'

function seriesFocusOpacity(
  focusedSeriesKey: string | null | undefined,
  seriesKey: string,
  base: number,
): number {
  if (!focusedSeriesKey) return base
  if (seriesKey === focusedSeriesKey) return Math.min(1, base * 1.05)
  const emoteFamily = seriesKey === 'emotes' || seriesKey.includes(':')
  if (focusedSeriesKey === 'emotes' && emoteFamily) return base
  return base * FOCUS_DIM_FACTOR
}

function rebalanceFractionsForFocus(
  focusedSeriesKey: string | null | undefined,
  activityExpansionProgress: number,
  chatFraction: number,
  traceFraction: number,
  emoteFraction: number,
): { chat: number; trace: number; emote: number } {
  if (!focusedSeriesKey || activityExpansionProgress <= 0) {
    return { chat: chatFraction, trace: traceFraction, emote: emoteFraction }
  }
  const rest = 1 - FOCUS_LANE_BOOST
  const halfRest = rest / 2
  let focused: { chat: number; trace: number; emote: number } | null = null
  switch (focusedSeriesKey) {
    case 'chat':
      focused = { chat: FOCUS_LANE_BOOST, trace: halfRest, emote: halfRest }
      break
    case 'emotes':
      focused = { chat: halfRest, trace: halfRest, emote: FOCUS_LANE_BOOST }
      break
    default:
      if (focusedSeriesKey.includes(':')) {
        focused = { chat: halfRest, trace: FOCUS_LANE_BOOST, emote: halfRest }
        break
      }
      return { chat: chatFraction, trace: traceFraction, emote: emoteFraction }
  }
  return {
    chat: chatFraction + (focused.chat - chatFraction) * activityExpansionProgress,
    trace: traceFraction + (focused.trace - traceFraction) * activityExpansionProgress,
    emote: emoteFraction + (focused.emote - emoteFraction) * activityExpansionProgress,
  }
}

function interpolateNumber(from: number, to: number, progress: number): number {
  return from + (to - from) * progress
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function chartMomentSignal(peak: ExtensionPeak): keyof typeof CHART_MOMENT_MARKER_COLORS {
  const dominant = `${peak.dominantSignal ?? ''} ${(peak.reasons ?? []).join(' ')}`.toLowerCase()
  if (dominant.includes('viewer')) return 'viewers'
  if (dominant.includes('emote')) return 'emotes'
  return 'chat'
}

function interpolatePlotXForOffset(
  offsetSeconds: number,
  rollups: readonly ExtensionRollup[],
  plotWidth: number,
): number {
  if (rollups.length === 0) return PAD_LEFT
  if (rollups.length === 1) return plotXForIndex(0, 1, PAD_LEFT, plotWidth)
  let rightIndex = rollups.findIndex(rollup => rollup.offsetSeconds >= offsetSeconds)
  if (rightIndex < 0) rightIndex = rollups.length - 1
  const leftIndex = Math.max(0, rightIndex - (rollups[rightIndex]?.offsetSeconds === offsetSeconds ? 0 : 1))
  if (leftIndex === rightIndex) return plotXForIndex(rightIndex, rollups.length, PAD_LEFT, plotWidth)
  const left = rollups[leftIndex]!
  const right = rollups[rightIndex]!
  const span = right.offsetSeconds - left.offsetSeconds
  const fraction = span > 0 ? clampNumber((offsetSeconds - left.offsetSeconds) / span, 0, 1) : 0
  const leftX = plotXForIndex(leftIndex, rollups.length, PAD_LEFT, plotWidth)
  const rightX = plotXForIndex(rightIndex, rollups.length, PAD_LEFT, plotWidth)
  return leftX + (rightX - leftX) * fraction
}

function plotBandForActivityZone(
  activityTop: number,
  activityBottom: number,
  activityHeight: number,
  zone: ActivityZone,
  chatFraction: number,
  traceFraction: number,
  emoteFraction: number,
) {
  const chatSplit = activityTop + activityHeight * chatFraction
  const traceSplit = chatSplit + activityHeight * traceFraction
  switch (zone) {
    case 'activity-chat':
      return {
        bandTop: activityTop,
        bandBottom: chatSplit,
        bandHeight: activityHeight * chatFraction,
      }
    case 'activity-emote-trace':
      return {
        bandTop: chatSplit,
        bandBottom: traceSplit,
        bandHeight: activityHeight * traceFraction,
      }
    case 'activity-emote':
      return {
        bandTop: traceSplit,
        bandBottom: activityBottom,
        bandHeight: activityHeight * emoteFraction,
      }
    default:
      return { bandTop: activityTop, bandBottom: activityBottom, bandHeight: activityHeight }
  }
}

function axisTicks(count: number): number[] {
  if (count <= 1) return [0]
  if (count <= 3) return [0, count - 1]
  const mid = Math.floor((count - 1) / 2)
  return [0, mid, count - 1]
}

function selectionColumnRect(
  index: number | null,
  n: number,
  plotWidth: number,
  top: number,
  bottom: number,
  fill: string,
  minWidth: number,
): { x: number; y: number; width: number; height: number; fill: string } | null {
  if (index == null || n <= 0) return null
  const width = Math.min(plotWidth, Math.max(minWidth, overviewBarWidth(plotWidth, n)))
  const center = plotXForIndex(index, n, PAD_LEFT, plotWidth)
  const x = clampNumber(center - width / 2, PAD_LEFT, PAD_LEFT + plotWidth - width)
  return { x, y: top, width, height: Math.max(1, bottom - top), fill }
}

/** A viewer value is observed only when the rollup actually carries it. */
function viewerObservedValue(point: ExtensionRollup): number | null {
  if (point.missing) return null
  const value = point.viewerCount
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  return (point.viewerSamples ?? 0) > 0 ? 0 : null
}

type SignalBar = {
  key: string
  x: number
  y: number
  width: number
  height: number
  hasValue: boolean
}

const SignalBarLane = memo(function SignalBarLane({
  bars,
  seriesKey,
  color,
  pinIndex,
  activeIndex,
  focusedSeriesKey,
  restAlpha,
}: {
  bars: SignalBar[]
  seriesKey: 'chat' | 'emotes'
  color: string
  pinIndex: number | null
  activeIndex: number | null
  focusedSeriesKey: string | null
  restAlpha: number
}) {
  return (
    <>
      {bars.map((bar, index) => {
        const { key, hasValue: _hasValue, ...geometry } = bar
        const state = pinIndex === index
          ? 'locked'
          : activeIndex === index
            ? 'hovered'
            : 'idle'
        const base = (() => {
          if (state === 'locked') return 0.98
          if (state === 'hovered') return bar.hasValue ? 0.84 : 0.5
          if (!bar.hasValue) return CHART_BAR_ALPHA.empty
          return chartBarBucketOpacity({
            index,
            activeIndex,
            baseOpacity: restAlpha,
            highlightOpacity: Math.min(1, restAlpha * 2.4),
          })
        })()
        const opacity = seriesFocusOpacity(focusedSeriesKey, seriesKey, base)
        return (
          <rect
            key={key}
            {...geometry}
            data-chart-signal-bar={seriesKey}
            data-chart-bucket-index={index}
            data-chart-bar-highlight={state}
            fill={color}
            opacity={opacity}
            pointerEvents="none"
          />
        )
      })}
    </>
  )
})

function PulseOverviewChartImpl({
  rollups: sourceRollups,
  games = [],
  durationSeconds = 0,
  streamStartedAt,
  height = DEFAULT_HEIGHT,
  chartRegionId,
  selectedIndex = null,
  previewIndex = null,
  activityExpanded = false,
  activityExpansionProgress,
  showViewerStrip: showViewerStripProp = true,
  viewerLaneExpected = false,
  viewerLaneCompact = false,
  viewerUpdatesPaused = false,
  viewerPeak = null,
  viewerSampleStartOffsetSeconds = null,
  viewerSampleEndOffsetSeconds = null,
  viewerSampleWindowComplete = false,
  onSelectIndex,
  onSelectMoment,
  onClearSelection,
  clearSelectionBoundaryRef,
  onHoverOffsetChange,
  emptyMessage,
  loading = false,
  overlayLines = [],
  peakMarkers = [],
  showPeakMarkers = false,
  normalizeOverlaySeries = false,
  reducedMotion = false,
  isLive = false,
  focusedSeriesKey = null,
  highlightedGameSegmentKey = null,
  viewport: externalViewport,
  coverageStartSeconds = 0,
  onViewportChange,
  interactionResetKey,
}: PulseOverviewChartProps) {
  const chartId = useId().replace(/:/g, '')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const internalViewport: ChartViewport = externalViewport ?? { startSeconds: 0, endSeconds: Math.max(0, durationSeconds) }
  // Without an external viewport the chart owns sampling: cap the raw timeline so
  // full-range rendering stays bounded while zoom (external viewport) can recover
  // detail from the raw source.
  const visibleRollups = useMemo(() => externalViewport ? viewportBuckets(sourceRollups, internalViewport, EXTENSION_CHART_MAX_POINTS) : downsampleRollupsForChart(sourceRollups), [sourceRollups, externalViewport, internalViewport.startSeconds, internalViewport.endSeconds])
  const rollups = visibleRollups
  // Selection/preview props arrive as indexes into the FULL source rollup list,
  // while everything below renders against the viewport-filtered list.
  // Map between the two domains by offsetSeconds so pins stay accurate when zoomed.
  const fullIndexByOffset = useMemo(() => {
    const map = new Map<number, number>()
    sourceRollups.forEach((r, i) => {
      if (!map.has(r.offsetSeconds)) map.set(r.offsetSeconds, i)
    })
    return map
  }, [sourceRollups])
  const fullIndexFromVisible = useCallback(
    (vi: number | null): number | null => {
      if (vi == null || vi < 0 || vi >= visibleRollups.length) return null
      return fullIndexByOffset.get(visibleRollups[vi].offsetSeconds) ?? null
    },
    [visibleRollups, fullIndexByOffset],
  )
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [activeMomentMarkerKey, setActiveMomentMarkerKey] = useState<string | null>(null)
  // Pointer previews are committed to lightweight SVG chrome imperatively
  // (Aug-16 hover shell): keeping them out of React prevents every hovered
  // bucket from reconciling the complete chart subtree.
  const hoverIndexRef = useRef<number | null>(null)
  const chartHoverActiveRef = useRef(false)
  const [chartHoverActive, setChartHoverActive] = useState(false)
  const [hoveredBucketIndex, setHoveredBucketIndex] = useState<number | null>(null)
  const interactionLayerRef = useRef<SVGGElement | null>(null)
  const emoteBarsGroupRef = useRef<SVGGElement | null>(null)
  const chatBarsGroupRef = useRef<SVGGElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const pendingHoverTargetRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const hoverFrameRef = useRef<number | null>(null)
  const captureBoundsRef = useRef<{ left: number; top: number; width: number; height: number } | null>(null)
  const scrubberRef = useRef<SVGRectElement | null>(null)
  const plotDragRef = useRef<{
    pointerId: number
    startClientX: number
    movedPx: number
    active: boolean
    startViewport: ChartViewport
  } | null>(null)
  const pendingPlotViewportRef = useRef<ChartViewport | null>(null)
  const plotFrameRef = useRef<number | null>(null)
  const suppressNextClickRef = useRef(false)
  const [plotDragging, setPlotDragging] = useState(false)
  const hoverOffsetChangeRef = useRef(onHoverOffsetChange)
  hoverOffsetChangeRef.current = onHoverOffsetChange
  // Latest viewport state for the native non-passive wheel listener below.
  // React registers root wheel listeners as passive, so onWheel preventDefault()
  // is ignored and zoom gestures would scroll the host Twitch page.
  const wheelStateRef = useRef({ onViewportChange, internalViewport, durationSeconds, width, coverageStartSeconds })
  wheelStateRef.current = { onViewportChange, internalViewport, durationSeconds, width, coverageStartSeconds }

  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current
    if (!node || typeof node.addEventListener !== 'function') return
    const handleWheel = (event: WheelEvent) => {
      const state = wheelStateRef.current
      if (!state.onViewportChange || state.durationSeconds <= 0 || event.ctrlKey) return
      // Cancel and contain BEFORE any zoom math — including at zoom limits — so
      // the gesture never chains into the page scrollport.
      event.preventDefault()
      event.stopPropagation()
      const rect = node.getBoundingClientRect()
      const plotWidth = Math.max(1, state.width - PAD_LEFT - PAD_RIGHT)
      const fraction = clampNumber(
        (event.clientX - rect.left - PAD_LEFT) / plotWidth,
        0,
        1,
      )
      const anchorSeconds =
        state.internalViewport.startSeconds +
        fraction * (state.internalViewport.endSeconds - state.internalViewport.startSeconds)
      state.onViewportChange(
        wheelZoom({
          viewport: state.internalViewport,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          anchorSeconds,
          durationSeconds: state.durationSeconds,
          coverageStartSeconds: state.coverageStartSeconds,
        }),
      )
    }
    node.addEventListener('wheel', handleWheel, { passive: false })
    return () => node.removeEventListener('wheel', handleWheel)
    // The loading/empty branches and the plotted branch render different
    // container nodes. Rebind after the chart node replaces the placeholder;
    // otherwise the first live-data render loses the non-passive wheel guard.
  }, [loading, visibleRollups.length])

  useIsomorphicLayoutEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const minPlotWidth = PAD_LEFT + PAD_RIGHT + 40
    let lastRounded = -1
    const applyWidth = (raw: number) => {
      const next = Math.round(raw)
      if (next === lastRounded) return
      lastRounded = next
      captureBoundsRef.current = null
      // Tiny pre-layout widths (e.g. 1px) make plotWidth = width-pads = -15 and SVG rects throw.
      setWidth(next >= minPlotWidth ? next : DEFAULT_WIDTH)
    }
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width
      if (next && next > 0) applyWidth(next)
    })
    observer.observe(node)
    applyWidth(node.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    chartHoverActiveRef.current = false
    setChartHoverActive(false)
    setHoveredBucketIndex(null)
    return () => {
      if (hoverFrameRef.current != null) {
        cancelAnimationFrame(hoverFrameRef.current)
        hoverFrameRef.current = null
      }
      pendingHoverTargetRef.current = null
      captureBoundsRef.current = null
      finishPlotInteraction()
      suppressNextClickRef.current = false
      if (hoverIndexRef.current != null) {
        hoverIndexRef.current = null
        applyInspectionDOM(null)
        hoverOffsetChangeRef.current?.(null)
      }
    }
    // The reset key is the only dependency by design. A parent callback may be
    // recreated during polling, but that must not clear an active hover.
  }, [interactionResetKey])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      const boundary = clearSelectionBoundaryRef?.current ?? containerRef.current
      if (!boundary) return
      const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : []
      const isInsideBoundary = composedPath.length > 0
        ? composedPath.includes(boundary)
        : boundary.contains(event.target as Node)
      if (isInsideBoundary) return
      // Portaled dropdown menus and chart-owned controls may sit outside the
      // boundary in the composed tree. They preserve the committed selection.
      if (isChartActionPointerTarget(event)) return
      if (event.defaultPrevented) return
      clearHoverPreview()
      onClearSelection?.()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [clearSelectionBoundaryRef, onClearSelection, onHoverOffsetChange])

  useEffect(() => {
    const cancel = () => {
      finishPlotInteraction()
      handlePointerLeave()
    }
    document.addEventListener('streampulse:deactivate-interactions', cancel)
    return () => document.removeEventListener('streampulse:deactivate-interactions', cancel)
    // The interaction reset key is the lifecycle boundary; hover callbacks are
    // intentionally not dependencies because this listener only cancels refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactionResetKey])

  const timelineDuration = useMemo(
    () => chartDurationSeconds(rollups, durationSeconds),
    [rollups, durationSeconds],
  )

  const chartGames = useMemo((): ChartGameSegment[] => {
    const normalized = normalizeChartGameSegments(
      (games ?? []).map((game, index) => ({
        id: index,
        gameName: game.gameName,
        offsetSeconds: game.offsetSeconds,
        durationSeconds: game.durationSeconds,
      })),
      timelineDuration,
    )
    return normalized
  }, [games, timelineDuration])

  const chartMinuteRollups = useMemo(
    () => rollupsToChartMinuteRollups(rollups, streamStartedAt),
    [rollups, streamStartedAt],
  )

  const viewers = useMemo(
    () => rollups.map(viewerObservedValue),
    [rollups],
  )
  // The parent may reserve this lane when viewer capability is known even
  // before the first sample. Missing values stay blank/unavailable; an
  // explicit zero remains a real sample.
  const showViewerStrip = showViewerStripProp && (
    viewers.some(value => value != null)
    || viewerLaneExpected
    || viewerPeak != null
  )
  const chat = useMemo(
    () => rollups.map(point => (point.missing ? null : (point.chatCount ?? 0) || null)),
    [rollups],
  )
  const emotes = useMemo(
    () => rollups.map(point => (point.missing ? null : minuteEmoteTotal(point) || null)),
    [rollups],
  )

  const trendWindow = useMemo(() => trendSmoothingWindow(rollups.length), [rollups.length])
  const chatTrendValues = useMemo(
    () =>
      rampNullableSeriesFromStreamStart(
        extendSeriesToTrailingEdge(
          smoothNullableSeriesValues(chat, trendWindow),
        ),
      ),
    [chat, trendWindow],
  )
  const emoteTrendValues = useMemo(
    () =>
      rampNullableSeriesFromStreamStart(
        extendSeriesToTrailingEdge(
          smoothNullableSeriesValues(emotes, trendWindow),
        ),
      ),
    [emotes, trendWindow],
  )
  const chatDetailValues = useMemo(
    () =>
      rampNullableSeriesFromStreamStart(
        extendSeriesToTrailingEdge(chat),
      ),
    [chat],
  )
  const emoteDetailValues = useMemo(
    () =>
      rampNullableSeriesFromStreamStart(
        extendSeriesToTrailingEdge(emotes),
      ),
    [emotes],
  )

  const chatMax = useMemo(() => seriesMax(chat), [chat])
  const emoteMax = useMemo(() => seriesMax(emotes), [emotes])
  const chatTrendAxisMax = Math.max(chatMax, 1)
  const emoteTrendAxisMax = Math.max(emoteMax, 1)
  const chatBarAxisMax = useMemo(() => barDisplayAxisMax(chat), [chat])
  const emoteBarAxisMax = useMemo(() => barDisplayAxisMax(emotes), [emotes])
  const viewerAxis = useMemo(
    () => viewerScaleBounds(viewers, viewerPeak ?? 0, true),
    [viewers, viewerPeak],
  )
  const viewerAxisMin = viewerAxis.min
  const viewerAxisMax = viewerAxis.max

  const expansionProgress = Math.min(1, Math.max(0, activityExpansionProgress ?? (activityExpanded ? 1 : 0)))
  const normalizationProgress = activityExpansionProgress == null
    ? normalizeOverlaySeries ? 1 : 0
    : normalizeOverlaySeries ? expansionProgress : 0

  let viewerStripShare = showViewerStrip
    ? interpolateNumber(
      viewerLaneCompact ? 0.17 : VIEWER_STRIP_SHARE_COLLAPSED,
      focusedSeriesKey === 'viewers'
        ? (viewerLaneCompact ? 0.30 : 0.42)
        : (viewerLaneCompact ? 0.16 : VIEWER_STRIP_SHARE_EXPANDED),
      expansionProgress,
    )
    : 0

  const hasOverlayTraces = overlayLines.some(series => series.dashed)

  let chatFraction = !showViewerStrip
    ? SIDEBAR_CHAT_FRACTION
    : interpolateNumber(ACTIVITY_CHAT_FRACTION, ACTIVITY_CHAT_FRACTION_EXPANDED, expansionProgress)
  let traceFraction = !showViewerStrip
    ? SIDEBAR_EMOTE_TRACE_FRACTION
    : ACTIVITY_EMOTE_TRACE_FRACTION
  let emoteFraction = !showViewerStrip
    ? SIDEBAR_EMOTE_BARS_FRACTION
    : interpolateNumber(ACTIVITY_EMOTE_BARS_FRACTION, ACTIVITY_EMOTE_BARS_FRACTION_EXPANDED, expansionProgress)

  if (showViewerStrip && hasOverlayTraces) {
    chatFraction = interpolateNumber(0.50, 0.44, expansionProgress)
    traceFraction = interpolateNumber(0.16, 0.26, expansionProgress)
    emoteFraction = interpolateNumber(0.34, 0.30, expansionProgress)
  }

  const rebalanced = rebalanceFractionsForFocus(
    focusedSeriesKey,
    expansionProgress,
    chatFraction,
    traceFraction,
    emoteFraction,
  )
  chatFraction = rebalanced.chat
  traceFraction = rebalanced.trace
  emoteFraction = rebalanced.emote

  const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT)
  // Games are vertical dashed dividers only — do not reserve a top game band.
  const plotTop = PAD_TOP + 4
  const plotBottom = height - PAD_BOTTOM
  const plotHeight = Math.max(48, plotBottom - plotTop)
  const viewerBandTop = plotTop
  const viewerBandBottom = plotTop + plotHeight * viewerStripShare
  const activityTop = viewerBandBottom + (showViewerStrip ? 4 : 0)
  const activityBottom = plotBottom
  const chartOffsets = useMemo(
    () => rollups.map(point => point.offsetSeconds),
    [rollups],
  )
  const gameBandTop = PAD_TOP + 1
  const gameDividerExtent = Math.max(48, plotBottom - gameBandTop)

  const highlightedGamePlotBounds = useMemo(() => {
    if (!highlightedGameSegmentKey || chartGames.length === 0) return null
    const segment = chartGames.find(game => gameSegmentKey(game) === highlightedGameSegmentKey)
    if (!segment) return null
    if (chartOffsets.length > 0) {
      return gameSegmentPlotBoundsByOffsets(segment, chartOffsets, PAD_LEFT, plotWidth)
    }
    return gameSegmentPlotBounds(
      segment,
      chartMinuteRollups,
      streamStartedAt,
      PAD_LEFT,
      plotWidth,
    )
  }, [
    highlightedGameSegmentKey,
    chartGames,
    chartOffsets,
    chartMinuteRollups,
    streamStartedAt,
    plotWidth,
  ])

  const activityHeight = Math.max(24, activityBottom - activityTop)
  const crosshairTop = plotTop
  const crosshairBottom = plotBottom

  const chatLane = plotBandForActivityZone(
    activityTop,
    activityBottom,
    activityHeight,
    'activity-chat',
    chatFraction,
    traceFraction,
    emoteFraction,
  )
  const traceLane = plotBandForActivityZone(
    activityTop,
    activityBottom,
    activityHeight,
    'activity-emote-trace',
    chatFraction,
    traceFraction,
    emoteFraction,
  )
  const emoteLane = plotBandForActivityZone(
    activityTop,
    activityBottom,
    activityHeight,
    'activity-emote',
    chatFraction,
    traceFraction,
    emoteFraction,
  )

  const chatLaneTop = chatLane.bandTop
  const chatLaneBottom = chatLane.bandBottom
  const chatLaneHeight = Math.max(8, chatLane.bandHeight)
  const traceLaneTop = traceLane.bandTop
  const traceLaneBottom = traceLane.bandBottom
  const traceLaneHeight = Math.max(TRACE_LANE_MIN_HEIGHT, traceLane.bandHeight)
  const emoteLaneTop = emoteLane.bandTop
  const emoteLaneBottom = emoteLane.bandBottom
  const emoteLaneHeight = Math.max(8, emoteLane.bandHeight)

  // Leading-edge policy: the unsampled prefix stays NULL. Do not ramp or
  // backfill it. Both invent viewer history that Helix never observed, and the
  // ramp additionally overwrites authoritative sampled zeroes that precede the
  // first positive value ([0, 0, 100] would render as [0, 50, 100]). The
  // sampling-window marker ("Viewer tracking began") is what explains the gap;
  // a lone first sample renders with the existing horizontal stroke.
  const viewerTimedValues = useMemo<ViewerTimedValue[]>(
    () => rollups.map((point, index) => ({
      minuteTs: chartMinuteRollups[index]?.minuteTs ?? new Date(Math.max(0, point.offsetSeconds) * 1000).toISOString(),
      value: viewers[index] ?? null,
    })),
    [chartMinuteRollups, rollups, viewers],
  )
  const viewerSamplesObserved = viewerTimedValues.some(point => point.value != null)
  // Viewer geometry uses the timestamp domain and explicit null segments. It
  // preserves sparse endpoints and does not imply continuity across a long
  // unobserved interval, while chat/emote lines retain their existing lanes.
  const viewerGeometry = useMemo(() => {
    if (!showViewerStrip || !viewerSamplesObserved) return null
    const axisSpan = Math.max(1, viewerAxisMax - viewerAxisMin)
    return buildViewerGeometry(viewerTimedValues, viewerTimedValues, {
      width,
      padLeft: PAD_LEFT,
      padRight: PAD_RIGHT,
      bandTop: viewerBandTop,
      bandBottom: viewerBandBottom,
      plotCssWidth: plotWidth,
      valueToY: value => viewerBandBottom - ((value - viewerAxisMin) / axisSpan) * (viewerBandBottom - viewerBandTop),
    })
  }, [
    plotWidth,
    showViewerStrip,
    height,
    viewerAxisMax,
    viewerAxisMin,
    viewerBandBottom,
    viewerBandTop,
    viewerSamplesObserved,
    viewerTimedValues,
    width,
  ])
  const viewerAreaPath = viewerGeometry?.idleAreaPathD ?? ''
  const viewerLinePath = viewerGeometry?.idlePathD ?? ''

  const chatLinePath = useMemo(() => {
    if (chatMax <= 0) return ''
    return smoothLinePathInBand(
      chatTrendValues,
      chatTrendAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      chatLaneTop,
      chatLaneBottom,
    )
  }, [chatTrendValues, chatMax, chatTrendAxisMax, width, height, chatLaneTop, chatLaneBottom])

  const chatDetailLinePath = useMemo(() => {
    if (chatMax <= 0) return ''
    return smoothLinePathInBand(
      chatDetailValues,
      chatTrendAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      chatLaneTop,
      chatLaneBottom,
    )
  }, [chatDetailValues, chatMax, chatTrendAxisMax, width, height, chatLaneTop, chatLaneBottom])

  const emoteLinePath = useMemo(() => {
    if (emoteMax <= 0) return ''
    return smoothLinePathInBand(
      emoteTrendValues,
      emoteTrendAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      emoteLaneTop,
      emoteLaneBottom,
    )
  }, [emoteTrendValues, emoteMax, emoteTrendAxisMax, width, height, emoteLaneTop, emoteLaneBottom])

  const emoteDetailLinePath = useMemo(() => {
    if (emoteMax <= 0) return ''
    return smoothLinePathInBand(
      emoteDetailValues,
      emoteTrendAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      emoteLaneTop,
      emoteLaneBottom,
    )
  }, [emoteDetailValues, emoteMax, emoteTrendAxisMax, width, height, emoteLaneTop, emoteLaneBottom])

  const n = visibleRollups.length

  // Parent selection/preview props are FULL-domain indexes; render them in the
  // visible viewport domain by offset lookup (visible ⇄ full mapping both ways).
  const visibleIndexByOffset = useMemo(() => {
    const map = new Map<number, number>()
    visibleRollups.forEach((rollup, index) => {
      if (!map.has(rollup.offsetSeconds)) map.set(rollup.offsetSeconds, index)
    })
    return map
  }, [visibleRollups])
  const visibleIndexFromFull = useCallback(
    (fullIdx: number | null | undefined): number | null => {
      if (fullIdx == null) return null
      const rollup = sourceRollups[fullIdx]
      if (!rollup) return null
      return visibleIndexByOffset.get(rollup.offsetSeconds) ?? null
    },
    [sourceRollups, visibleIndexByOffset],
  )

  const visibleMomentMarkers = useMemo(() => {
    if (!showPeakMarkers || peakMarkers.length === 0 || n === 0) return []
    const firstOffset = visibleRollups[0]?.offsetSeconds ?? internalViewport.startSeconds
    const lastOffset = visibleRollups[n - 1]?.offsetSeconds ?? internalViewport.endSeconds
    const selectedPeaks = selectVisibleChartMomentPeaks(peakMarkers, firstOffset, lastOffset, MAX_CHART_MOMENT_MARKERS)
    return selectedPeaks.visible
      .map((peak, rank) => {
        const offsetSeconds = reactionAnalyticalOffset(peak)
        if (offsetSeconds < firstOffset - 60 || offsetSeconds > lastOffset + 60) return null
        const sourceIndex = nearestRollupIndex(visibleRollups, offsetSeconds)
        if (sourceIndex < 0) return null
        const signal = chartMomentSignal(peak)
        const band = signal === 'viewers'
          ? { top: viewerBandTop, bottom: viewerBandBottom }
          : signal === 'emotes'
            ? { top: emoteLaneTop, bottom: emoteLaneBottom }
            : { top: chatLaneTop, bottom: chatLaneBottom }
        const value = signal === 'viewers'
          ? viewers[sourceIndex]
          : signal === 'emotes'
            ? emoteTrendValues[sourceIndex]
            : chatTrendValues[sourceIndex]
        const axisMin = signal === 'viewers' ? viewerAxisMin : 0
        const axisMax = signal === 'viewers'
          ? viewerAxisMax
          : signal === 'emotes'
            ? emoteTrendAxisMax
            : chatTrendAxisMax
        return {
          peak,
          rank,
          key: chartMomentMarkerKey(peak.offsetSeconds, peak.score, rank),
          offsetSeconds,
          sourceIndex,
          x: interpolatePlotXForOffset(offsetSeconds, visibleRollups, plotWidth),
          y: chartMomentMarkerY({ value, axisMin, axisMax, band }),
          signal,
          color: CHART_MOMENT_MARKER_COLORS[signal],
        }
      })
      .filter((marker): marker is NonNullable<typeof marker> => marker !== null)
  }, [
    chatLaneBottom,
    chatLaneTop,
    chatTrendAxisMax,
    chatTrendValues,
    emoteTrendAxisMax,
    emoteTrendValues,
    emoteLaneBottom,
    emoteLaneTop,
    internalViewport.endSeconds,
    internalViewport.startSeconds,
    n,
    peakMarkers,
    plotWidth,
    showPeakMarkers,
    viewerAxisMax,
    viewerAxisMin,
    viewerBandBottom,
    viewerBandTop,
    viewers,
    visibleRollups,
  ])

  useEffect(() => {
    if (activeMomentMarkerKey == null) return
    if (!visibleMomentMarkers.some(marker => marker.key === activeMomentMarkerKey)) {
      setActiveMomentMarkerKey(null)
    }
  }, [activeMomentMarkerKey, visibleMomentMarkers])

  const handlePeakMarkerClick = useCallback((peak: ExtensionPeak, sourceIndex: number): void => {
    if (onSelectMoment) {
      onSelectMoment(peak)
      return
    }
    const fullIndex = fullIndexFromVisible(sourceIndex) ?? sourceIndex
    // Selection is sticky. Re-clicking the committed bucket confirms the
    // current inspection instead of silently dismissing it; Close, Escape,
    // or an intentional outside action are the explicit release paths.
    if (selectedIndex != null && fullIndex === selectedIndex) return
    onSelectIndex?.(fullIndex)
  }, [fullIndexFromVisible, onClearSelection, onSelectIndex, onSelectMoment, selectedIndex])

  const pinIndex = visibleIndexFromFull(selectedIndex ?? null)
  const previewVisibleIndex = visibleIndexFromFull(previewIndex ?? null)
  const listPreviewIndex =
    previewVisibleIndex != null && previewVisibleIndex !== pinIndex ? previewVisibleIndex : null

  // Pointer/keyboard preview is independent from the committed lock. This lets
  // a lighter preview move bucket-by-bucket while the locked bar stays strong.
  const activeIndex = hoveredBucketIndex ?? pinIndex ?? listPreviewIndex
  const detailPresentationState: 'idle' | 'preview' | 'locked' = pinIndex != null
    ? 'locked'
    : listPreviewIndex != null || chartHoverActive
      ? 'preview'
      : 'idle'
  const detailActive = detailPresentationState !== 'idle'
  // Preview and lock use one exact geometry. Crossfading the smooth overview
  // and raw detail paths made two same-colour traces visible at once whenever
  // their curves diverged.
  const overviewPresentationOpacity = detailPresentationState === 'idle' ? 1 : 0
  const detailPresentationOpacity = detailPresentationState === 'locked'
    ? 0.95
    : detailPresentationState === 'preview'
      ? 0.86
      : 0
  // Full-stream overview: attenuate resting signal strength so the dense full-range
  // timeline stays calm; zoomed ranges keep full strength.
  const viewportSpan = internalViewport.endSeconds - internalViewport.startSeconds
  const overviewRange =
    externalViewport != null &&
    durationSeconds > 0 &&
    viewportSpan >= Math.max(1, durationSeconds - FOLLOW_LIVE_EPSILON_SECONDS)
  const motionEnabled = !reducedMotion && !prefersReducedMotion()
  const markerFade = motionEnabled
    ? `opacity ${MARKER_FADE_MS}ms ${MARKER_FADE_EASING}`
    : undefined
  const overviewPathClassName = 'pulse-chart-overview-path'
  const detailPathClassName = 'pulse-chart-detail-path'
  const interactionLayerOpacity = activeIndex != null || highlightedGamePlotBounds != null ? 1 : 0
  const svgIds = {
    viewerGradient: `${chartId}-viewer-gradient`,
    plotClip: `${chartId}-plot-clip`,
    activityClip: `${chartId}-activity-clip`,
    viewerClip: `${chartId}-viewer-clip`,
    chatClip: `${chartId}-chat-clip`,
    traceClip: `${chartId}-trace-clip`,
    emoteClip: `${chartId}-emote-clip`,
  }
  // Overlay series values are aligned to the FULL rollup list by the parent; remap
  // them into the visible viewport domain so traces stay on the right minutes.
  const visibleOverlayLines = useMemo(
    () => {
      if (!externalViewport) return overlayLines
      return overlayLines.map(series => ({
        ...series,
        values: visibleRollups.map(r => {
          const fi = fullIndexByOffset.get(r.offsetSeconds)
          return fi == null ? 0 : (series.values[fi] ?? 0)
        }),
      }))
    },
    [overlayLines, externalViewport, visibleRollups, fullIndexByOffset],
  )
  const dashedOverlays = useMemo(
    () => visibleOverlayLines.filter(series => series.dashed),
    [visibleOverlayLines],
  )

  const traceAxis = useMemo(
    () => activityAxisBoundsFromZero(dashedOverlays.map(series => series.values)),
    [dashedOverlays],
  )

  const tracePaths = useMemo(() => {
    return dashedOverlays.map(series => {
      const smoothed = smoothSeriesValues(series.values, 3)
      const smoothValues = rampNullableSeriesFromStreamStart(
        smoothed.map(value => (value > 0 ? value : null)),
      )
      const detailValues = rampNullableSeriesFromStreamStart(
        series.values.map(value => (value > 0 ? value : null)),
      )
      const normalizedAxisMax = overlaySeriesAxisMax(detailValues, true, traceAxis.max)
      const axisMax = interpolateNumber(traceAxis.max, normalizedAxisMax, normalizationProgress)
      const axisMin = interpolateNumber(traceAxis.min, 0, normalizationProgress)
      const path =
        smoothLinePathInBand(
          smoothValues,
          axisMax,
          width,
          height,
          PAD_LEFT,
          PAD_RIGHT,
          traceLaneTop,
          traceLaneBottom,
          axisMin,
        ) || ''
      const detailPath =
        smoothLinePathInBand(
          detailValues,
          axisMax,
          width,
          height,
          PAD_LEFT,
          PAD_RIGHT,
          traceLaneTop,
          traceLaneBottom,
          axisMin,
        ) || ''
      return { ...series, path, detailPath }
    })
  }, [
    dashedOverlays,
    normalizationProgress,
    traceAxis,
    width,
    height,
    traceLaneTop,
    traceLaneBottom,
  ])


  const pinColumn = selectionColumnRect(
    pinIndex,
    n,
    plotWidth,
    crosshairTop,
    crosshairBottom,
    CHART_SELECTION_PIN_WASH,
    CHART_SELECTION_PIN_MIN_WIDTH,
  )
  const previewBucketIndex = hoveredBucketIndex != null && hoveredBucketIndex !== pinIndex
    ? hoveredBucketIndex
    : listPreviewIndex
  const previewColumn = selectionColumnRect(
    previewBucketIndex,
    n,
    plotWidth,
    crosshairTop,
    crosshairBottom,
    CHART_SELECTION_PREVIEW_WASH,
    CHART_SELECTION_PREVIEW_MIN_WIDTH,
  )

  const visibleViewerMarkerX = (offsetSeconds: number | null): number | null => {
    if (offsetSeconds == null || n === 0) return null
    const first = visibleRollups[0]?.offsetSeconds ?? 0
    const last = visibleRollups[n - 1]?.offsetSeconds ?? first
    if (offsetSeconds < first || offsetSeconds > last) return null
    return interpolatePlotXForOffset(offsetSeconds, visibleRollups, plotWidth)
  }
  const viewerStartMarkerX = visibleViewerMarkerX(viewerSampleStartOffsetSeconds)
  const viewerEndMarkerX = viewerSampleWindowComplete
    ? visibleViewerMarkerX(viewerSampleEndOffsetSeconds)
    : null

  const emoteBars = useMemo(() => {
    if (n === 0) return []
    const barWidth = overviewBarWidth(plotWidth, n)
    return emotes.map((value, index) => {
      const x = plotXForIndex(index, n, PAD_LEFT, plotWidth) - barWidth / 2
      const v = value ?? 0
      const barHeight = v > 0 ? (emoteLaneHeight * v) / emoteBarAxisMax : 1
      const y = emoteLaneBottom - barHeight
      return { key: `emote-${index}`, x, y, width: barWidth, height: Math.max(1, barHeight), hasValue: v > 0 }
    })
  }, [emotes, n, plotWidth, emoteBarAxisMax, emoteLaneBottom, emoteLaneHeight])

  const chatBars = useMemo(() => {
    if (n === 0) return []
    const barWidth = overviewBarWidth(plotWidth, n)
    return chat.map((value, index) => {
      const x = plotXForIndex(index, n, PAD_LEFT, plotWidth) - barWidth / 2
      const v = value ?? 0
      const barHeight = v > 0 ? (chatLaneHeight * v) / chatBarAxisMax : 1
      const y = chatLaneBottom - barHeight
      return { key: `chat-${index}`, x, y, width: barWidth, height: Math.max(1, barHeight), hasValue: v > 0 }
    })
  }, [chat, n, plotWidth, chatBarAxisMax, chatLaneBottom, chatLaneHeight])

  // Live render values for imperative chrome updates (hover runs outside React).
  const chromeStateRef = useRef({ visibleRollups, n, plotWidth })
  chromeStateRef.current = { visibleRollups, n, plotWidth }
  // The imperative hover layer writes bar-group opacity directly. It must know
  // about a committed pin, otherwise clearing hover hides a lane that React
  // still considers visible — and React will not repair it, because the
  // rendered `opacity` prop did not change across that update.
  const pinIndexRef = useRef<number | null>(pinIndex)
  pinIndexRef.current = pinIndex

  // React owns committed chrome (pin/preview); reapply the imperative hover
  // layer whenever the underlying geometry or committed state changes so a
  // stale hover position never survives a resize/viewport/pin update.
  useLayoutEffect(() => {
    const hover = hoverIndexRef.current
    if (hover == null) {
      // Restore React-owned committed attributes that imperative hover may
      // have overwritten during a previous pointer pass.
      const svg = svgRef.current
      if (svg) {
        svg.removeAttribute('data-chart-hover-index')
        if (listPreviewIndex != null) {
          svg.setAttribute('data-chart-preview-index', String(listPreviewIndex))
        } else {
          svg.removeAttribute('data-chart-preview-index')
        }
      }
      // Reassert lane visibility from React state. The reconciler skips the
      // write when the rendered `opacity` prop is unchanged, so an imperative
      // hover teardown can otherwise leave a pinned lane hidden.
      const restedOpacity = activeIndex != null ? '1' : '0'
      interactionLayerRef.current?.setAttribute('opacity', restedOpacity)
      emoteBarsGroupRef.current?.setAttribute('opacity', restedOpacity)
      chatBarsGroupRef.current?.setAttribute('opacity', restedOpacity)
      return
    }
    applyInspectionDOM(hover)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, n, plotWidth, listPreviewIndex])

  // Imperative inspection shell (Aug-16 pattern): direct pointer hover moves the
  // marker and reveals whisper bars without reconciling
  // the chart subtree. Committed pins/previews still flow through React props.
  function applyInspectionDOM(index: number | null): void {
    const svg = svgRef.current
    if (svg) {
      // Direct hover previews through the same attribute the committed
      // list-preview uses; the resync layout effect restores React's value
      // whenever committed state or geometry changes.
      if (index == null) {
        svg.removeAttribute('data-chart-hover-index')
        if (listPreviewIndex != null) {
          svg.setAttribute('data-chart-preview-index', String(listPreviewIndex))
        } else {
          svg.removeAttribute('data-chart-preview-index')
        }
      } else {
        svg.setAttribute('data-chart-hover-index', String(index))
        svg.setAttribute('data-chart-preview-index', String(index))
      }
    }
    // A committed pin keeps the lanes and the locked bucket visible after the
    // pointer leaves. Only an unpinned chart returns to the resting hidden state.
    const visible = index != null || pinIndexRef.current != null
    const layer = interactionLayerRef.current
    if (layer) layer.setAttribute('opacity', visible ? '1' : '0')
    const emoteGroup = emoteBarsGroupRef.current
    if (emoteGroup) emoteGroup.setAttribute('opacity', visible ? '1' : '0')
    const chatGroup = chatBarsGroupRef.current
    if (chatGroup) chatGroup.setAttribute('opacity', visible ? '1' : '0')
  }

  function setChartHoverState(active: boolean): void {
    if (chartHoverActiveRef.current === active) return
    chartHoverActiveRef.current = active
    setChartHoverActive(active)
  }

  function clearHoverPreview(): void {
    if (hoverIndexRef.current == null) return
    hoverIndexRef.current = null
    setHoveredBucketIndex(null)
    applyInspectionDOM(null)
    onHoverOffsetChange?.(null)
  }

  useEffect(() => {
    const index = hoverIndexRef.current
    if (index == null || visibleRollups[index]?.missing !== true) return
    clearHoverPreview()
  }, [visibleRollups])

  function flushPlotViewport(): void {
    if (plotFrameRef.current != null) {
      cancelAnimationFrame(plotFrameRef.current)
      plotFrameRef.current = null
    }
    const pending = pendingPlotViewportRef.current
    pendingPlotViewportRef.current = null
    if (pending) onViewportChange?.(pending)
  }

  function queuePlotViewport(next: ChartViewport): void {
    pendingPlotViewportRef.current = next
    if (plotFrameRef.current != null) return
    plotFrameRef.current = requestAnimationFrame(() => {
      plotFrameRef.current = null
      const pending = pendingPlotViewportRef.current
      pendingPlotViewportRef.current = null
      if (pending) onViewportChange?.(pending)
    })
  }

  function finishPlotInteraction(pointerId?: number): void {
    const scrubber = scrubberRef.current
    if (pointerId != null) {
      try {
        scrubber?.releasePointerCapture(pointerId)
      } catch {
        // Pointer capture may already have been released.
      }
    }
    plotDragRef.current = null
    pendingPlotViewportRef.current = null
    if (plotFrameRef.current != null) {
      cancelAnimationFrame(plotFrameRef.current)
      plotFrameRef.current = null
    }
    setPlotDragging(false)
  }

  function handlePlotPointerDown(event: ReactPointerEvent<SVGRectElement>): void {
    if (n === 0) return
    event.stopPropagation()
    suppressNextClickRef.current = false
    plotDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      movedPx: 0,
      active: false,
      startViewport: internalViewport,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort; normal hover still works without it.
    }
    handlePointer(event.clientX, event.clientY, event.currentTarget)
  }

  function handlePlotPointerMove(event: ReactPointerEvent<SVGRectElement>): void {
    const state = plotDragRef.current
    if (!state || state.pointerId !== event.pointerId) {
      handlePointer(event.clientX, event.clientY, event.currentTarget)
      return
    }
    const deltaPx = event.clientX - state.startClientX
    state.movedPx = Math.max(state.movedPx, Math.abs(deltaPx))
    const rect = event.currentTarget.getBoundingClientRect()
    const visibleDuration = state.startViewport.endSeconds - state.startViewport.startSeconds
    const availableDuration = Math.max(0, durationSeconds - coverageStartSeconds)
    if (!state.active && state.movedPx > PLOT_DRAG_THRESHOLD_PX && onViewportChange && rect.width > 0) {
      if (visibleDuration < availableDuration - FOLLOW_LIVE_EPSILON_SECONDS) {
        state.active = true
        setPlotDragging(true)
        suppressNextClickRef.current = true
        clearHoverPreview()
      }
    }
    if (!state.active) {
      handlePointer(event.clientX, event.clientY, event.currentTarget)
      return
    }
    event.stopPropagation()
    const deltaSeconds = panDeltaSecondsFromPointer(deltaPx, visibleDuration, rect.width)
    queuePlotViewport(panViewport(
      state.startViewport,
      deltaSeconds,
      durationSeconds,
      true,
      coverageStartSeconds,
    ))
  }

  function handlePlotPointerUp(event: ReactPointerEvent<SVGRectElement>): void {
    const state = plotDragRef.current
    if (!state || state.pointerId !== event.pointerId) return
    if (state.active) {
      event.preventDefault()
      event.stopPropagation()
      flushPlotViewport()
      clearHoverPreview()
    }
    finishPlotInteraction(event.pointerId)
  }

  function handlePlotPointerCancel(event: ReactPointerEvent<SVGRectElement>): void {
    const state = plotDragRef.current
    if (state?.active) clearHoverPreview()
    finishPlotInteraction(event.pointerId)
  }

  function flushHoverIndex(): void {
    hoverFrameRef.current = null
    const pending = pendingHoverTargetRef.current
    pendingHoverTargetRef.current = null
    const bounds = captureBoundsRef.current
    if (!pending || !bounds) return
    const index = indexForPointer(pending.clientX, pending.clientY, bounds)
    if (hoverIndexRef.current === index) return
    hoverIndexRef.current = index
    setHoveredBucketIndex(index)
    applyInspectionDOM(index)
    const offset =
      index != null ? chromeStateRef.current.visibleRollups[index]?.offsetSeconds ?? null : null
    onHoverOffsetChange?.(offset)
  }

  function handlePointer(clientX: number, clientY: number, target: SVGRectElement): void {
    setChartHoverState(true)
    if (!captureBoundsRef.current) {
      const rect = target.getBoundingClientRect()
      captureBoundsRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    }
    pendingHoverTargetRef.current = { clientX, clientY }
    if (hoverFrameRef.current != null) return
    hoverFrameRef.current = requestAnimationFrame(flushHoverIndex)
  }

  function handlePointerLeave(): void {
    setChartHoverState(false)
    pendingHoverTargetRef.current = null
    captureBoundsRef.current = null
    if (hoverFrameRef.current != null) {
      cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
    clearHoverPreview()
  }

  const viewerPointerHitRegions = useMemo(() => {
    const firstOffset = visibleRollups[0]?.offsetSeconds ?? internalViewport.startSeconds
    const lastOffset = visibleRollups[n - 1]?.offsetSeconds ?? internalViewport.endSeconds
    const span = Math.max(0, lastOffset - firstOffset)
    return buildChartHitRegions(visibleRollups.map((point, index) => ({
      index,
      centerX: span > 0 ? ((point.offsetSeconds - firstOffset) / span) * plotWidth : 0,
      selectable: !point.missing,
    })))
  }, [visibleRollups, n, plotWidth, internalViewport.startSeconds, internalViewport.endSeconds])
  const activityPointerHitRegions = useMemo(() => buildChartHitRegions(
    visibleRollups.map((point, index) => ({
      index,
      centerX: plotXForIndex(index, n, 0, plotWidth),
      selectable: !point.missing,
    })),
  ), [visibleRollups, n, plotWidth])

  /** Resolve only bounded sample regions; timestamp gaps are not selectable. */
  function indexForPointer(
    clientX: number,
    clientY: number,
    bounds: { left: number; top: number; width: number; height: number },
  ): number | null {
    if (n <= 0 || bounds.width <= 0 || bounds.height <= 0) return null
    const fraction = clampNumber((clientX - bounds.left) / bounds.width, 0, 1)
    const plotY = PAD_TOP + ((clientY - bounds.top) / bounds.height) * (height - PAD_TOP - PAD_BOTTOM)
    // Viewer geometry is timestamp-based; activity lanes still use index spacing.
    const regions = showViewerStrip && plotY <= viewerBandBottom
      ? viewerPointerHitRegions
      : activityPointerHitRegions
    return chartHitRegionAtX(regions, fraction * plotWidth)?.index ?? null
  }

  function previewKeyboardIndex(index: number, direction: -1 | 1): void {
    if (n <= 0) return
    let next = Math.min(n - 1, Math.max(0, index))
    while (next >= 0 && next < n && visibleRollups[next].missing) next += direction
    if (next < 0 || next >= n) {
      const current = hoverIndexRef.current
      if (current != null && (!visibleRollups[current] || visibleRollups[current].missing)) {
        clearHoverPreview()
      }
      return
    }
    pendingHoverTargetRef.current = null
    hoverIndexRef.current = next
    setHoveredBucketIndex(next)
    applyInspectionDOM(next)
    onHoverOffsetChange?.(visibleRollups[next]?.offsetSeconds ?? null)
  }

  function handleClick(event: MouseEvent<SVGRectElement>): void {
    if (n === 0) return
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    captureBoundsRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    const index = indexForPointer(event.clientX, event.clientY, captureBoundsRef.current)
    const clickedFullIndex = index == null ? null : (fullIndexFromVisible(index) ?? index)
    if (clickedFullIndex == null) return
    pendingHoverTargetRef.current = null
    if (hoverFrameRef.current != null) {
      cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
    clearHoverPreview()
    if (selectedIndex != null && clickedFullIndex === selectedIndex) {
      onClearSelection?.()
      return
    }
    // Repeated bucket clicks only select time; legend controls own series focus.
    onSelectIndex?.(clickedFullIndex)
  }

  const shellStyle = { ...styles.shell, height, minHeight: height }

  if (loading) {
    return (
      <div ref={containerRef} id={chartRegionId} style={shellStyle}>
        <div style={styles.empty}>Loading timeline…</div>
      </div>
    )
  }

  if (n === 0) {
    return (
      <div ref={containerRef} id={chartRegionId} style={shellStyle}>
        <div style={styles.empty}>{emptyMessage ?? 'No chart data yet'}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} id={chartRegionId} className="pulse-sparkline-wrap" style={shellStyle}>
      <svg
        ref={svgRef}
        data-testid="pulse-overview-chart"
        data-chart-hover-render="imperative"
        data-chart-point-count={n}
        data-chart-point-cap={EXTENSION_CHART_MAX_POINTS}
        data-chart-viewport-start={internalViewport.startSeconds}
        data-chart-viewport-end={internalViewport.endSeconds}
        data-chart-viewer-axis-min={showViewerStrip ? viewerAxisMin : undefined}
        data-chart-viewer-axis-max={showViewerStrip ? viewerAxisMax : undefined}
        data-chart-viewer-lane={showViewerStrip ? 'true' : 'false'}
        data-chart-viewer-strip-share={showViewerStrip ? viewerStripShare.toFixed(2) : undefined}
        data-chart-active-index={activeIndex ?? undefined}
        data-chart-active-offset={
          activeIndex != null ? visibleRollups[activeIndex]?.offsetSeconds ?? undefined : undefined
        }
        data-chart-locked-index={pinIndex ?? undefined}
        data-chart-preview-index={hoveredBucketIndex ?? listPreviewIndex ?? undefined}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        className="pulse-overview-chart"
        aria-label="Chat and emote activity timeline with viewer context. Move or drag across the plot to inspect a moment."
        data-chart-mode={detailPresentationState}
        data-chart-presentation={detailPresentationState}
        data-chart-geometry="single"
        style={{ ...styles.svg, height }}
      >
        <defs>
          <linearGradient id={svgIds.viewerGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_THEME.viewer.color} stopOpacity={CHART_THEME.viewer.fillTop} />
            <stop offset="100%" stopColor={CHART_THEME.viewer.color} stopOpacity={CHART_THEME.viewer.fillBottom} />
          </linearGradient>
          <filter id={`${chartId}-bar-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
          </filter>
          <clipPath id={svgIds.plotClip}>
            <rect x={PAD_LEFT} y={PAD_TOP} width={plotWidth} height={height - PAD_TOP - PAD_BOTTOM} />
          </clipPath>
          <clipPath id={svgIds.activityClip}>
            <rect x={PAD_LEFT} y={activityTop} width={plotWidth} height={activityBottom - activityTop} />
          </clipPath>
          <clipPath id={svgIds.viewerClip}>
            <rect
              x={PAD_LEFT}
              y={viewerBandTop}
              width={plotWidth}
              height={Math.max(1, viewerBandBottom - viewerBandTop)}
            />
          </clipPath>
          <clipPath id={svgIds.chatClip}>
            <rect x={PAD_LEFT} y={chatLaneTop} width={plotWidth} height={chatLaneHeight} />
          </clipPath>
          <clipPath id={svgIds.traceClip}>
            <rect x={PAD_LEFT} y={traceLaneTop} width={plotWidth} height={traceLaneHeight} />
          </clipPath>
          <clipPath id={svgIds.emoteClip}>
            <rect x={PAD_LEFT} y={emoteLaneTop} width={plotWidth} height={emoteLaneHeight} />
          </clipPath>
        </defs>

        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={viewerBandTop}
          y2={viewerBandTop}
          stroke="rgba(255,255,255,0.055)"
          strokeWidth="1"
          opacity={showViewerStrip ? 1 : 0}
        />
        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={activityBottom}
          y2={activityBottom}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
          opacity={detailActive ? 1 : 0}
        />

        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={viewerBandBottom + 2}
          y2={viewerBandBottom + 2}
          stroke="rgba(255,255,255,0.10)"
          strokeWidth="1"
          opacity={showViewerStrip ? 1 : 0}
        />

        {showViewerStrip ? (
          <g data-chart-viewer-lane-label="true" pointerEvents="none">
            <rect
              x={PAD_LEFT + 4}
              y={viewerBandTop + 4}
              width={42}
              height={13}
              rx={4}
              fill="rgba(8, 15, 24, 0.72)"
              stroke={hexToRgba(CHART_THEME.viewer.color, 0.32)}
              strokeWidth="0.75"
            />
            <text
              x={PAD_LEFT + 25}
              y={viewerBandTop + 13}
              fill={CHART_THEME.viewer.color}
              fontSize="7.5"
              fontWeight="800"
              letterSpacing="0.04em"
              textAnchor="middle"
            >
              Viewers
            </text>
          </g>
        ) : null}

        <g clipPath={`url(#${svgIds.plotClip})`}>
          <g
            data-chart-layer="signals"
            opacity={1}
          >
          {showViewerStrip ? (
            <rect
              x={PAD_LEFT}
              y={viewerBandTop}
              width={plotWidth}
              height={viewerBandBottom - viewerBandTop}
              fill="rgba(255,255,255,0.02)"
            />
          ) : null}
          {showViewerStrip && viewerLinePath ? (
            <g clipPath={`url(#${svgIds.viewerClip})`}>
              <g data-chart-viewer-line="true" data-chart-viewer-renderer="shared-no-dot" data-chart-series="viewers">
                <ViewerNoDotPath
                  lineD={viewerLinePath}
                  areaD={viewerAreaPath}
                  gradientId={svgIds.viewerGradient}
                  lineOpacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', overviewRange ? 0.72 : 0.88)}
                  areaOpacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', overviewRange ? 0.07 : 0.11)}
                  color={CHART_THEME.viewer.color}
                  strokeWidth={RESTING_TREND_STROKE}
                  motionEnabled={motionEnabled}
                />
              </g>
            </g>
          ) : null}
          {showViewerStrip && viewerStartMarkerX != null ? (
            <g data-viewer-sample-marker="start" pointerEvents="none" aria-hidden="true">
              <line
                x1={viewerStartMarkerX}
                x2={viewerStartMarkerX}
                y1={viewerBandTop}
                y2={viewerBandBottom}
                stroke={CHART_THEME.viewer.color}
                strokeWidth={1.25}
                strokeDasharray="3 2"
                opacity={0.72}
              />
              <text
                x={Math.min(width - PAD_RIGHT - 4, viewerStartMarkerX + 4)}
                y={viewerBandBottom - 4}
                fill={CHART_THEME.viewer.color}
                fontSize="7.5"
                fontWeight="750"
              >
                Viewer tracking began
              </text>
            </g>
          ) : null}
          {showViewerStrip && viewerEndMarkerX != null && viewerEndMarkerX !== viewerStartMarkerX ? (
            <g data-viewer-sample-marker="end" pointerEvents="none" aria-hidden="true">
              <line
                x1={viewerEndMarkerX}
                x2={viewerEndMarkerX}
                y1={viewerBandTop}
                y2={viewerBandBottom}
                stroke={CHART_THEME.viewer.color}
                strokeWidth={1.1}
                strokeDasharray="3 2"
                opacity={0.58}
              />
              <text
                x={Math.max(PAD_LEFT + 4, viewerEndMarkerX - 4)}
                y={viewerBandBottom - 4}
                fill={CHART_THEME.viewer.color}
                fontSize="7.5"
                fontWeight="700"
                textAnchor="end"
              >
                Viewer tracking ended
              </text>
            </g>
          ) : null}
          {showViewerStrip && !viewerGeometry ? (
            <g clipPath={`url(#${svgIds.viewerClip})`} opacity={0.35}>
              <line
                x1={PAD_LEFT}
                x2={width - PAD_RIGHT}
                y1={(viewerBandTop + viewerBandBottom) / 2}
                y2={(viewerBandTop + viewerBandBottom) / 2}
                stroke={CHART_THEME.viewer.color}
                strokeWidth="1"
                strokeDasharray="4 6"
                opacity={0.4}
              />
              <text
                x={width / 2}
                y={viewerBandBottom - 4}
                fill={CHART_THEME.viewer.color}
                fontSize="8"
                fontWeight="600"
                textAnchor="middle"
                opacity={0.5}
              >
                {viewerUpdatesPaused
                  ? 'Viewer updates paused'
                  : viewerLaneExpected
                    ? 'waiting for viewer samples…'
                    : 'viewer data unavailable'}
              </text>
            </g>
          ) : null}
          <rect
            x={PAD_LEFT}
            y={activityTop}
            width={plotWidth}
            height={activityBottom - activityTop}
            fill={CHART_INTERACTION.activityFill}
          />
          {pinColumn ? (
            <rect
              x={pinColumn.x}
              y={pinColumn.y}
              width={pinColumn.width}
              height={pinColumn.height}
              fill={pinColumn.fill}
              rx={2}
              data-chart-selection-band="locked"
              data-chart-bucket-index={pinIndex ?? undefined}
              pointerEvents="none"
            />
          ) : null}
          {previewColumn ? (
            <rect
              x={previewColumn.x}
              y={previewColumn.y}
              width={previewColumn.width}
              height={previewColumn.height}
              fill={previewColumn.fill}
              rx={2}
              data-chart-selection-band="preview"
              data-chart-bucket-index={previewBucketIndex ?? undefined}
              pointerEvents="none"
            />
          ) : null}
          <line
            x1={PAD_LEFT}
            x2={width - PAD_RIGHT}
            y1={chatLaneBottom + 1}
            y2={chatLaneBottom + 1}
            stroke={CHART_INTERACTION.gridLine}
            strokeWidth="1"
            opacity={0.55}
          />
          <line
            x1={PAD_LEFT}
            x2={width - PAD_RIGHT}
            y1={traceLaneBottom + 1}
            y2={traceLaneBottom + 1}
            stroke={CHART_INTERACTION.gridLine}
            strokeWidth="1"
            opacity={0.45}
          />

          <g clipPath={`url(#${svgIds.emoteClip})`}>
            <g
              ref={emoteBarsGroupRef}
              data-chart-signal-group="emotes"
              opacity={activeIndex != null ? 1 : 0}
            >
            <SignalBarLane
              bars={emoteBars}
              seriesKey="emotes"
              color={CHART_THEME.emote.color}
              pinIndex={pinIndex}
              activeIndex={activeIndex}
              focusedSeriesKey={focusedSeriesKey}
              restAlpha={0.18}
            />
            </g>
            {emoteLinePath ? (
              <path
                className={overviewPathClassName}
                d={emoteLinePath}
                data-chart-path-state="overview"
                data-chart-series="emotes"
                fill="none"
                stroke={CHART_THEME.emote.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth={EMOTE_TREND_STROKE}
                  opacity={seriesFocusOpacity(
                    focusedSeriesKey,
                    'emotes',
                    overviewPresentationOpacity * (overviewRange ? 0.3 : 0.58),
                  )}
                pointerEvents="none"
              />
            ) : null}
            {emoteDetailLinePath ? (
              <path
                className={detailPathClassName}
                d={emoteDetailLinePath}
                data-chart-layer="detail-overlay"
                data-chart-path-state="detail"
                data-chart-series="emotes"
                fill="none"
                stroke={CHART_THEME.emote.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={EMOTE_TREND_STROKE}
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes', detailPresentationOpacity)}
                pointerEvents="none"
              />
            ) : null}
          </g>

          <g clipPath={`url(#${svgIds.chatClip})`}>
            <g
              ref={chatBarsGroupRef}
              data-chart-signal-group="chat"
              opacity={activeIndex != null ? 1 : 0}
            >
            <SignalBarLane
              bars={chatBars}
              seriesKey="chat"
              color={CHART_THEME.chat.color}
              pinIndex={pinIndex}
              activeIndex={activeIndex}
              focusedSeriesKey={focusedSeriesKey}
              restAlpha={0.08}
            />
            </g>
            {chatLinePath ? (
              <path
                className={overviewPathClassName}
                d={chatLinePath}
                data-chart-path-state="overview"
                data-chart-series="chat"
                fill="none"
                stroke={CHART_THEME.chat.line}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth={CHAT_TREND_STROKE}
                  opacity={seriesFocusOpacity(
                    focusedSeriesKey,
                    'chat',
                    overviewPresentationOpacity * (overviewRange ? 0.3 : 0.58),
                  )}
                pointerEvents="none"
              />
            ) : null}
            {chatDetailLinePath ? (
              <path
                className={detailPathClassName}
                d={chatDetailLinePath}
                data-chart-layer="detail-overlay"
                data-chart-path-state="detail"
                data-chart-series="chat"
                fill="none"
                stroke={CHART_THEME.chat.line}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={CHAT_TREND_STROKE}
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'chat', detailPresentationOpacity)}
                pointerEvents="none"
              />
            ) : null}
          </g>

          <g clipPath={`url(#${svgIds.traceClip})`}>
            {tracePaths.map(series => {
              if (!series.path) return null
              return (
                <g key={series.key}>
                  <path
                    className={`sc-emote-plot-line ${overviewPathClassName}`}
                    d={series.path}
                    data-chart-path-state="overview"
                    fill="none"
                    stroke={series.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={normalizeOverlaySeries ? 2.25 : TRACE_LINE_STROKE}
                    strokeDasharray={normalizationProgress >= 1 ? undefined : series.dash ?? '4 3'}
                     opacity={seriesFocusOpacity(
                       focusedSeriesKey,
                       series.key,
                       overviewPresentationOpacity * (overviewRange ? 0.25 : 0.58),
                     )}
                   />
                   <path
                     className={detailPathClassName}
                     d={series.detailPath}
                     data-chart-layer="detail-overlay"
                     data-chart-path-state="detail"
                     data-chart-series={series.key}
                     fill="none"
                     stroke={series.color}
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     strokeWidth={normalizeOverlaySeries ? 2.25 : TRACE_LINE_STROKE}
                     strokeDasharray={normalizationProgress >= 1 ? undefined : series.dash ?? '4 3'}
                     opacity={seriesFocusOpacity(
                       focusedSeriesKey,
                       series.key,
                       detailPresentationOpacity * TRACE_LINE_OPACITY,
                     )}
                  />
                </g>
              )
            })}
          </g>
          </g>
        </g>

        <g
          ref={interactionLayerRef}
          data-chart-layer="interaction"
          opacity={interactionLayerOpacity}
          pointerEvents="none"
          style={{ transition: markerFade }}
        >
        {/* Paint game dividers above chat/emote bars so they stay visible through the full plot. */}
        {chartGames.length > 0 ? (
          <GameSegmentOverlay
            segments={chartGames}
            rollups={chartMinuteRollups}
            streamStartedAt={streamStartedAt}
            chartOffsets={chartOffsets}
            padLeft={PAD_LEFT}
            plotWidth={plotWidth}
            gameBandTop={gameBandTop}
            gameBandHeight={0}
            dividerExtent={gameDividerExtent}
            highlightedSegmentKey={highlightedGameSegmentKey}
            isLive={isLive}
          />
        ) : null}

        {/* Games-played hover band above series (portal parity) so it is actually visible. */}
        {highlightedGamePlotBounds ? (
          <g
            pointerEvents="none"
            aria-hidden="true"
            data-game-highlight={highlightedGameSegmentKey ?? undefined}
          >
            <rect
              x={highlightedGamePlotBounds.startX}
              y={viewerBandTop}
              width={Math.max(1, highlightedGamePlotBounds.endX - highlightedGamePlotBounds.startX)}
              height={Math.max(1, activityBottom - viewerBandTop)}
              fill="rgba(249, 115, 22, 0.22)"
            />
            <line
              x1={highlightedGamePlotBounds.startX}
              x2={highlightedGamePlotBounds.startX}
              y1={viewerBandTop}
              y2={activityBottom}
              stroke="rgba(249, 115, 22, 0.95)"
              strokeWidth={2.5}
            />
            <line
              x1={highlightedGamePlotBounds.endX}
              x2={highlightedGamePlotBounds.endX}
              y1={viewerBandTop}
              y2={activityBottom}
              stroke="rgba(249, 115, 22, 0.7)"
              strokeWidth={2}
              strokeDasharray="4 3"
            />
          </g>
        ) : null}

        {axisTicks(n).map(tickIndex => {
          const offset = rollups[tickIndex]?.offsetSeconds ?? 0
          const x = plotXForIndex(tickIndex, n, PAD_LEFT, plotWidth)
          const isLast = tickIndex === n - 1
          const endOffset = offset > 0 ? offset : durationSeconds
          const label = isLast && isLive ? 'Now' : formatHeatOffset(isLast ? endOffset : offset)
          const insetX = isLast ? Math.min(x, width - PAD_RIGHT - 2) : x
          return (
            <text
              key={tickIndex}
              x={insetX}
              y={height - 4}
              fill="rgba(161, 161, 170, 0.95)"
              fontSize="9"
              fontWeight="700"
              textAnchor={tickIndex === 0 ? 'start' : isLast ? 'end' : 'middle'}
            >
              {label}
            </text>
          )
        })}
        </g>

        <rect
          ref={scrubberRef}
          data-chart-scrubber="true"
          tabIndex={onSelectIndex || onViewportChange ? 0 : undefined}
          role="application"
          aria-label="Chart plot. Press Enter to inspect the previewed minute, Escape to release the selection."
          x={PAD_LEFT}
          y={PAD_TOP}
          width={plotWidth}
          height={height - PAD_TOP - PAD_BOTTOM}
          fill="transparent"
          style={{ cursor: plotDragging ? 'grabbing' : 'crosshair', outline: 'none', touchAction: 'none' }}
          onPointerDown={handlePlotPointerDown}
          onPointerMove={event => {
            // Contain pointer gestures (hover scrub, drag intent) inside the chart.
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.stopPropagation()
            }
            handlePlotPointerMove(event)
          }}
          onPointerLeave={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              handlePointerLeave()
            }
          }}
          onPointerUp={event => {
            handlePlotPointerUp(event)
            // A drag ending outside the plot must not leave stale hover chrome.
            const rect = event.currentTarget.getBoundingClientRect()
            const inside =
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom
            if (!inside) handlePointerLeave()
          }}
          onPointerCancel={event => {
            handlePlotPointerCancel(event)
            handlePointerLeave()
          }}
          onLostPointerCapture={() => {
            if (plotDragRef.current?.active) clearHoverPreview()
            finishPlotInteraction()
          }}
          onClick={handleClick}
          onKeyDown={event => {
            // Escape clears ephemeral hover first, then the committed lock, then
            // the viewport. It also releases focus so a following Tab is honest.
            if (event.key === 'Escape') {
              event.preventDefault()
              handlePointerLeave()
              if (pinIndex != null) {
                onClearSelection?.()
              } else if (onViewportChange && durationSeconds > 0) {
                onViewportChange({ startSeconds: coverageStartSeconds, endSeconds: durationSeconds })
              }
              event.currentTarget.blur()
              return
            }
            // Enter/Space commit the previewed bucket as a lock.
            if ((event.key === 'Enter' || event.key === ' ') && onSelectIndex) {
              const lockable = hoverIndexRef.current ?? listPreviewIndex
              if (lockable != null) {
                event.preventDefault()
                if (!visibleRollups[lockable] || visibleRollups[lockable].missing) {
                  clearHoverPreview()
                  return
                }
                const fullIndex = fullIndexFromVisible(lockable) ?? lockable
                clearHoverPreview()
                if (selectedIndex !== fullIndex) onSelectIndex(fullIndex)
              }
              return
            }
            if (onSelectIndex && n > 0) {
              const current = hoverIndexRef.current ?? pinIndex ?? listPreviewIndex ?? 0
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                const direction = event.key === 'ArrowLeft' ? -1 : 1
                previewKeyboardIndex(current + direction, direction)
                return
              }
              if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                previewKeyboardIndex(event.key === 'Home' ? 0 : n - 1, event.key === 'Home' ? 1 : -1)
                return
              }
            }
            if (!onViewportChange || durationSeconds <= 0) return
            const currentDuration = internalViewport.endSeconds - internalViewport.startSeconds
            if (event.key === '+' || event.key === '=') {
              event.preventDefault()
              onViewportChange(zoomViewport({ viewport: internalViewport, zoomSeconds: Math.max(Math.min(MIN_VIEWPORT_SECONDS, Math.max(0, durationSeconds - coverageStartSeconds)), currentDuration / 1.5), durationSeconds, coverageStartSeconds }))
            } else if (event.key === '-') {
              event.preventDefault()
              onViewportChange(zoomViewport({ viewport: internalViewport, zoomSeconds: Math.min(Math.max(0, durationSeconds - coverageStartSeconds), currentDuration * 1.5), durationSeconds, coverageStartSeconds }))
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              onViewportChange(panViewport(internalViewport, event.key === 'ArrowLeft' ? -60 : 60, durationSeconds, true, coverageStartSeconds))
            }
          }}
        />

        {/* Paint after the transparent scrubber so opted-in moment dots are
            actual interactive targets instead of being covered by the plot. */}
        {visibleMomentMarkers.length > 0 ? (
          <g data-chart-moment-markers="true" aria-label="Top moment markers">
            {visibleMomentMarkers.map(marker => {
              const active = marker.sourceIndex === pinIndex || activeMomentMarkerKey === marker.key
              const presentation = chartMomentMarkerPresentation(active)
              const clock = momentClockDisplay(marker.peak)
              const accessibleClock = `minute bucket ${clock.text}`
              return (
                <g
                  key={marker.key}
                  opacity={seriesFocusOpacity(focusedSeriesKey, marker.signal, 1)}
                  pointerEvents="none"
                >
                  {presentation.showGuide ? (
                    <line
                      data-chart-moment-marker-guide="true"
                      data-chart-moment-marker-guide-state="active"
                      x1={marker.x}
                      x2={marker.x}
                      y1={crosshairTop}
                      y2={crosshairBottom}
                      stroke={marker.color}
                      strokeWidth="1"
                      strokeDasharray={presentation.guideDasharray}
                      opacity={presentation.guideOpacity}
                      pointerEvents="none"
                    />
                  ) : null}
                <g
                  data-chart-moment-marker="true"
                  data-chart-moment-marker-offset={marker.offsetSeconds}
                  data-chart-moment-marker-precision={marker.peak.precisionSeconds ?? undefined}
                  data-chart-moment-marker-state={active ? 'active' : 'resting'}
                  role={onSelectIndex || onSelectMoment ? 'button' : undefined}
                  tabIndex={onSelectIndex || onSelectMoment ? 0 : undefined}
                  aria-label={`${accessibleClock} ${marker.peak.reasonLabel ?? marker.signal} · score ${Math.round(marker.peak.score)}`}
                  pointerEvents={onSelectIndex || onSelectMoment ? 'all' : 'none'}
                  style={{ cursor: onSelectIndex || onSelectMoment ? 'pointer' : 'default' }}
                  onMouseEnter={() => setActiveMomentMarkerKey(marker.key)}
                  onMouseLeave={() => setActiveMomentMarkerKey(current => current === marker.key ? null : current)}
                  onFocus={() => setActiveMomentMarkerKey(marker.key)}
                  onBlur={() => setActiveMomentMarkerKey(current => current === marker.key ? null : current)}
                  onClick={event => {
                    event.stopPropagation()
                    handlePeakMarkerClick(marker.peak, marker.sourceIndex)
                  }}
                  onKeyDown={event => {
                    if ((!onSelectIndex && !onSelectMoment) || (event.key !== 'Enter' && event.key !== ' ')) return
                    event.preventDefault()
                    event.stopPropagation()
                    handlePeakMarkerClick(marker.peak, marker.sourceIndex)
                  }}
                >
                  <title>
                    {accessibleClock} · {marker.peak.reasonLabel ?? marker.signal} · score {Math.round(marker.peak.score)}
                  </title>
                  {presentation.haloRadius > 0 ? (
                      <circle
                        cx={marker.x}
                        cy={marker.y}
                        r={presentation.haloRadius}
                        fill={marker.color}
                        opacity={presentation.haloOpacity}
                        pointerEvents="none"
                      />
                  ) : null}
                  <circle
                    cx={marker.x}
                    cy={marker.y}
                    r="9"
                    fill="transparent"
                    pointerEvents="all"
                  />
                  <path
                    data-spike-symbol="diamond"
                    d={`M ${marker.x} ${marker.y - 5.5} l 5.5 5.5 -5.5 5.5 -5.5 -5.5 Z`}
                    fill="#fbbf24"
                    stroke="#111117"
                    strokeWidth="2"
                    opacity="1"
                    pointerEvents="none"
                  />
                </g>
              </g>
              )
            })}
          </g>
        ) : null}
      </svg>
    </div>
  )
}

// Memoized (Aug-16 pattern): parent poll renders must not reconcile the whole
// chart subtree; imperative hover already bypasses React for pointer chrome.
export const PulseOverviewChart = memo(PulseOverviewChartImpl)

const styles: Record<string, CSSProperties> = {
  shell: {
    background: CHART_THEME.background,
    borderRadius: 8,
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  svg: {
    display: 'block',
    width: '100%',
  },
  empty: {
    alignItems: 'center',
    color: 'rgba(161, 161, 170, 0.95)',
    display: 'grid',
    fontSize: 11,
    fontWeight: 700,
    height: '100%',
    minHeight: 0,
    padding: '0 12px',
    placeItems: 'center',
    textAlign: 'center',
  },
}
