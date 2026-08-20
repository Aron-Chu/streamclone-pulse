import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import AnalyticsChart, { type AnalyticsViewMode } from './analytics/AnalyticsChart.tsx'
import {
  getAnalyticsLive,
  getAnalyticsStream,
  getAnalyticsStreams,
  getPulseStreamRecap,
  getReplayHeatmap,
  getStreamGameSegments,
  getStreamMinutesTail,
  getStreamStatus,
  getStreamSummary,
  getSyncStatus,
  startHistoricalSync,
  type AnalyticsMinuteRollup,
} from '../api.ts'
import type { AnalyticsStream, AnalyticsStreamDetail, SyncStatus } from '../apiTypes.ts'
import { isSessionDataError, type SessionDataError } from '../utils/sessionDataErrors.ts'
import type { HeatmapResponse } from '../types/heatmap.ts'
import { useAnalyticsLive } from '../hooks/useAnalyticsLive.ts'
import { syncCtaLabel } from '../utils/syncLabel.ts'
import { findNearestRollupByOffset, parseDeepLinkOffset, rollupOffsetSeconds } from '../utils/momentSelection.ts'
import {
  findNearestHeatmapPoint,
  findNearestRecapMoment,
} from '../utils/selectedMomentMatch.ts'
import {
  classifyStatCards,
  STAT_PLACEHOLDER_MUTED_CLASS,
  type StreamCollectionState,
} from '../utils/statCards.ts'
import { isActiveLiveCollectorStream, isSyncPrefetchPlaceholder, resolveChannelActuallyLive } from '../utils/analyticsStreamRow.ts'
import { resolveCanonicalLiveSessionTarget } from '../utils/syncedLiveStream.ts'
import {
  isDateSlugUnresolved,
  resolveMatchedStream,
  resolveTargetQueryStreamId,
} from '../utils/streamRouteResolution.ts'
import { buildTwitchVodUrl, resolveAnalyticsVodId, resolveSessionFallbackVodId, resolveVodLinkState } from '../utils/twitchVodUrl.ts'
import { mergeSessionStatusIntoDetail } from '../utils/sessionStatusMerge.ts'
import { maxRollupOffsetSeconds, mergeMinutesTailIntoDetail } from '../utils/minutesTailMerge.ts'
import {
  computeRollupChatStats,
  computeRollupViewerStats,
  rollupHasMinuteData,
  rollupsHaveViewerData,
} from './analytics/chartRollupUtils.ts'
import {
  type EmotePlotSelection,
  resolveChartEmoteKeys,
  toggleEmotePlotSelection,
} from '../utils/emotePlotSelection.ts'
import { count, displayStreamTitle, duration, relativeTime, streamStateLabel } from '../utils/consoleFormat.ts'
import { deriveChartGameSegments, gameNameAtOffset } from '../utils/gameSegmentChart.ts'
import { ChatCoverageBadge, StatCard, ViewerSourceBadge, AnalyticsQualityChip, CoverageFacets, CoverageStartBanner, VodAvailabilityChip } from './analytics/ConsoleBits.tsx'
import { StreamSidebar } from './analytics/StreamSidebar.tsx'
import { TopEmoteTable } from './analytics/TopEmoteTable.tsx'
import { MomentReviewPanel } from './analytics/MomentReviewPanel.tsx'
import { PastBroadcastBanner } from './analytics/PastBroadcastBanner.tsx'
import { SessionRecapMomentsStrip } from './analytics/SessionRecapMomentsStrip.tsx'
import { StreamRecapPanel } from './analytics/StreamRecapPanel.tsx'
import { hasRecapMomentsAvailable } from '../utils/recapMomentsAvailable.ts'
import { SyncStatusPanel } from './analytics/SyncStatusPanel.tsx'
import { StreamQualityBanner } from './analytics/StreamQualityBanner.tsx'
import { diagnoseStreamQuality } from '../utils/streamQuality.ts'
import { isTerminalSyncPhase, pollSyncUntilDone } from '../utils/syncPolling.ts'

type RightPanelTab = 'moments' | 'emotes' | 'status'

interface HistoryStreamItem {
  streamId?: string
  id?: string
  displayName?: string
  title?: string
  category?: string
  startedAt?: string
  endedAt?: string | null
  avgViewers?: number
  peakViewers?: number
  viewerSamples?: number
  chatMessages?: number
  vodId?: string
  videoId?: string
}

function maxDefinedCount(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined)
  return defined.length > 0 ? Math.max(...defined) : undefined
}

function SessionDataState({
  kind,
  dateLabel,
  title,
  onRetry,
}: {
  kind: 'session_identity_mismatch' | 'timeline_integrity_error' | 'heatmap_integrity_error'
  dateLabel: string
  title?: string
  onRetry: () => void
}) {
  const identity = kind === 'session_identity_mismatch'
  const heatmap = kind === 'heatmap_integrity_error'
  const heading = identity
    ? 'Session analytics unavailable'
    : heatmap
      ? 'Moment ranking unavailable'
      : 'Timeline data is being repaired'
  const message = identity
    ? 'The server returned a different broadcast for this date. No other session data was rendered.'
    : heatmap
      ? 'The server returned cross-session moment data. The chart remains available without those markers.'
      : 'This session returned duplicate or out-of-window minute buckets. The chart is withheld until the timeline is trustworthy.'
  return (
    <div
      className="rounded border border-amber-400/25 bg-amber-500/[0.06] px-4 py-8 text-center"
      data-session-data-state={kind}
      data-testid={kind}
      data-requested-date={dateLabel}
    >
      <div className="text-base font-black text-amber-100">{heading}</div>
      <p className="mx-auto mt-2 max-w-xl text-sm font-semibold text-amber-100/70">{message}</p>
      {title ? <p className="mt-2 text-xs font-bold text-zinc-500">{title}</p> : null}
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 rounded border border-amber-300/25 bg-amber-400/10 px-3 py-1.5 text-xs font-black uppercase text-amber-100 transition hover:bg-amber-400/20"
      >
        Retry
      </button>
    </div>
  )
}

function heatmapPointsFitSession(
  response: HeatmapResponse | null | undefined,
  stream: AnalyticsStream | undefined,
): boolean {
  if (!response || !stream?.startedAt) return true
  const startMs = Date.parse(stream.startedAt)
  const endMs = stream.endedAt ? Date.parse(stream.endedAt) : Date.now()
  if (!Number.isFinite(startMs)) return false
  return response.points.every((point) => {
    const pointMs = Date.parse(point.minuteTs)
    return (
      (!point.streamId || point.streamId === stream.streamId)
      && Number.isFinite(pointMs)
      && pointMs >= startMs - 60_000
      && (!Number.isFinite(endMs) || pointMs <= endMs + 300_000)
    )
  })
}

