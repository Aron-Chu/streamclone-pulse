import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { CHART_INTERACTION, CHART_THEME } from './chartTheme.ts'
import { resolveActivityLaneFractions } from './activityLaneFractions.ts'
import {
  areaPathInBand,
  barDisplayAxisMax,
  chartBarBucketOpacity,
  chartDurationSeconds,
  chartViewerValue,
  extendSeriesToTrailingEdge,
  extendViewerSeriesToLeadingEdge,
  extendViewerSeriesToTrailingEdge,
  indexFromChartClick,
  minuteEmoteTotal,
  overviewBarWidth,
  plotXForIndex,
  rampNullableSeriesFromStreamStart,
  rollupsToChartMinuteRollups,
  seriesMax,
  softFitValueToAxis,
  softFitSeriesToAxis,
  smoothLinePathInBand,
  smoothNullableSeriesValues,
  smoothSeriesValues,
  trendSmoothingWindow,
  viewerDisplayAxisMax,
} from './chartRollupUtils.ts'
import { resolveChartCrosshairMode, chartInteractionOpacityTransition } from './chartCrosshair.ts'
import { AFTER_CURSOR_OPACITY } from './MorphPath.tsx'
import { useSmoothedScalar } from './motion/useSmoothedScalar.ts'
import { useReducedMotion } from './motion/useReducedMotion.ts'

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
// Keep the viewer lane visually flush with the chart frame. Two pixels preserve
// the rounded stroke without recreating the former empty header band.
const PAD_TOP = 2
const PAD_BOTTOM = 18
const VIEWER_STRIP_SHARE_COLLAPSED = 0.28
const VIEWER_STRIP_SHARE_EXPANDED = 0.12
const CHAT_TREND_STROKE = 2
const CHAT_TREND_OPACITY = CHART_THEME.chat.lineOpacity
const EMOTE_TREND_STROKE = 1.75
const EMOTE_TREND_OPACITY = CHART_THEME.emote.line
const TRACE_LINE_STROKE = 2.25
const TRACE_LINE_OPACITY = 0.95
const FOCUS_DIM_FACTOR = 0.14
/** Keep peaks/strokes off the chat↔emote seam. */
const ACTIVITY_LANE_INSET = 4

type ActivityZone = 'activity-chat' | 'activity-emote' | 'activity-emote-trace'

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

