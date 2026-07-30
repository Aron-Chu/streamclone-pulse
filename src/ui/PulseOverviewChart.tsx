import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, RefObject } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
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
import { CHART_INTERACTION, CHART_LANE, CHART_THEME, hexToRgba } from './chartTheme.ts'
import {
  areaPathInBand,
  barDisplayAxisMax,
  chartBarBucketOpacity,
  chartDurationSeconds,
  chartViewerValue,
  extendSeriesToTrailingEdge,
  extendViewerSeriesToTrailingEdge,
  indexFromChartClick,
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

export interface PulseOverviewChartProps {
  rollups: ExtensionRollup[]
  games?: ExtensionGameSegment[]
  durationSeconds?: number
  streamStartedAt?: string
  height?: number
  selectedIndex?: number | null
  previewIndex?: number | null
  activityExpanded?: boolean
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
}

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 160
const PAD_LEFT = 4
const PAD_RIGHT = 12
const PAD_TOP = 14
const PAD_BOTTOM = 12
const VIEWER_STRIP_SHARE_COLLAPSED = 0.28
const VIEWER_STRIP_SHARE_EXPANDED = 0.16
const ACTIVITY_CHAT_FRACTION = 0.54
const ACTIVITY_EMOTE_TRACE_FRACTION = 0.12
const ACTIVITY_EMOTE_BARS_FRACTION = 0.34
const SIDEBAR_CHAT_FRACTION = 0.5
const SIDEBAR_EMOTE_TRACE_FRACTION = 0.18
const SIDEBAR_EMOTE_BARS_FRACTION = 0.32
const ACTIVITY_CHAT_FRACTION_EXPANDED = 0.62
const ACTIVITY_EMOTE_BARS_FRACTION_EXPANDED = 0.26
const CHAT_TREND_STROKE = 2
const CHAT_TREND_OPACITY = CHART_THEME.chat.lineOpacity
const EMOTE_TREND_STROKE = 1.75
const EMOTE_TREND_OPACITY = CHART_THEME.emote.line
const TRACE_LANE_MIN_HEIGHT = 16
const TRACE_LINE_STROKE = 2.25
const TRACE_LINE_OPACITY = 0.95
const FOCUS_DIM_FACTOR = 0.14
const FOCUS_LANE_BOOST = 0.78
const SCRUB_TRANSITION_MS = 180
const SCRUB_FUTURE_STROKE = 'rgba(161, 161, 170, 0.52)'

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
  activityExpanded: boolean,
  chatFraction: number,
  traceFraction: number,
  emoteFraction: number,
): { chat: number; trace: number; emote: number } {
  if (!focusedSeriesKey || !activityExpanded) {
    return { chat: chatFraction, trace: traceFraction, emote: emoteFraction }
  }
  const rest = 1 - FOCUS_LANE_BOOST
  const halfRest = rest / 2
  switch (focusedSeriesKey) {
    case 'chat':
      return { chat: FOCUS_LANE_BOOST, trace: halfRest, emote: halfRest }
    case 'emotes':
      return { chat: halfRest, trace: halfRest, emote: FOCUS_LANE_BOOST }
    default:
      if (focusedSeriesKey.includes(':')) {
        return { chat: halfRest, trace: FOCUS_LANE_BOOST, emote: halfRest }
      }
      return { chat: chatFraction, trace: traceFraction, emote: emoteFraction }
  }
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

export function PulseOverviewChart({
  rollups,
  games = [],
  durationSeconds = 0,
  streamStartedAt,
  height = DEFAULT_HEIGHT,
  selectedIndex = null,
  previewIndex = null,
  activityExpanded = false,
  showViewerStrip = true,
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
}: PulseOverviewChartProps) {
  const chartId = useId().replace(/:/g, '')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const pendingHoverIndexRef = useRef<number | null>(null)
  const hoverFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const minPlotWidth = PAD_LEFT + PAD_RIGHT + 40
    let lastRounded = -1
    const applyWidth = (raw: number) => {
      const next = Math.round(raw)
      if (next === lastRounded) return
      lastRounded = next
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
      }
    }
  }, [])

  useEffect(() => {
    function handlePointerDown(event: PointerEvent): void {
      const boundary = clearSelectionBoundaryRef?.current ?? containerRef.current
      if (!boundary || boundary.contains(event.target as Node)) return
      if (event.defaultPrevented) return
      setHoverIndex(null)
      onHoverOffsetChange?.(null)
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
    () =>
      rampNullableSeriesFromStreamStart(
        extendViewerSeriesToTrailingEdge(
          smoothNullableSeriesValues(viewers, trendWindow),
        ),
      ),
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
    () =>
      rampNullableSeriesFromStreamStart(
        extendViewerSeriesToTrailingEdge(viewers),
      ),
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

  let viewerStripShare = showViewerStrip
    ? activityExpanded && focusedSeriesKey === 'viewers'
      ? 0.42
      : activityExpanded
        ? VIEWER_STRIP_SHARE_EXPANDED
        : VIEWER_STRIP_SHARE_COLLAPSED
    : 0

  const hasOverlayTraces = overlayLines.some(series => series.dashed)

  let chatFraction = !showViewerStrip
    ? SIDEBAR_CHAT_FRACTION
    : activityExpanded
      ? ACTIVITY_CHAT_FRACTION_EXPANDED
      : ACTIVITY_CHAT_FRACTION
  let traceFraction = !showViewerStrip ? SIDEBAR_EMOTE_TRACE_FRACTION : ACTIVITY_EMOTE_TRACE_FRACTION
  let emoteFraction = !showViewerStrip
    ? SIDEBAR_EMOTE_BARS_FRACTION
    : activityExpanded
      ? ACTIVITY_EMOTE_BARS_FRACTION_EXPANDED
      : ACTIVITY_EMOTE_BARS_FRACTION

  if (showViewerStrip && hasOverlayTraces) {
    if (activityExpanded) {
      chatFraction = 0.44
      traceFraction = 0.26
      emoteFraction = 0.30
    } else {
      chatFraction = 0.50
      traceFraction = 0.16
      emoteFraction = 0.34
    }
  }

  const rebalanced = rebalanceFractionsForFocus(
    focusedSeriesKey,
    activityExpanded,
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

  const n = rollups.length
  const crosshair = resolveChartCrosshairMode({
    pinIndex: selectedIndex ?? null,
    listPreviewIndex:
      previewIndex != null && previewIndex !== selectedIndex ? previewIndex : null,
  })
  const pinIndex = crosshair.pinIndex
  const listPreviewIndex = crosshair.listPreviewIndex
  const activeIndex = listPreviewIndex ?? pinIndex ?? hoverIndex ?? previewIndex
  const hoverPreviewIndex =
    hoverIndex != null && hoverIndex !== pinIndex && hoverIndex !== listPreviewIndex
      ? hoverIndex
      : null
  const hovering = hoverIndex != null || listPreviewIndex != null
  const motionEnabled = !reducedMotion && !prefersReducedMotion()
  const scrubActive = activeIndex != null
  const scrubX =
    activeIndex != null && n > 0
      ? plotXForIndex(activeIndex, n, PAD_LEFT, plotWidth)
      : width - PAD_RIGHT
  const scrubPastWidth = Math.max(0, Math.min(plotWidth, scrubX - PAD_LEFT + 1))
  const scrubFutureX = Math.max(PAD_LEFT, Math.min(width - PAD_RIGHT, scrubX))
  const scrubFutureWidth = Math.max(0, width - PAD_RIGHT - scrubFutureX)
  const scrubTransition = motionEnabled
    ? `opacity ${SCRUB_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
    : undefined
  const activeTimeLabel =
    activeIndex != null ? formatHeatOffset(rollups[activeIndex]?.offsetSeconds ?? 0) : ''
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
  const dashedOverlays = useMemo(
    () => overlayLines.filter(series => series.dashed),
    [overlayLines],
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
      const axisMax = overlaySeriesAxisMax(detailValues, normalizeOverlaySeries, traceAxis.max)
      const axisMin = normalizeOverlaySeries ? 0 : traceAxis.min
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
    normalizeOverlaySeries,
    traceAxis,
    width,
    height,
    traceLaneTop,
    traceLaneBottom,
  ])

  const barOpacity = (index: number, hasValue: boolean): number => {
    const base = (() => {
      if (!hasValue) return CHART_THEME.emote.barBaseline * 0.6
      if (pinIndex === index) return Math.min(CHART_THEME.emote.barSpike * 1.15, 0.98)
      if (hoverPreviewIndex === index) return Math.min(CHART_THEME.emote.barSpike * 0.92, 0.82)
      return chartBarBucketOpacity({
        index,
        activeIndex,
        baseOpacity: CHART_THEME.emote.bar,
        highlightOpacity: CHART_THEME.emote.barSpike,
        fadeFutureAfterActive: true,
      })
    })()
    return seriesFocusOpacity(focusedSeriesKey, 'emotes', base)
  }

  const chatBarOpacity = (index: number, hasValue: boolean): number => {
    const base = (() => {
      if (!hasValue) return CHART_THEME.chat.whisperBar * 0.6
      if (pinIndex === index) return Math.min(CHART_THEME.chat.guide * 1.2, 0.92)
      if (hoverPreviewIndex === index) return Math.min(CHART_THEME.chat.guide * 0.95, 0.78)
      return chartBarBucketOpacity({
        index,
        activeIndex,
        baseOpacity: CHART_THEME.chat.whisperBar,
        highlightOpacity: CHART_THEME.chat.guide,
        fadeFutureAfterActive: true,
      })
    })()
    return seriesFocusOpacity(focusedSeriesKey, 'chat', base)
  }

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
      hoverPreviewIndex,
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

  function flushHoverIndex(): void {
    hoverFrameRef.current = null
    const index = pendingHoverIndexRef.current
    setHoverIndex(prev => {
      if (prev === index) return prev
      return index
    })
    onHoverOffsetChange?.(index != null ? rollups[index]?.offsetSeconds ?? null : null)
  }

  function handlePointer(clientX: number, target: SVGRectElement): void {
    const rect = target.getBoundingClientRect()
    const index = indexFromChartClick(clientX, rect.left, rect.width, n)
    if (pendingHoverIndexRef.current === index && hoverFrameRef.current != null) return
    pendingHoverIndexRef.current = index
    if (hoverFrameRef.current != null) return
    hoverFrameRef.current = requestAnimationFrame(flushHoverIndex)
  }

  function handlePointerLeave(): void {
    pendingHoverIndexRef.current = null
    if (hoverFrameRef.current != null) {
      cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
    setHoverIndex(prev => (prev == null ? prev : null))
    onHoverOffsetChange?.(null)
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
    if (onFocusedSeriesKeyChange && event.detail >= 2) {
      const laneKey = laneKeyFromPointerY(event.clientY, rect)
      if (laneKey) {
        toggleSeriesFocus(laneKey)
        return
      }
    }
    const index = indexFromChartClick(event.clientX, rect.left, rect.width, n)
    pendingHoverIndexRef.current = index
    if (hoverFrameRef.current != null) {
      cancelAnimationFrame(hoverFrameRef.current)
      hoverFrameRef.current = null
    }
    setHoverIndex(index)
    onSelectIndex?.(index)
  }

  const pinTargetX =
    pinIndex != null && n > 0 ? plotXForIndex(pinIndex, n, PAD_LEFT, plotWidth) : 0
  const hoverLineX =
    hoverPreviewIndex != null && n > 0
      ? plotXForIndex(hoverPreviewIndex, n, PAD_LEFT, plotWidth)
      : null
  const listPreviewTargetX =
    listPreviewIndex != null && n > 0
      ? plotXForIndex(listPreviewIndex, n, PAD_LEFT, plotWidth)
      : 0
  // Direct bucket X for pointer hover; RAF-smooth only list/external selection.
  const smoothListPreviewX = useSmoothedScalar(
    listPreviewTargetX,
    motionEnabled && listPreviewIndex != null,
  )
  const pinX = pinIndex != null ? pinTargetX : null
  const listPreviewLineX = listPreviewIndex != null ? smoothListPreviewX : null

  if (loading) {
    return (
      <div ref={containerRef} style={styles.shell}>
        <div style={styles.empty}>Loading timeline…</div>
      </div>
    )
  }

  if (n === 0) {
    return (
      <div ref={containerRef} style={styles.shell}>
        <div style={styles.empty}>{emptyMessage ?? 'No chart data yet'}</div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="pulse-sparkline-wrap" style={styles.shell}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Interactive stream overview chart. Move or drag across the plot to inspect a moment."
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
          opacity={showViewerStrip ? 1 : 0}
        />
        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={activityBottom}
          y2={activityBottom}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="1"
        />

        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={viewerBandBottom + 2}
          y2={viewerBandBottom + 2}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
          opacity={showViewerStrip ? 1 : 0}
        />

        <g clipPath={`url(#${svgIds.plotClip})`}>
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
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', scrubActive ? 0.06 : 0.35)}
                style={{ transition: scrubTransition }}
              />
              <path
                d={viewerDetailAreaPath}
                fill="rgba(161, 161, 170, 0.12)"
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', scrubActive ? 1 : 0)}
                clipPath={`url(#${svgIds.scrubFutureClip})`}
                style={{ transition: scrubTransition }}
              />
              <path
                d={viewerDetailAreaPath}
                fill={`url(#${svgIds.viewerGradient})`}
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', scrubActive ? 0.44 : 0)}
                clipPath={`url(#${svgIds.scrubPastClip})`}
                style={{ transition: scrubTransition }}
              />
            </g>
          ) : null}
          {showViewerStrip && viewerLinePath ? (
            <g clipPath={`url(#${svgIds.viewerClip})`}>
              <path
                d={viewerLinePath}
                fill="none"
                stroke={CHART_THEME.viewer.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.25"
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', scrubActive ? 0.08 : 0.62)}
                style={{ transition: scrubTransition }}
              />
              <path
                d={viewerDetailLinePath}
                fill="none"
                stroke={SCRUB_FUTURE_STROKE}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.35"
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', scrubActive ? 0.48 : 0)}
                clipPath={`url(#${svgIds.scrubFutureClip})`}
                style={{ transition: scrubTransition }}
              />
              <path
                d={viewerDetailLinePath}
                fill="none"
                stroke={CHART_THEME.viewer.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.65"
                opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', scrubActive ? 0.9 : 0)}
                clipPath={`url(#${svgIds.scrubPastClip})`}
                style={{ transition: scrubTransition }}
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
            {emoteBars.map((bar, index) => (
              <rect
                key={bar.key}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={CHART_THEME.emote.color}
                opacity={barOpacity(index, bar.hasValue)}
              />
            ))}
            {emoteLinePath ? (
              <path
                d={emoteLinePath}
                fill="none"
                stroke={CHART_THEME.emote.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={EMOTE_TREND_STROKE}
                opacity={seriesFocusOpacity(
                  focusedSeriesKey,
                  'emotes',
                  scrubActive ? 0.08 : EMOTE_TREND_OPACITY,
                )}
                pointerEvents="none"
                style={{ transition: scrubTransition }}
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
                opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes', scrubActive ? 0.44 : 0)}
                clipPath={`url(#${svgIds.scrubFutureClip})`}
                pointerEvents="none"
                style={{ transition: scrubTransition }}
              />
            ) : null}
            {emoteDetailLinePath ? (
              <path
                d={emoteDetailLinePath}
                fill="none"
                stroke={CHART_THEME.emote.color}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={EMOTE_TREND_STROKE + 0.35}
                opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes', scrubActive ? 0.94 : 0)}
                clipPath={`url(#${svgIds.scrubPastClip})`}
                pointerEvents="none"
                style={{ transition: scrubTransition }}
              />
            ) : null}
          </g>

          <g clipPath={`url(#${svgIds.chatClip})`}>
            {chatBars.map((bar, index) => (
              <rect
                key={bar.key}
                x={bar.x}
                y={bar.y}
                width={bar.width}
                height={bar.height}
                fill={CHART_THEME.chat.color}
                opacity={chatBarOpacity(index, bar.hasValue)}
              />
            ))}
          </g>

          <g clipPath={`url(#${svgIds.traceClip})`}>
            {tracePaths.map(series => {
              if (!series.path) return null
              const baseOpacity =
                activeIndex != null || hovering
                  ? activeIndex != null
                    ? TRACE_LINE_OPACITY
                    : 0.72
                  : 0.55
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
                    strokeDasharray={normalizeOverlaySeries ? undefined : '4 3'}
                    opacity={seriesFocusOpacity(
                      focusedSeriesKey,
                      series.key,
                      scrubActive ? 0.08 : baseOpacity,
                    )}
                    style={{ transition: scrubTransition }}
                  />
                  <path
                    d={series.detailPath}
                    fill="none"
                    stroke={SCRUB_FUTURE_STROKE}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={normalizeOverlaySeries ? 2.25 : TRACE_LINE_STROKE}
                    strokeDasharray={normalizeOverlaySeries ? undefined : '4 3'}
                    opacity={seriesFocusOpacity(
                      focusedSeriesKey,
                      series.key,
                      scrubActive ? 0.42 : 0,
                    )}
                    clipPath={`url(#${svgIds.scrubFutureClip})`}
                    style={{ transition: scrubTransition }}
                  />
                  <path
                    d={series.detailPath}
                    fill="none"
                    stroke={series.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={normalizeOverlaySeries ? 2.5 : TRACE_LINE_STROKE + 0.25}
                    strokeDasharray={normalizeOverlaySeries ? undefined : '4 3'}
                    opacity={seriesFocusOpacity(
                      focusedSeriesKey,
                      series.key,
                      scrubActive ? TRACE_LINE_OPACITY : 0,
                    )}
                    clipPath={`url(#${svgIds.scrubPastClip})`}
                    style={{ transition: scrubTransition }}
                  />
                </g>
              )
            })}
          </g>
        </g>

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

        {hoverLineX != null ? (
          <line
            x1={hoverLineX}
            x2={hoverLineX}
            y1={crosshairTop}
            y2={crosshairBottom}
            stroke={CHART_INTERACTION.hoverLine}
            strokeWidth="1"
            strokeDasharray="2 2"
            opacity={0.75}
            pointerEvents="none"
          />
        ) : null}

        {listPreviewLineX != null ? (
          <line
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

        {scrubActive ? (
          <g pointerEvents="none" aria-hidden="true">
            <rect
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
        ) : null}

        {chatLinePath ? (
          <g clipPath={`url(#${svgIds.chatClip})`} pointerEvents="none">
            <path
              d={chatLinePath}
              fill="none"
              stroke={CHART_THEME.chat.line}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={CHAT_TREND_STROKE}
              opacity={seriesFocusOpacity(
                focusedSeriesKey,
                'chat',
                scrubActive ? 0.08 : CHAT_TREND_OPACITY,
              )}
              style={{ transition: scrubTransition }}
            />
            <path
              d={chatDetailLinePath}
              fill="none"
              stroke={SCRUB_FUTURE_STROKE}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={CHAT_TREND_STROKE}
              opacity={seriesFocusOpacity(focusedSeriesKey, 'chat', scrubActive ? 0.46 : 0)}
              clipPath={`url(#${svgIds.scrubFutureClip})`}
              style={{ transition: scrubTransition }}
            />
            <path
              d={chatDetailLinePath}
              fill="none"
              stroke={CHART_THEME.chat.line}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={CHAT_TREND_STROKE + 0.35}
              opacity={seriesFocusOpacity(focusedSeriesKey, 'chat', scrubActive ? 0.96 : 0)}
              clipPath={`url(#${svgIds.scrubPastClip})`}
              style={{ transition: scrubTransition }}
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

        <rect
          x={PAD_LEFT}
          y={PAD_TOP}
          width={plotWidth}
          height={height - PAD_TOP - PAD_BOTTOM}
          fill="transparent"
          style={{ cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={event => {
            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            handlePointer(event.clientX, event.currentTarget)
          }}
          onPointerMove={event => handlePointer(event.clientX, event.currentTarget)}
          onPointerLeave={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
              handlePointerLeave()
            }
          }}
          onPointerUp={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
          onPointerCancel={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            handlePointerLeave()
          }}
          onClick={handleClick}
        />
      </svg>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  shell: {
    background: CHART_THEME.background,
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    minHeight: DEFAULT_HEIGHT,
    minWidth: 0,
    overflow: 'hidden',
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
    minHeight: DEFAULT_HEIGHT,
    padding: '0 12px',
    placeItems: 'center',
    textAlign: 'center',
  },
}