export interface AnalyticsConsoleProps {
  mode?: 'public' | 'local' | string
  showGameSegments?: boolean
  enableLayoutControls?: boolean
  /** When true, use lg breakpoint for 3-col layout (portal Figma shell already consumes sidebar width). */
  shellNested?: boolean
  /** Enable sync / re-sync CTAs (local dev portal; hosted waits for API-008 rate limits). */
  enableSyncActions?: boolean
  buildSessionPath?: (login: string, streamId: string) => string
  buildChannelPath?: (login: string) => string
}

function defaultSessionPath(login: string, streamId: string): string {
  return `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}`
}

function defaultChannelPath(login: string): string {
  return `/analytics/${encodeURIComponent(login)}`
}

export function AnalyticsConsole({
  mode = 'public',
  showGameSegments = true,
  enableLayoutControls = false,
  shellNested = false,
  enableSyncActions = false,
  buildSessionPath = defaultSessionPath,
  buildChannelPath = defaultChannelPath,
}: AnalyticsConsoleProps = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const { login = '', streamId = '' } = useParams<{ login: string; streamId?: string }>()
  const channelLogin = login.trim().toLowerCase()
  const isHistoricalRoute = Boolean(streamId)
  const isLiveRoute = !streamId
  /** Layer 2 (games, recap, heatmap, summary, sync detail) only on explicit session routes. */
  const layer2Enabled = isHistoricalRoute

  const [emotePlotSelection, setEmotePlotSelection] = useState<EmotePlotSelection>('auto')
  const [selectedRollup, setSelectedRollup] = useState<AnalyticsMinuteRollup | null>(null)
  const [previewRollup, setPreviewRollup] = useState<AnalyticsMinuteRollup | null>(null)
  const [viewMode, setViewMode] = useState<AnalyticsViewMode>('overview')
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('moments')
  const [streamsVisible, setStreamsVisible] = useState(true)
  const [chartFocused, setChartFocused] = useState(false)
  const [syncedOnlyFilter, setSyncedOnlyFilter] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [liveSyncStatus, setLiveSyncStatus] = useState<SyncStatus | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const [enrichmentReady, setEnrichmentReady] = useState(false)
  const appliedDeepLinkKey = useRef<string | null>(null)

  const handleSelectRollup = useCallback((rollup: AnalyticsMinuteRollup | null) => {
    if (rollup && selectedRollup?.minuteTs === rollup.minuteTs) {
      setSelectedRollup(null)
      setPreviewRollup(null)
      return
    }
    setSelectedRollup(rollup)
  }, [selectedRollup])

  useEffect(() => {
    setSelectedRollup(null)
    setPreviewRollup(null)
    setLastRefreshedAt(null)
    setEmotePlotSelection('auto')
    setSyncing(false)
    setSyncError(null)
    setSyncNotice(null)
    setLiveSyncStatus(null)
    setEnrichmentReady(false)
    setStreamsVisible(true)
    setChartFocused(false)
  }, [channelLogin, streamId])

  const liveQuery = useAnalyticsLive(channelLogin, { enabled: isLiveRoute })
  const streamsQuery = useQuery({
    queryKey: ['analytics-console-streams', channelLogin],
    queryFn: ({ signal }) => getAnalyticsStreams(channelLogin, 100, { signal }),
    enabled: Boolean(channelLogin),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  })

  const historyItems = streamsQuery.data?.items as HistoryStreamItem[] | undefined
  const listsLoading = streamsQuery.isLoading

  const sidebarStreams = useMemo(() => {
    const local = streamsQuery.data?.items ?? []
    const historyItemsList = historyItems ?? []
    const mappedHistory: AnalyticsStream[] = historyItemsList
      .map((s) => ({
        streamId: s.streamId ?? s.id ?? '',
        login: channelLogin,
        displayName: s.displayName ?? channelLogin,
        title: s.title,
        category: s.category || 'Live',
        startedAt: s.startedAt || '',
        endedAt: s.endedAt || '',
        currentViewers: 0,
        avgViewers: s.avgViewers,
        peakViewers: s.peakViewers,
        viewerSamples: s.viewerSamples,
        chatMessages: s.chatMessages,
        vodId: s.vodId ?? s.videoId,
      }))
      .filter((s) => s.streamId)

    const historyById = new Map(mappedHistory.map((s) => [s.streamId, s]))
    const merged = local.map((item) => {
      const history = historyById.get(item.streamId)
      if (!history) return item
      return {
        ...item,
        startedAt: history.startedAt || item.startedAt,
        endedAt: history.endedAt || item.endedAt,
        title: history.title || item.title,
        category: history.category || item.category,
        avgViewers: (item.avgViewers ?? 0) > 0 ? item.avgViewers : history.avgViewers,
        peakViewers: (item.peakViewers ?? 0) > 0 ? item.peakViewers : history.peakViewers,
        viewerSamples: maxDefinedCount(item.viewerSamples, history.viewerSamples),
        chatMessages: maxDefinedCount(item.chatMessages, history.chatMessages),
        vodId: item.vodId?.trim() || history.vodId,
      }
    })
    const localIds = new Set(merged.map((s) => s.streamId))
    for (const s of mappedHistory) {
      if (!localIds.has(s.streamId)) merged.push(s)
    }
    return merged
      .filter((s) => !isSyncPrefetchPlaceholder(s))
      .sort((a, b) => {
        const aTime = a.startedAt ? Date.parse(a.startedAt) : 0
        const bTime = b.startedAt ? Date.parse(b.startedAt) : 0
        return bTime - aTime
      })
  }, [streamsQuery.data?.items, historyItems, channelLogin])
  const newestStream = sidebarStreams[0]

  const matchedStream = useMemo(() => {
    if (!streamId) return undefined
    return resolveMatchedStream(streamId, sidebarStreams, sidebarStreams)
  }, [streamId, sidebarStreams])

  const targetQueryStreamId = useMemo(() => {
    if (isLiveRoute) {
      return liveQuery.data?.stream?.streamId || newestStream?.streamId || ''
    }
    const resolved = resolveTargetQueryStreamId(streamId, matchedStream, historyItems, listsLoading)
    return resolved ?? ''
  }, [
    isLiveRoute,
    streamId,
    matchedStream,
    historyItems,
    listsLoading,
    liveQuery.data?.stream?.streamId,
    newestStream?.streamId,
  ])

  const sessionResolving = Boolean(
    isHistoricalRoute && listsLoading && /^\d{4}-\d{2}-\d{2}$/.test(streamId),
  )
  const sessionNotFound = Boolean(
    isHistoricalRoute && isDateSlugUnresolved(streamId, matchedStream, listsLoading),
  )

  useEffect(() => {
    if (
      !isHistoricalRoute
      || !/^\d{4}-\d{2}-\d{2}$/.test(streamId)
      || !matchedStream?.streamId
      || targetQueryStreamId !== matchedStream.streamId
    ) {
      return
    }
    navigate(buildSessionPath(channelLogin, matchedStream.streamId), { replace: true })
  }, [
    buildSessionPath,
    channelLogin,
    isHistoricalRoute,
    matchedStream?.streamId,
    navigate,
    streamId,
    targetQueryStreamId,
  ])

  const liveActiveStreamId = liveQuery.data?.stream?.streamId || newestStream?.streamId || ''
  const liveReturnedStreamId = liveQuery.data?.stream?.streamId
    || (isSessionDataError(liveQuery.error) ? liveQuery.error.details.returnedStreamId : undefined)
  const liveIdentityMismatch = Boolean(
    isLiveRoute
    && liveReturnedStreamId
    && newestStream?.streamId
    && liveReturnedStreamId !== newestStream.streamId,
  )

  const historicalDetailQuery = useQuery({
    queryKey: ['analytics-console-detail', targetQueryStreamId, channelLogin],
    queryFn: ({ signal }) => {
      if (!targetQueryStreamId) return null
      return getAnalyticsStream(targetQueryStreamId, {
        sparse: false,
        channel: channelLogin,
        signal,
      })
    },
    enabled: Boolean(channelLogin && targetQueryStreamId && isHistoricalRoute && !sessionNotFound),
    staleTime: 30_000,
    refetchInterval: false,
    retry: false,
  })

  const detailQuery = isLiveRoute ? liveQuery : historicalDetailQuery
  const baseDetail = (detailQuery.data ?? undefined) as AnalyticsStreamDetail | undefined

  const statusQuery = useQuery({
    queryKey: ['analytics-console-status', targetQueryStreamId, channelLogin],
    queryFn: async ({ signal }) => {
      if (!targetQueryStreamId) return null
      return getStreamStatus(targetQueryStreamId, { signal })
    },
    enabled: Boolean(
      isHistoricalRoute
      && targetQueryStreamId
      && baseDetail
      && enrichmentReady
      && rightPanelTab === 'status',
    ),
    staleTime: 30_000,
    refetchInterval: (query) => {
      const failureCount = query.state.errorUpdateCount ?? 0
      const backoff = Math.min(120_000, 30_000 * Math.max(1, 2 ** Math.min(failureCount, 2)))
      const data = query.state.data as {
        availability?: { vodState?: string; liveDvrState?: string }
        state?: string
      } | null
      const mergedState = (data?.state ?? baseDetail?.state ?? '').toLowerCase()
      const vod = (data?.availability?.vodState ?? baseDetail?.availability?.vodState ?? '').toLowerCase()
      const liveDvr = (data?.availability?.liveDvrState ?? baseDetail?.availability?.liveDvrState ?? '').toLowerCase()
      if (vod === 'linked' || vod === 'terminal' || vod === 'unavailable') return false
      if (mergedState === 'live' || liveDvr === 'live') return backoff
      if (vod === 'pending_live' || vod === 'resolving' || vod === 'request_failed') return backoff
      return false
    },
    retry: false,
  })

  const statusMerged = useMemo(() => {
    if (!baseDetail) return undefined
    if (!statusQuery.data) return baseDetail
    return mergeSessionStatusIntoDetail(baseDetail, statusQuery.data as Parameters<typeof mergeSessionStatusIntoDetail>[1])
  }, [baseDetail, statusQuery.data])

  const sessionIsLive = Boolean(
    statusMerged?.availability?.liveDvrState === 'live'
    || statusMerged?.state === 'live'
    || resolveChannelActuallyLive(statusMerged),
  )

  const liveTailAfterOffset = maxRollupOffsetSeconds(statusMerged)
  const minutesTailQuery = useQuery({
    queryKey: ['analytics-console-minutes-tail', targetQueryStreamId, liveTailAfterOffset],
    queryFn: async ({ signal }) => {
      if (!targetQueryStreamId || liveTailAfterOffset < 0) return null
      return getStreamMinutesTail(targetQueryStreamId, liveTailAfterOffset, { signal })
    },
    enabled: Boolean(sessionIsLive && targetQueryStreamId && liveTailAfterOffset >= 0 && statusMerged),
    staleTime: 15_000,
    refetchInterval: sessionIsLive ? 30_000 : false,
  })

  const detail = useMemo(() => {
    if (!statusMerged) return undefined
    return mergeMinutesTailIntoDetail(statusMerged, minutesTailQuery.data ?? undefined)
  }, [statusMerged, minutesTailQuery.data])
  const sessionDataError: SessionDataError | null =
    isSessionDataError(detailQuery.error)
      ? detailQuery.error
      : isSessionDataError(liveQuery.error)
        ? liveQuery.error
      : isSessionDataError(minutesTailQuery.error)
        ? minutesTailQuery.error
        : null

  const chartDetailReady = Boolean(
    detail?.rollups?.some(rollupHasMinuteData),
  )
  useEffect(() => {
    if (!chartDetailReady) return
    const timer = window.setTimeout(() => setEnrichmentReady(true), 250)
    return () => window.clearTimeout(timer)
  }, [chartDetailReady, targetQueryStreamId])

  const gamesQuery = useQuery({
    queryKey: ['analytics-console-games', targetQueryStreamId],
    queryFn: ({ signal }) => getStreamGameSegments(targetQueryStreamId, { signal }),
    enabled: Boolean(showGameSegments && targetQueryStreamId && enrichmentReady),
    staleTime: 60_000,
    refetchInterval: sessionIsLive ? 75_000 : false,
    retry: false,
  })

  const syncQuery = useQuery({
    queryKey: ['analytics-console-sync', targetQueryStreamId],
    queryFn: ({ signal }) => getSyncStatus(targetQueryStreamId, { signal }),
    enabled: Boolean(layer2Enabled && targetQueryStreamId && chartDetailReady && enrichmentReady && rightPanelTab === 'status'),
    staleTime: 30_000,
    refetchInterval: syncing ? 2000 : false,
  })

  const summaryQuery = useQuery({
    queryKey: ['analytics-console-summary', targetQueryStreamId, channelLogin],
    queryFn: ({ signal }) => getStreamSummary(targetQueryStreamId, channelLogin, { signal }),
    enabled: Boolean(layer2Enabled && targetQueryStreamId && channelLogin && chartDetailReady && enrichmentReady),
    staleTime: 30_000,
    retry: false,
  })

  const recapQuery = useQuery({
    queryKey: ['analytics-console-recap', targetQueryStreamId],
    queryFn: ({ signal }) => getPulseStreamRecap(targetQueryStreamId, { signal }),
    enabled: Boolean(layer2Enabled && targetQueryStreamId && chartDetailReady && enrichmentReady && rightPanelTab === 'moments'),
    staleTime: 120_000,
    retry: false,
  })

  const heatmapQuery = useQuery({
    queryKey: ['analytics-console-heatmap', targetQueryStreamId, channelLogin],
    queryFn: async ({ signal }) => {
      const data = await getReplayHeatmap(targetQueryStreamId, 60, channelLogin, { signal })
      return (data ?? null) as HeatmapResponse | null
    },
    enabled: Boolean(layer2Enabled && targetQueryStreamId && channelLogin && chartDetailReady && enrichmentReady && rightPanelTab === 'moments' && viewMode === 'spikes'),
    staleTime: 120_000,
    retry: false,
  })

  const heatmapIntegrityBlocked = Boolean(
    heatmapQuery.data
    && !heatmapPointsFitSession(heatmapQuery.data, detail?.stream),
  )
  const heatmapPoints = heatmapIntegrityBlocked ? undefined : heatmapQuery.data?.points

  const recapCandidate = recapQuery.isSuccess ? recapQuery.data : null
  const recapForStream =
    recapCandidate
    && recapCandidate.streamId === targetQueryStreamId
    && (!recapCandidate.durationSeconds
      || !detail?.stream?.startedAt
      || recapCandidate.durationSeconds <= (
        (Date.now() - Date.parse(detail.stream.startedAt)) / 1000 + 300
      ))
      ? recapQuery.data
      : null
  const recapIntegrityBlocked = Boolean(recapCandidate && !recapForStream)

  const isActiveLiveCollector = isActiveLiveCollectorStream(detail?.stream, detail?.state)
  // Deep-linked live sessions must keep advancing — path shape is not authoritative.
  const isLive = Boolean(
    sessionIsLive
    || isActiveLiveCollector
    || (isLiveRoute && (detail?.state === 'live' || Boolean(liveQuery.data?.stream?.streamId))),
  )

  useEffect(() => {
    appliedDeepLinkKey.current = null
  }, [targetQueryStreamId, location.hash, location.search])

  useEffect(() => {
    const rollups = detail?.momentRollups?.length
      ? detail.momentRollups
      : detail?.rollups ?? []
    if (!rollups.length) return
    const deepLinkKey = `${targetQueryStreamId}:${location.hash}:${location.search}`
    if (appliedDeepLinkKey.current === deepLinkKey) return
    const offsetSeconds = parseDeepLinkOffset(location.hash, location.search)
    if (offsetSeconds == null) return
    const nearest = findNearestRollupByOffset(rollups, detail?.stream?.startedAt, offsetSeconds)
    if (nearest) setSelectedRollup(nearest)
    appliedDeepLinkKey.current = deepLinkKey
  }, [
    targetQueryStreamId,
    detail?.momentRollups,
    detail?.rollups,
    detail?.stream?.startedAt,
    location.hash,
    location.search,
  ])

  const activeStreamKey = detail?.stream?.streamId || targetQueryStreamId || channelLogin
  const [prevRailStreamKey, setPrevRailStreamKey] = useState(activeStreamKey)
  if (activeStreamKey !== prevRailStreamKey) {
    setPrevRailStreamKey(activeStreamKey)
    setRightPanelTab('moments')
  }

  const toggleSelected = useCallback((key: string) => {
    setEmotePlotSelection((current) =>
      toggleEmotePlotSelection(current, key, detail?.topEmotes ?? [], viewMode),
    )
  }, [detail?.topEmotes, viewMode])

  const clearEmotePlots = useCallback(() => {
    setEmotePlotSelection('none')
  }, [])

  const resetEmotePlots = useCallback(() => {
    setEmotePlotSelection('auto')
  }, [])

  const handleViewMode = useCallback((next: AnalyticsViewMode) => {
    setViewMode(next)
    if (next === 'emotes') setRightPanelTab('emotes')
    else if (next === 'spikes') setRightPanelTab('moments')
  }, [])

  const handleJumpToRecapOffset = useCallback(
    (offsetSeconds: number) => {
      // Prefer full-resolution momentRollups so Selected Moment lands on the same
      // minute Pulse Moments uses (chart rollups may be downsampled above 240 mins).
      const rollups = detail?.momentRollups?.length
        ? detail.momentRollups
        : detail?.rollups ?? []
      if (!rollups.length) return
      const nearest = findNearestRollupByOffset(rollups, detail?.stream?.startedAt, offsetSeconds)
      if (nearest) setSelectedRollup(nearest)
    },
    [detail?.momentRollups, detail?.rollups, detail?.stream?.startedAt],
  )

  const handleRefresh = useCallback(async () => {
    if (!channelLogin || refreshing) return
    setRefreshing(true)
    try {
      const refetches: Array<Promise<unknown>> = [
        streamsQuery.refetch(),
        detailQuery.refetch(),
      ]
      if (layer2Enabled && targetQueryStreamId) {
        if (showGameSegments) refetches.push(gamesQuery.refetch())
        refetches.push(syncQuery.refetch())
        refetches.push(summaryQuery.refetch())
        refetches.push(recapQuery.refetch())
        refetches.push(heatmapQuery.refetch())
      }
      await Promise.race([Promise.all(refetches), new Promise((resolve) => setTimeout(resolve, 30_000))])
      setLastRefreshedAt(Date.now())
    } finally {
      setRefreshing(false)
    }
  }, [
    channelLogin,
    refreshing,
    streamsQuery,
    detailQuery,
    gamesQuery,
    syncQuery,
    summaryQuery,
    recapQuery,
    heatmapQuery,
    layer2Enabled,
    showGameSegments,
    targetQueryStreamId,
  ])

  const refetchChartDuringSync = useCallback(async () => {
    await detailQuery.refetch()
    await streamsQuery.refetch()
    if (layer2Enabled) {
      await summaryQuery.refetch()
    }
  }, [detailQuery, streamsQuery, summaryQuery, layer2Enabled])

  const handleSync = useCallback(
    async (opts?: { viewersOnly?: boolean; forceChat?: boolean }) => {
      if (!enableSyncActions || !targetQueryStreamId || syncing) return
      setSyncing(true)
      setSyncError(null)
      setSyncNotice(null)
      setLiveSyncStatus(null)
      setRightPanelTab('status')
      try {
        const start = (await startHistoricalSync(targetQueryStreamId, channelLogin, {
          viewersOnly: opts?.viewersOnly,
          forceChat: opts?.forceChat,
          vodId: detail?.stream?.vodId,
        })) as { accepted?: boolean; status?: SyncStatus }
        if (start.status) setLiveSyncStatus(start.status)
        if (start.accepted === false && start.status && !isTerminalSyncPhase(start.status.phase)) {
          setSyncNotice('Sync already running — showing live progress.')
        }
        const finalStatus = await pollSyncUntilDone(targetQueryStreamId, setLiveSyncStatus, {
          onProgress: () => {
            void refetchChartDuringSync()
          },
        })
        if (!finalStatus) {
          setSyncError('Lost sync status — try again or use Refresh data.')
          return
        }
        if (finalStatus.stale) {
          setSyncNotice('Sync interrupted — click sync to retry.')
          return
        }
        if (finalStatus.phase === 'failed') {
          setSyncError(finalStatus.error || 'Sync failed.')
          return
        }
        setSyncNotice('Sync finished — charts updated.')
        await refetchChartDuringSync()
        await syncQuery.refetch()
      } catch (err: unknown) {
        setSyncError(err instanceof Error ? err.message : 'Sync failed.')
      } finally {
        setSyncing(false)
      }
    },
    [
      enableSyncActions,
      targetQueryStreamId,
      syncing,
      channelLogin,
      detail?.stream?.vodId,
      refetchChartDuringSync,
      syncQuery,
    ],
  )

  useEffect(() => {
    if (!enableSyncActions || !layer2Enabled || !targetQueryStreamId) return
    let cancelled = false
    void (async () => {
      const status = await getSyncStatus(targetQueryStreamId).catch(() => null)
      if (cancelled || !status || isTerminalSyncPhase(status.phase) || status.stale) return
      setSyncing(true)
      setLiveSyncStatus(status)
      setSyncNotice('Sync in progress — resuming live progress.')
      setRightPanelTab('status')
      const finalStatus = await pollSyncUntilDone(targetQueryStreamId, setLiveSyncStatus, {
        onProgress: () => {
          void refetchChartDuringSync()
        },
      })
      if (cancelled) return
      if (finalStatus && !finalStatus.stale && finalStatus.phase !== 'failed') {
        await refetchChartDuringSync()
      }
      setSyncing(false)
    })()
    return () => {
      cancelled = true
    }
  }, [enableSyncActions, layer2Enabled, targetQueryStreamId, refetchChartDuringSync])

  const detailForRender = sessionDataError || liveIdentityMismatch ? undefined : detail
  const stream = detailForRender?.stream
  const fallbackVodId = useMemo(
    () =>
      resolveSessionFallbackVodId({
        sidebarStreams,
        targetQueryStreamId,
        detail: detailForRender,
      }),
    [sidebarStreams, targetQueryStreamId, detailForRender],
  )
  const recapMomentsAvailable = useMemo(
    () => Boolean(layer2Enabled && recapForStream && hasRecapMomentsAvailable(recapForStream)),
    [layer2Enabled, recapForStream],
  )
  const channelIsLive = useMemo(() => resolveChannelActuallyLive(detailForRender), [detailForRender])
  const streamVodId = resolveAnalyticsVodId(detailForRender, recapForStream?.vodId) ?? fallbackVodId
  const vodLinkState = useMemo(
    () =>
      resolveVodLinkState({
        detail: detailForRender,
        recapVodId: recapForStream?.vodId,
        fallbackVodId,
        isLiveCollector: isActiveLiveCollector,
        channelIsLive,
      }),
    [detailForRender, recapForStream?.vodId, fallbackVodId, isActiveLiveCollector, channelIsLive],
  )
  const rollupCount = detailForRender?.rollups?.length ?? 0
  const isLongStreamChart = rollupCount >= 360

  const headerState = channelIsLive || isActiveLiveCollector || sessionIsLive
    ? 'live'
    : isHistoricalRoute
      ? detailForRender?.state && detailForRender.state !== 'live'
        ? detailForRender.state
        : 'historical'
      : detailForRender?.state || (detailQuery.isLoading ? 'loading' : 'not_collected')

  const headerStats = useMemo(() => {
    const rollups = detailForRender?.rollups ?? []
    const viewerStats = computeRollupViewerStats(rollups)
    const chatStats = computeRollupChatStats(rollups)
    return {
      current: viewerStats?.current ?? stream?.currentViewers,
      avg: viewerStats?.avg ?? stream?.avgViewers,
      peak: viewerStats?.peak ?? stream?.peakViewers,
      chat: chatStats.chat > 0 ? chatStats.chat : stream?.chatMessages,
      emotes: chatStats.emotes > 0 ? chatStats.emotes : undefined,
    }
  }, [detailForRender?.rollups, stream])

  const statCardClasses = useMemo(
    () =>
      classifyStatCards({
        state: (detailForRender?.state as StreamCollectionState) ?? 'not_collected',
        avgViewers: stream?.avgViewers ?? 0,
        peakViewers: stream?.peakViewers ?? 0,
        rollups: detailForRender?.rollups ?? [],
      }),
    [detailForRender?.state, detailForRender?.rollups, stream?.avgViewers, stream?.peakViewers],
  )

  const chartEmoteKeys = useMemo(
    () => resolveChartEmoteKeys(emotePlotSelection, detailForRender?.topEmotes ?? [], viewMode),
    [emotePlotSelection, detailForRender?.topEmotes, viewMode],
  )

  const chartEmoteKeysOrdered = useMemo(() => Array.from(chartEmoteKeys), [chartEmoteKeys])

  const chartGames = useMemo(() => {
    if (!showGameSegments || !targetQueryStreamId) return []
    return deriveChartGameSegments(targetQueryStreamId, detailForRender, gamesQuery.data, {
      // Public portal: only render backend game segments, never silent category synthesis.
      allowCategoryFallback: mode !== 'public' && showGameSegments,
    })
  }, [showGameSegments, mode, targetQueryStreamId, detailForRender, gamesQuery.data])

  const liveRouteSessionTarget = useMemo(() => {
    if (!isLiveRoute) return undefined
    return resolveCanonicalLiveSessionTarget(sidebarStreams, {
      liveStreamId: detailForRender?.stream?.streamId || liveQuery.data?.stream?.streamId || liveActiveStreamId,
      channelLive: channelIsLive || isActiveLiveCollector,
      channelLogin,
      startedAt: detailForRender?.stream?.startedAt ?? liveQuery.data?.stream?.startedAt,
    })
  }, [
    isLiveRoute,
    sidebarStreams,
    detailForRender?.stream?.streamId,
    detailForRender?.stream?.startedAt,
    liveQuery.data?.stream?.streamId,
    liveQuery.data?.stream?.startedAt,
    liveActiveStreamId,
    channelIsLive,
    isActiveLiveCollector,
    channelLogin,
  ])

  const liveRouteSessionSlug = useMemo(() => {
    if (!liveRouteSessionTarget) return undefined
    return liveRouteSessionTarget.streamId
  }, [liveRouteSessionTarget])

  const shouldRedirectLiveRouteToSession = Boolean(
    isLiveRoute
    && !detailQuery.isLoading
    && !streamsQuery.isLoading
    && liveRouteSessionSlug,
  )

  useEffect(() => {
    if (!shouldRedirectLiveRouteToSession || !channelLogin || !liveRouteSessionSlug) return
    navigate(buildSessionPath(channelLogin, liveRouteSessionSlug), { replace: true })
  }, [
    buildSessionPath,
    channelLogin,
    liveRouteSessionSlug,
    navigate,
    shouldRedirectLiveRouteToSession,
  ])

  const canonicalLiveSessionSlug = useMemo(() => {
    const target = resolveCanonicalLiveSessionTarget(sidebarStreams, {
      liveStreamId: detailForRender?.stream?.streamId || liveActiveStreamId,
      channelLive: channelIsLive || isActiveLiveCollector,
      channelLogin,
      startedAt: detailForRender?.stream?.startedAt,
    })
    return target?.streamId
  }, [
    sidebarStreams,
    detailForRender?.stream?.streamId,
    detailForRender?.stream?.startedAt,
    liveActiveStreamId,
    channelIsLive,
    isActiveLiveCollector,
    channelLogin,
  ])

  const activeMinutesUnavailable = Boolean(
    isHistoricalRoute
    && !detailQuery.isLoading
    && matchedStream
    && (detailForRender?.minutesUnavailable || !detailForRender?.rollups?.some(rollupHasMinuteData))
    && ((matchedStream.viewerSamples ?? 0) > 0 || (matchedStream.chatMessages ?? 0) > 0),
  )

  const activeSyncEvidence = useMemo(() => {
    if (!isHistoricalRoute || !detailForRender) return undefined
    const rollups = detailForRender.rollups ?? []
    return {
      hasViewerMinutes: rollups.some(
        row => !row.missing && ((row.viewerSamples ?? 0) > 0 || (row.viewerAvg ?? 0) > 0),
      ),
      hasChatMinutes: rollups.some(
        row => !row.missing && ((row.chatCount ?? 0) > 0 || (row.totalEmoteCount ?? 0) > 0),
      ),
      coveragePct: summaryQuery.data?.metrics?.data_coverage_pct ?? detailForRender.chatCoveragePct,
      syncHealthState: summaryQuery.data?.metrics?.sync_health_state,
    }
  }, [detailForRender, isHistoricalRoute, summaryQuery.data?.metrics])

  const handlePreviewRecapOffset = useCallback(
    (offsetSeconds: number | null) => {
      if (offsetSeconds == null) {
        setPreviewRollup(null)
        return
      }
      const rollups = detailForRender?.momentRollups?.length
        ? detailForRender.momentRollups
        : detailForRender?.rollups ?? []
      if (!rollups.length) return
      const nearest = findNearestRollupByOffset(rollups, detailForRender?.stream?.startedAt, offsetSeconds)
      if (nearest) setPreviewRollup(nearest)
    },
    [detailForRender?.momentRollups, detailForRender?.rollups, detailForRender?.stream?.startedAt],
  )

  const selectedOffsetSeconds = useMemo(() => {
    if (!selectedRollup || !detailForRender?.stream?.startedAt) return null
    return rollupOffsetSeconds(selectedRollup, detailForRender.stream.startedAt)
  }, [detailForRender?.stream?.startedAt, selectedRollup])

  const matchedRecapMoment = useMemo(() => {
    if (selectedOffsetSeconds == null || !recapForStream) return null
    const moments = [
      ...(recapForStream.topMoments ?? []),
      ...(recapForStream.clipCandidates ?? []),
    ]
    return findNearestRecapMoment(moments, selectedOffsetSeconds)
  }, [recapForStream, selectedOffsetSeconds])

  const matchedHeatmapPoint = useMemo(() => {
    if (selectedOffsetSeconds == null) return null
    return findNearestHeatmapPoint(heatmapPoints, selectedOffsetSeconds)
  }, [heatmapPoints, selectedOffsetSeconds])

  const selectedGameName = useMemo(() => {
    if (selectedOffsetSeconds == null) return null
    return gameNameAtOffset(chartGames, selectedOffsetSeconds)
  }, [chartGames, selectedOffsetSeconds])

  const syncLabel = useMemo(() => {
    const rollups = detailForRender?.rollups ?? []
    const hasChat = rollups.some((row) => (row.chatCount ?? 0) > 0 || (row.totalEmoteCount ?? 0) > 0)
    const hasViewers = rollups.some((row) => (row.viewerSamples ?? 0) > 0 || (row.viewerAvg ?? 0) > 0)
    return syncCtaLabel({ syncing, hasChatRollups: hasChat, hasViewerSamples: hasViewers })
  }, [detailForRender?.rollups, syncing])

  const qualityDiagnosis = useMemo(
    () =>
      diagnoseStreamQuality({
        detail: detailForRender,
        summaryMetrics: summaryQuery.data?.metrics,
        analyticsQuality: summaryQuery.data?.analyticsQuality ?? detailForRender?.analyticsQuality,
        isLive: isActiveLiveCollector,
        syncing: syncing || detailForRender?.state === 'syncing',
      }),
    [detailForRender, summaryQuery.data, isActiveLiveCollector, syncing],
  )

  const activeSyncStatus = liveSyncStatus ?? syncQuery.data ?? null

  if (!channelLogin) {
    return (
      <section className="analytics-console" aria-label="Streamclone analytics console">
        <p className="muted">Missing channel login.</p>
      </section>
    )
  }

  const headerTitle = displayStreamTitle(
    stream ?? matchedStream,
    channelLogin,
    [
      matchedStream?.title,
      streamId && /^\d{4}-\d{2}-\d{2}$/.test(streamId)
        ? `${channelLogin} stream on ${streamId}`
        : `${channelLogin} stream`,
    ],
  )

  return (
    <section className="analytics-console text-zinc-200" aria-label={`Analytics for ${channelLogin}`}>
      <div className="flex w-full flex-col gap-4">
        <header className="flex flex-col gap-3 border-b border-white/[0.07] pb-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase text-zinc-500">
              <Link to="/analytics" className="rounded bg-white/10 px-2 py-1 text-zinc-200 transition hover:bg-white/15">
                Analytics hub
              </Link>
              <Link
                to={buildChannelPath(channelLogin)}
                className="rounded bg-violet-400/15 px-2 py-1 text-violet-100 transition hover:bg-violet-400/25"
              >
                {channelLogin}
              </Link>
              <span
                className={`rounded px-2 py-1 ${
                  headerState === 'live'
                    ? 'bg-red-500/15 text-red-100'
                    : headerState === 'syncing'
                      ? 'bg-violet-500/15 text-violet-100'
                      : headerState === 'historical'
                        ? 'bg-cyan-500/10 text-cyan-100'
                        : 'bg-white/10 text-zinc-300'
                }`}
              >
                {streamStateLabel(
                  headerState as AnalyticsStreamDetail['state'] | 'not found' | 'loading',
                  isHistoricalRoute,
                )}
              </span>
              {!detailForRender?.availability ? <ChatCoverageBadge detail={detailForRender} /> : null}
              {mode === 'public' ? (
                <>
                  <ViewerSourceBadge source={detailForRender?.viewerSource} />
                  <AnalyticsQualityChip detail={detailForRender} summaryMetrics={summaryQuery.data?.metrics} />
                  <CoverageFacets detail={detailForRender} summaryMetrics={summaryQuery.data?.metrics} />
                  <VodAvailabilityChip detail={detailForRender} />
                </>
              ) : null}
            </div>
            <h1
              className="mt-3 truncate text-2xl font-black leading-tight text-white lg:text-3xl"
              title={headerTitle}
            >
              {headerTitle}
            </h1>
            <div className="mt-2 flex flex-wrap gap-2 text-sm font-bold text-zinc-500">
              {stream?.displayName ? <span>{stream.displayName}</span> : null}
              {stream?.category ? <span>{stream.category}</span> : null}
              {stream?.startedAt ? <span>Started {relativeTime(stream.startedAt)}</span> : null}
              <span>
                {lastRefreshedAt
                  ? `Refreshed ${relativeTime(lastRefreshedAt)}`
                  : `Updated ${detailForRender?.updatedAt ? relativeTime(detailForRender.updatedAt) : '-'}`}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {enableLayoutControls ? (
              <>
                <button
                  type="button"
                  aria-expanded={streamsVisible}
                  aria-controls="analytics-console-streams"
                  onClick={() => setStreamsVisible(value => !value)}
                  className="rounded border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] font-black uppercase text-zinc-300 transition hover:bg-white/10 hover:text-white"
                >
                  {streamsVisible ? 'Hide streams' : 'Show streams'}
                </button>
                <button
                  type="button"
                  aria-pressed={chartFocused}
                  onClick={() => setChartFocused(value => !value)}
                  className="rounded border border-violet-400/25 bg-violet-500/10 px-3 py-1.5 text-[11px] font-black uppercase text-violet-200 transition hover:bg-violet-500/20"
                >
                  {chartFocused ? 'Exit chart focus' : 'Focus chart'}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="rounded border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[11px] font-black uppercase text-zinc-300 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              title="Reload chart and stats from server (does not start a sync job)"
            >
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatCard
            label="Current"
            value={statCardClasses.current.placeholder ?? count(headerStats.current)}
            tone={statCardClasses.current.muted ? STAT_PLACEHOLDER_MUTED_CLASS : 'text-cyan-300/90'}
          />
          <StatCard
            label="Average"
            value={statCardClasses.average.placeholder ?? count(headerStats.avg)}
            tone={statCardClasses.average.muted ? STAT_PLACEHOLDER_MUTED_CLASS : undefined}
          />
          <StatCard
            label="Peak"
            value={statCardClasses.peak.placeholder ?? count(headerStats.peak)}
            tone={statCardClasses.peak.muted ? STAT_PLACEHOLDER_MUTED_CLASS : undefined}
          />
          <StatCard
            label="Chat"
            value={statCardClasses.chat.placeholder ?? count(headerStats.chat)}
            tone={statCardClasses.chat.muted ? STAT_PLACEHOLDER_MUTED_CLASS : 'text-violet-300/90'}
          />
          <StatCard
            label="Emote Uses"
            value={statCardClasses.emoteUses.placeholder ?? count(headerStats.emotes)}
            tone={statCardClasses.emoteUses.muted ? STAT_PLACEHOLDER_MUTED_CLASS : 'text-emerald-300/90'}
          />
          <StatCard label="Duration" value={duration(stream)} />
        </section>

        <div
          className={
            chartFocused
              ? 'grid grid-cols-1 gap-4'
              : shellNested
              ? 'grid gap-4 lg:grid-cols-[minmax(260px,280px)_minmax(0,1fr)_minmax(260px,280px)]'
              : 'grid gap-4 xl:grid-cols-[minmax(260px,280px)_minmax(0,1fr)_minmax(260px,280px)]'
          }
        >
          {streamsVisible && !chartFocused ? <aside id="analytics-console-streams" className="order-3 min-w-0 w-full xl:order-none xl:sticky xl:top-4 xl:self-start">
            <StreamSidebar
              login={channelLogin}
              streams={sidebarStreams}
              activeID={isHistoricalRoute ? streamId : undefined}
              isLiveView={isLiveRoute}
              liveStreamId={liveActiveStreamId}
              liveState={channelIsLive || isActiveLiveCollector ? 'live' : isLiveRoute ? detailForRender?.state : undefined}
              liveSessionPath={
                canonicalLiveSessionSlug
                  ? buildSessionPath(channelLogin, canonicalLiveSessionSlug)
                  : buildChannelPath(channelLogin)
              }
              syncedOnly={syncedOnlyFilter}
              onSyncedOnlyChange={setSyncedOnlyFilter}
              buildSessionPath={buildSessionPath}
              buildChannelPath={buildChannelPath}
              activeMinutesUnavailable={activeMinutesUnavailable}
              activeSyncEvidence={activeSyncEvidence}
            />
          </aside> : null}

          <section className="order-1 min-w-0 xl:order-none">
            {sessionResolving ? (
              <div className="rounded border border-white/[0.07] bg-white/[0.025] px-4 py-8 text-center text-sm font-semibold text-zinc-500">
                Resolving session…
              </div>
            ) : null}
            {sessionNotFound ? (
              <div className="rounded border border-amber-500/20 bg-amber-500/[0.06] px-4 py-8 text-center text-sm font-semibold text-amber-100/90">
                Session not found for <span className="font-mono">{streamId}</span>. Pick another stream from the sidebar.
              </div>
            ) : null}
            {liveIdentityMismatch ? (
              <SessionDataState
                kind="session_identity_mismatch"
                dateLabel="live"
                title="Live session identity is updating."
                onRetry={() => void liveQuery.refetch()}
              />
            ) : null}
            {sessionDataError ? (
              <SessionDataState
                kind={sessionDataError.kind}
                dateLabel={/^\d{4}-\d{2}-\d{2}$/.test(streamId) ? streamId : 'session'}
                title={matchedStream?.title}
                onRetry={() => void detailQuery.refetch()}
              />
            ) : null}
            {!sessionResolving && !sessionNotFound && !liveIdentityMismatch && !sessionDataError ? (
            <div className="min-w-0 space-y-4">
              <CoverageStartBanner
                offsetSeconds={detailForRender?.coverageStartOffsetSeconds}
                missingRanges={detailForRender?.availability?.missingRanges}
                message={detailForRender?.availability?.coverageMessage}
              />
              <StreamQualityBanner
                diagnosis={qualityDiagnosis}
                syncing={syncing}
                canSync={enableSyncActions}
                onSync={() => void handleSync()}
                onSyncViewers={() => void handleSync({ viewersOnly: true })}
              />
              {syncError ? (
                <p className="text-[11px] font-semibold text-red-400">{syncError}</p>
              ) : null}
              {syncNotice && !syncError ? (
                <p className="text-[11px] font-semibold text-violet-300">{syncNotice}</p>
              ) : null}
              {detailQuery.isError && !detail ? (
                <p role="alert" className="text-[11px] font-semibold text-red-400">
                  Unable to load session data. Refresh to try again.
                </p>
              ) : null}
              <PastBroadcastBanner
                isLiveRoute={isLiveRoute}
                isActiveLiveCollector={isActiveLiveCollector}
                stream={stream}
                syncing={syncing}
                hasChartData={
                  (detailForRender?.rollups ?? []).some(rollupHasMinuteData)
                  || rollupsHaveViewerData(detailForRender?.rollups ?? [])
                }
                vodLinkState={vodLinkState}
                sessionStreamId={targetQueryStreamId}
                channelLogin={channelLogin}
                buildSessionPath={buildSessionPath}
              />
              <AnalyticsChart
                detail={detailForRender}
                selectedEmotes={chartEmoteKeys}
                onSelectEmote={toggleSelected}
                onClearEmotePlots={clearEmotePlots}
                onResetEmotePlots={resetEmotePlots}
                selectedRollup={selectedRollup}
                previewRollup={previewRollup}
                onSelectRollup={handleSelectRollup}
                onRefresh={() => void handleRefresh()}
                refreshing={refreshing}
                loading={detailQuery.isLoading && !detailForRender}
                games={chartGames}
                canSync={enableSyncActions}
                syncing={syncing}
                onSync={() => void handleSync()}
                onChatOnlySync={enableSyncActions ? () => void handleSync({ forceChat: true }) : undefined}
                isLive={isLive}
                syncCtaLabel={syncLabel}
                syncViewerStatus={activeSyncStatus?.viewerStatus}
                viewMode={viewMode}
                onViewModeChange={handleViewMode}
                vodLinkState={vodLinkState}
                topEmotesCatalog={detailForRender?.topEmotes}
                heatmapPoint={matchedHeatmapPoint}
                heatmapPoints={heatmapPoints}
                recapMoment={matchedRecapMoment}
                selectedGameName={selectedGameName}
                onOpenAnalytics={() => setRightPanelTab('moments')}
              />
              {streamVodId ? (
                <p className="text-[11px] font-semibold text-zinc-500">
                  VOD {streamVodId} — select a moment for a timestamped jump, or{' '}
                  <a
                    href={buildTwitchVodUrl(streamVodId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-violet-300 hover:text-violet-200"
                  >
                    open the full VOD
                  </a>
                  {isLongStreamChart ? ' Long streams (6h+) may feel slower while hovering the chart.' : ''}
                </p>
              ) : vodLinkState.detail ? (
                <p className="text-[11px] font-semibold text-zinc-500">{vodLinkState.detail}</p>
              ) : null}
            </div>
            ) : null}
          </section>

          {!chartFocused ? <aside className="order-2 w-full min-w-0 space-y-3 xl:order-none">
            {recapIntegrityBlocked || heatmapIntegrityBlocked ? (
              <div
                className="rounded border border-amber-400/20 bg-amber-500/[0.05] px-3 py-3 text-xs font-semibold text-amber-100/80"
                data-session-moment-state="integrity-blocked"
              >
                Moment ranking unavailable for this session because the server returned cross-session data.
              </div>
            ) : null}
            {layer2Enabled && recapForStream ? (
              <StreamRecapPanel
                recap={recapForStream}
                topEmotesCatalog={detailForRender?.topEmotes}
                rollups={detailForRender?.momentRollups ?? detailForRender?.rollups ?? []}
                streamStartedAt={stream?.startedAt}
                vodId={streamVodId}
                onJumpToOffset={handleJumpToRecapOffset}
                onPreviewOffset={handlePreviewRecapOffset}
              />
            ) : null}
            <div className="w-full overflow-hidden rounded border border-white/[0.07] bg-white/[0.025]">
              <div className="flex border-b border-white/[0.07] text-[10px] font-black uppercase bg-white/[0.012]">
                {(['moments', 'emotes', 'status'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setRightPanelTab(tab)}
                    className={`flex-1 py-2 text-center transition border-r border-white/[0.07] last:border-r-0 ${
                      rightPanelTab === tab ? 'bg-white/[0.028] text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'
                    }`}
                  >
                    {tab === 'moments' ? 'Moments' : tab === 'emotes' ? 'Emotes' : 'Status'}
                  </button>
                ))}
              </div>
              <div className="p-0">
                {rightPanelTab === 'moments' ? (
                  recapMomentsAvailable && recapForStream ? (
                    <SessionRecapMomentsStrip
                      recap={recapForStream}
                      streamStartedAt={stream?.startedAt}
                      selectedOffsetSeconds={selectedOffsetSeconds}
                      onSelectOffset={handleJumpToRecapOffset}
                      onPreviewOffset={handlePreviewRecapOffset}
                      layout="rightRail"
                      rollups={detailForRender?.momentRollups ?? detailForRender?.rollups ?? []}
                      heatmapPoints={heatmapPoints}
                      topEmotesCatalog={detailForRender?.topEmotes}
                    />
                  ) : (
                    <MomentReviewPanel
                      rollups={detailForRender?.momentRollups ?? detailForRender?.rollups ?? []}
                      selectedRollup={selectedRollup}
                      previewRollup={previewRollup}
                      onSelectRollup={handleSelectRollup}
                      onPreviewRollup={setPreviewRollup}
                      topEmotesCatalog={detailForRender?.topEmotes}
                      heatmapPoints={layer2Enabled ? heatmapPoints : undefined}
                      streamStartedAt={stream?.startedAt}
                      embedded
                    />
                  )
                ) : null}
                {rightPanelTab === 'emotes' ? (
                  <TopEmoteTable
                    emotes={detailForRender?.topEmotes ?? []}
                    selected={chartEmoteKeys}
                    plottedKeys={chartEmoteKeysOrdered}
                    onSelect={toggleSelected}
                    embedded
                  />
                ) : null}
                {rightPanelTab === 'status' && layer2Enabled ? (
                  <SyncStatusPanel detail={detailForRender} syncStatus={activeSyncStatus} />
                ) : rightPanelTab === 'status' ? (
                  <p className="p-4 text-[11px] font-semibold text-zinc-500">
                    Open a session from the sidebar for sync status and Layer 2 detail.
                  </p>
                ) : null}
              </div>
            </div>
          </aside> : null}
        </div>
      </div>
    </section>
  )
}