/** Lane order: chat → emote aggregate → optional overlay traces (inside emote half). */
function plotBandForActivityZone(
  activityTop: number,
  activityBottom: number,
  activityHeight: number,
  zone: ActivityZone,
  chatFraction: number,
  emoteFraction: number,
  traceFraction: number,
) {
  const chatSplit = activityTop + activityHeight * chatFraction
  const emoteSplit = chatSplit + activityHeight * emoteFraction
  switch (zone) {
    case 'activity-chat':
      return {
        bandTop: activityTop,
        bandBottom: chatSplit,
        bandHeight: activityHeight * chatFraction,
      }
    case 'activity-emote':
      return {
        bandTop: chatSplit,
        bandBottom: emoteSplit,
        bandHeight: activityHeight * emoteFraction,
      }
    case 'activity-emote-trace':
      return {
        bandTop: emoteSplit,
        bandBottom: activityBottom,
        bandHeight: activityHeight * traceFraction,
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

/**
 * Owns rAF-smoothed crosshair / pin-seam state so per-frame updates do not
 * re-render the full bar/path chart subtree (critical on 1000+ bucket VODs).
 */
function OverviewChartMotionChrome(props: {
  motionEnabled: boolean
  lockPinIndex: number | null
  pinIndex: number | null
  hoverPreviewIndex: number | null
  listPreviewIndex: number | null
  activeIndex: number | null
  lockPinTargetX: number
  hoverTargetX: number
  listPreviewTargetX: number
  highlightTargetX: number
  plotWidth: number
  plotClipHeight: number
  crosshairTop: number
  crosshairBottom: number
}) {
  const {
    motionEnabled,
    lockPinIndex,
    pinIndex,
    hoverPreviewIndex,
    listPreviewIndex,
    activeIndex,
    lockPinTargetX,
    hoverTargetX,
    listPreviewTargetX,
    highlightTargetX,
    plotWidth,
    plotClipHeight,
    crosshairTop,
    crosshairBottom,
  } = props

  const smoothLockPinX = useSmoothedScalar(
    lockPinTargetX,
    motionEnabled && lockPinIndex != null,
  )
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
    motionEnabled && activeIndex != null && lockPinIndex == null,
  )

  const seamX = lockPinIndex != null ? smoothLockPinX : null
  const pinX = pinIndex != null ? smoothLockPinX : null
  const hoverLineX = hoverPreviewIndex != null ? smoothHoverX : null
  const listPreviewLineX = listPreviewIndex != null ? smoothListPreviewX : null
  const activeHighlightX = activeIndex != null && lockPinIndex == null ? smoothHighlightX : null
  const beforeClipWidth = seamX != null ? Math.max(0, seamX - PAD_LEFT) : plotWidth
  const afterClipX = seamX != null ? seamX : PAD_LEFT + plotWidth
  const afterClipWidth = seamX != null
    ? Math.max(0, PAD_LEFT + plotWidth - seamX)
    : 0

  return (
    <>
      <defs>
        <clipPath id="pulseInspectBefore">
          <rect x={PAD_LEFT} y={PAD_TOP} width={beforeClipWidth} height={plotClipHeight} />
        </clipPath>
        <clipPath id="pulseInspectAfter">
          <rect x={afterClipX} y={PAD_TOP} width={afterClipWidth} height={plotClipHeight} />
        </clipPath>
      </defs>

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
      ) : activeHighlightX != null ? (
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
    </>
  )
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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const pendingHoverIndexRef = useRef<number | null>(null)
  const hoverFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const minPlotWidth = PAD_LEFT + PAD_RIGHT + 40
    const applyWidth = (raw: number) => {
      const next = Math.round(raw)
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
          extendViewerSeriesToLeadingEdge(
            rollups,
            smoothNullableSeriesValues(viewers, trendWindow),
          ),
        ),
      ),
    [rollups, viewers, trendWindow],
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

  const viewerMax = seriesMax(viewers)
  const chatMax = seriesMax(chat)
  const emoteMax = seriesMax(emotes)
  // Robust axis keeps typical minutes readable; soft-fit maps outliers into the
  // lane top without hard-clamping into a flat plateau (see softFitSeriesToAxis).
  // Axis ceiling must use RAW viewers — trend smoothing bleeds brief spikes into
  // neighboring minutes and falsely raises the strip max (plateau sits mid-lane).
  const viewerAxisCeiling = viewerDisplayAxisMax(viewers)
  const chatBarAxisMax = barDisplayAxisMax(chat)
  const emoteBarAxisMax = barDisplayAxisMax(emotes)
  const viewerTrendFitted = useMemo(
    () => softFitSeriesToAxis(viewerTrendValues, viewerAxisCeiling),
    [viewerTrendValues, viewerAxisCeiling],
  )
  const chatTrendFitted = useMemo(
    () => softFitSeriesToAxis(chatTrendValues, barDisplayAxisMax(chatTrendValues)),
    [chatTrendValues],
  )
  const emoteTrendFitted = useMemo(
    () => softFitSeriesToAxis(emoteTrendValues, barDisplayAxisMax(emoteTrendValues)),
    [emoteTrendValues],
  )
  const viewerAxisMax = viewerTrendFitted.plotMax
  const chatTrendAxisMax = chatTrendFitted.plotMax
  const emoteTrendAxisMax = emoteTrendFitted.plotMax

  let viewerStripShare = showViewerStrip
    ? activityExpanded && focusedSeriesKey === 'viewers'
      ? 0.42
      : activityExpanded
        ? VIEWER_STRIP_SHARE_EXPANDED
        : VIEWER_STRIP_SHARE_COLLAPSED
    : 0

  const hasOverlayTraces = overlayLines.some(series => series.dashed)
  const laneFractions = resolveActivityLaneFractions({
    expanded: activityExpanded,
    hasOverlays: hasOverlayTraces,
    focusedKey: focusedSeriesKey,
  })
  const chatFraction = laneFractions.chat
  const emoteFraction = laneFractions.emote
  const traceFraction = laneFractions.trace

  const plotWidth = Math.max(1, width - PAD_LEFT - PAD_RIGHT)
  // Games are vertical dashed dividers only — do not reserve a top game band.
  const plotTop = PAD_TOP
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
  const gameBandTop = plotTop
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
    emoteFraction,
    traceFraction,
  )
  const emoteLane = plotBandForActivityZone(
    activityTop,
    activityBottom,
    activityHeight,
    'activity-emote',
    chatFraction,
    emoteFraction,
    traceFraction,
  )
  const traceLane = plotBandForActivityZone(
    activityTop,
    activityBottom,
    activityHeight,
    'activity-emote-trace',
    chatFraction,
    emoteFraction,
    traceFraction,
  )

  const chatLaneTop = chatLane.bandTop
  const chatLaneBottom = chatLane.bandBottom
  const chatLaneHeight = Math.max(1, chatLane.bandHeight)
  const emoteLaneTop = emoteLane.bandTop
  const emoteLaneBottom = emoteLane.bandBottom
  const emoteLaneHeight = Math.max(1, emoteLane.bandHeight)
  const traceLaneTop = traceLane.bandTop
  const traceLaneBottom = traceLane.bandBottom
  const traceLaneHeight = Math.max(0, traceLane.bandHeight)
  const chatPlotTop = chatLaneTop + ACTIVITY_LANE_INSET
  const chatPlotBottom = Math.max(chatPlotTop + 1, chatLaneBottom - ACTIVITY_LANE_INSET)
  const emotePlotTop = emoteLaneTop + ACTIVITY_LANE_INSET
  const emotePlotBottom = Math.max(emotePlotTop + 1, emoteLaneBottom - ACTIVITY_LANE_INSET)
  const chatBars = useMemo(() => {
    const barWidth = overviewBarWidth(plotWidth, rollups.length)
    const usableHeight = Math.max(1, chatPlotBottom - chatPlotTop)
    return chat.map((value, index) => {
      if (value == null || value <= 0) return null
      const fitted = softFitValueToAxis(value, chatBarAxisMax)
      const barHeight = Math.max(1, (fitted / chatBarAxisMax) * usableHeight)
      return {
        x: plotXForIndex(index, rollups.length, PAD_LEFT, plotWidth) - barWidth / 2,
        y: chatPlotBottom - barHeight,
        width: barWidth,
        height: barHeight,
      }
    })
  }, [chat, chatBarAxisMax, chatPlotBottom, chatPlotTop, plotWidth, rollups.length])
  const emoteBars = useMemo(() => {
    const barWidth = overviewBarWidth(plotWidth, rollups.length)
    const usableHeight = Math.max(1, emotePlotBottom - emotePlotTop)
    return emotes.map((value, index) => {
      if (value == null || value <= 0) return null
      const fitted = softFitValueToAxis(value, emoteBarAxisMax)
      const barHeight = Math.max(1, (fitted / emoteBarAxisMax) * usableHeight)
      return {
        x: plotXForIndex(index, rollups.length, PAD_LEFT, plotWidth) - barWidth / 2,
        y: emotePlotBottom - barHeight,
        width: barWidth,
        height: barHeight,
      }
    })
  }, [emoteBarAxisMax, emotePlotBottom, emotePlotTop, emotes, plotWidth, rollups.length])
  const viewerAreaPath = useMemo(() => {
    if (viewerMax <= 0) return ''
    return areaPathInBand(
      viewerTrendFitted.values,
      viewerAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      viewerBandTop,
      viewerBandBottom,
    )
  }, [viewerTrendFitted.values, viewerMax, viewerAxisMax, width, height, viewerBandTop, viewerBandBottom])

  const viewerLinePath = useMemo(() => {
    if (viewerMax <= 0) return ''
    return smoothLinePathInBand(
      viewerTrendFitted.values,
      viewerAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      viewerBandTop,
      viewerBandBottom,
    )
  }, [viewerTrendFitted.values, viewerMax, viewerAxisMax, width, height, viewerBandTop, viewerBandBottom])

  const chatLinePath = useMemo(() => {
    if (chatMax <= 0) return ''
    return smoothLinePathInBand(
      chatTrendFitted.values,
      chatTrendAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      chatPlotTop,
      chatPlotBottom,
    )
  }, [
    chatTrendFitted.values,
    chatMax,
    chatTrendAxisMax,
    width,
    height,
    chatPlotTop,
    chatPlotBottom,
  ])

  const emoteLinePath = useMemo(() => {
    if (emoteMax <= 0) return ''
    return smoothLinePathInBand(
      emoteTrendFitted.values,
      emoteTrendAxisMax,
      width,
      height,
      PAD_LEFT,
      PAD_RIGHT,
      emotePlotTop,
      emotePlotBottom,
    )
  }, [
    emoteTrendFitted.values,
    emoteMax,
    emoteTrendAxisMax,
    width,
    height,
    emotePlotTop,
    emotePlotBottom,
  ])

  const n = rollups.length
  // useReducedMotion already folds the stored system/on/off preference with the OS.
  // The optional prop remains a force-on override (tests); do not add a parallel flag.
  const preferenceMotionOff = useReducedMotion()
  const motionOff = reducedMotion || preferenceMotionOff
  const crosshair = resolveChartCrosshairMode({
    pinIndex: selectedIndex ?? null,
    listPreviewIndex:
      previewIndex != null && previewIndex !== selectedIndex ? previewIndex : null,
  })
  // Fade seam always follows the locked pin (raw selectedIndex), even when
  // list preview hides the pin crosshair.
  const lockPinIndex = selectedIndex ?? null
  const pinIndex = crosshair.pinIndex
  const listPreviewIndex = crosshair.listPreviewIndex
  const activeIndex = listPreviewIndex ?? pinIndex ?? hoverIndex ?? previewIndex
  const hoverPreviewIndex =
    hoverIndex != null && hoverIndex !== lockPinIndex && hoverIndex !== listPreviewIndex
      ? hoverIndex
      : null
  const hovering = hoverIndex != null || listPreviewIndex != null
  const motionEnabled = !motionOff
  const inspecting = lockPinIndex != null
  const opacityTransition = chartInteractionOpacityTransition(motionOff)
  const dashedOverlays = overlayLines.filter(series => series.dashed)

  const traceAxis = useMemo(
    () => activityAxisBoundsFromZero(dashedOverlays.map(series => series.values)),
    [dashedOverlays],
  )

  const tracePaths = useMemo(() => {
    return dashedOverlays.map(series => {
      const smoothed = smoothSeriesValues(series.values, 3)
      const values = rampNullableSeriesFromStreamStart(
        smoothed.map(value => (value > 0 ? value : null)),
      )
      const axisMax = overlaySeriesAxisMax(values, normalizeOverlaySeries, traceAxis.max)
      const axisMin = normalizeOverlaySeries ? 0 : traceAxis.min
      const path =
        smoothLinePathInBand(
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

  const toggleSeriesFocus = useCallback((seriesKey: string) => {
    if (!onFocusedSeriesKeyChange) return
    onFocusedSeriesKeyChange(focusedSeriesKey === seriesKey ? null : seriesKey)
  }, [focusedSeriesKey, onFocusedSeriesKeyChange])

  const pinColumn = selectionColumnRect(
    lockPinIndex,
    n,
    plotWidth,
    crosshairTop,
    crosshairBottom,
    'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1)',
  )
  const hoverColumn = lockPinIndex == null
    ? selectionColumnRect(
      hoverPreviewIndex,
      n,
      plotWidth,
      crosshairTop,
      crosshairBottom,
      CHART_INTERACTION.activityFill,
    )
    : null

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
    if (y >= emoteLaneTop && y <= emoteLaneBottom) return 'emotes'
    if (hasOverlayTraces && y >= traceLaneTop && y <= traceLaneBottom) return 'emotes'
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

  // Target X values only — smoothing lives in OverviewChartMotionChrome so
  // rAF updates do not re-render every bar/path on long VOD timelines.
  const lockPinTargetX =
    lockPinIndex != null && n > 0 ? plotXForIndex(lockPinIndex, n, PAD_LEFT, plotWidth) : 0
  const hoverTargetX =
    hoverPreviewIndex != null && n > 0
      ? plotXForIndex(hoverPreviewIndex, n, PAD_LEFT, plotWidth)
      : lockPinTargetX
  const listPreviewTargetX =
    listPreviewIndex != null && n > 0
      ? plotXForIndex(listPreviewIndex, n, PAD_LEFT, plotWidth)
      : 0
  const highlightTargetX =
    activeIndex != null && n > 0 ? plotXForIndex(activeIndex, n, PAD_LEFT, plotWidth) : 0
  const plotClipHeight = height - PAD_TOP - PAD_BOTTOM

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
        data-testid="pulse-overview-chart"
        data-viewer-axis-max={viewerAxisMax}
        data-viewer-raw-max={viewerMax}
        data-plot-top={plotTop}
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
          <clipPath id="pulseViewerClip">
            <rect
              x={PAD_LEFT}
              y={viewerBandTop}
              width={plotWidth}
              height={Math.max(1, viewerBandBottom - viewerBandTop)}
            />
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
          stroke={CHART_THEME.viewer.color}
          strokeOpacity={CHART_THEME.viewer.guide * 0.85}
          strokeWidth="1"
          opacity={showViewerStrip ? 1 : 0}
        />
        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={activityBottom}
          y2={activityBottom}
          stroke={CHART_INTERACTION.gridLine}
          strokeWidth="1"
        />

        <line
          x1={PAD_LEFT}
          x2={width - PAD_RIGHT}
          y1={viewerBandBottom + 2}
          y2={viewerBandBottom + 2}
          stroke={CHART_INTERACTION.gridLine}
          strokeWidth="1"
          opacity={showViewerStrip ? 1 : 0}
        />

        <g clipPath="url(#pulsePlotClip)">
          {showViewerStrip ? (
            <rect
              x={PAD_LEFT}
              y={viewerBandTop}
              width={plotWidth}
              height={viewerBandBottom - viewerBandTop}
              fill={CHART_INTERACTION.activityFill}
            />
          ) : null}
          {showViewerStrip && viewerAreaPath ? (
            <g clipPath="url(#pulseViewerClip)">
              {inspecting ? (
                <>
                  <path
                    d={viewerAreaPath}
                    fill="url(#pulseViewerAreaGradient)"
                    opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', 0.35)}
                    clipPath="url(#pulseInspectBefore)"
                    pointerEvents="none"
                    style={{ transition: opacityTransition }}
                  />
                  <path
                    d={viewerAreaPath}
                    fill="url(#pulseViewerAreaGradient)"
                    opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', 0.35) * AFTER_CURSOR_OPACITY}
                    clipPath="url(#pulseInspectAfter)"
                    pointerEvents="none"
                    style={{ transition: opacityTransition }}
                  />
                </>
              ) : (
                <path
                  d={viewerAreaPath}
                  fill="url(#pulseViewerAreaGradient)"
                  opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', 0.35)}
                />
              )}
            </g>
          ) : null}
          {showViewerStrip && viewerLinePath ? (
            <g clipPath="url(#pulseViewerClip)">
              {inspecting ? (
                <>
                  <path
                    d={viewerLinePath}
                    fill="none"
                    stroke={CHART_THEME.viewer.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.25"
                    opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', 0.62)}
                    clipPath="url(#pulseInspectBefore)"
                    pointerEvents="none"
                    style={{ transition: opacityTransition }}
                  />
                  <path
                    d={viewerLinePath}
                    fill="none"
                    stroke={CHART_THEME.viewer.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.25"
                    opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', 0.62) * AFTER_CURSOR_OPACITY}
                    clipPath="url(#pulseInspectAfter)"
                    pointerEvents="none"
                    style={{ transition: opacityTransition }}
                  />
                </>
              ) : (
                <path
                  d={viewerLinePath}
                  fill="none"
                  stroke={CHART_THEME.viewer.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.25"
                  opacity={seriesFocusOpacity(focusedSeriesKey, 'viewers', 0.62)}
                />
              )}
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
            opacity={0.7}
          />
          {hasOverlayTraces && traceLaneHeight > 0 ? (
            <line
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={emoteLaneBottom + 1}
              y2={emoteLaneBottom + 1}
              stroke={CHART_INTERACTION.gridLine}
              strokeWidth="1"
              opacity={0.45}
            />
          ) : null}

          <g clipPath="url(#pulseChatLaneClip)" data-chart-series="chat-bars">
            {chatBars.map((bar, index) => bar ? (
              <rect
                key={index}
                {...bar}
                fill={CHART_THEME.chat.color}
                opacity={seriesFocusOpacity(
                  focusedSeriesKey,
                  'chat',
                  chartBarBucketOpacity({
                    index,
                    activeIndex: activeIndex ?? null,
                    pinIndex: lockPinIndex,
                  }),
                )}
                rx={1}
                pointerEvents="none"
              />
            ) : null)}
            {chatLinePath ? (
              inspecting ? (
                <>
                  <path
                    d={chatLinePath}
                    fill="none"
                    stroke={CHART_THEME.chat.line}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={CHAT_TREND_STROKE}
                    opacity={seriesFocusOpacity(focusedSeriesKey, 'chat', CHAT_TREND_OPACITY)}
                    clipPath="url(#pulseInspectBefore)"
                    pointerEvents="none"
                    style={{ transition: opacityTransition }}
                  />
                  <path
                    d={chatLinePath}
                    fill="none"
                    stroke={CHART_THEME.chat.line}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={CHAT_TREND_STROKE}
                    opacity={seriesFocusOpacity(focusedSeriesKey, 'chat', CHAT_TREND_OPACITY) * AFTER_CURSOR_OPACITY}
                    clipPath="url(#pulseInspectAfter)"
                    pointerEvents="none"
                    style={{ transition: opacityTransition }}
                  />
                </>
              ) : (
                <path
                  d={chatLinePath}
                  fill="none"
                  stroke={CHART_THEME.chat.line}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={CHAT_TREND_STROKE}
                  opacity={seriesFocusOpacity(focusedSeriesKey, 'chat', CHAT_TREND_OPACITY)}
                  pointerEvents="none"
                />
              )
            ) : null}
          </g>

          <g clipPath="url(#pulseEmoteLaneClip)" data-chart-series="emote-bars">
            {emoteBars.map((bar, index) => bar ? (
              <rect
                key={index}
                {...bar}
                fill={CHART_THEME.emote.color}
                opacity={seriesFocusOpacity(
                  focusedSeriesKey,
                  'emotes',
                  chartBarBucketOpacity({
                    index,
                    activeIndex: activeIndex ?? null,
                    pinIndex: lockPinIndex,
                  }),
                )}
                rx={1}
                pointerEvents="none"
              />
            ) : null)}
            {emoteLinePath ? (
              inspecting ? (
                <>
                  <path
                    d={emoteLinePath}
                    fill="none"
                    stroke={CHART_THEME.emote.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={EMOTE_TREND_STROKE}
                    opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes', EMOTE_TREND_OPACITY)}
                    clipPath="url(#pulseInspectBefore)"
                    pointerEvents="none"
                    style={{ transition: opacityTransition }}
                  />
                  <path
                    d={emoteLinePath}
                    fill="none"
                    stroke={CHART_THEME.emote.color}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={EMOTE_TREND_STROKE}
                    opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes', EMOTE_TREND_OPACITY) * AFTER_CURSOR_OPACITY}
                    clipPath="url(#pulseInspectAfter)"
                    pointerEvents="none"
                    style={{ transition: opacityTransition }}
                  />
                </>
              ) : (
                <path
                  d={emoteLinePath}
                  fill="none"
                  stroke={CHART_THEME.emote.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={EMOTE_TREND_STROKE}
                  opacity={seriesFocusOpacity(focusedSeriesKey, 'emotes', EMOTE_TREND_OPACITY)}
                  pointerEvents="none"
                />
              )
            ) : null}
          </g>

          {hasOverlayTraces && traceLaneHeight > 0 ? (
          <g clipPath="url(#pulseEmoteTraceClip)">
            {tracePaths.map(series => {
              if (!series.path) return null
              const baseOpacity =
                activeIndex != null || hovering
                  ? activeIndex != null
                    ? TRACE_LINE_OPACITY
                    : 0.72
                  : 0.55
              const resolved = seriesFocusOpacity(focusedSeriesKey, series.key, baseOpacity)
              const pathProps = {
                d: series.path,
                fill: 'none' as const,
                stroke: series.color,
                strokeLinecap: 'round' as const,
                strokeLinejoin: 'round' as const,
                strokeWidth: normalizeOverlaySeries ? 2.25 : TRACE_LINE_STROKE,
                strokeDasharray: normalizeOverlaySeries ? undefined : '4 3',
              }
              if (!inspecting) {
                return <path key={series.key} {...pathProps} opacity={resolved} />
              }
              return (
                <g key={series.key}>
                  <path
                    {...pathProps}
                    opacity={resolved}
                    clipPath="url(#pulseInspectBefore)"
                    style={{ transition: opacityTransition }}
                  />
                  <path
                    {...pathProps}
                    opacity={resolved * AFTER_CURSOR_OPACITY}
                    clipPath="url(#pulseInspectAfter)"
                    style={{ transition: opacityTransition }}
                  />
                </g>
              )
            })}
          </g>
          ) : null}
        </g>

        {/* Paint game dividers above the activity series so they span the full plot. */}
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
              fill="rgba(249, 115, 22, 0.1)"
            />
            <line
              x1={highlightedGamePlotBounds.startX}
              x2={highlightedGamePlotBounds.startX}
              y1={viewerBandTop}
              y2={activityBottom}
              stroke="rgba(249, 115, 22, 0.45)"
              strokeWidth={1.5}
            />
            <line
              x1={highlightedGamePlotBounds.endX}
              x2={highlightedGamePlotBounds.endX}
              y1={viewerBandTop}
              y2={activityBottom}
              stroke="rgba(249, 115, 22, 0.32)"
              strokeWidth={1.25}
              strokeDasharray="4 5"
            />
          </g>
        ) : null}

        <OverviewChartMotionChrome
          motionEnabled={motionEnabled}
          lockPinIndex={lockPinIndex}
          pinIndex={pinIndex}
          hoverPreviewIndex={hoverPreviewIndex}
          listPreviewIndex={listPreviewIndex}
          activeIndex={activeIndex ?? null}
          lockPinTargetX={lockPinTargetX}
          hoverTargetX={hoverTargetX}
          listPreviewTargetX={listPreviewTargetX}
          highlightTargetX={highlightTargetX}
          plotWidth={plotWidth}
          plotClipHeight={plotClipHeight}
          crosshairTop={crosshairTop}
          crosshairBottom={crosshairBottom}
        />

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
              y={height - 6}
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
    border: `1px solid ${CHART_INTERACTION.gridLine}`,
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
    color: 'var(--pulse-surface-text-muted, #9b9bac)',
    display: 'grid',
    fontSize: 11,
    fontWeight: 700,
    minHeight: DEFAULT_HEIGHT,
    padding: '0 12px',
    placeItems: 'center',
    textAlign: 'center',
  },
}
