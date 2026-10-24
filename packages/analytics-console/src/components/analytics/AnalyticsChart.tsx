import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import type { AnalyticsMinuteRollup, AnalyticsStreamDetail, GameSegment } from '../../api.ts'
import { formatHeatOffset, reactionAnalyticalOffset } from '@streampulse/pulse-core'
import {
  MAX_PLOTTED_EMOTES,
  MIN_CHART_VIEWPORT_SECONDS,
  analyzeViewerCoverage,
  count,
  formatVodClock,
  minuteEmoteTotal,
  normalizeGameSegments,
  rollupHasMinuteData,
  rollupsForChart,
  rollupsHaveViewerData,
  viewerSourceLabel,
  viewerReadoutValue,
  vodClock,
} from '@streampulse/pulse-charts'
import type { ChartReactionPoint } from '@streampulse/pulse-charts'
import {
  barAt,
  buildSpLevels,
  createSpHoverStore,
  createSpViewportStore,
  SP_EASE,
  type SpBar,
  type SpCaptions,
  type SpChartHandle,
  type SpHit,
  type SpHoverStore,
  type SpLiveEdge,
  type SpSelection,
  type SpViewportStore,
} from '@streampulse/pulse-charts/spchart'
import { spMark } from '@streampulse/pulse-charts/perfMarks'
import { classifyLiveEmptyState } from '../../utils/liveEmptyState.ts'
import { liveWarmupHintLine } from '../../utils/liveCollectionWarmup.ts'
import { CoreMinuteChartsNotice } from '../CoreMinuteChartsNotice.tsx'
import LiveCollectionWarmup from './LiveCollectionWarmup.tsx'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import type { ReplayHeatmapPoint } from '../../types/heatmap.ts'
import type { MomentVodJump } from '../../utils/selectedMomentDisplay.ts'
import {
  clampGamesDurationSeconds,
  minuteRollupEndOffsetSeconds,
  resolveGamesTimelineDurationSeconds,
  streamWallDurationSeconds,
  trimRollupsToWallDuration,
} from '../../utils/gameSegmentChart.ts'
import { GamesPlayedStrip } from './GamesPlayedStrip.tsx'
import { ChartNavigator, useChartScrollZoom, zoomNavigatorRange } from './ChartNavigator.tsx'
import { sessionNavigatorPresets } from '../../utils/sessionChartNavigator.ts'
import {
  liveEdgeLabel,
  plotEndMinutes,
  resolveLiveEdgeMode,
  rollupsThroughMinute,
} from '../../utils/chartLiveEdge.ts'
import { buildSessionChartModel, ratesCaption, spanLabel, type SessionChartModel } from './sessionSpChartModel.ts'
import { SessionSpChart, sessionPlotHeight } from './SessionSpChart.tsx'
import { sessionBandSegments } from './SessionChartLayers.tsx'
import { buildSessionPins, selectedPinIndex, type SessionPin, type SessionStripPinsSource } from './SessionChartPins.tsx'
import { SessionShowOnChart, SESSION_MARKERS_OFF, type SessionMarkers } from './SessionShowOnChart.tsx'
import { PlotOnChartStrip } from './PlotOnChartStrip.tsx'
import {
  SessionExpandButton,
  SessionRangeSeg,
  SessionReadout,
  SessionSeriesSeg,
  sessionSeriesKey,
  sessionSeriesVisibility,
  useSessionPhone,
  type SessionReadoutSelection,
} from './SessionChartToolbar.tsx'

function chartVisibleRangeFromRollups(
  rollups: AnalyticsMinuteRollup[],
  streamStartedAt: string | undefined,
): { startOffset: number; endOffset: number } | null {
  const attestedRollups = rollups.filter(rollupHasMinuteData)
  if (!attestedRollups.length || !streamStartedAt) return null
  const startMs = Date.parse(streamStartedAt)
  const first = Date.parse(attestedRollups[0]!.minuteTs)
  const last = Date.parse(attestedRollups[attestedRollups.length - 1]!.minuteTs)
  if (!Number.isFinite(startMs) || !Number.isFinite(first) || !Number.isFinite(last)) return null
  return {
    startOffset: Math.max(0, Math.round((first - startMs) / 1000)),
    endOffset: Math.max(0, Math.round((last - startMs) / 1000)),
  }
}

function selectedMinuteRangeLabel(
  minuteTs: string,
  streamStartedAt: string | undefined,
): string {
  const minuteMs = Date.parse(minuteTs)
  const streamMs = streamStartedAt ? Date.parse(streamStartedAt) : NaN
  if (!Number.isFinite(minuteMs) || !Number.isFinite(streamMs)) {
    return vodClock(minuteTs, streamStartedAt)
  }
  const startOffsetSeconds = Math.max(0, Math.round((minuteMs - streamMs) / 1000))
  return `${formatHeatOffset(startOffsetSeconds)}–${formatHeatOffset(startOffsetSeconds + 60)}`
}

export type AnalyticsViewMode =
  | 'overview'
  | 'viewers'
  | 'chat'
  | 'emotes'
  | 'spikes'
  | `series:${string}`
export type RightPanelTab = 'moments' | 'emotes' | 'clips' | 'sync'

/** The standard small bordered button, with a visible disabled state. */

/**
 * The session view never shows less than the chart's own viewport floor (five
 * minutes, which hold six minute steps), so the navigator stops there too.
 */
const NAVIGATOR_MIN_VISIBLE_STEPS = Math.ceil(MIN_CHART_VIEWPORT_SECONDS / 60) + 1

/** How far back the resting readout may look for a minute with a viewer sample. */
const RESTING_VIEWER_LOOKBACK_MS = 15 * 60_000

/** What the console's lead figures say about viewers (D5: the chart caption equals the StatCards). */
/** F23: the locked bar as the selected detail sees it (epoch ms, the chart's bar size). */
export interface SessionChartBarLock {
  startMs: number
  endMs: number
  levelMinutes: number
  /** "Zoom to bucket": the view eases to this bar. */
  zoom(): void
}

export interface SessionViewerCaption {
  peak: number | null | undefined
  avg: number | null | undefined
}

const noop = () => {}

/** Stream-relative label of a sample index ("00:19:00"). */
function sampleLabel(model: SessionChartModel, index: number): string {
  const ms = model.data.startMs + index * model.data.stepMs
  return formatHeatOffset(Math.max(0, Math.round((ms - model.originMs) / 1000)))
}

interface SessionNavigatorProps {
  model: SessionChartModel
  store: SpViewportStore
  levelMinutes: number | null
  focusIndex: number | null
  selectedIndex: number | null
  wheelSurfaceRef: RefObject<HTMLElement | null>
  wheelAnchor: () => Element | null | undefined
  scrollZoomEnabled: boolean
  onScrollZoomChange: (enabled: boolean) => void
}

/**
 * The navigator under the plot (the hub's d3 navigator). It reads the target
 * from the store, so a zoom renders this host and not the whole chart.
 */
