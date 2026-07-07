import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, RefObject } from 'react'
import { formatHeatOffset } from '@streamclone/pulse-core'
import {
  GameSegmentOverlay,
  normalizeGameSegments as normalizeChartGameSegments,
  type ChartGameSegment,
  type ChartMinuteRollup,
} from '@streamclone/pulse-charts'
import type { ExtensionGameSegment, ExtensionRollup } from '../shared/messages.ts'
import { activityAxisBoundsFromZero, overlaySeriesAxisMax } from './chatActivityEmotes.ts'
import type { EmoteOverlaySeries } from './chatActivityEmotes.ts'
import { CHART_INTERACTION, CHART_LANE, CHART_THEME, hexToRgba } from './chartTheme.ts'
import {
  areaPath,
  barDisplayAxisMax,
  chartBarBucketOpacity,
  chartDurationSeconds,
  chartViewerValue,
  indexFromChartClick,
  linePath,
  linePathInBand,
  minuteEmoteTotal,
  plotXForIndex,
  rollupsToChartMinuteRollups,
  seriesMax,
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
}

const DEFAULT_WIDTH = 320
const DEFAULT_HEIGHT = 160
const PAD_LEFT = 4
const PAD_RIGHT = 12
const PAD_TOP = 14
const PAD_BOTTOM = 12
const GAME_BAND_HEIGHT = 20
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

