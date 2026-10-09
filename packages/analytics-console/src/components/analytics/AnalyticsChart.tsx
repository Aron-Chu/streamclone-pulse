import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { AnalyticsMinuteRollup, AnalyticsStreamDetail, GameSegment } from '../../api.ts'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  PulseMultiSignalChartInner,
  analyzeViewerCoverage,
  buildChartSeries,
  count,
  formatVodClock,
  fullChartViewport,
  isFollowingLive,
  jumpViewportToOffset,
  legendDotStyle,
  minuteEmoteTotal,
  normalizeChartViewport,
  normalizeGameSegments,
  rollupHasMinuteData,
  rollupsForChart,
  rollupsHaveViewerData,
  shouldShowChartRail,
  viewerSourceLabel,
  viewerReadoutValue,
  viewerValue,
  viewportDurationSeconds,
  vodClock,
} from '@streampulse/pulse-charts'
import type { ChartReactionPoint, ChartViewport } from '@streampulse/pulse-charts'
import { classifyLiveEmptyState } from '../../utils/liveEmptyState.ts'
import { liveWarmupHintLine } from '../../utils/liveCollectionWarmup.ts'
import { usePlayheadStore } from '../../stores/playheadStore.ts'
import { CoreMinuteChartsNotice } from '../CoreMinuteChartsNotice.tsx'
import LiveCollectionWarmup from './LiveCollectionWarmup.tsx'
import { PlotOnChartStrip } from './PlotOnChartStrip.tsx'
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
import { ChartNavigator, type ChartNavigatorRange } from './ChartNavigator.tsx'
import {
  sessionNavigatorIndexForOffset,
  sessionNavigatorPointCount,
  sessionNavigatorPresets,
  sessionNavigatorRangeForViewport,
  sessionViewportForNavigatorRange,
} from '../../utils/sessionChartNavigator.ts'

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

/** A missing value reads as an em dash, as on the hub's readout ("Viewers —"). */
function readoutCount(value: number | null | undefined): string {
  return value == null ? '—' : count(value)
}

/** The standard small bordered button, with a visible disabled state. */
const DATA_PAGER_BUTTON_CLASS = 'min-h-11 rounded border border-white/10 px-3 font-bold text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/10 disabled:hover:bg-transparent'

/** How far back the resting readout may look for a minute with a viewer sample. */
const RESTING_VIEWER_LOOKBACK_MS = 15 * 60_000

function ChartHoverReadout({
  minuteTs,
  streamStartedAt,
  viewers,
  chatCount,
  emoteTotal,
}: {
  minuteTs?: string
  streamStartedAt?: string
  viewers: number | null
  chatCount?: number | null
  emoteTotal: number | null
}) {
  return (
    <p
      className="min-w-0 shrink-[0.01] truncate text-xs font-bold tabular-nums text-zinc-500"
      title="Values at the hovered minute on the chart"
    >
      {vodClock(minuteTs, streamStartedAt)} · viewers {readoutCount(viewers)} · chat {readoutCount(chatCount)}/min · emotes {readoutCount(emoteTotal)}/min
    </p>
  )
}