function SessionNavigator({
  model,
  store,
  levelMinutes,
  focusIndex,
  selectedIndex,
  wheelSurfaceRef,
  wheelAnchor,
  scrollZoomEnabled,
  onScrollZoomChange,
}: SessionNavigatorProps) {
  const target = useSyncExternalStore(store.subscribeTarget, store.getTarget, store.getTarget)
  const onReset = useCallback(
    () => store.setTarget({ startIndex: 0, endIndex: store.getCount() - 1 }, { animate: true }),
    [store],
  )
  const full = target.startIndex <= 0 && target.endIndex >= model.n - 1
  // A click on the track at full range zooms to presets[0] around it, as before (15m, or 1h past 2h).
  const presets = useMemo(
    () => sessionNavigatorPresets(((model.n - 1) * model.data.stepMs) / 1000, 0),
    [model.n, model.data.stepMs],
  )
  return (
    <div
      className="ssc-navhost"
      data-session-chart-navigator=""
      data-chart-range-state={full ? 'full' : 'zoomed'}
    >
      <ChartNavigator
        variant="d3"
        infoDisclosure
        viewportSource={store}
        overview={model.overview}
        pointCount={model.n}
        presets={presets}
        startIndex={target.startIndex}
        endIndex={target.endIndex}
        startLabel={sampleLabel(model, target.startIndex)}
        endLabel={sampleLabel(model, target.endIndex)}
        focusIndex={focusIndex}
        selectedIndex={selectedIndex}
        wheelSurfaceRef={wheelSurfaceRef}
        wheelAnchor={wheelAnchor}
        minVisibleCount={NAVIGATOR_MIN_VISIBLE_STEPS}
        scrollZoomEnabled={scrollZoomEnabled}
        onScrollZoomChange={onScrollZoomChange}
        onChange={noop}
        onReset={onReset}
        fullRangeLabel="Full stream"
        zoomedRangeLabel={spanLabel((target.endIndex - target.startIndex) * model.data.stepMs)}
        unitLabel="minutes"
        selectedLabel="Return to selected"
        readoutCount="screen-reader"
        readoutNote={levelMinutes != null ? (
          <span
            className="ssc-barnote"
            data-chart-bar-bucket-minutes={levelMinutes}
            data-chart-bar-size-label=""
          >
            {/* session-original navText: "Full stream · 10-min bars" */}
            {`${levelMinutes}-min bars`}
          </span>
        ) : undefined}
      />
    </div>
  )
}

/** Whether the view reaches the newest sample (one render per change, not per zoom). */
function useViewAtEnd(store: SpViewportStore, n: number): boolean {
  const read = useCallback(() => store.getTarget().endIndex >= n - 1, [n, store])
  return useSyncExternalStore(store.subscribeTarget, read, read)
}

/** The window's inner height, kept current on resize while `on` (Expand fills it). */
function useWindowHeight(on: boolean): number {
  const [height, setHeight] = useState(() => (typeof window === 'undefined' ? 0 : window.innerHeight))
  useEffect(() => {
    if (!on || typeof window === 'undefined') return
    const read = () => setHeight(window.innerHeight)
    read()
    window.addEventListener('resize', read)
    return () => window.removeEventListener('resize', read)
  }, [on])
  return height
}

