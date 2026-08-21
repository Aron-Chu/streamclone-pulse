import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AnalyticsMinuteRollup, AnalyticsStreamDetail, GameSegment } from '../../api.ts'
import type { PulseRecapMoment } from '../../apiTypes.ts'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  ChartPositionRail,
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
import { SelectedMomentPanel } from './SelectedMomentPanel.tsx'
import { useConsoleMotion } from '../../hooks/useConsoleMotion.ts'
import type { AnalyticsTopEmote } from '../../apiTypes.ts'
import type { ReplayHeatmapDetailPoint, ReplayHeatmapPoint } from '../../types/heatmap.ts'
import type { VodLinkState } from '../../utils/twitchVodUrl.ts'
import {
  clampGamesDurationSeconds,
  minuteRollupSpanSeconds,
  streamWallDurationSeconds,
  trimRollupsToWallDuration,
} from '../../utils/gameSegmentChart.ts'
import { GamesPlayedStrip } from './GamesPlayedStrip.tsx'

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
      className="min-w-0 truncate text-xs font-bold tabular-nums text-zinc-500"
      title="Values at the hovered minute on the chart"
    >
      {vodClock(minuteTs, streamStartedAt)} · viewers {count(viewers)} · chat {count(chatCount)}/min · emotes {count(emoteTotal)}/min
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
  vodLinkState,
  topEmotesCatalog,
  heatmapPoint,
  heatmapDetail,
  heatmapPoints,
  reactionMoments,
  recapMoment,
  selectedGameName,
  onOpenAnalytics: _onOpenAnalytics,
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
  vodLinkState?: VodLinkState
  topEmotesCatalog?: AnalyticsTopEmote[]
  heatmapPoint?: ReplayHeatmapPoint | null
  heatmapDetail?: ReplayHeatmapDetailPoint | null
  heatmapPoints?: ReplayHeatmapPoint[]
  /** Canonical merged reaction windows; heatmap points are only the fallback. */
  reactionMoments?: ChartReactionPoint[]
  recapMoment?: PulseRecapMoment | null
  selectedGameName?: string | null
  onOpenAnalytics?: () => void
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
      const boundary = chartInteractionRef.current
      if (!boundary || boundary.contains(event.target as Node)) return
      if (event.defaultPrevented) return
      onSelectRollup(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
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

  const gamesDurationSeconds = useMemo(() => {
    const fromRollups = minuteRollupSpanSeconds(rollups)
    const rollupSpan = fromRollups > 0 ? fromRollups : Math.max(rollups.length * 60, 60)
    return clampGamesDurationSeconds(rollupSpan, wallDurationSeconds)
  }, [rollups, wallDurationSeconds])
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
  const chartPlayhead = useMemo(
    () => ({
      streamId: playheadStreamId ?? '',
      offsetSeconds: playheadOffsetSeconds,
      isPlaying: playheadPlaying,
    }),
    [playheadOffsetSeconds, playheadPlaying, playheadStreamId],
  )
  const chartDurationSeconds = gamesDurationSeconds
  const chartDurationRef = useRef(chartDurationSeconds)
  const [chartViewport, setChartViewport] = useState<ChartViewport | null>(null)
  const chartDomainStartSeconds = useMemo(() => {
    if (!streamStartedAt) return 0
    const firstAttested = rollups.find(rollupHasMinuteData)
    if (!firstAttested) return 0
    const streamMs = Date.parse(streamStartedAt)
    const firstMs = Date.parse(firstAttested.minuteTs)
    if (!Number.isFinite(streamMs) || !Number.isFinite(firstMs)) return 0
    return Math.max(0, Math.min(chartDurationSeconds, Math.round((firstMs - streamMs) / 1000)))
  }, [chartDurationSeconds, rollups, streamStartedAt])

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

  const hoverPoint = hoverRollup ?? rollups[rollups.length - 1] ?? null
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
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="mt-5 rounded-lg border border-white/10 bg-white/[0.05] px-5 py-2.5 text-xs font-black uppercase tracking-wider text-zinc-200 transition hover:bg-white/10 disabled:opacity-50"
            >
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
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
          <div className="text-base font-black text-zinc-100">{(isTwitchTracker || canSync) ? 'Chat & Emotes Offline' : 'No recent data'}</div>
          <div className="mt-1 text-sm font-semibold text-zinc-500 max-w-md">
            {(isTwitchTracker || canSync)
              ? 'This stream has TwitchTracker averages only. Sync pulls minute-level viewers, chat, and 7TV data (large VODs can take a few minutes).'
              : 'Analytics start collecting when this channel is viewed in Streamclone.'}
          </div>
          {notInAnalyticsDb ? (
            <div className="mt-2 text-[11px] font-semibold text-zinc-600">
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
    <div className="sc-chart-root rounded border border-white/10 bg-[#0d0d12] p-3" data-view-mode={viewMode}>
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

      <div className="mb-3 space-y-2">
        <div className="flex h-5 min-h-5 min-w-0 items-center justify-between gap-2" data-chart-hover-readout-row>
          <ChartHoverReadout
            minuteTs={hoverPoint?.minuteTs}
            streamStartedAt={streamStartedAt}
            viewers={hoverPoint ? viewerValue(hoverPoint) : null}
            chatCount={hoverPoint?.chatCount}
            emoteTotal={hoverPoint ? minuteEmoteTotal(hoverPoint) : null}
          />
          <div className="flex shrink-0 items-center gap-2">
            {detail?.viewerSource ? (
              <span className="hidden text-[10px] font-bold uppercase tracking-wide text-zinc-500 sm:inline">
                Viewers: {viewerSourceLabel(detail.viewerSource) || detail.viewerSource}
              </span>
            ) : null}
            {canSync && !coreMinuteChartsBlocked && (!hasChatData || needsViewerResync) ? (
              <button
                type="button"
                onClick={onSync}
                disabled={syncing}
                className="shrink-0 rounded border border-violet-400/30 bg-violet-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-violet-200 transition hover:bg-violet-500/20 disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : needsViewerResync ? 'Re-sync viewers' : 'Sync chat/emotes'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label={refreshing ? 'Refreshing chart and stats' : 'Refresh chart and stats'}
              title="Reload chart and stats from server"
              className="shrink-0 rounded border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-300 disabled:opacity-50"
            >
              {refreshing ? '…' : '↻'}
            </button>
          </div>
        </div>

        <p
          className="truncate text-[10px] font-bold leading-4 text-zinc-600"
          data-chart-selection-hint
          title="Hover previews a minute. Click to select it. Press Escape or use Clear to release the selection."
        >
          {selectedRollup
            ? `Selected minute ${selectedMinuteRangeLabel(selectedRollup.minuteTs, streamStartedAt)}${Number.isFinite(selectedOffsetSeconds) ? ` · exact moment ${formatHeatOffset(selectedOffsetSeconds!)}` : ''} · Esc or Clear to release`
            : 'Hover to preview a minute · click to select · press Esc to clear'}
        </p>

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
              className={`shrink-0 rounded px-2.5 py-1.5 text-[10px] font-black uppercase transition ${
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
                  className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-[10px] font-black uppercase transition ${
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
              className={`shrink-0 rounded px-2.5 py-1.5 text-[10px] font-black uppercase transition ${
                showSpikes
                  ? 'bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/25'
                  : 'text-zinc-500 hover:bg-white/[0.07] hover:text-zinc-200'
              }`}
            >
              Spikes
            </button>
            <button
              type="button"
              onClick={toggleActivityExpanded}
              aria-pressed={activityExpanded}
              aria-label={activityExpanded ? 'Collapse activity detail' : 'Expand activity detail'}
              className={`shrink-0 rounded border px-2.5 py-1.5 text-[10px] font-black uppercase transition ${
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
            <span className="shrink-0 px-1 text-[8px] font-black uppercase tracking-wide text-slate-500">
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
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black uppercase transition ${
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
      <div data-session-chart-stack>
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
          lineWeightMode="viewport-adaptive"
        />

        {showPositionRail ? (
          <div data-session-chart-rail>
            <ChartPositionRail
              viewport={effectiveChartViewport}
              durationSeconds={chartDurationSeconds}
              minuteRollups={rollups}
              onViewportChange={handleViewportChange}
              coverageStartSeconds={chartDomainStartSeconds}
              plotInsetLeft="9%"
              plotInsetRight="3.4%"
            />
            <div
              className="flex min-w-0 items-center justify-between gap-2 pt-1 text-[9px] font-bold tabular-nums text-zinc-500"
              style={{ marginLeft: '9%', marginRight: '3.4%' }}
              data-session-chart-range
              data-chart-range-state={isChartZoomed ? 'zoomed' : 'full'}
              title="Visible elapsed stream time / full stream length"
            >
              <span className="shrink-0 uppercase tracking-wide text-zinc-600">
                {isChartZoomed ? 'Visible range' : 'Full stream'}
              </span>
              <span className="min-w-0 truncate text-right" data-chart-visible-range>
                {formatHeatOffset(effectiveChartViewport.startSeconds)}–{formatHeatOffset(effectiveChartViewport.endSeconds)} / {formatHeatOffset(chartDurationSeconds)}
              </span>
            </div>
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

      {selectedRollup && vodLinkState ? (
        <SelectedMomentPanel
          rollup={selectedRollup}
          rollups={detail?.momentRollups?.length ? detail.momentRollups : allRollups}
          startedAt={streamStartedAt}
          vodLinkState={vodLinkState}
          topEmotesCatalog={topEmotesCatalog ?? detail?.topEmotes}
          heatmapPoint={heatmapPoint}
          heatmapDetail={heatmapDetail}
          heatmapPoints={heatmapPoints}
          recapMoment={recapMoment}
          gameName={selectedGameName}
          vodAlignSeconds={detail?.vodAlignSeconds}
          onClear={() => onSelectRollup(null)}
        />
      ) : null}
      </div>
    </div>
  )
}

export default memo(AnalyticsChart)