function AnalyticsChart({
  detail,
  selectedEmotes,
  onSelectEmote,
  onClearEmotePlots,
  onResetEmotePlots,
  selectedRollup,
  previewRollup = null,
  selectedOffsetSeconds = null,
  previewOffsetSeconds = null,
  onSelectRollup,
  onSelectOffset,
  onSelectReactionMoment,
  onPreviewReactionMoment,
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
  vodJump = null,
  selectedDetail,
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
  /** VOD deep link for the pinned minute; null when alignment is unverified. */
  vodJump?: MomentVodJump | null
  selectedDetail?: ReactNode
}) {
  const showSpikes = viewMode === 'spikes'
  // Keep the activity lanes collapsed on first paint.  `auto` emote plotting
  // may select a lane for the chart, but it must not silently consume most of
  // the chart height before the user chooses Expand.
  const [activityExpanded, setActivityExpanded] = useState(false)
  const [hoveredGameKey, setHoveredGameKey] = useState<string | null>(null)
  const [hoverRollup, setHoverRollup] = useState<AnalyticsMinuteRollup | null>(null)
  const chartInteractionRef = useRef<HTMLDivElement>(null)
  const playheadStreamId = usePlayheadStore(s => s.streamId)
  const playheadOffsetSeconds = usePlayheadStore(s => s.offsetSeconds)
  const playheadPlaying = usePlayheadStore(s => s.isPlaying)
  const { motionEnabled } = useConsoleMotion()

  useEffect(() => {
    if (!selectedRollup) return
    function handlePointerDown(event: PointerEvent) {
      if (event.defaultPrevented) return
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('button, a, input, select, [data-chart-action="true"], .pulse-multi-signal-svg, [data-multi-signal-chart]')) {
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
  const rollups = useMemo(() => {
    const charted = rollupsForChart(allRollups, isLive)
    return trimRollupsToWallDuration(charted, streamStartedAt, wallDurationSeconds)
  }, [allRollups, isLive, streamStartedAt, wallDurationSeconds])
  const peakViewersFallback = detail?.stream?.peakViewers ?? 0
  const avgViewersFallback = detail?.stream?.avgViewers ?? 0
  const hasSyncedChat = rollups.some(point => !point.missing && (point.chatCount ?? 0) > 0)
  const viewerCoverage = useMemo(() => analyzeViewerCoverage(rollups), [rollups])
  const useViewerFallback = !isLive
    && !hasSyncedChat
    && rollups.every(point => point.missing || viewerValue(point) === 0)
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

  const series = useMemo(
    () => buildChartSeries(rollups, selectedEmotes, peakViewersFallback, avgViewersFallback, useViewerFallback),
    [rollups, selectedEmotes, peakViewersFallback, avgViewersFallback, useViewerFallback],
  )
  const perEmoteSeries = useMemo(() => series.filter(item => item.dashed), [series])
  const primarySeries = useMemo(() => series.filter(item => !item.dashed), [series])
  const plottedEmoteKeys = useMemo(() => perEmoteSeries.map(item => item.key), [perEmoteSeries])
  const focusedSeriesKey = useMemo(() => {
    if (viewMode === 'overview') return null
    if (viewMode.startsWith('series:')) return viewMode.slice('series:'.length)
    return viewMode
  }, [viewMode])

  useEffect(() => {
    if (!viewMode.startsWith('series:')) return
    const key = viewMode.slice('series:'.length)
    if (!plottedEmoteKeys.includes(key)) onViewModeChange('overview')
  }, [onViewModeChange, plottedEmoteKeys, viewMode])

  const chartDurationSeconds = useMemo(() => {
    // The viewport is in broadcast offsets: end at the last measured minute, not after the span.
    const fromRollups = minuteRollupEndOffsetSeconds(rollups, streamStartedAt)
    const rollupEnd = fromRollups > 0 ? fromRollups : Math.max(rollups.length * 60, 60)
    return clampGamesDurationSeconds(rollupEnd, wallDurationSeconds)
  }, [rollups, streamStartedAt, wallDurationSeconds])
  const gamesDurationSeconds = useMemo(
    () => resolveGamesTimelineDurationSeconds(games, chartDurationSeconds, wallDurationSeconds, isLive),
    [chartDurationSeconds, games, isLive, wallDurationSeconds],
  )
  const chartGames = useMemo(
    () => normalizeGameSegments(games, gamesDurationSeconds),
    [games, gamesDurationSeconds],
  )
  // Live: range-aware Games played (chart window) with expand. Offline/VOD: full list.
  const gamesVisibleRange = useMemo(
    () => (isLive ? chartVisibleRangeFromRollups(rollups, streamStartedAt) : null),
    [isLive, rollups, streamStartedAt],
  )
  const detailRollups = useMemo(
    () => (detail?.momentRollups?.length
      ? trimRollupsToWallDuration(detail.momentRollups, streamStartedAt, wallDurationSeconds)
      : undefined),
    [detail?.momentRollups, streamStartedAt, wallDurationSeconds],
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
  const chartPlayhead = useMemo(
    () => ({
      streamId: playheadStreamId ?? '',
      offsetSeconds: playheadOffsetSeconds,
      isPlaying: playheadPlaying,
    }),
    [playheadOffsetSeconds, playheadPlaying, playheadStreamId],
  )
  // Matches the hub: plain wheel scrolls the page until Scroll zoom is on.
  const [scrollZoomEnabled, setScrollZoomEnabled] = useState(false)
  const [activityBucketMinutes, setActivityBucketMinutes] = useState<number | null>(null)
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
  const chartDurationRef = useRef(chartDurationSeconds)
  const [chartViewport, setChartViewport] = useState<ChartViewport | null>(null)
  // The table lists every measured minute when the full-resolution series is loaded;
  // `rollups` is the chart's downsampled series.
  const tableRollups = detailRollups ?? rollups
  const dataPageCount = Math.max(1, Math.ceil(tableRollups.length / 120))
  const boundedDataPage = Math.min(dataPage, dataPageCount - 1)
  const dataPageEnd = tableRollups.length - boundedDataPage * 120
  const pagedDataRows = tableRollups.slice(Math.max(0, dataPageEnd - 120), dataPageEnd)
  const selectedOutsideDataPage = selectedRollup != null && !pagedDataRows.some(row => row.minuteTs === selectedRollup.minuteTs)
  const chartDomainStartSeconds = useMemo(() => {
    if (!streamStartedAt) return 0
    const firstAttested = focusedSeriesKey === 'viewers'
      ? firstViewerRollup
      : rollups.find(rollupHasMinuteData)
    if (!firstAttested) return 0
    const streamMs = Date.parse(streamStartedAt)
    const firstMs = Date.parse(firstAttested.minuteTs)
    if (!Number.isFinite(streamMs) || !Number.isFinite(firstMs)) return 0
    return Math.max(0, Math.min(chartDurationSeconds, Math.round((firstMs - streamMs) / 1000)))
  }, [chartDurationSeconds, firstViewerRollup, focusedSeriesKey, rollups, streamStartedAt])

  useEffect(() => {
    const prevDuration = chartDurationRef.current
    chartDurationRef.current = chartDurationSeconds
    setChartViewport(current => {
      if (current == null || chartDurationSeconds <= 0) return current
      const span = viewportDurationSeconds(current)
      const wasFull =
        span <= 0
        || (
          current.startSeconds <= chartDomainStartSeconds + 1
          && current.endSeconds >= prevDuration - 5
        )
      if (wasFull) return null
      if (isFollowingLive(current, prevDuration)) {
        return jumpViewportToOffset(
          current,
          chartDurationSeconds,
          chartDurationSeconds,
          span > 0 ? span : chartDurationSeconds,
          chartDomainStartSeconds,
        )
      }
          return normalizeChartViewport(current, chartDurationSeconds, undefined, chartDomainStartSeconds)
    })
  }, [chartDomainStartSeconds, chartDurationSeconds])

  const effectiveChartViewport = useMemo(
    () => (chartViewport == null
      ? fullChartViewport(chartDurationSeconds, chartDomainStartSeconds)
      : normalizeChartViewport(chartViewport, chartDurationSeconds, undefined, chartDomainStartSeconds)),
    [chartDomainStartSeconds, chartDurationSeconds, chartViewport],
  )

  const handleViewportChange = useCallback((next: ChartViewport) => {
    const duration = chartDurationRef.current || chartDurationSeconds
    const normalized = normalizeChartViewport(next, duration, undefined, chartDomainStartSeconds)
    const span = viewportDurationSeconds(normalized)
    if (normalized.startSeconds <= chartDomainStartSeconds + 1 && span >= duration - chartDomainStartSeconds - 5) {
      setChartViewport(null)
      return
    }
    setChartViewport(normalized)
  }, [chartDomainStartSeconds, chartDurationSeconds])
  const showPositionRail = shouldShowChartRail(
    effectiveChartViewport,
    chartDurationSeconds,
    chartDomainStartSeconds,
  )
  const isChartZoomed = chartDurationSeconds > 0 && (
    effectiveChartViewport.startSeconds > chartDomainStartSeconds + 1
    || viewportDurationSeconds(effectiveChartViewport) < chartDurationSeconds - chartDomainStartSeconds - 5
  )
  const selectedOutsideViewport = selectedChartOffsetSeconds != null
    && (
      selectedChartOffsetSeconds < effectiveChartViewport.startSeconds
      || selectedChartOffsetSeconds > effectiveChartViewport.endSeconds
    )
  const navigatorPointCount = sessionNavigatorPointCount(chartDurationSeconds, chartDomainStartSeconds)
  const navigatorPresets = useMemo(
    () => sessionNavigatorPresets(chartDurationSeconds, chartDomainStartSeconds),
    [chartDomainStartSeconds, chartDurationSeconds],
  )
  const navigatorRange = sessionNavigatorRangeForViewport(
    effectiveChartViewport,
    chartDurationSeconds,
    chartDomainStartSeconds,
  )
  const navigatorIndexForOffset = (offsetSeconds: number | null) =>
    sessionNavigatorIndexForOffset(offsetSeconds, chartDurationSeconds, chartDomainStartSeconds)
  // A navigator drag reports every pointer move with animate=false. The plot
  // must follow the pointer, so motion stays off while the rendered target is
  // the viewport the drag last set (the hub does the same with jumpTo).
  const [navigatorDirectViewport, setNavigatorDirectViewport] = useState<ChartViewport | null>(null)
  const handleNavigatorChange = useCallback((range: ChartNavigatorRange, animate = true) => {
    const next = sessionViewportForNavigatorRange(range, chartDurationSeconds, chartDomainStartSeconds)
    setNavigatorDirectViewport(animate
      ? null
      : normalizeChartViewport(next, chartDurationSeconds, undefined, chartDomainStartSeconds))
    handleViewportChange(next)
  }, [chartDomainStartSeconds, chartDurationSeconds, handleViewportChange])
  const navigatorDirect = navigatorDirectViewport != null
    && Math.abs(navigatorDirectViewport.startSeconds - effectiveChartViewport.startSeconds) < 0.5
    && Math.abs(navigatorDirectViewport.endSeconds - effectiveChartViewport.endSeconds) < 0.5
  const resetNavigator = useCallback(() => {
    setScrollZoomEnabled(false)
    setNavigatorDirectViewport(null)
    handleViewportChange(fullChartViewport(chartDurationSeconds, chartDomainStartSeconds))
  }, [chartDomainStartSeconds, chartDurationSeconds, handleViewportChange])
  const chartStackRef = useRef<HTMLDivElement>(null)

  // At rest the readout names the pinned minute, else the last complete minute:
  // a live stream's newest minute is still filling and reads like a collapse.
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
  const hoverPoint = hoverRollup ?? selectedRollup ?? restingRollup ?? rollups[rollups.length - 1] ?? null
  const toggleActivityExpanded = useCallback(() => {
    setActivityExpanded(value => !value)
  }, [])
  const toggleFocusMode = useCallback((next: AnalyticsViewMode) => {
    onViewModeChange(viewMode === next ? 'overview' : next)
  }, [onViewModeChange, viewMode])

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

  return (
    <div
      className="sc-chart-root rounded border border-white/10 bg-[#0d0d12] p-3"
      data-view-mode={viewMode}
      role="region"
      aria-label="Session activity chart"
      aria-describedby="analytics-chart-help"
    >
      <p id="analytics-chart-help" className="sr-only">
        Viewer, chat, and emote measurements over the selected session. Use the chart controls to change the view; hover or focus a minute to inspect it and select it to pin details. With the chart focused, + and − zoom and 0 resets the view.
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

      <div className="mb-3 space-y-2" data-chart-header-block>
        {/* Chart header: the hover readout and the selection hint. Zoom and
            range controls live only in the shared navigator under the plot,
            as on the hub's Global activity chart. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2" data-chart-header-row>
          <div className="min-w-0 flex-[999_1_20rem] space-y-2" data-chart-header-readouts>
            <div className="flex h-5 min-h-5 min-w-0 items-center justify-between gap-2" data-chart-hover-readout-row>
              <ChartHoverReadout
                minuteTs={hoverPoint?.minuteTs}
                streamStartedAt={streamStartedAt}
                viewers={hoverPoint ? viewerReadoutValue(hoverPoint) : null}
                chatCount={hoverPoint?.chatCount}
                emoteTotal={hoverPoint ? minuteEmoteTotal(hoverPoint) : null}
              />
              {/* The source label gives way before the hover values do. */}
              <div className="flex min-w-0 items-center gap-2">
                {detail?.viewerSource ? (
                  <span className="hidden min-w-0 truncate text-xs font-bold uppercase tracking-wide text-zinc-500 sm:block">
                    Viewers: {viewerSourceLabel(detail.viewerSource) || detail.viewerSource}
                  </span>
                ) : null}
                {canSync && !coreMinuteChartsBlocked && (!hasChatData || needsViewerResync) ? (
                  <button
                    type="button"
                    onClick={onSync}
                    disabled={syncing}
                    className="shrink-0 rounded border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-xs font-black uppercase text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
                  >
                    {syncing ? 'Syncing…' : needsViewerResync ? 'Re-sync viewers' : 'Sync chat/emotes'}
                  </button>
                ) : null}
                {showRefreshControl ? <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  aria-label={refreshing ? 'Refreshing chart and stats' : 'Refresh chart and stats'}
                  title="Reload chart and stats from server"
                  className="shrink-0 rounded border border-white/10 px-2 py-1 text-xs font-black uppercase text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300 disabled:opacity-50"
                >
                  {refreshing ? '…' : '↻'}
                </button> : null}
              </div>
            </div>

            <div className="flex min-w-0 items-center justify-between gap-2">
              <p
                className="min-w-0 truncate text-xs font-bold leading-4 text-zinc-600"
                data-chart-selection-hint
                title="Hover previews a minute. Click to select it. Press Escape or use Clear to release the selection."
              >
                {selectedRollup
                  ? `Pinned minute ${selectedMinuteRangeLabel(selectedRollup.minuteTs, streamStartedAt)}${Number.isFinite(selectedOffsetSeconds) ? ` · exact moment ${formatHeatOffset(selectedOffsetSeconds!)}` : ''}${selectedOutsideViewport ? ' · outside visible range · Return below' : ''} · Esc or Clear to release`
                  : 'Hover to preview a minute · click to select · press Esc to clear'}
              </p>
              {selectedRollup && vodJump && !selectedDetail ? (
                <a
                  href={vodJump.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-chart-vod-jump
                  className="shrink-0 whitespace-nowrap rounded border border-violet-400/25 bg-violet-500/10 px-2 py-1 text-xs font-black uppercase text-violet-100 transition hover:border-violet-300/40 hover:bg-violet-500/20"
                  title={vodJump.offsetStr ? `Open the Twitch VOD at ${vodJump.offsetStr}` : 'Open the Twitch VOD'}
                >
                  {vodJump.offsetStr ? `Jump to VOD · ${vodJump.offsetStr}` : 'Open VOD'}
                </a>
              ) : null}
            </div>
          </div>
        </div>

        <GamesPlayedStrip
          games={chartGames}
          durationSeconds={gamesDurationSeconds}
          highlightedKey={hoveredGameKey}
          onHighlightKey={setHoveredGameKey}
          visibleRange={gamesVisibleRange}
        />
      </div>

      <div ref={chartInteractionRef}>
      <div
        className="mb-2 min-w-0 overflow-hidden rounded border border-white/10 bg-white/[0.025]"
        data-chart-focus-bar
        aria-label="Chart focus"
      >
        <div className="flex min-h-10 min-w-0 items-center gap-1.5 p-1.5" data-chart-focus-top-row>
          <div
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-chart-primary-focus-row
          >
            <button
              type="button"
              onClick={() => onViewModeChange('overview')}
              aria-pressed={viewMode === 'overview'}
              className={`shrink-0 rounded px-2.5 py-1.5 text-xs font-black uppercase transition ${
                viewMode === 'overview'
                  ? 'bg-white text-zinc-950'
                  : 'text-zinc-500 hover:bg-white/10 hover:text-zinc-200'
              }`}
            >
              Overview
            </button>
            {primarySeries.map(item => {
              const mode = item.key as 'viewers' | 'chat' | 'emotes'
              const focused = viewMode === mode
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => toggleFocusMode(mode)}
                  aria-pressed={focused}
                  aria-label={`${focused ? 'Clear' : 'Focus'} ${item.label} peak ${count(item.max)}`}
                  title={focused ? 'Return to overview' : `Focus ${item.label} and fade the other series`}
                  className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-xs font-black uppercase transition ${
                    focused
                      ? 'bg-white/[0.12] text-zinc-100 ring-1 ring-inset ring-white/25'
                      : 'text-zinc-500 hover:bg-white/[0.07] hover:text-zinc-200'
                  }`}
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={legendDotStyle(item.color)}
                    aria-hidden="true"
                  />
                  <span className="whitespace-nowrap">{item.label} · {count(item.max)}</span>
                </button>
              )
            })}
          </div>
          <div
            className="flex shrink-0 items-center gap-1 border-l border-white/10 pl-1.5"
            data-chart-focus-utilities
          >
            <button
              type="button"
              onClick={() => toggleFocusMode('spikes')}
              aria-pressed={showSpikes}
              aria-label={showSpikes ? 'Hide chart spikes' : 'Show chart spikes'}
              className={`shrink-0 rounded border px-2.5 py-1.5 text-xs font-black uppercase transition ${
                showSpikes
                  ? 'border-amber-300/25 bg-amber-400/15 text-amber-200'
                  : 'border-white/10 text-zinc-500 hover:border-white/20 hover:bg-white/[0.07] hover:text-zinc-200'
              }`}
            >
              Spikes
            </button>
            <button
              type="button"
              onClick={toggleActivityExpanded}
              aria-pressed={activityExpanded}
              aria-label={activityExpanded ? 'Collapse activity detail' : 'Expand activity detail'}
              className={`shrink-0 rounded border px-2.5 py-1.5 text-xs font-black uppercase transition ${
                activityExpanded
                  ? 'border-violet-300/25 bg-violet-400/10 text-violet-200'
                  : 'border-white/10 text-zinc-500 hover:border-white/20 hover:text-zinc-200'
              }`}
            >
              {activityExpanded ? 'Collapse' : 'Expand'}
            </button>
          </div>
        </div>
        {perEmoteSeries.length > 0 ? (
          <div
            className="flex min-w-0 items-center gap-1.5 border-t border-white/10 bg-slate-400/[0.025] px-1.5 py-1"
            data-chart-overlay-focus-row
          >
            <span className="shrink-0 px-1 text-xs font-black uppercase tracking-wide text-slate-500">
              Overlay focus
            </span>
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:thin]">
              {perEmoteSeries.map(item => {
                const mode: AnalyticsViewMode = `series:${item.key}`
                const focused = viewMode === mode
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleFocusMode(mode)}
                    aria-pressed={focused}
                    aria-label={`${focused ? 'Clear' : 'Focus'} ${item.label} peak ${count(item.max)}`}
                    title={focused ? 'Return to overview' : `Focus ${item.label} and fade the other series`}
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-black uppercase transition ${
                      focused
                        ? 'bg-slate-300/15 text-slate-100 ring-1 ring-inset ring-slate-300/25'
                        : 'text-slate-500 hover:bg-slate-300/[0.08] hover:text-slate-200'
                    }`}
                  >
                    <span
                      className="h-0.5 w-2.5 shrink-0 rounded-full"
                      style={legendDotStyle(item.color)}
                      aria-hidden="true"
                    />
                    <span className="whitespace-nowrap">{item.label} · {count(item.max)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
      <div
        className="relative"
        data-session-chart-stack
        ref={chartStackRef}
        onKeyDownCapture={(event) => {
          // The navigator hint promises Escape turns Scroll zoom off; that must
          // also hold with focus on the plot, ahead of its Escape clearing the pin.
          if (event.key !== 'Escape' || !scrollZoomEnabled) return
          event.preventDefault()
          event.stopPropagation()
          resetNavigator()
        }}
      >
        <PulseMultiSignalChartInner
          chromeless
          variant="console"
          rollups={rollups}
          detailRollups={detailRollups}
          games={chartGames}
          reactionPoints={chartReactionPoints}
          streamStartedAt={streamStartedAt}
          chartStreamId={detail?.stream?.streamId ?? null}
          peakViewersFallback={peakViewersFallback}
          avgViewersFallback={avgViewersFallback}
          viewerSource={detail?.viewerSource}
          selectedEmotes={selectedEmotes}
          selectedRollup={selectedRollup}
          previewRollup={previewRollup}
          selectedOffsetSeconds={selectedOffsetSeconds}
          previewOffsetSeconds={previewOffsetSeconds}
          onSelectRollup={onSelectRollup}
          onSelectOffset={onSelectOffset}
          onSelectReactionMoment={onSelectReactionMoment}
          onPreviewReactionMoment={onPreviewReactionMoment}
          syncing={syncing}
          isLive={isLive}
          showSpikes={showSpikes}
          activityExpanded={activityExpanded}
          motionEnabled={motionEnabled}
          viewportMotionEnabled={!navigatorDirect}
          playhead={chartPlayhead}
          onHoverRollupChange={setHoverRollup}
          focusedSeriesKey={focusedSeriesKey}
          highlightedGameSegmentKey={hoveredGameKey}
          durationSeconds={chartDurationSeconds}
           viewport={effectiveChartViewport}
           viewportDomainStartSeconds={chartDomainStartSeconds}
           onViewportChange={handleViewportChange}
          layoutMode="equal-signals"
          dragPanMode="zoomed"
          wheelZoomMode={scrollZoomEnabled ? 'direct' : 'modified'}
          lineWeightMode="viewport-adaptive"
          activityBucketing="time"
          onActivityBucketMinutesChange={setActivityBucketMinutes}
        />

        {showPositionRail ? (
          <div
            className="hubx sc-chart-navigator-host"
            data-session-chart-rail
            data-session-chart-navigator
            data-chart-range-state={isChartZoomed ? 'zoomed' : 'full'}
          >
            {/* The same navigator as the hub's Global activity chart. */}
            <ChartNavigator
              pointCount={navigatorPointCount}
              startIndex={navigatorRange.startIndex}
              endIndex={navigatorRange.endIndex}
              startLabel={formatHeatOffset(effectiveChartViewport.startSeconds)}
              endLabel={formatHeatOffset(effectiveChartViewport.endSeconds)}
              focusIndex={navigatorIndexForOffset(selectedChartOffsetSeconds ?? (isLive ? chartDurationSeconds : null))}
              selectedIndex={navigatorIndexForOffset(selectedChartOffsetSeconds)}
              wheelSurfaceRef={chartStackRef}
              scrollZoomEnabled={scrollZoomEnabled}
              onScrollZoomChange={setScrollZoomEnabled}
              onChange={handleNavigatorChange}
              onReset={resetNavigator}
              fullRangeLabel="Full stream"
              zoomedRangeLabel="Zoomed view"
              unitLabel="minutes"
              selectedLabel="Return to selected"
              presets={navigatorPresets}
              readoutNote={activityBucketMinutes != null && activityBucketMinutes > 1 ? (
                <span
                  data-chart-bar-bucket-minutes={activityBucketMinutes}
                  title={`Each activity bar averages ${activityBucketMinutes} measured minutes so bars stay readable at this width. Gaps are minutes with no measurement.`}
                >
                  {`bars ${activityBucketMinutes}-min avg`}
                </span>
              ) : undefined}
            />
          </div>
        ) : null}
      </div>

      <PlotOnChartStrip
        topEmotes={detail?.topEmotes ?? []}
        plottedKeys={plottedEmoteKeys}
        onToggleEmote={onSelectEmote}
        onClear={onClearEmotePlots}
        onReset={onResetEmotePlots}
      />

      {/* No reserved height: it never stopped the content below from moving (a
          pinned card is taller than any fixed reserve) and left a blank band at
          rest. */}
      <div className={selectedDetail ? 'mt-3' : undefined} data-chart-selected-detail-slot>
        {selectedDetail ? <div data-chart-selected-detail data-chart-action="true">{selectedDetail}</div> : null}
      </div>

      <details className="group mt-3 rounded border border-white/10 bg-black/20 px-3 py-2" data-chart-data-alternative data-chart-action="true">
        <summary className="cursor-pointer gap-1.5 text-xs font-bold text-zinc-300">
          {/* The portal lays the summary out as flex, which drops the native marker. */}
          <span aria-hidden="true" className="inline-block text-zinc-500 transition-transform group-open:rotate-90">▸</span>
          View measured minute data ({pagedDataRows.length} of {tableRollups.length} minutes)
        </summary>
        {tableRollups.length > 120 ? (
          <div className="mt-2 flex items-center justify-between gap-2 text-xs text-zinc-400" data-chart-data-pager>
            <button
              type="button"
              className={DATA_PAGER_BUTTON_CLASS}
              disabled={boundedDataPage >= dataPageCount - 1}
              onClick={() => setDataPage(page => Math.min(dataPageCount - 1, page + 1))}
            >
              Earlier minutes
            </button>
            {/* Pages count from the stream start, so the newest page is "N of N". */}
            <span className="text-center tabular-nums" data-chart-data-page-label>
              {pagedDataRows.length > 0
                ? `${vodClock(pagedDataRows[0]!.minuteTs, streamStartedAt)}–${vodClock(pagedDataRows[pagedDataRows.length - 1]!.minuteTs, streamStartedAt)} · `
                : ''}
              {dataPageCount - boundedDataPage} of {dataPageCount}
            </span>
            <button
              type="button"
              className={DATA_PAGER_BUTTON_CLASS}
              disabled={boundedDataPage === 0}
              onClick={() => setDataPage(page => Math.max(0, page - 1))}
            >
              Later minutes
            </button>
          </div>
        ) : null}
        <div className="mt-2 max-h-72 overflow-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="sr-only">Measured session minutes corresponding to the activity chart, 120 rows per page.</caption>
            <thead>
              <tr className="text-zinc-500">
                <th scope="col">Stream time</th><th scope="col">Viewers</th><th scope="col">Chat/min</th><th scope="col">Emotes/min</th>
              </tr>
            </thead>
            <tbody>
              {selectedOutsideDataPage ? (
                <tr className="border-t border-amber-300/20" data-chart-selected-data-row>
                  <th scope="row">{vodClock(selectedRollup.minuteTs, streamStartedAt)} (pinned)</th>
                  <td>{count(viewerReadoutValue(selectedRollup))}</td><td>{count(selectedRollup.chatCount)}</td><td>{count(minuteEmoteTotal(selectedRollup))}</td>
                </tr>
              ) : null}
              {pagedDataRows.map((rollup) => (
                <tr key={rollup.minuteTs} className="border-t border-white/5">
                  <th scope="row">{vodClock(rollup.minuteTs, streamStartedAt)}</th>
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
    </div>
  )
}

export default memo(AnalyticsChart)
