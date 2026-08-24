import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, RefObject } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import { formatCount } from './mostReacted.ts'
import {
  GameSegmentOverlay,
  gameSegmentKey,
  gameSegmentPlotBounds,
  gameSegmentPlotBoundsByOffsets,
  normalizeGameSegments as normalizeChartGameSegments,
  type ChartGameSegment,
  type ChartMinuteRollup,
} from '@streampulse/pulse-charts'
import type { ExtensionGameSegment, ExtensionRollup } from '../shared/messages.ts'
import { activityAxisBoundsFromZero, overlaySeriesAxisMax } from './chatActivityEmotes.ts'
import type { EmoteOverlaySeries } from './chatActivityEmotes.ts'
import { CHART_BAR_ALPHA, CHART_INTERACTION, CHART_LANE, CHART_THEME, hexToRgba } from './chartTheme.ts'
import {
  areaPathInBand,
  barDisplayAxisMax,
  chartBarBucketOpacity,
  chartDurationSeconds,
  chartViewerValue,
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
import { resolveChartCrosshairMode } from './chartCrosshair.ts'
import { prefersReducedMotion, useSmoothedScalar } from './motion/useSmoothedScalar.ts'
import { downsampleRollupsForChart, EXTENSION_CHART_MAX_POINTS, nearestRollupIndex } from './extensionChartPoints.ts'
import { FOLLOW_LIVE_EPSILON_SECONDS, MIN_VIEWPORT_SECONDS, viewportBuckets, wheelZoom, zoomViewport, panViewport, type ChartViewport } from './chartViewport.ts'

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
  onSelectIndex?: (index: number) => void
  onClearSelection?: () => void
  /** Clicks inside this node (e.g. Selected moment card below chart) must not clear the pin. */
  clearSelectionBoundaryRef?: RefObject<HTMLElement | null>
  onHoverOffsetChange?: (offsetSeconds: number | null) => void
  emptyMessage?: string
  loading?: boolean
  isLive?: boolean
  emoteSyncTone?: 'ok' | 'warn' | 'muted'
  overlayLines?: EmoteOverlaySeries[]
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

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 160
const PAD_LEFT = 4
const PAD_RIGHT = 12
const PAD_TOP = 14
const PAD_BOTTOM = 12
const VIEWER_STRIP_SHARE_COLLAPSED = 0.18
const VIEWER_STRIP_SHARE_EXPANDED = 0.12
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
const TRACE_LINE_STROKE = 2.25
const TRACE_LINE_OPACITY = 0.95
const FOCUS_DIM_FACTOR = 0.14
const FOCUS_LANE_BOOST = 0.78
// Hover chrome fades in/out with one short ease-out; plotted data geometry is
// always immediate (no line morphing, no delayed data animation).
const MARKER_FADE_MS = 140
const MARKER_FADE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const SCRUB_FUTURE_STROKE = 'rgba(161, 161, 170, 0.52)'
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type ActivityZone = 'activity-chat' | 'activity-emote-trace' | 'activity-emote'

function seriesFocusOpacity(
  focusedSeriesKey: string | null | undefined,
  seriesKey: string,
  base: number,
): number {
  if (!focusedSeriesKey) return base
  if (seriesKey === focusedSeriesKey) return base
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
): { x: number; y: number; width: number; height: number; fill: string } | null {
  if (index == null || n <= 0) return null
  const barWidth = overviewBarWidth(plotWidth, n)
  const x = plotXForIndex(index, n, PAD_LEFT, plotWidth) - barWidth / 2
  return { x, y: top, width: barWidth, height: Math.max(1, bottom - top), fill }
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
        const base = (() => {
          if (!bar.hasValue) return CHART_BAR_ALPHA.empty
          if (pinIndex === index) return CHART_BAR_ALPHA.selectedSpike
          return chartBarBucketOpacity({
            index,
            activeIndex,
            baseOpacity: restAlpha,
            highlightOpacity: Math.min(1, restAlpha * 2.4),
            fadeFutureAfterActive: true,
          })
        })()
        const opacity = seriesFocusOpacity(focusedSeriesKey, seriesKey, base)
        return (
          <rect
            key={key}
            {...geometry}
            data-chart-signal-bar={seriesKey}
            fill={color}
            opacity={opacity}
            pointerEvents="none"
          />
        )
      })}
    </>
  )
})