type ActivityZone = 'activity-chat' | 'activity-emote-trace' | 'activity-emote'

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
  const barWidth = Math.max(1, plotWidth / Math.max(n, 1) - 0.5)
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
}: PulseOverviewChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const pendingHoverIndexRef = useRef<number | null>(null)
  const hoverFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => {
      const next = entries[0]?.contentRect.width
      if (next && next > 0) setWidth(Math.round(next))
    })
    observer.observe(node)
    setWidth(Math.max(1, Math.round(node.getBoundingClientRect().width)) || DEFAULT_WIDTH)
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
    () => rollups.map(point => (point.missing ? null : point.chatCount ?? null)),
    [rollups],
  )
  const emotes = useMemo(
    () => rollups.map(point => (point.missing ? null : minuteEmoteTotal(point) || null)),
    [rollups],
  )

  const trendWindow = useMemo(() => trendSmoothingWindow(rollups.length), [rollups.length])
  const chatTrendValues = useMemo(
    () => smoothNullableSeriesValues(chat, trendWindow),
    [chat, trendWindow],
  )
  const emoteTrendValues = useMemo(
    () => smoothNullableSeriesValues(emotes, trendWindow),
    [emotes, trendWindow],
  )

  const viewerMax = seriesMax(viewers)
  const chatMax = seriesMax(chat)
  const emoteMax = seriesMax(emotes)
  const chatTrendAxisMax = Math.max(chatMax, 1)
  const emoteTrendAxisMax = Math.max(emoteMax, 1)
  const chatBarAxisMax = barDisplayAxisMax(chat)
  const emoteBarAxisMax = barDisplayAxisMax(emotes)
  const viewerAxisMax = Math.max(viewerMax, 1)

  const viewerStripShare = showViewerStrip
    ? activityExpanded
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

  const plotWidth = width - PAD_LEFT - PAD_RIGHT
  const gameBandHeight = chartGames.length > 0 ? GAME_BAND_HEIGHT : 0
  const plotTop = PAD_TOP + 4 + gameBandHeight
  const plotBottom = height - PAD_BOTTOM
  const plotHeight = Math.max(48, plotBottom - plotTop)
  const viewerBandTop = plotTop
  const viewerBandBottom = plotTop + plotHeight * viewerStripShare
  const activityTop = viewerBandBottom + (showViewerStrip ? 4 : 0)
  const activityBottom = plotBottom
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
    return areaPath(
      viewers,
      viewerAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      viewerBandTop,
      viewerBandBottom,
    )
  }, [viewers, viewerMax, viewerAxisMax, width, height, viewerBandTop, viewerBandBottom])

  const viewerLinePath = useMemo(() => {
    if (viewerMax <= 0) return ''
    return linePath(
      viewers,
      viewerAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      viewerBandTop,
      viewerBandBottom,
    )
  }, [viewers, viewerMax, viewerAxisMax, width, height, viewerBandTop, viewerBandBottom])

  const chatLinePath = useMemo(() => {
    if (chatMax <= 0) return ''
    return linePathInBand(
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

  const emoteLinePath = useMemo(() => {
    if (emoteMax <= 0) return ''
    return linePathInBand(
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
  const dashedOverlays = overlayLines.filter(series => series.dashed)

  const traceAxis = useMemo(
    () => activityAxisBoundsFromZero(dashedOverlays.map(series => series.values)),
    [dashedOverlays],
  )

  const tracePaths = useMemo(() => {
    return dashedOverlays.map(series => {
      const smoothed = smoothSeriesValues(series.values, 3)
      const values = smoothed.map(value => (value > 0 ? value : null))
      const axisMax = overlaySeriesAxisMax(values, normalizeOverlaySeries, traceAxis.max)
      const axisMin = normalizeOverlaySeries ? 0 : traceAxis.min
      const path =
        linePathInBand(
          values,
          axisMax,
          width,
          height,
          PAD_LEFT,
          PAD_RIGHT,
          traceLaneTop,
          traceLaneBottom,
          axisMin,
        ) || ''
      return { ...series, path }
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
    if (!hasValue) return CHART_THEME.emote.barBaseline * 0.6
    if (pinIndex === index) return Math.min(CHART_THEME.emote.barSpike * 1.15, 0.98)
    if (hoverPreviewIndex === index) return Math.min(CHART_THEME.emote.barSpike * 0.92, 0.82)
    return chartBarBucketOpacity({
      index,
      activeIndex: pinIndex ?? hoverPreviewIndex ?? null,
      baseOpacity: CHART_THEME.emote.bar,
      highlightOpacity: CHART_THEME.emote.barSpike,
    })
  }

  const chatBarOpacity = (index: number, hasValue: boolean): number => {
    if (!hasValue) return CHART_THEME.chat.whisperBar * 0.6
    if (pinIndex === index) return Math.min(CHART_THEME.chat.guide * 1.2, 0.92)
    if (hoverPreviewIndex === index) return Math.min(CHART_THEME.chat.guide * 0.95, 0.78)
    return chartBarBucketOpacity({
      index,
      activeIndex: pinIndex ?? hoverPreviewIndex ?? null,
      baseOpacity: CHART_THEME.chat.whisperBar,
      highlightOpacity: CHART_THEME.chat.guide,
    })
  }

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
    const barWidth = Math.max(1, plotWidth / Math.max(n, 1) - 0.5)
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
    const barWidth = Math.max(1, plotWidth / Math.max(n, 1) - 0.5)
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

  function handleClick(event: MouseEvent<SVGRectElement>): void {
    if (n === 0) return
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
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
  const hoverTargetX =
    hoverPreviewIndex != null && n > 0
      ? plotXForIndex(hoverPreviewIndex, n, PAD_LEFT, plotWidth)
      : pinTargetX
  const listPreviewTargetX =
    listPreviewIndex != null && n > 0
      ? plotXForIndex(listPreviewIndex, n, PAD_LEFT, plotWidth)
      : 0
  const highlightTargetX =
    activeIndex != null && n > 0 ? plotXForIndex(activeIndex, n, PAD_LEFT, plotWidth) : 0
  const smoothPinX = useSmoothedScalar(pinTargetX, false)
  const smoothHoverX = useSmoothedScalar(
    hoverTargetX,
    motionEnabled && hoverPreviewIndex != null,
  )
  const smoothListPreviewX = useSmoothedScalar(
    listPreviewTargetX,
    motionEnabled && listPreviewIndex != null,
  )
  const smoothHighlightX = useSmoothedScalar(
    highlightTargetX,
    motionEnabled && activeIndex != null,
  )
  const pinX = pinIndex != null ? smoothPinX : null
  const hoverLineX = hoverPreviewIndex != null ? smoothHoverX : null
  const listPreviewLineX = listPreviewIndex != null ? smoothListPreviewX : null
  const activeHighlightX = activeIndex != null ? smoothHighlightX : null

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
        aria-label="Stream overview chart"
        style={{ ...styles.svg, height }}
      >
        <defs>
          <linearGradient id="pulseViewerAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART_THEME.viewer.color} stopOpacity={CHART_THEME.viewer.fillTop} />
            <stop offset="100%" stopColor={CHART_THEME.viewer.color} stopOpacity={CHART_THEME.viewer.fillBottom} />
          </linearGradient>
          <clipPath id="pulsePlotClip">
            <rect x={PAD_LEFT} y={PAD_TOP} width={plotWidth} height={height - PAD_TOP - PAD_BOTTOM} />
          </clipPath>
          <clipPath id="pulseActivityClip">
            <rect x={PAD_LEFT} y={activityTop} width={plotWidth} height={activityBottom - activityTop} />
          </clipPath>
          <clipPath id="pulseChatLaneClip">
            <rect x={PAD_LEFT} y={chatLaneTop} width={plotWidth} height={chatLaneHeight} />
          </clipPath>
          <clipPath id="pulseEmoteTraceClip">
            <rect x={PAD_LEFT} y={traceLaneTop} width={plotWidth} height={traceLaneHeight} />
          </clipPath>
          <clipPath id="pulseEmoteLaneClip">
            <rect x={PAD_LEFT} y={emoteLaneTop} width={plotWidth} height={emoteLaneHeight} />
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

        {chartGames.length > 0 ? (
          <GameSegmentOverlay
            segments={chartGames}
            rollups={chartMinuteRollups}
            streamStartedAt={streamStartedAt}
            padLeft={PAD_LEFT}
            plotWidth={plotWidth}
            gameBandTop={PAD_TOP + 1}
            gameBandHeight={gameBandHeight - 2}
            minLabelWidth={24}
          />
        ) : null}

        <g clipPath="url(#pulsePlotClip)">
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
            <path d={viewerAreaPath} fill="url(#pulseViewerAreaGradient)" opacity={0.35} />
          ) : null}
          {showViewerStrip && viewerLinePath ? (
            <path
              d={viewerLinePath}
              fill="none"
              stroke={CHART_THEME.viewer.color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.25"
              opacity={0.62}
            />
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

          <g clipPath="url(#pulseEmoteLaneClip)">
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
                opacity={EMOTE_TREND_OPACITY}
                pointerEvents="none"
              />
            ) : null}
          </g>

          <g clipPath="url(#pulseChatLaneClip)">
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

          <g clipPath="url(#pulseEmoteTraceClip)">
            {tracePaths.map(series => {
              if (!series.path) return null
              const overlayOpacity =
                activeIndex != null || hovering
                  ? activeIndex != null
                    ? TRACE_LINE_OPACITY
                    : 0.72
                  : 0.55
              return (
                <path
                  key={series.key}
                  d={series.path}
                  fill="none"
                  stroke={series.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={normalizeOverlaySeries ? 2.25 : TRACE_LINE_STROKE}
                  strokeDasharray={normalizeOverlaySeries ? undefined : '4 3'}
                  opacity={overlayOpacity}
                />
              )
            })}
          </g>
        </g>

        {hoverLineX != null ? (
          <line
            x1={hoverLineX}
            x2={hoverLineX}
            y1={crosshairTop}
            y2={crosshairBottom}
            stroke={CHART_INTERACTION.hoverLine}
            strokeWidth="1"
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
            pointerEvents="none"
          />
        ) : activeHighlightX != null && pinIndex == null ? (
          <line
            x1={activeHighlightX}
            x2={activeHighlightX}
            y1={crosshairTop}
            y2={crosshairBottom}
            stroke={CHART_INTERACTION.previewLine}
            strokeWidth="1"
            opacity={0.85}
            pointerEvents="none"
          />
        ) : null}

        {chatLinePath ? (
          <g clipPath="url(#pulseChatLaneClip)" pointerEvents="none">
            <path
              d={chatLinePath}
              fill="none"
              stroke={CHART_THEME.chat.line}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={CHAT_TREND_STROKE}
              opacity={CHAT_TREND_OPACITY}
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
          onPointerDown={event => event.stopPropagation()}
          onPointerMove={event => handlePointer(event.clientX, event.currentTarget)}
          onPointerLeave={handlePointerLeave}
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