/** Expand's plot height, eased over 260 ms on the viewport's curve; without motion it jumps (2026-10-21). */
function useEasedPlotHeight(target: number, motion: boolean): number {
  const [height, setHeight] = useState(target)
  const shown = useRef(target)
  useEffect(() => {
    if (!motion || typeof requestAnimationFrame !== 'function' || shown.current === target) {
      shown.current = target
      setHeight(target)
      return
    }
    const from = shown.current
    let t0: number | null = null
    let raf = requestAnimationFrame(function step(t) {
      t0 ??= t
      const k = Math.min(1, (t - t0) / 260)
      shown.current = Math.round(from + (target - from) * SP_EASE(k))
      setHeight(shown.current)
      if (k < 1) raf = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(raf)
  }, [target, motion])
  return motion ? height : target
}

function AnalyticsChart({
  detail,
  selectedEmotes,
  onSelectEmote,
  onClearEmotePlots,
  onResetEmotePlots,
  selectedRollup,
  selectedOffsetSeconds = null,
  previewOffsetSeconds = null,
  onSelectRollup,
  onSelectReactionMoment,
  syncing = false,
  syncError = null,
  syncNotice = null,
  onSync = () => {},
  onRefresh = () => {},
  showRefreshControl = true,
  refreshing = false,
  loading = false,
  games = [],
  canSync = false,
  isLive = false,
  notInAnalyticsDb = false,
  coreMinuteChartsBlocked = false,
  liveHasRichHistory = false,
  chatOnlySyncAvailable = false,
  onChatOnlySync,
  syncCtaLabel: syncCtaLabelText,
  syncViewerStatus,
  viewMode,
  onViewModeChange,
  heatmapPoints,
  reactionMoments,
  selectedDetail,
  viewerCaption = null,
  stripPins = null,
  extraPlotPx = 0,
  momentOffsetInBar,
  selectionIsMoment = false,
  onExpandedChange,
}: {
  detail?: AnalyticsStreamDetail
  selectedEmotes: Set<string>
  onSelectEmote: (key: string) => void
  onClearEmotePlots?: () => void
  onResetEmotePlots?: () => void
  selectedRollup: AnalyticsMinuteRollup | null
  previewRollup?: AnalyticsMinuteRollup | null
  selectedOffsetSeconds?: number | null
  previewOffsetSeconds?: number | null
  onSelectRollup: (rollup: AnalyticsMinuteRollup | null) => void
  onSelectOffset?: (offsetSeconds: number) => void
  onSelectReactionMoment?: (moment: ChartReactionPoint) => void
  onPreviewReactionMoment?: (moment: ChartReactionPoint | null) => void
  syncing?: boolean
  syncError?: string | null
  syncNotice?: string | null
  onSync?: () => void
  onRefresh?: () => void
  /** The console shell already owns refresh; disable this to avoid duplicate controls. */
  showRefreshControl?: boolean
  refreshing?: boolean
  loading?: boolean
  games?: GameSegment[]
  canSync?: boolean
  isLive?: boolean
  notInAnalyticsDb?: boolean
  coreMinuteChartsBlocked?: boolean
  liveHasRichHistory?: boolean
  chatOnlySyncAvailable?: boolean
  onChatOnlySync?: () => void
  syncCtaLabel?: string
  syncViewerStatus?: string
  viewMode: AnalyticsViewMode
  onViewModeChange: (mode: AnalyticsViewMode) => void
  heatmapPoints?: ReplayHeatmapPoint[]
  /** Canonical merged reaction windows; heatmap points are only the fallback. */
  reactionMoments?: ChartReactionPoint[]
  /** VOD deep link for the pinned minute; the selected detail card carries it. */
  vodJump?: MomentVodJump | null
  /** Under the chart while something is selected; a function also gets the locked bar (F23). */
  selectedDetail?: ReactNode | ((bar: SessionChartBarLock | null) => ReactNode)
  /** The lead figures' viewer peak and average, drawn as the viewers caption. */
  viewerCaption?: SessionViewerCaption | null
  /** The Pulse Moments strip's source; pins render only while the strip does. */
  stripPins?: SessionStripPinsSource | null
  /** Px the plot grows so the side column's moment rows end level with it (session-original fillH). */
  extraPlotPx?: number
  /**
   * F23: the moment a bar click locks with the bar, as an analytical offset
   * (the best ranked in the Moments list), or null for none. Without it the
   * click takes the first reaction moment in the bar.
   */
  momentOffsetInBar?: (span: { startMs: number; endMs: number }) => number | null
  /** F23: the selection is a Moments row or pin, so it locks the bar holding it (a table minute doesn't). */
  selectionIsMoment?: boolean
  /** Expand toggled on a desktop: the console folds the side columns under the chart (B2). Phones keep their layout. */
  onExpandedChange?: (expanded: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)
  const { motionEnabled } = useConsoleMotion()
  const phone = useSessionPhone()
  const onExpandedChangeRef = useRef(onExpandedChange)
  onExpandedChangeRef.current = onExpandedChange
  const layoutExpanded = expanded && !phone
  useEffect(() => {
    onExpandedChangeRef.current?.(layoutExpanded)
  }, [layoutExpanded])

  useEffect(() => {
    if (!selectedRollup) return
    function handlePointerDown(event: PointerEvent) {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('button, a, input, select, [data-chart-action="true"], .spc-svg, [data-session-chart-part]')) {
        return
      }
      onSelectRollup(null)
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        onSelectRollup(null)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onSelectRollup, selectedRollup])

  const allRollups = detail?.rollups ?? []
  const streamStartedAt = detail?.stream?.startedAt
  const wallDurationSeconds = useMemo(
    () => streamWallDurationSeconds(detail?.stream),
    [detail?.stream],
  )
  const chartedRollups = useMemo(() => {
    const charted = rollupsForChart(allRollups, isLive)
    return trimRollupsToWallDuration(charted, streamStartedAt, wallDurationSeconds)
  }, [allRollups, isLive, streamStartedAt, wallDurationSeconds])
  // Every measured minute, full resolution when loaded (the table lists these).
  const allDetailRollups = useMemo(
    () => (detail?.momentRollups?.length
      ? trimRollupsToWallDuration(detail.momentRollups, streamStartedAt, wallDurationSeconds)
      : undefined),
    [detail?.momentRollups, streamStartedAt, wallDurationSeconds],
  )
  // The plot, its time axis and the navigator all end on the newest minute with
  // data. On an open stream a partial newest minute, still being measured or the
  // one collection stopped in, is left off the plot (the table still lists it,
  // marked) and a marker at the edge says how fresh the data is.
  const liveEdgeMode = resolveLiveEdgeMode(detail, isLive)
  const liveMeasuredThroughMs = liveEdgeMode && detail?.updatedAt ? detail.updatedAt : null
  const plotEnd = useMemo(
    () => plotEndMinutes(allDetailRollups ?? chartedRollups, liveMeasuredThroughMs, liveEdgeMode != null),
    [allDetailRollups, chartedRollups, liveEdgeMode, liveMeasuredThroughMs],
  )
  const plotLastMinute = plotEnd.plotted
  // The partial minute the plot leaves off, if any, and why. While the live
  // status is unconfirmed nothing says more data is coming, so it is "partial".
  const leftOffMinute = plotEnd.leftOff && plotEnd.newest
    ? { minuteTs: plotEnd.newest.minuteTs, reason: liveEdgeMode === 'unconfirmed' ? 'partial' as const : plotEnd.leftOff }
    : null
  const rollups = useMemo(() => {
    const plotted = rollupsThroughMinute(chartedRollups, plotLastMinute)
    // A downsampled series may skip the last minute; end it there anyway.
    if (plotLastMinute && plotted.length > 0 && plotted[plotted.length - 1]!.minuteTs !== plotLastMinute.minuteTs) {
      plotted.push(plotLastMinute)
    }
    return plotted
  }, [chartedRollups, plotLastMinute])
  const hasSyncedChat = rollups.some(point => !point.missing && (point.chatCount ?? 0) > 0)
  const viewerCoverage = useMemo(() => analyzeViewerCoverage(rollups), [rollups])
  const needsViewerResync = !isLive && hasSyncedChat && (
    !viewerCoverage.hasViewerRollups
    || viewerCoverage.hasFlatViewerLine
    || viewerCoverage.hasPartialTail
    || viewerCoverage.hasShortSpan
  )
  const hasChartData = useMemo(() => allRollups.some(rollupHasMinuteData), [allRollups])
  const hasViewerChartData = useMemo(() => rollupsHaveViewerData(allRollups), [allRollups])
  const hasChatData = useMemo(
    () => rollups.some(point => (point.chatCount ?? 0) > 0 || minuteEmoteTotal(point) > 0),
    [rollups],
  )
  const liveViewerCollectHint = useMemo(
    () => (isLive && hasChatData && !hasViewerChartData
      ? liveWarmupHintLine({
        viewerSamples: detail?.stream?.viewerSamples,
        chatMessages: detail?.stream?.chatMessages,
      })
      : null),
    [isLive, hasChatData, hasViewerChartData, detail?.stream?.viewerSamples, detail?.stream?.chatMessages],
  )
  const canRenderChart = hasChartData || hasViewerChartData
  const viewerBackfillPending = syncing && (syncViewerStatus === 'pending_backfill' || syncViewerStatus === 'backfilling')
  const partialChatCoverage = !isLive && !syncing && Boolean(detail?.chatCoverage?.partial)

  const chartDurationSeconds = useMemo(() => {
    // Broadcast offsets: the plot ends at the start of the last plotted minute.
    const fromRollups = minuteRollupEndOffsetSeconds(rollups, streamStartedAt)
    const rollupEnd = fromRollups > 0 ? fromRollups : Math.max(rollups.length * 60, 60)
    const startMs = streamStartedAt ? Date.parse(streamStartedAt) : Number.NaN
    const firstMs = rollups.length > 0 ? Date.parse(rollups[0]!.minuteTs) : Number.NaN
    const lastMs = plotLastMinute ? Date.parse(plotLastMinute.minuteTs) : Number.NaN
    const plotEnd = Number.isFinite(startMs) && Number.isFinite(lastMs) && Number.isFinite(firstMs) && lastMs > firstMs
      ? Math.round((lastMs - startMs) / 1000)
      : rollupEnd
    return clampGamesDurationSeconds(plotEnd > 0 ? plotEnd : rollupEnd, wallDurationSeconds)
  }, [plotLastMinute, rollups, streamStartedAt, wallDurationSeconds])
  const gamesDurationSeconds = useMemo(
    () => resolveGamesTimelineDurationSeconds(games, chartDurationSeconds, wallDurationSeconds, isLive),
    [chartDurationSeconds, games, isLive, wallDurationSeconds],
  )
  const chartGames = useMemo(
    () => normalizeGameSegments(games, gamesDurationSeconds),
    [games, gamesDurationSeconds],
  )
  // The posters' run times end with the newest measured minute (session-original
  // DATA_END), not the games API's last segment end, which can run on for days
  // on a stale live record ("35h 34m" on a 13h 51m stream).
  const gamesDataEndSeconds = useMemo(
    () => minuteRollupEndOffsetSeconds(
      trimRollupsToWallDuration(allRollups, streamStartedAt, wallDurationSeconds),
      streamStartedAt,
    ),
    [allRollups, streamStartedAt, wallDurationSeconds],
  )
  // Segments without durations are spread over the timeline: keep the band's spread so keys match.
  const stripGamesEndSeconds = gamesDataEndSeconds > 0 && games.some(game => game.durationSeconds > 0)
    ? gamesDataEndSeconds
    : gamesDurationSeconds
  const stripGames = useMemo(
    () => normalizeGameSegments(games, stripGamesEndSeconds),
    [games, stripGamesEndSeconds],
  )
  // Live: range-aware Games played (chart window) with expand. Offline/VOD: full list.
  const gamesVisibleRange = useMemo(
    () => (isLive ? chartVisibleRangeFromRollups(rollups, streamStartedAt) : null),
    [isLive, rollups, streamStartedAt],
  )
  const detailRollups = useMemo(
    () => (allDetailRollups ? rollupsThroughMinute(allDetailRollups, plotLastMinute) : undefined),
    [allDetailRollups, plotLastMinute],
  )
  const chartReactionPoints = useMemo(
    () => reactionMoments ?? heatmapPoints ?? [],
    [heatmapPoints, reactionMoments],
  )
  const firstViewerRollup = useMemo(
    () => rollups.find(rollup => viewerReadoutValue(rollup) !== null) ?? null,
    [rollups],
  )
  const viewerCoverageStartSeconds = useMemo(() => {
    if (!firstViewerRollup || !streamStartedAt) return 0
    const streamMs = Date.parse(streamStartedAt)
    const firstMs = Date.parse(firstViewerRollup.minuteTs)
    if (!Number.isFinite(streamMs) || !Number.isFinite(firstMs)) return 0
    return Math.max(0, Math.round((firstMs - streamMs) / 1000))
  }, [firstViewerRollup, streamStartedAt])
  const liveViewerCoverageHint = useMemo(() => {
    if (!isLive || !firstViewerRollup || viewerCoverageStartSeconds <= 5 * 60) return null
    const sampledMinutes = rollups.filter(rollup => viewerReadoutValue(rollup) !== null).length
    if (sampledMinutes <= 0) return null
    const offsetLabel = formatHeatOffset(viewerCoverageStartSeconds)
    return `Only ${sampledMinutes} viewer-sampled minute${sampledMinutes === 1 ? '' : 's'} are available from ${offsetLabel}; earlier minutes contain chat/emote data but no viewer samples.`
  }, [firstViewerRollup, isLive, rollups, viewerCoverageStartSeconds])
  // Shared with the hub and remembered in this browser: on by default, so a
  // plain wheel over the plot zooms.
  const [scrollZoomEnabled, setScrollZoomEnabled] = useChartScrollZoom()
  const [dataPage, setDataPage] = useState(0)
  const selectedChartOffsetSeconds = useMemo(() => {
    const explicitOffset = typeof selectedOffsetSeconds === 'number' && Number.isFinite(selectedOffsetSeconds)
      ? selectedOffsetSeconds
      : null
    if (explicitOffset != null) {
      return Math.max(0, Math.min(chartDurationSeconds, explicitOffset))
    }
    if (!selectedRollup || !streamStartedAt) return null
    const streamMs = Date.parse(streamStartedAt)
    const selectedMs = Date.parse(selectedRollup.minuteTs)
    if (!Number.isFinite(streamMs) || !Number.isFinite(selectedMs)) return null
    return Math.max(0, Math.min(chartDurationSeconds, Math.round((selectedMs - streamMs) / 1000)))
  }, [chartDurationSeconds, selectedOffsetSeconds, selectedRollup, streamStartedAt])
  // The table lists every measured minute when the full-resolution series is loaded;
  // `rollups` is the chart's downsampled series.
  const tableRollups = allDetailRollups ?? chartedRollups
  const dataPageCount = Math.max(1, Math.ceil(tableRollups.length / 120))
  const boundedDataPage = Math.min(dataPage, dataPageCount - 1)
  const dataPageEnd = tableRollups.length - boundedDataPage * 120
  const pagedDataRows = tableRollups.slice(Math.max(0, dataPageEnd - 120), dataPageEnd)
  const selectedOutsideDataPage = selectedRollup != null && !pagedDataRows.some(row => row.minuteTs === selectedRollup.minuteTs)

  // At rest the readout names the last complete minute: a live stream's newest
  // minute is still filling and reads like a collapse.
  const lastCompleteRollup = useMemo(() => {
    const measuredThrough = detail?.updatedAt
    for (let index = rollups.length - 1; index >= 0; index -= 1) {
      const minuteEnd = Date.parse(rollups[index].minuteTs) + 60_000
      if (!measuredThrough || !Number.isFinite(minuteEnd) || minuteEnd <= measuredThrough) return rollups[index]
    }
    return null
  }, [detail?.updatedAt, rollups])
  // The newest complete minute can have chat but no viewer sample yet. At rest,
  // show the latest recent minute that has one, so the readout does not say
  // "viewers —" beside a stat card with a viewer count.
  const restingRollup = useMemo(() => {
    if (!lastCompleteRollup || viewerReadoutValue(lastCompleteRollup) !== null) return lastCompleteRollup
    const lastMs = Date.parse(lastCompleteRollup.minuteTs)
    for (let index = rollups.indexOf(lastCompleteRollup) - 1; index >= 0; index -= 1) {
      const rollup = rollups[index]!
      if (lastMs - Date.parse(rollup.minuteTs) > RESTING_VIEWER_LOOKBACK_MS) break
      if (viewerReadoutValue(rollup) !== null) return rollup
    }
    return lastCompleteRollup
  }, [lastCompleteRollup, rollups])

  // ---- the chart part (d3 design, plan §1.2 / §2.4) ----

  // The plotted emotes ("Emote overlays" under the plot), in colour order.
  const plottedKeys = useMemo(() => [...selectedEmotes].slice(0, MAX_PLOTTED_EMOTES), [selectedEmotes])
  const model = useMemo(
    () => buildSessionChartModel({
      rollups: detailRollups ?? rollups,
      streamStartedAt,
      overlayKeys: plottedKeys,
      availability: detail?.availability,
      coverageStartOffsetSeconds: detail?.coverageStartOffsetSeconds,
    }),
    [detail?.availability, detail?.coverageStartOffsetSeconds, detailRollups, plottedKeys, rollups, streamStartedAt],
  )
  // Show on chart (d3-v2 session-original): every marker off on each load, never remembered.
  const [markers, setMarkers] = useState<SessionMarkers>(SESSION_MARKERS_OFF)
  const n = model?.n ?? 2

  const motionRef = useRef(motionEnabled)
  motionRef.current = motionEnabled
  const streamKey = detail?.stream?.streamId ?? ''
  const store = useMemo(
    () => createSpViewportStore({
      count: Math.max(2, n),
      minSpan: NAVIGATOR_MIN_VISIBLE_STEPS - 1,
      reducedMotion: () => !motionRef.current,
    }),
    // A new stream starts a new view; live growth uses setCount below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streamKey],
  )
  useEffect(() => () => store.destroy(), [store])
  useEffect(() => {
    store.setCount(Math.max(2, n))
  }, [n, store])
  const hover: SpHoverStore = useMemo(createSpHoverStore, [])
  useEffect(() => {
    const off = store.subscribeGesture(active => spMark(active ? 'sp:wheel-start' : 'sp:wheel-settle'))
    return off
  }, [store])

  const markedDetail = useRef(false)
  useEffect(() => {
    if (!model || markedDetail.current) return
    markedDetail.current = true
    spMark('sp:session-detail')
  }, [model])
  const markedGames = useRef(false)
  useEffect(() => {
    if (!chartGames.length || markedGames.current) return
    markedGames.current = true
    spMark('sp:games-ready')
  }, [chartGames])

  // The whole chart card is the wheel zone (owner rule: the wheel zooms
  // anywhere over a chart card): the games strip, the toolbar, the pins and
  // band, the plot, the axis and the navigator. The plot only anchors the zoom.
  const chartCardRef = useRef<HTMLDivElement>(null)
  const chartStackRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<SpChartHandle>(null)
  const plotWheelAnchor = useCallback(
    () => chartStackRef.current?.querySelector('.spc-svg rect[data-chart-touch-action]'),
    [],
  )
  // A wheel event that is not cancelable was already scrolled by the browser:
  // a page scroll that began outside the card (the selected detail, the minute
  // table) and brought the card under the pointer. It must not zoom as well
  // (A4: outside the card the wheel scrolls the page). Capture phase on the
  // card, so the navigator's listeners never see it. Core request u08-3 asks
  // the shared wheel handler to do this for both charts.
  const scrollThroughGuard = useRef<{ card: HTMLElement; off: () => void } | null>(null)
  useEffect(() => {
    const card = chartCardRef.current
    if (scrollThroughGuard.current?.card === card) return
    scrollThroughGuard.current?.off()
    scrollThroughGuard.current = null
    if (!card) return
    const onWheel = (event: WheelEvent) => {
      if (!event.cancelable) event.stopImmediatePropagation()
    }
    card.addEventListener('wheel', onWheel, { capture: true, passive: true })
    scrollThroughGuard.current = { card, off: () => card.removeEventListener('wheel', onWheel, { capture: true }) }
  })
  useEffect(() => () => scrollThroughGuard.current?.off(), [])
  // null until the stack is measured (in this commit, before the paint): the plot then draws once at its
  // width, not first at a stand-in 1000 px and again (two full chart renders in the session's first paint;
  // mobile TBT and LCP, PR #122 bench).
  const [stackWidth, setStackWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = chartStackRef.current
    if (!element) return
    const read = () => setStackWidth(Math.round(element.clientWidth))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(read)
    observer.observe(element)
    return () => observer.disconnect()
  }, [canRenderChart, model != null])
  // The stack spans the part, so its width is the part's. Below the one-row
  // width the range seg, Expand and the overlay control move under the plot
  // and the 40 px toolbar keeps the series seg and the readout.
  const [levelMinutes, setLevelMinutes] = useState<number | null>(null)

  const seriesKey = sessionSeriesKey(viewMode)
  // The core's one dashed overlay stays off; the session layer draws the plotted emotes.
  const visibility = useMemo(() => sessionSeriesVisibility(seriesKey, false), [seriesKey])
  // Plotted emotes draw with All and Emotes (session-original ovOn).
  const overlayLines = useMemo(
    () => (model && (seriesKey === 'all' || seriesKey === 'emotes') ? model.overlays : []),
    [model, seriesKey],
  )
  // A lane added or taken away re-lays the plot at once; it settles in from 45 % so the change reads (2026-10-21).
  const laneKey = `${seriesKey}:${overlayLines.length > 0}`
  const laneKeyRef = useRef(laneKey)
  useEffect(() => {
    if (laneKeyRef.current === laneKey) return
    laneKeyRef.current = laneKey
    const plot = chartStackRef.current?.querySelector<HTMLElement>('.spc-plot')
    if (motionEnabled && plot && typeof plot.animate === 'function') {
      plot.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 240, easing: 'cubic-bezier(.16, 1, .3, 1)' })
    }
  }, [laneKey, motionEnabled])
  const showAvg = markers.avg
  const captions = useMemo<SpCaptions>(() => {
    const peak = viewerCaption?.peak
    const rates = model ? ratesCaption(model, { chat: visibility.chat, emotes: visibility.emotes }) : null
    const viewerAvg = viewerCaption?.avg
    return {
      // The dotted average line draws only with Show on chart's Averages.
      rates: rates && !showAvg ? { ...rates, avg: null } : rates,
      viewers: peak != null && Number.isFinite(peak)
        ? { peak, avg: showAvg && viewerAvg != null && Number.isFinite(viewerAvg) ? viewerAvg : null, unit: 'viewers' }
        : null,
    }
  }, [model, showAvg, viewerCaption?.avg, viewerCaption?.peak, visibility.chat, visibility.emotes])

  const indexOfMs = useCallback(
    (ms: number) => (model ? Math.max(0, Math.min(model.n - 1, Math.floor((ms - model.data.startMs) / model.data.stepMs))) : 0),
    [model],
  )

  // F23 (session-original lockBar): a click on a bar above 1-minute bars locks
  // that bar with the moment it holds; a moment row or pin locks the bar that
  // holds it at the drawn size. The lock holds through zoom and ends with the selection.
  const [lockedBar, setLockedBar] = useState<{ bar: SpBar; levelMinutes: number } | null>(null)
  const levelRef = useRef(levelMinutes)
  levelRef.current = levelMinutes
  const barLevels = useMemo(() => (model ? buildSpLevels(model.data, model.data.startMs) : []), [model])
  const barHolding = useCallback((ms: number, minutes: number | null) => {
    if (!model || !minutes || minutes <= 1) return null
    const level = barLevels.find(item => Math.round(item.slotMs / 60_000) === minutes)
    const bar = level ? barAt(model.data, level, indexOfMs(ms)) : null
    return bar ? { bar, levelMinutes: minutes } : null
  }, [barLevels, indexOfMs, model])
  const selectionMs = !model
    ? NaN
    : selectedChartOffsetSeconds != null
      ? model.originMs + selectedChartOffsetSeconds * 1000
      : selectedRollup ? Date.parse(selectedRollup.minuteTs) : NaN
  useEffect(() => {
    if (!Number.isFinite(selectionMs)) {
      setLockedBar(null)
      return
    }
    setLockedBar(current => {
      // a moment belongs to a bar when its minute overlaps it (momentsIn); a lock it sits in stays, with fresh figures
      if (current && selectionMs < current.bar.endMs && selectionMs + 60_000 > current.bar.startMs) {
        return barHolding(current.bar.startMs, current.levelMinutes) ?? current
      }
      // a moment row or pin locks its bar (lockMoment, at the moment's middle); a minute pinned elsewhere doesn't
      return selectionIsMoment ? barHolding(selectionMs + 30_000, levelRef.current) : null
    })
  }, [barHolding, selectionIsMoment, selectionMs])

  const selectedIndex = model && selectedChartOffsetSeconds != null
    ? indexOfMs(model.originMs + selectedChartOffsetSeconds * 1000)
    : null
  const focusIndex = selectedIndex ?? (isLive ? n - 1 : null)

  const atEnd = useViewAtEnd(store, n)
  const liveEdge = useMemo<SpLiveEdge | null>(() => {
    if (!liveEdgeMode || !plotLastMinute || !atEnd) return null
    const atMs = Date.parse(plotLastMinute.minuteTs)
    if (!Number.isFinite(atMs)) return null
    return {
      atMs,
      pollSeq: atMs,
      stale: liveEdgeMode === 'unconfirmed',
      label: liveEdgeLabel({
        lastMinute: plotLastMinute,
        measuredThroughMs: liveMeasuredThroughMs,
        streamStartedAt,
        formatOffset: formatHeatOffset,
        mode: liveEdgeMode,
      }),
      tone: liveEdgeMode === 'unconfirmed' ? 'unconfirmed' : 'live',
    }
  }, [atEnd, liveEdgeMode, liveMeasuredThroughMs, plotLastMinute, streamStartedAt])

  const selected = useMemo<SpSelection | null>(() => {
    if (!model) return null
    if (lockedBar) return { startMs: lockedBar.bar.startMs, endMs: lockedBar.bar.endMs, kind: 'bar' }
    const ms = selectedRollup
      ? Date.parse(selectedRollup.minuteTs)
      : selectedChartOffsetSeconds != null ? model.originMs + selectedChartOffsetSeconds * 1000 : NaN
    if (!Number.isFinite(ms)) return null
    const startMs = model.data.startMs + indexOfMs(ms) * model.data.stepMs
    return { startMs, endMs: startMs + model.data.stepMs, kind: 'minute' }
  }, [indexOfMs, lockedBar, model, selectedChartOffsetSeconds, selectedRollup])

  const bandSegments = useMemo(
    () => (model ? sessionBandSegments(chartGames, model.originMs, model.data.startMs + model.n * model.data.stepMs) : []),
    [chartGames, model],
  )
  const highlightRange = useMemo(() => {
    const segment = hoveredGameKey ? bandSegments.find(item => item.key === hoveredGameKey) : null
    return segment ? { startMs: segment.startMs, endMs: segment.endMs } : null
  }, [bandSegments, hoveredGameKey])

  // Pins: the first five Pulse Moments strip rows; a click is the row's click.
  const stripRecap = stripPins?.recap
  const stripStart = stripPins?.streamStartedAt
  const stripHeat = stripPins?.heatmapPoints
  const stripCatalog = stripPins?.topEmotesCatalog
  const stripRollups = stripPins?.rollups
  const pins = useMemo(
    () => (stripRecap
      ? buildSessionPins({ recap: stripRecap, streamStartedAt: stripStart, heatmapPoints: stripHeat, topEmotesCatalog: stripCatalog, rollups: stripRollups, onSelectOffset: noop })
      : []),
    [stripCatalog, stripHeat, stripRecap, stripRollups, stripStart],
  )
  const pinIndex = selectedPinIndex(pins, selectedOffsetSeconds)
  // Focus goes back to what opened the selection when it closes (Esc, ×, a second click).
  const openerRef = useRef<HTMLElement | SVGElement | null>(null)
  const rememberOpener = useCallback(() => {
    const active = document.activeElement
    openerRef.current = active instanceof HTMLElement && active !== document.body
      ? active
      : chartRef.current?.plotElement() ?? null
  }, [])
  const hadSelection = useRef(false)
  useEffect(() => {
    const has = selectedRollup != null
    if (hadSelection.current && !has) {
      const opener = openerRef.current
      const active = document.activeElement
      if (opener?.isConnected && (!active || active === document.body)) opener.focus({ preventScroll: true })
      openerRef.current = null
    }
    hadSelection.current = has
  }, [selectedRollup])
  const onSelectOffsetRef = useRef(stripPins?.onSelectOffset)
  onSelectOffsetRef.current = stripPins?.onSelectOffset
  const onPinSelect = useCallback((pin: SessionPin) => {
    rememberOpener()
    onSelectOffsetRef.current?.(pin.offsetSeconds)
  }, [rememberOpener])
  const onPinClear = useCallback(() => onSelectRollup(null), [onSelectRollup])
  // The readout's Clear hides as it closes the selection, so focus goes back
  // to what opened it (else the plot) here rather than falling to the body.
  const onReadoutClear = useCallback(() => {
    const opener = openerRef.current?.isConnected ? openerRef.current : chartRef.current?.plotElement() ?? null
    openerRef.current = null
    onSelectRollup(null)
    opener?.focus({ preventScroll: true })
  }, [onSelectRollup])
  const pinProps = useMemo(
    () => ({ list: pins, selectedIndex: pinIndex, onSelect: onPinSelect, onClear: onPinClear }),
    [onPinClear, onPinSelect, pinIndex, pins],
  )
  const bandProps = useMemo(
    () => ({ segments: bandSegments, highlightedKey: hoveredGameKey, onHoverKey: setHoveredGameKey }),
    [bandSegments, hoveredGameKey],
  )

  // Prod click semantics: inside a moment group selects that moment, otherwise
  // the minute under the pointer is pinned; a click on the selection clears it.
  // F23: above 1-minute bars the click also locks the bar (the best ranked moment
  // in it when the page ranks them), and a click on the locked bar releases it.
  const onBarClick = useCallback((hit: SpHit) => {
    if (!model) return
    const step = model.data.stepMs
    const bar = !hit.fine && hit.bar ? hit.bar : null
    const groupStart = bar ? bar.startMs : model.data.startMs + hit.index * step
    const groupEnd = bar ? bar.endMs : groupStart + step
    const inGroup = (ms: number) => ms >= groupStart && ms < groupEnd
    if (lockedBar) {
      if (lockedBar.bar.startMs === groupStart && lockedBar.bar.endMs === groupEnd) {
        onSelectRollup(null)
        return
      }
    } else {
      const selectedMs = selectedRollup
        ? Date.parse(selectedRollup.minuteTs)
        : selectedChartOffsetSeconds != null ? model.originMs + selectedChartOffsetSeconds * 1000 : NaN
      if (Number.isFinite(selectedMs) && inGroup(selectedMs)) {
        onSelectRollup(null)
        return
      }
    }
    const lock = bar && hit.levelMinutes > 1 ? { bar, levelMinutes: hit.levelMinutes } : null
    const best = lock && momentOffsetInBar ? momentOffsetInBar({ startMs: groupStart, endMs: groupEnd }) : null
    if (best != null && Number.isFinite(best) && onSelectOffsetRef.current) {
      rememberOpener()
      setLockedBar(lock)
      onSelectOffsetRef.current(best)
      return
    }
    const moment = chartReactionPoints.find(point => inGroup(model.originMs + reactionAnalyticalOffset(point) * 1000))
    if (moment && onSelectReactionMoment) {
      rememberOpener()
      setLockedBar(lock)
      onSelectReactionMoment(moment)
      return
    }
    // the bar's own minute: the hover can name a bar a few px before its first sample's column
    const index = bar ? Math.min(Math.max(hit.index, bar.fromIndex), bar.toIndex - 1) : hit.index
    let row = model.rows[index] ?? null
    if (!row && bar) {
      for (let i = bar.fromIndex; i < bar.toIndex && !row; i += 1) row = model.rows[i] ?? null
    }
    if (!row) return
    rememberOpener()
    setLockedBar(lock)
    onSelectRollup(row)
  }, [chartReactionPoints, lockedBar, model, momentOffsetInBar, onSelectReactionMoment, onSelectRollup, rememberOpener, selectedChartOffsetSeconds, selectedRollup])

  const zoomToLockedBar = useCallback(() => {
    if (!lockedBar) return
    const { fromIndex, toIndex } = lockedBar.bar
    store.setTarget({ startIndex: fromIndex, endIndex: Math.max(toIndex - 1, fromIndex + 1) }, { animate: true })
  }, [lockedBar, store])
  const barLock = useMemo<SessionChartBarLock | null>(
    () => (lockedBar
      ? { startMs: lockedBar.bar.startMs, endMs: lockedBar.bar.endMs, levelMinutes: lockedBar.levelMinutes, zoom: zoomToLockedBar }
      : null),
    [lockedBar, zoomToLockedBar],
  )
  const selectedDetailNode = typeof selectedDetail === 'function' ? selectedDetail(barLock) : selectedDetail

  // The plot's + / - / 0 keys step exactly like Zoom in / Zoom out / Reset zoom
  // (the chart core's own step differs, so the stack takes these keys first).
  const onStackKeyDownCapture = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as Element | null
    const key = event.key
    if (target?.closest?.('.spc-svg') && (key === '+' || key === '=' || key === '-' || key === '_' || key === '0')) {
      event.stopPropagation()
      // With Ctrl, Cmd or Alt held these stay the browser's page zoom.
      if (event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      if (key === '0') {
        store.setTarget({ startIndex: 0, endIndex: n - 1 }, { animate: true })
        return
      }
      const current = store.getTarget()
      const next = zoomNavigatorRange(n, current, focusIndex, key === '-' || key === '_' ? 'out' : 'in', NAVIGATOR_MIN_VISIBLE_STEPS)
      store.setTarget(next, { animate: true })
      return
    }
    // Escape releases a selection first (the document listener); with nothing
    // selected it restores the full range. A navigator slider keeps its own Escape.
    if (key !== 'Escape') return
    const view = store.getTarget()
    if (view.startIndex <= 0 && view.endIndex >= n - 1) return
    if (selectedRollup || Number.isFinite(selectedOffsetSeconds)) return
    if (target?.closest?.('[data-hub-chart-navigator]')) return
    event.preventDefault()
    event.stopPropagation()
    store.setTarget({ startIndex: 0, endIndex: n - 1 }, { animate: true })
  }

  // Drag on a zoomed plot pans it, following the pointer without easing.
  const onStackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === 'touch') return
    const target = event.target as Element | null
    if (!target?.closest?.('.spc-svg') || target.closest('.spc-pe')) return
    // Pan what is drawn: an easing zoom stops where it is.
    const visual = store.getVisual()
    const start = { startIndex: Math.round(visual.startIndex), endIndex: Math.round(visual.endIndex) }
    if (start.startIndex <= 0 && start.endIndex >= n - 1) return
    const scale = chartRef.current?.frame().scale ?? 0
    if (!(scale > 0)) return
    const x0 = event.clientX
    const move = (e: PointerEvent) => {
      const shift = Math.round((e.clientX - x0) / scale)
      store.setTarget({ startIndex: start.startIndex - shift, endIndex: start.endIndex - shift }, { animate: false })
    }
    const end = (e: PointerEvent) => {
      if (e.type === 'pointerup') move(e)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const readoutSelection = useMemo<SessionReadoutSelection>(() => {
    if (!model) return { moment: null, pinned: null }
    const bar = lockedBar
    if (pinIndex >= 0) {
      const pin = pins[pinIndex]!
      return { moment: { offsetSeconds: pin.offsetSeconds, rollup: selectedRollup, tokens: pin.tokens }, pinned: null, bar }
    }
    if (selectedRollup) {
      const ms = Date.parse(selectedRollup.minuteTs)
      if (Number.isFinite(ms)) return { moment: null, pinned: { offsetSeconds: (ms - model.originMs) / 1000, rollup: selectedRollup }, bar }
    }
    return { moment: null, pinned: null, bar }
  }, [lockedBar, model, pinIndex, pins, selectedRollup])

  const windowHeight = useWindowHeight(expanded)
  const plotHeight = useEasedPlotHeight(sessionPlotHeight(expanded, phone, windowHeight), motionEnabled)
  const toggleExpanded = useCallback(() => setExpanded(value => !value), [])
  // Expand fills the screen (Aron's pick B2, 2026-10-21): the console moves the side columns under the chart
  // (onExpandedChange), the toolbar scrolls up under the site nav once the plot has grown (a smooth scroll that
  // starts while the page still changes height stops short), and Escape goes back once nothing else on the page
  // used it (a popover, a selection, a zoom: their document and chart listeners run before this window one).
  const chartPartRef = useRef<HTMLElement>(null)
  const selectionHeldRef = useRef(false)
  selectionHeldRef.current = !!selectedRollup || Number.isFinite(selectedOffsetSeconds)
  useEffect(() => {
    if (!expanded) return
    const timer = phone
      ? undefined
      : setTimeout(() => {
          const part = chartPartRef.current
          if (part && typeof part.scrollIntoView === 'function') part.scrollIntoView({ block: 'start', behavior: motionEnabled ? 'smooth' : 'instant' })
        }, motionEnabled ? 280 : 0)
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || selectionHeldRef.current) return
      setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scroll once per Expand, with the motion setting of that moment
  }, [expanded])

  if (loading && !detail) {
    return (
      <div className="grid min-h-80 place-items-center rounded border border-white/10 bg-[#0d0d12]/50 px-4 text-center">
        <div className="text-sm font-bold text-zinc-500">Loading chart data…</div>
      </div>
    )
  }

  if (!canRenderChart && (detail?.state === 'syncing' || syncing)) {
    return (
      <div className="grid min-h-80 place-items-center rounded border border-white/10 bg-[#0d0d12]/50 backdrop-blur-md px-4 text-center">
        <div>
          <div className="text-base font-black text-zinc-100">Syncing chart data…</div>
          <div className="mt-1 text-sm font-semibold text-zinc-500 max-w-md">
            Viewer minutes appear as soon as TwitchTracker finishes. Chat and emotes fill in segment by segment.
          </div>
          <div className="mt-2 text-xs font-semibold text-zinc-600">
            Step-by-step progress is in the Sync tab on the right.
          </div>
          {syncNotice ? <div className="mt-2 text-xs font-bold text-amber-300">{syncNotice}</div> : null}
          {syncError ? <div className="mt-2 text-xs font-bold text-red-400">{syncError}</div> : null}
        </div>
      </div>
    )
  }

  if (!canRenderChart) {
    if (coreMinuteChartsBlocked) {
      return (
        <div className="grid min-h-80 place-items-center rounded border border-white/10 bg-[#0d0d12]/50 backdrop-blur-md px-4 text-center">
          <CoreMinuteChartsNotice />
        </div>
      )
    }
    if (isLive && liveHasRichHistory) {
      return (
        <div className="grid min-h-80 place-items-center rounded border border-white/10 bg-[#0d0d12]/50 backdrop-blur-md px-4 text-center">
          <div>
            <div className="text-base font-black text-zinc-100">Live collector has no minute rollups yet</div>
            <div className="mt-1 text-sm font-semibold text-zinc-500 max-w-md">
              The IRC collector is running but has not written chart minutes for this session. Past synced streams are in the left rail — pick one for full charts, or wait and refresh.
            </div>
            {showRefreshControl ? <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="mt-5 rounded-lg border border-white/10 bg-white/[0.05] px-5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button> : null}
          </div>
        </div>
      )
    }
    const isTwitchTracker = detail?.sources?.some(s => s.source === 'twitchtracker')
    const canShowSync = canSync || detail?.state === 'historical' || isTwitchTracker
    const liveEmpty = classifyLiveEmptyState({
      collectingNow: isLive,
      rollupCount: rollups.filter(point => !point.missing).length,
    })
    if (liveEmpty.kind === 'collecting-first-minutes') {
      const minuteDataCount = rollups.filter(point => rollupHasMinuteData(point)).length
      return (
        <div className="grid min-h-80 place-items-center rounded border border-white/10 bg-[#0d0d12]/50 backdrop-blur-md px-4 py-8 text-center">
          <LiveCollectionWarmup
            rollupMinuteCount={minuteDataCount}
            viewerSamples={detail?.stream?.viewerSamples}
            chatMessages={detail?.stream?.chatMessages}
          />
        </div>
      )
    }
    return (
      <div className="grid min-h-80 place-items-center rounded border border-white/10 bg-[#0d0d12]/50 backdrop-blur-md px-4 text-center">
        <div>
          <div className="text-base font-black text-zinc-100">{(isTwitchTracker || canSync) ? 'Chat & Emotes Offline' : 'No minute data'}</div>
          <div className="mt-1 text-sm font-semibold text-zinc-500 max-w-md">
            {(isTwitchTracker || canSync)
              ? 'This stream has TwitchTracker averages only. Sync pulls minute-level viewers, chat, and 7TV data (large VODs can take a few minutes).'
              : 'No minute data was recorded for this stream.'}
          </div>
          {notInAnalyticsDb ? (
            <div className="mt-2 text-xs font-semibold text-zinc-600">
              Stream not in analytics DB yet — sync will create it.
            </div>
          ) : null}
          {canShowSync ? (
            <div className="mt-5 flex w-full flex-col items-center gap-2">
              {chatOnlySyncAvailable && onChatOnlySync ? (
                <button
                  type="button"
                  onClick={onChatOnlySync}
                  disabled={syncing}
                  className="rounded-lg border border-violet-400/30 bg-violet-500/10 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
                >
                  Re-sync chat only
                </button>
              ) : null}
              <button
                type="button"
                onClick={onSync}
                disabled={syncing}
                className="rounded-lg border border-violet-400/30 bg-violet-500/10 px-5 py-2.5 text-xs font-black uppercase tracking-wider text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : (syncCtaLabelText ?? 'Sync chat/emotes')}
              </button>
              {syncNotice ? <div className="mt-2 text-xs font-bold text-amber-300">{syncNotice}</div> : null}
              {syncError ? <div className="mt-2 text-xs font-bold text-red-400">{syncError}</div> : null}
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const rangeControls = model ? (
    <>
      <SessionRangeSeg store={store} model={model} phone={phone} />
      <SessionExpandButton expanded={expanded} onToggle={toggleExpanded} />
      <SessionShowOnChart markers={markers} onChange={setMarkers} liveAvailable={liveEdgeMode != null && plotLastMinute != null} />
    </>
  ) : null
  const syncButton = canSync && !coreMinuteChartsBlocked && (!hasChatData || needsViewerResync) ? (
    <button
      type="button"
      onClick={onSync}
      disabled={syncing}
      className="ssc-qb ssc-sync"
    >
      {syncing ? 'Syncing…' : needsViewerResync ? 'Re-sync viewers' : 'Sync chat/emotes'}
    </button>
  ) : null
  const refreshButton = showRefreshControl ? (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      aria-label={refreshing ? 'Refreshing chart and stats' : 'Refresh chart and stats'}
      title="Reload chart and stats from server"
      className="ssc-qb"
    >
      {refreshing ? '…' : '↻'}
    </button>
  ) : null

  return (
    <div
      className="sc-chart-root rounded border border-white/10 bg-[#0d0d12] p-3"
      role="region"
      aria-label="Session activity chart"
      aria-describedby="analytics-chart-help"
    >
      <p id="analytics-chart-help" className="sr-only">
        Viewer, chat, and emote measurements over the selected session. Use the chart controls to change the view; hover or focus a minute to inspect it and select it to pin details. With the chart focused, + and − work like Zoom in and Zoom out and 0 like Reset zoom.
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true" data-chart-selection-announcement>
        {selectedRollup
          ? `Selected ${selectedMinuteRangeLabel(selectedRollup.minuteTs, streamStartedAt)}: viewers ${count(viewerReadoutValue(selectedRollup))}, chat ${count(selectedRollup.chatCount)} per minute, emotes ${count(minuteEmoteTotal(selectedRollup))} per minute.`
          : 'No chart minute selected.'}
      </p>
      {needsViewerResync ? (
        <div className="mb-3 rounded border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100">
          Viewer timeline is incomplete for this sync. Click <span className="font-black">Re-sync viewers</span> to pull the TwitchTracker viewer chart (fast — chat/7TV stay as-is).
        </div>
      ) : null}
      {liveViewerCollectHint ? (
        <div className="mb-3 rounded border border-violet-400/20 bg-violet-500/10 px-3 py-2 text-xs font-semibold text-violet-100">
          {liveViewerCollectHint}
        </div>
      ) : null}
      {liveViewerCoverageHint ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-cyan-400/20 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100">
          <span>{liveViewerCoverageHint}</span>
          <button
            type="button"
            onClick={() => onViewModeChange(viewMode === 'viewers' ? 'overview' : 'viewers')}
            aria-pressed={viewMode === 'viewers'}
            className="shrink-0 rounded border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-xs font-black uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-400/20"
          >
            {viewMode === 'viewers' ? 'Show full timeline' : 'Focus viewer samples'}
          </button>
        </div>
      ) : null}
      {partialChatCoverage ? (
        <div className="mb-3 rounded border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-100">
          Chat only covers the first {formatVodClock((detail?.chatCoverage?.chatSpanMinutes ?? 0) * 60)} of this{' '}
          {formatVodClock((detail?.chatCoverage?.streamSpanMinutes ?? 0) * 60)} stream
          {detail?.vodId ? ` (VOD ${detail.vodId})` : ''}. Twitch may still be processing the archive — re-sync later.
        </div>
      ) : null}
      {viewerBackfillPending && hasViewerChartData ? (
        <div className="mb-3 rounded border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-100">
          Viewer line from {detail?.viewerSource === 'live' ? 'live collection' : viewerSourceLabel(detail?.viewerSource) || 'existing rollups'}; TwitchTracker backfill{' '}
          {syncViewerStatus === 'backfilling' ? 'running in background' : 'pending'}.
        </div>
      ) : null}
      {syncNotice ? (
        <div className="mb-3 rounded border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-200">{syncNotice}</div>
      ) : null}
      {syncError ? (
        <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">{syncError}</div>
      ) : null}

      <div ref={chartCardRef} data-session-chart-wheel-card="" data-bench-chart-card="" data-view-mode={viewMode}>
        <div className="ssc-head" data-chart-header-block="">
          {/* d3-v2 session-original (2026-10-14/15): one readout line above
              Games played: the hovered minute or bar, else what is pinned, else
              the latest minute; Clear ends it while something is pinned. */}
          <div className="ssc ssc-top">
            <div className="ssc-ro-row" data-chart-hover-readout-row="">
              {model ? (
                <SessionReadout
                  hover={hover}
                  model={model}
                  isLive={isLive}
                  resting={restingRollup ?? rollups[rollups.length - 1] ?? null}
                  selection={readoutSelection}
                  topEmotesCatalog={detail?.topEmotes}
                />
              ) : <div className="ssc-ro" data-session-readout="" data-chart-selection-hint="" />}
              <button
                type="button"
                className="ssc-clear"
                title="Release the pinned minute (Esc)"
                data-session-readout-clear=""
                hidden={!readoutSelection.moment && !readoutSelection.pinned}
                onClick={onReadoutClear}
              >
                Clear
              </button>
            </div>
          </div>
          <GamesPlayedStrip
            games={stripGames}
            durationSeconds={stripGamesEndSeconds}
            highlightedKey={hoveredGameKey}
            onHighlightKey={setHoveredGameKey}
            visibleRange={gamesVisibleRange}
            headerless
          />
        </div>

        <section
          ref={chartPartRef}
          className="ssc"
          data-session-chart-part=""
          data-session-controls="toolbar"
          aria-label="Timeline"
        >
          {/* d3-v2 session-original .cb-tool: series, range, Expand and Show on
              chart in one row above the plot at every width; it wraps on
              narrow parts and Show on chart keeps the row's end. */}
          <div className="ssc-tool" data-chart-focus-bar="">
            <SessionSeriesSeg viewMode={viewMode} onViewModeChange={onViewModeChange} />
            {rangeControls}
            {syncButton}
            {refreshButton}
          </div>
          <div
            className="ssc-stack"
            data-session-chart-stack=""
            ref={chartStackRef}
            onKeyDownCapture={onStackKeyDownCapture}
            onPointerDown={onStackPointerDown}
          >
            {model && stackWidth != null ? (
              <SessionSpChart
                ref={chartRef}
                model={model}
                store={store}
                hover={hover}
                width={stackWidth > 0 ? stackWidth : 1000}
                plotHeight={plotHeight}
                extraPlotPx={extraPlotPx}
                phone={phone}
                series={visibility}
                captions={captions}
                liveEdge={markers.live ? liveEdge : null}
                highlightRange={highlightRange}
                selected={selected}
                band={bandProps}
                pins={pinProps}
                showPins={markers.moments}
                overlays={overlayLines}
                previewOffsetSeconds={previewOffsetSeconds}
                navigator={model.n > NAVIGATOR_MIN_VISIBLE_STEPS ? (
                  <SessionNavigator
                    model={model}
                    store={store}
                    levelMinutes={levelMinutes}
                    focusIndex={focusIndex}
                    selectedIndex={selectedIndex}
                    wheelSurfaceRef={chartCardRef}
                    wheelAnchor={plotWheelAnchor}
                    scrollZoomEnabled={scrollZoomEnabled}
                    onScrollZoomChange={setScrollZoomEnabled}
                  />
                ) : null}
                onBarClick={onBarClick}
                onLevel={setLevelMinutes}
              />
            ) : null}
          </div>
        </section>
        {/* Outside `.ssc`, whose button reset would strip the panel's borders and chips. */}
        {model ? (
          <div className="mt-2">
            <PlotOnChartStrip
              topEmotes={detail?.topEmotes ?? []}
              plottedKeys={plottedKeys}
              onToggleEmote={onSelectEmote}
              onClear={onClearEmotePlots}
              onReset={onResetEmotePlots}
            />
          </div>
        ) : null}
      </div>

      {/* No reserved height: it never stopped the content below from moving (a
          pinned card is taller than any fixed reserve) and left a blank band at
          rest. */}
      <div className={selectedDetailNode ? 'mt-3' : undefined} data-chart-selected-detail-slot>
        {selectedDetailNode ? <div data-chart-selected-detail data-chart-action="true">{selectedDetailNode}</div> : null}
      </div>

      {/* d3-v2 session-original .po-md: no box, and no counts in the summary
          ("120 of 205" disagreed with the navigator and the duration stat); the
          pager inside names the page's time span. */}
      <details className="ssc-md" data-chart-data-alternative data-chart-action="true">
        <summary>
          {/* The portal lays the summary out as flex, which drops the native marker. */}
          <span aria-hidden="true" className="ssc-md-tw">▸</span>
          Minute-by-minute table
        </summary>
        {tableRollups.length > 120 ? (
          <div className="ssc-md-pg" data-chart-data-pager>
            <button
              type="button"
              disabled={boundedDataPage >= dataPageCount - 1}
              onClick={() => setDataPage(page => Math.min(dataPageCount - 1, page + 1))}
            >
              Earlier minutes
            </button>
            {/* Pages count from the stream start, so the newest page is "N of N". */}
            <span data-chart-data-page-label>
              {pagedDataRows.length > 0
                ? `${vodClock(pagedDataRows[0]!.minuteTs, streamStartedAt)}–${vodClock(pagedDataRows[pagedDataRows.length - 1]!.minuteTs, streamStartedAt)} · `
                : ''}
              {dataPageCount - boundedDataPage} of {dataPageCount}
            </span>
            <button
              type="button"
              disabled={boundedDataPage === 0}
              onClick={() => setDataPage(page => Math.max(0, page - 1))}
            >
              Later minutes
            </button>
          </div>
        ) : null}
        <div className="ssc-md-sc">
          <table>
            <caption className="sr-only">Measured session minutes corresponding to the activity chart, 120 rows per page.</caption>
            <thead>
              <tr>
                <th scope="col">Stream time</th><th scope="col">Viewers</th><th scope="col">Chat/min</th><th scope="col">Emotes/min</th>
              </tr>
            </thead>
            <tbody>
              {selectedOutsideDataPage ? (
                <tr aria-current="true" data-chart-selected-data-row>
                  <th scope="row">{vodClock(selectedRollup.minuteTs, streamStartedAt)} (pinned)</th>
                  <td>{count(viewerReadoutValue(selectedRollup))}</td><td>{count(selectedRollup.chatCount)}</td><td>{count(minuteEmoteTotal(selectedRollup))}</td>
                </tr>
              ) : null}
              {pagedDataRows.map((rollup) => (
                <tr key={rollup.minuteTs} aria-current={selectedRollup?.minuteTs === rollup.minuteTs ? 'true' : undefined}>
                  <th scope="row">
                    {vodClock(rollup.minuteTs, streamStartedAt)}
                    {/* Partial (still being measured, or the minute collection stopped in); the plot leaves it off. */}
                    {leftOffMinute && rollup.minuteTs === leftOffMinute.minuteTs
                      ? (
                        <span className="font-normal text-zinc-500" data-chart-data-updating={leftOffMinute.reason}>
                          {leftOffMinute.reason === 'updating' ? ' (updating)' : ' (partial)'}
                        </span>
                      )
                      : null}
                  </th>
                  <td>{count(viewerReadoutValue(rollup))}</td>
                  <td>{count(rollup.chatCount)}</td>
                  <td>{count(minuteEmoteTotal(rollup))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

export default memo(AnalyticsChart)