const DIRECT_HOVER_MARKER_STYLE: CSSProperties = {
  opacity: 0,
  pointerEvents: 'none',
}

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
  onSelectIndex,
  onClearSelection,
  clearSelectionBoundaryRef,
  onHoverOffsetChange,
  emptyMessage,
  loading = false,
  overlayLines = [],
  normalizeOverlaySeries = false,
  reducedMotion = false,
  isLive = false,
  focusedSeriesKey = null,
  onFocusedSeriesKeyChange,
  highlightedGameSegmentKey = null,
  viewport: externalViewport,
  coverageStartSeconds = 0,
  onViewportChange,
  onJumpToOffset,
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
  const directHoverMarkerRef = useRef<SVGLineElement | null>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  // Pointer previews are committed to lightweight SVG chrome imperatively
  // (Aug-16 hover shell): keeping them out of React prevents every hovered
  // bucket from reconciling the complete chart subtree.
  const hoverIndexRef = useRef<number | null>(null)
  const interactionLayerRef = useRef<SVGGElement | null>(null)
  const emoteBarsGroupRef = useRef<SVGGElement | null>(null)
  const chatBarsGroupRef = useRef<SVGGElement | null>(null)
  const readoutGroupRef = useRef<SVGGElement | null>(null)
  const readoutRectRef = useRef<SVGRectElement | null>(null)
  const readoutTextRef = useRef<SVGTextElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const pendingHoverTargetRef = useRef<{ clientX: number } | null>(null)
  const hoverFrameRef = useRef<number | null>(null)
  const captureBoundsRef = useRef<{ left: number; width: number } | null>(null)
  const scrubberRef = useRef<SVGRectElement | null>(null)
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
    return () => {
      if (hoverFrameRef.current != null) {
        cancelAnimationFrame(hoverFrameRef.current)
        hoverFrameRef.current = null
      }
      pendingHoverTargetRef.current = null
      captureBoundsRef.current = null
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
      if (event.defaultPrevented) return
      clearHoverPreview()
      onClearSelection?.()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [clearSelectionBoundaryRef, onClearSelection, onHoverOffsetChange])

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
    () => rollups.map(point => (point.missing ? null : chartViewerValue(point) || null)),
    [rollups],
  )
  // The parent may know that viewer samples exist elsewhere in the full
  // timeline. Only reserve the viewer lane when the current viewport contains
  // a real sample, otherwise the chart spends space on an empty lane.
  const showViewerStrip = showViewerStripProp && viewers.some(value => value != null && value > 0)
  const chat = useMemo(
    () => rollups.map(point => (point.missing ? null : (point.chatCount ?? 0) || null)),
    [rollups],
  )
  const emotes = useMemo(
    () => rollups.map(point => (point.missing ? null : minuteEmoteTotal(point) || null)),
    [rollups],
  )

  const trendWindow = useMemo(() => trendSmoothingWindow(rollups.length), [rollups.length])
  const viewerTrendValues = useMemo(
    () => smoothNullableSeriesValues(viewers, trendWindow),
    [viewers, trendWindow],
  )
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
  const viewerDetailValues = useMemo(
    () => viewers,
    [viewers],
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

  const viewerMax = useMemo(() => seriesMax(viewerTrendValues), [viewerTrendValues])
  const chatMax = useMemo(() => seriesMax(chat), [chat])
  const emoteMax = useMemo(() => seriesMax(emotes), [emotes])
  const chatTrendAxisMax = Math.max(chatMax, 1)
  const emoteTrendAxisMax = Math.max(emoteMax, 1)
  const chatBarAxisMax = useMemo(() => barDisplayAxisMax(chat), [chat])
  const emoteBarAxisMax = useMemo(() => barDisplayAxisMax(emotes), [emotes])
  const viewerAxisMax = Math.max(viewerMax, 1)

  const expansionProgress = Math.min(1, Math.max(0, activityExpansionProgress ?? (activityExpanded ? 1 : 0)))
  const normalizationProgress = activityExpansionProgress == null
    ? normalizeOverlaySeries ? 1 : 0
    : normalizeOverlaySeries ? expansionProgress : 0

  let viewerStripShare = showViewerStrip
    ? interpolateNumber(
      VIEWER_STRIP_SHARE_COLLAPSED,
      focusedSeriesKey === 'viewers' ? 0.42 : VIEWER_STRIP_SHARE_EXPANDED,
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

  const viewerAreaPath = useMemo(() => {
    if (viewerMax <= 0) return ''
    return areaPathInBand(
      viewerTrendValues,
      viewerAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      viewerBandTop,
      viewerBandBottom,
    )
  }, [viewerTrendValues, viewerMax, viewerAxisMax, width, height, viewerBandTop, viewerBandBottom])

  const viewerLinePath = useMemo(() => {
    if (viewerMax <= 0) return ''
    return smoothLinePathInBand(
      viewerTrendValues,
      viewerAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      viewerBandTop,
      viewerBandBottom,
    )
  }, [viewerTrendValues, viewerMax, viewerAxisMax, width, height, viewerBandTop, viewerBandBottom])

  const viewerDetailAreaPath = useMemo(() => {
    if (viewerMax <= 0) return ''
    return areaPathInBand(
      viewerDetailValues,
      viewerAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      viewerBandTop,
      viewerBandBottom,
    )
  }, [viewerDetailValues, viewerMax, viewerAxisMax, width, height, viewerBandTop, viewerBandBottom])

  const viewerDetailLinePath = useMemo(() => {
    if (viewerMax <= 0) return ''
    return smoothLinePathInBand(
      viewerDetailValues,
      viewerAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      viewerBandTop,
      viewerBandBottom,
    )
  }, [viewerDetailValues, viewerMax, viewerAxisMax, width, height, viewerBandTop, viewerBandBottom])

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

  const pinIndex = visibleIndexFromFull(selectedIndex ?? null)
  const previewVisibleIndex = visibleIndexFromFull(previewIndex ?? null)
  const listPreviewIndex =
    previewVisibleIndex != null && previewVisibleIndex !== pinIndex ? previewVisibleIndex : null

  const activeIndex = pinIndex ?? listPreviewIndex
  // Raw past/future detail paths render only for a committed inspection (pin or
  // legend/preview). Direct pointer hover reveals marker/bars/readout imperatively
  // while keeping the single smoothed line geometry — no double-painted underlay,
  // and no React reconciliation per hovered bucket.
  const detailActive = pinIndex != null || listPreviewIndex != null
  // Full-stream overview: attenuate resting signal strength so the dense full-range
  // timeline stays calm; zoomed ranges keep full strength.
  const viewportSpan = internalViewport.endSeconds - internalViewport.startSeconds
  const overviewRange =
    externalViewport != null &&
    durationSeconds > 0 &&
    viewportSpan >= Math.max(1, durationSeconds - FOLLOW_LIVE_EPSILON_SECONDS)
  const motionEnabled = !reducedMotion && !prefersReducedMotion()
  const scrubX =
    activeIndex != null && n > 0
      ? plotXForIndex(activeIndex, n, PAD_LEFT, plotWidth)
      : width - PAD_RIGHT
  const scrubPastWidth = Math.max(0, Math.min(plotWidth, scrubX - PAD_LEFT + 1))
  const scrubFutureX = Math.max(PAD_LEFT, Math.min(width - PAD_RIGHT, scrubX))
  const scrubFutureWidth = Math.max(0, width - PAD_RIGHT - scrubFutureX)
  const markerFade = motionEnabled
    ? `opacity ${MARKER_FADE_MS}ms ${MARKER_FADE_EASING}`
    : undefined
  const interactionLayerOpacity = activeIndex != null || highlightedGamePlotBounds != null ? 1 : 0
  const activeRollup = activeIndex != null ? visibleRollups[activeIndex] : undefined
  const activeViewerValue = activeIndex != null ? viewers[activeIndex] : null
  const activeTimeLabel = activeRollup
    ? formatHeatOffset(activeRollup.offsetSeconds) +
      (activeViewerValue != null ? ` · ${formatCount(activeViewerValue)}` : '')
    : ''
  const activeTimeLabelWidth = Math.max(34, activeTimeLabel.length * 5.5 + 12)
  const activeTimeLabelX = Math.max(
    PAD_LEFT,
    Math.min(width - PAD_RIGHT - activeTimeLabelWidth, scrubX - activeTimeLabelWidth / 2),
  )
  const svgIds = {
    viewerGradient: `${chartId}-viewer-gradient`,
    plotClip: `${chartId}-plot-clip`,
    activityClip: `${chartId}-activity-clip`,
    viewerClip: `${chartId}-viewer-clip`,
    chatClip: `${chartId}-chat-clip`,
    traceClip: `${chartId}-trace-clip`,
    emoteClip: `${chartId}-emote-clip`,
    scrubPastClip: `${chartId}-scrub-past-clip`,
    scrubFutureClip: `${chartId}-scrub-future-clip`,
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

  const toggleSeriesFocus = useCallback((seriesKey: string) => {
    if (!onFocusedSeriesKeyChange) return
    onFocusedSeriesKeyChange(focusedSeriesKey === seriesKey ? null : seriesKey)
  }, [focusedSeriesKey, onFocusedSeriesKeyChange])

  const pinColumn = selectionColumnRect(
    pinIndex,
    n,
    plotWidth,
    crosshairTop,
    crosshairBottom,
    'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1)',
  )
  const hoverColumn = pinIndex == null
    ? selectionColumnRect(
      listPreviewIndex,
      n,
      plotWidth,
      crosshairTop,
      crosshairBottom,
      'rgba(255, 255, 255, 0.06)',
    )
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
  const chromeStateRef = useRef({ visibleRollups, viewers, n, plotWidth, width })
  chromeStateRef.current = { visibleRollups, viewers, n, plotWidth, width }

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
      return
    }
    applyInspectionDOM(hover)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, n, plotWidth, listPreviewIndex])

  // Imperative inspection shell (Aug-16 pattern): direct pointer hover moves the
  // marker, reveals whisper bars, and rewrites the readout without reconciling
  // the chart subtree. Committed pins/previews still flow through React props.
  function applyInspectionDOM(index: number | null): void {
    const svg = svgRef.current
    if (svg) {
      // Direct hover previews through the same attribute the committed
      // list-preview uses; the resync layout effect restores React's value
      // whenever committed state or geometry changes.
      if (index == null) {
        svg.removeAttribute('data-chart-hover-index')
        svg.removeAttribute('data-chart-preview-index')
      } else {
        svg.setAttribute('data-chart-hover-index', String(index))
        svg.setAttribute('data-chart-preview-index', String(index))
      }
    }
    const visible = index != null
    const layer = interactionLayerRef.current
    if (layer) layer.setAttribute('opacity', visible ? '1' : '0')
    const emoteGroup = emoteBarsGroupRef.current
    if (emoteGroup) emoteGroup.setAttribute('opacity', visible ? '1' : '0')
    const chatGroup = chatBarsGroupRef.current
    if (chatGroup) chatGroup.setAttribute('opacity', visible ? '1' : '0')
    const chrome = chromeStateRef.current
    const marker = directHoverMarkerRef.current
    if (marker) {
      if (visible) {
        const x = plotXForIndex(index, chrome.n, PAD_LEFT, chrome.plotWidth)
        marker.setAttribute('x1', String(x))
        marker.setAttribute('x2', String(x))
        marker.style.opacity = '0.75'
      } else {
        marker.style.opacity = '0'
      }
    }
    const readout = readoutGroupRef.current
    if (readout) readout.setAttribute('opacity', visible ? '1' : '0')
    if (visible) {
      const rectEl = readoutRectRef.current
      const textEl = readoutTextRef.current
      const rollup = chrome.visibleRollups[index]
      if (rectEl && textEl && rollup) {
        const viewerValue = chrome.viewers[index]
        const label =
          formatHeatOffset(rollup.offsetSeconds) +
          (viewerValue != null ? ` · ${formatCount(viewerValue)}` : '')
        const labelWidth = Math.max(34, label.length * 5.5 + 12)
        const x = plotXForIndex(index, chrome.n, PAD_LEFT, chrome.plotWidth)
        const labelX = Math.max(
          PAD_LEFT,
          Math.min(chrome.width - PAD_RIGHT - labelWidth, x - labelWidth / 2),
        )
        rectEl.setAttribute('x', String(labelX))
        rectEl.setAttribute('width', String(labelWidth))
        textEl.setAttribute('x', String(labelX + labelWidth / 2))
        textEl.textContent = label
      }
    }
  }

  function clearHoverPreview(): void {
    if (hoverIndexRef.current == null && !directHoverMarkerRef.current) return
    hoverIndexRef.current = null
    applyInspectionDOM(null)
    onHoverOffsetChange?.(null)
  }

  function flushHoverIndex(): void {
    hoverFrameRef.current = null
    const pending = pendingHoverTargetRef.current
    pendingHoverTargetRef.current = null
    const bounds = captureBoundsRef.current
    if (!pending || !bounds) return
    const index = indexForPointer(pending.clientX, bounds)
    if (hoverIndexRef.current === index) return
    hoverIndexRef.current = index
    applyInspectionDOM(index)
    const offset =
      index != null ? chromeStateRef.current.visibleRollups[index]?.offsetSeconds ?? null : null
    onHoverOffsetChange?.(offset)
  }

  function handlePointer(clientX: number, target: SVGRectElement): void {
    if (!captureBoundsRef.current) {
      const rect = target.getBoundingClientRect()
      captureBoundsRef.current = { left: rect.left, width: rect.width }
    }
    pendingHoverTargetRef.current = { clientX }
    if (hoverFrameRef.current != null) return
    hoverFrameRef.current = requestAnimationFrame(flushHoverIndex)
  }

  function handlePointerLeave(): void {
    pendingHoverTargetRef.current = null
    captureBoundsRef.current = null
    if (hoverFrameRef.current != null) {
      cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
    clearHoverPreview()
  }

  /** Resolve pointer pixels against ordered sample time, not array position. */
  function indexForPointer(clientX: number, bounds: { left: number; width: number }): number | null {
    if (n <= 0 || bounds.width <= 0) return null
    const fraction = clampNumber((clientX - bounds.left) / bounds.width, 0, 1)
    const firstOffset = visibleRollups[0]?.offsetSeconds ?? internalViewport.startSeconds
    const lastOffset = visibleRollups[n - 1]?.offsetSeconds ?? internalViewport.endSeconds
    const targetOffset = firstOffset + fraction * Math.max(0, lastOffset - firstOffset)
    const index = nearestRollupIndex(visibleRollups, targetOffset)
    return index >= 0 ? index : null
  }

  function previewKeyboardIndex(index: number): void {
    if (n <= 0) return
    const next = Math.min(n - 1, Math.max(0, index))
    pendingHoverTargetRef.current = null
    hoverIndexRef.current = next
    applyInspectionDOM(next)
    onHoverOffsetChange?.(visibleRollups[next]?.offsetSeconds ?? null)
  }

  function laneKeyFromPointerY(clientY: number, svgRect: DOMRect): string | null {
    const y = ((clientY - svgRect.top) / svgRect.height) * height
    if (showViewerStrip && y >= viewerBandTop && y <= viewerBandBottom) return 'viewers'
    if (y >= chatLaneTop && y <= chatLaneBottom) return 'chat'
    if (y >= traceLaneTop && y <= traceLaneBottom) return 'emotes'
    if (y >= emoteLaneTop && y <= emoteLaneBottom) return 'emotes'
    return null
  }

  function handleClick(event: MouseEvent<SVGRectElement>): void {
    if (n === 0) return
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    captureBoundsRef.current = { left: rect.left, width: rect.width }
    if (onFocusedSeriesKeyChange && event.detail >= 2) {
      const laneKey = laneKeyFromPointerY(event.clientY, rect)
      if (laneKey) {
        toggleSeriesFocus(laneKey)
        return
      }
    }
    const index = indexForPointer(event.clientX, { left: rect.left, width: rect.width })
    pendingHoverTargetRef.current = null
    if (hoverFrameRef.current != null) {
      cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
    const clickedFullIndex = index == null ? null : (fullIndexFromVisible(index) ?? index)
    // The lock takes over the chrome: clear ephemeral hover state so the
    // committed pin/preview rendering is the single visible inspection.
    clearHoverPreview()
    // Clicking the already-locked bucket releases the lock (toggle).
    if (clickedFullIndex == null) return
    if (selectedIndex != null && clickedFullIndex === selectedIndex) {
      onClearSelection?.()
      return
    }
    onSelectIndex?.(clickedFullIndex)
  }

  const pinTargetX =
    pinIndex != null && n > 0 ? plotXForIndex(pinIndex, n, PAD_LEFT, plotWidth) : 0
  const listPreviewTargetX =
    listPreviewIndex != null && n > 0
      ? plotXForIndex(listPreviewIndex, n, PAD_LEFT, plotWidth)
      : 0
  // Preview/pin lines track their bucket immediately (no smoothing lag/drift);
  // only hover chrome fades, via markerFade above.
  const smoothListPreviewX = useSmoothedScalar(
    listPreviewTargetX,
    false,
  )
  const pinX = pinIndex != null ? pinTargetX : null
  const listPreviewLineX = listPreviewIndex != null ? smoothListPreviewX : null
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
        data-chart-active-index={activeIndex ?? undefined}
        data-chart-active-offset={
          activeIndex != null ? visibleRollups[activeIndex]?.offsetSeconds ?? undefined : undefined
        }
        data-chart-locked-index={pinIndex ?? undefined}
        data-chart-preview-index={listPreviewIndex ?? undefined}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        className="pulse-overview-chart"
        aria-label="Chat and emote activity timeline with viewer context. Move or drag across the plot to inspect a moment."
        data-chart-mode={detailActive ? 'detail' : 'signals'}
        style={{ ...styles.svg, height }}
      >
        <defs>
          <linearGradient id={svgIds.viewerGradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_THEME.viewer.color} stopOpacity={CHART_THEME.viewer.fillTop} />
            <stop offset="100%" stopColor={CHART_THEME.viewer.color} stopOpacity={CHART_THEME.viewer.fillBottom} />
          </linearGradient>
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
          <clipPath id={svgIds.scrubPastClip}>
            <rect
              x={PAD_LEFT}
              y={PAD_TOP}
              width={scrubPastWidth}
              height={height - PAD_TOP - PAD_BOTTOM}
            />
          </clipPath>
          <clipPath id={svgIds.scrubFutureClip}>
            <rect
              x={scrubFutureX}
              y={PAD_TOP}
              width={scrubFutureWidth}
              height={height - PAD_TOP - PAD_BOTTOM}
            />
          </clipPath>
        </defs>

        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={viewerBandTop}
          y2={viewerBandTop}
          stroke={hexToRgba(CHART_THEME.viewer.color, CHART_THEME.viewer.guide * 0.85)}
          strokeWidth="1"
          opacity={detailActive && showViewerStrip ? 1 : 0}
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
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
          opacity={detailActive && showViewerStrip ? 1 : 0}
        />

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
          {showViewerStrip && viewerAreaPath ? (
            <g clipPath={`url(#${svgIds.viewerClip})`}>
              <path
                d={viewerAreaPath}
                fill={`url(#${svgIds.viewerGradient})`}
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', detailActive ? 0.06 : 0.03)}
              />
              <path
                d={viewerDetailAreaPath}
                fill="rgba(161, 161, 170, 0.12)"
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', detailActive ? 1 : 0)}
                clipPath={`url(#${svgIds.scrubFutureClip})`}
              />
              <path
                d={viewerDetailAreaPath}
                fill={`url(#${svgIds.viewerGradient})`}
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', detailActive ? 0.14 : 0)}
                clipPath={`url(#${svgIds.scrubPastClip})`}
              />
            </g>
          ) : null}
          {showViewerStrip && viewerLinePath ? (
            <g clipPath={`url(#${svgIds.viewerClip})`}>
              <path
                d={viewerLinePath}
                data-chart-series="viewers"
                fill="none"
                stroke={CHART_THEME.viewer.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth={RESTING_TREND_STROKE}
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', detailActive ? 0 : overviewRange ? 0.55 : 0.62)}
              />
              <path
                d={viewerDetailLinePath}
                data-chart-layer="detail-future"
                fill="none"
                stroke={SCRUB_FUTURE_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth="1.1"
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', detailActive ? 0.22 : 0)}
                clipPath={`url(#${svgIds.scrubFutureClip})`}
              />
              <path
                d={viewerDetailLinePath}
                data-chart-layer="detail-past"
                fill="none"
                stroke={CHART_THEME.viewer.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth="1.35"
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', detailActive ? 0.34 : 0)}
                clipPath={`url(#${svgIds.scrubPastClip})`}
              />
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
              pointerEvents="none"
            />
          ) : null}
          {hoverColumn ? (
            <rect
              x={hoverColumn.x}
              y={hoverColumn.y}
              width={hoverColumn.width}
              height={hoverColumn.height}
              fill={hoverColumn.fill}
              rx={2}
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
              restAlpha={0.12}
            />
            </g>
            {emoteLinePath ? (
              <path
                d={emoteLinePath}
                data-chart-series="emotes"
                fill="none"
                stroke={CHART_THEME.emote.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth={EMOTE_TREND_STROKE}
                  opacity={seriesFocusOpacity(
                    focusedSeriesKey,
                    'emotes',
                    detailActive ? 0 : overviewRange ? 0.3 : 0.58,
                  )}
                pointerEvents="none"
              />
            ) : null}
            {emoteDetailLinePath ? (
              <path
                d={emoteDetailLinePath}
                fill="none"
                stroke={SCRUB_FUTURE_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={EMOTE_TREND_STROKE}
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes', detailActive ? 0.44 : 0)}
                clipPath={`url(#${svgIds.scrubFutureClip})`}
                pointerEvents="none"
              />
            ) : null}
            {emoteDetailLinePath ? (
              <path
                d={emoteDetailLinePath}
                fill="none"
                stroke={CHART_THEME.emote.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth={EMOTE_TREND_STROKE}
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes', detailActive ? 0.94 : 0)}
                clipPath={`url(#${svgIds.scrubPastClip})`}
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
                d={chatLinePath}
                data-chart-series="chat"
                fill="none"
                stroke={CHART_THEME.chat.line}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth={CHAT_TREND_STROKE}
                  opacity={seriesFocusOpacity(
                    focusedSeriesKey,
                    'chat',
                    detailActive ? 0 : overviewRange ? 0.3 : 0.58,
                  )}
                pointerEvents="none"
              />
            ) : null}
            {chatDetailLinePath ? (
              <path
                d={chatDetailLinePath}
                data-chart-layer="detail-future"
                fill="none"
                stroke={SCRUB_FUTURE_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={CHAT_TREND_STROKE}
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'chat', detailActive ? 0.46 : 0)}
                clipPath={`url(#${svgIds.scrubFutureClip})`}
                pointerEvents="none"
              />
            ) : null}
            {chatDetailLinePath ? (
              <path
                d={chatDetailLinePath}
                data-chart-layer="detail-past"
                fill="none"
                stroke={CHART_THEME.chat.line}
                strokeLinecap="round"
                strokeLinejoin="round"
                 strokeWidth={CHAT_TREND_STROKE}
                 opacity={seriesFocusOpacity(focusedSeriesKey, 'chat', detailActive ? 0.96 : 0)}
                clipPath={`url(#${svgIds.scrubPastClip})`}
                pointerEvents="none"
              />
            ) : null}
          </g>

          <g clipPath={`url(#${svgIds.traceClip})`}>
            {tracePaths.map(series => {
              if (!series.path) return null
              const baseOpacity = detailActive ? TRACE_LINE_OPACITY : overviewRange ? 0.25 : 0.55
              return (
                <g key={series.key}>
                  <path
                    className="sc-emote-plot-line"
                    d={series.path}
                    fill="none"
                    stroke={series.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={normalizeOverlaySeries ? 2.25 : TRACE_LINE_STROKE}
                    strokeDasharray={normalizationProgress >= 1 ? undefined : series.dash ?? '4 3'}
                     opacity={seriesFocusOpacity(
                       focusedSeriesKey,
                       series.key,
                       detailActive ? 0 : overviewRange ? 0.25 : 0.58,
                     )}
                   />
                   <path
                     d={series.detailPath}
                     fill="none"
                     stroke={SCRUB_FUTURE_STROKE}
                     strokeLinecap="round"
                     strokeLinejoin="round"
                     strokeWidth={normalizeOverlaySeries ? 2.25 : TRACE_LINE_STROKE}
                     strokeDasharray={normalizationProgress >= 1 ? undefined : series.dash ?? '4 3'}
                     opacity={seriesFocusOpacity(
                       focusedSeriesKey,
                       series.key,
                       detailActive ? 0.42 : 0,
                     )}
                    clipPath={`url(#${svgIds.scrubFutureClip})`}
                  />
                  <path
                    d={series.detailPath}
                    fill="none"
                    stroke={series.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                     strokeWidth={normalizeOverlaySeries ? 2.25 : TRACE_LINE_STROKE}
                     strokeDasharray={normalizationProgress >= 1 ? undefined : series.dash ?? '4 3'}
                     opacity={seriesFocusOpacity(
                       focusedSeriesKey,
                       series.key,
                       detailActive ? TRACE_LINE_OPACITY : 0,
                     )}
                    clipPath={`url(#${svgIds.scrubPastClip})`}
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

        <line
          ref={directHoverMarkerRef}
          data-chart-hover-marker="true"
          x1={PAD_LEFT}
          x2={PAD_LEFT}
          y1={crosshairTop}
          y2={crosshairBottom}
          stroke={CHART_INTERACTION.hoverLine}
          strokeWidth="1"
          strokeDasharray="2 2"
          style={DIRECT_HOVER_MARKER_STYLE}
        />

        {listPreviewLineX != null ? (
          <line data-chart-hover-band="muted"
            x1={listPreviewLineX}
            x2={listPreviewLineX}
            y1={crosshairTop}
            y2={crosshairBottom}
            stroke={CHART_INTERACTION.previewLine}
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity={0.7}
            pointerEvents="none"
          />
        ) : null}

        {pinX != null ? (
          <line
            x1={pinX}
            x2={pinX}
            y1={crosshairTop}
            y2={crosshairBottom}
            stroke={CHART_INTERACTION.pinLine}
            strokeWidth="1.5"
            strokeDasharray="2 2"
            pointerEvents="none"
          />
        ) : null}

        {/* Always mounted: hover updates position/text imperatively; the
            interaction layer opacity hides it when nothing is inspected. */}
        <g ref={readoutGroupRef} pointerEvents="none" aria-hidden="true">
          <rect
            ref={readoutRectRef}
            x={activeTimeLabelX}
            y={1}
            width={activeTimeLabelWidth}
            height={14}
            rx={7}
            fill="rgba(7, 12, 20, 0.92)"
            stroke={CHART_INTERACTION.hoverLine}
            strokeWidth={0.75}
          />
          <text
            ref={readoutTextRef}
            x={activeTimeLabelX + activeTimeLabelWidth / 2}
            y={11}
            fill={CHART_INTERACTION.hoverLine}
            fontSize="8.5"
            fontWeight="800"
            textAnchor="middle"
          >
            {activeTimeLabel}
          </text>
        </g>

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
          style={{ cursor: 'crosshair', outline: 'none', touchAction: 'none' }}
          onPointerDown={event => {
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            handlePointer(event.clientX, event.currentTarget)
          }}
          onPointerMove={event => {
            // Contain pointer gestures (hover scrub, drag intent) inside the chart.
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.stopPropagation()
            }
            handlePointer(event.clientX, event.currentTarget)
          }}
          onPointerLeave={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              handlePointerLeave()
            }
          }}
          onPointerUp={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
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
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            handlePointerLeave()
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
                clearHoverPreview()
                onSelectIndex(fullIndexFromVisible(lockable) ?? lockable)
              }
              return
            }
            if (onSelectIndex && n > 0) {
              const current = hoverIndexRef.current ?? pinIndex ?? listPreviewIndex ?? 0
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault()
                previewKeyboardIndex(current + (event.key === 'ArrowLeft' ? -1 : 1))
                return
              }
              if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault()
                previewKeyboardIndex(event.key === 'Home' ? 0 : n - 1)
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
