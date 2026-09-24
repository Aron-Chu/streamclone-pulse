import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  mergeRecapMoments,
  momentScoreReasonLabel,
  reactionAnalyticalOffset,
  sanitizeReactionMoment,
} from '@streampulse/pulse-core'
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
  watchAnalyticsChannel,
  type AnalyticsMinuteRollup,
} from '../api.ts'
import type { AnalyticsStream, AnalyticsStreamDetail, SyncStatus } from '../apiTypes.ts'
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
import { analyticsStreamPathSlug, resolveCanonicalLiveSessionTarget } from '../utils/syncedLiveStream.ts'
import {
  isDateSlugUnresolved,
  recapMatchesStreamIds,
  resolveCanonicalStreamId,
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
import { count, displayStreamTitle, duration, durationFromDetail, getLocalDateString, streamStateLabel } from '../utils/consoleFormat.ts'
import { deriveChartGameSegments, gameNameAtOffset } from '../utils/gameSegmentChart.ts'
import { DataQualityDisclosure, StatCard, CoverageStartBanner } from './analytics/ConsoleBits.tsx'
import { StreamSidebar } from './analytics/StreamSidebar.tsx'
import { TopEmoteTable } from './analytics/TopEmoteTable.tsx'
import { MomentReviewPanel } from './analytics/MomentReviewPanel.tsx'
import { PastBroadcastBanner } from './analytics/PastBroadcastBanner.tsx'
import { RelativeTimeText } from './analytics/RelativeTimeText.tsx'
import { SessionRecapMomentsStrip } from './analytics/SessionRecapMomentsStrip.tsx'
import { SelectedMomentCompactCard } from './analytics/SelectedMomentCompactCard.tsx'
import { StreamRecapPanel } from './analytics/StreamRecapPanel.tsx'
import { hasRecapMomentsAvailable } from '../utils/recapMomentsAvailable.ts'
import { resolveMomentVodJump } from '../utils/selectedMomentDisplay.ts'
import { SyncStatusPanel } from './analytics/SyncStatusPanel.tsx'
import { StreamQualityBanner } from './analytics/StreamQualityBanner.tsx'
import { diagnoseStreamQuality } from '../utils/streamQuality.ts'
import { isTerminalSyncPhase, pollSyncUntilDone } from '../utils/syncPolling.ts'
import { buildSessionSignals } from '../signals/buildSessionSignals.ts'
import { SessionSignalTape } from './signals/SessionSignalTape.tsx'
import { AnalyticsConsoleDataSkeleton } from './AnalyticsConsoleDataSkeleton.tsx'
import './signals/session-signal-tape.css'

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

export interface AnalyticsConsoleProps {
  mode?: 'public' | 'local' | string
  showGameSegments?: boolean
  /** Opt into stream-rail and chart-focus controls. Package consumers remain unchanged by default. */
  enableLayoutControls?: boolean
  /** Stage optional heatmap/sync detail after core session content. */
  layer2LoadMode?: 'eager' | 'staged'
  /** When true, use lg breakpoint for 3-col layout (portal Figma shell already consumes sidebar width). */
  shellNested?: boolean
  /** Enable sync / re-sync CTAs (local dev portal; hosted waits for API-008 rate limits). */
  enableSyncActions?: boolean
  buildSessionPath?: (login: string, streamId: string) => string
  buildChannelPath?: (login: string) => string
  /** Host-owned actions for an explicitly selected minute on a resolved stream. */
  renderSelectedMomentActions?: (moment: { login: string; streamId: string; offsetSeconds: number; at?: number; chatPerMin?: number; emotesPerMin?: number; category?: string; label?: string }) => ReactNode
}

function defaultSessionPath(login: string, streamId: string): string {
  return `/analytics/${encodeURIComponent(login)}/${encodeURIComponent(streamId)}`
}

/** A session URL may name any stream ID; only the returned stream can prove ownership. */
function streamBelongsToChannel(detail: AnalyticsStreamDetail, channelLogin: string): boolean {
  const requested = channelLogin.trim().toLowerCase()
  const owner = detail.stream?.login?.trim().toLowerCase()
  const responseChannel = detail.channel?.trim().toLowerCase()
  return Boolean(requested && owner === requested && (!responseChannel || responseChannel === requested))
}

function defaultChannelPath(login: string): string {
  return `/analytics/${encodeURIComponent(login)}`
}

export function AnalyticsConsole({
  mode = 'public',
  showGameSegments = true,
  enableLayoutControls = false,
  layer2LoadMode = 'eager',
  shellNested = false,
  enableSyncActions = false,
  buildSessionPath = defaultSessionPath,
  buildChannelPath = defaultChannelPath,
  renderSelectedMomentActions,
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
  const [selectedAnchorOffsetSeconds, setSelectedAnchorOffsetSeconds] = useState<number | null>(null)
  const [previewRollup, setPreviewRollup] = useState<AnalyticsMinuteRollup | null>(null)
  const [previewOffsetSeconds, setPreviewOffsetSeconds] = useState<number | null>(null)
  const [viewMode, setViewMode] = useState<AnalyticsViewMode>('overview')
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('moments')
  const [streamsVisible, setStreamsVisible] = useState(true)
  const [chartFocused, setChartFocused] = useState(false)
  const [heatmapEngagedStreamId, setHeatmapEngagedStreamId] = useState<string | null>(null)
  const [syncEngagedStreamId, setSyncEngagedStreamId] = useState<string | null>(null)
  const [stagedIdleStreamId, setStagedIdleStreamId] = useState<string | null>(null)
  const [syncedOnlyFilter, setSyncedOnlyFilter] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncNotice, setSyncNotice] = useState<string | null>(null)
  const [liveSyncStatus, setLiveSyncStatus] = useState<SyncStatus | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null)
  const appliedDeepLinkKey = useRef<string | null>(null)

  const handleSelectRollup = useCallback((rollup: AnalyticsMinuteRollup | null) => {
    if (rollup && selectedRollup?.minuteTs === rollup.minuteTs) {
      setSelectedRollup(null)
      setSelectedAnchorOffsetSeconds(null)
      setPreviewRollup(null)
      setPreviewOffsetSeconds(null)
      return
    }
    setSelectedRollup(rollup)
    setSelectedAnchorOffsetSeconds(null)
    setPreviewRollup(null)
    setPreviewOffsetSeconds(null)
  }, [selectedRollup])

  useEffect(() => {
    setSelectedRollup(null)
    setSelectedAnchorOffsetSeconds(null)
    setPreviewRollup(null)
    setPreviewOffsetSeconds(null)
    setLastRefreshedAt(null)
    setEmotePlotSelection('auto')
    setViewMode('overview')
    setSyncing(false)
    setSyncError(null)
    setSyncNotice(null)
    setLiveSyncStatus(null)
    setChartFocused(false)
    setHeatmapEngagedStreamId(null)
    setSyncEngagedStreamId(null)
    setStagedIdleStreamId(null)
  }, [channelLogin, streamId, layer2LoadMode])

  useEffect(() => {
    if (!channelLogin || !isLiveRoute) return
    watchAnalyticsChannel(channelLogin).catch(() => undefined)
  }, [channelLogin, isLiveRoute])

  // Session routes own their explicit target. They must not keep an unrelated
  // channel-live request running in the background.
  const liveQuery = useAnalyticsLive(channelLogin, {
    enabled: Boolean(channelLogin && isLiveRoute),
  })
  const streamsQuery = useQuery({
    queryKey: ['analytics-console-streams', channelLogin],
    // Fetch a bounded recent channel list (limit 100) once. This response powers
    // both the recent sidebar AND the history used for date-slug resolution —
    // previously two separate fetches to the same /channels/{login}/streams
    // endpoint (limit 20 + limit 100).
    queryFn: () => getAnalyticsStreams(channelLogin, 100),
    enabled: Boolean(channelLogin),
    staleTime: 30_000,
    refetchInterval: isLiveRoute ? 30_000 : false,
  })

  // historyItems are derived from the same limit-100 streams response (no
  // second network call). resolveTargetQueryStreamId only reads streamId/id/startedAt.
  const historyItems = useMemo<HistoryStreamItem[] | undefined>(() => {
    const items = streamsQuery.data?.items ?? []
    if (items.length === 0) return undefined
    return items.map((item) => ({
      streamId: item.streamId,
      id: item.streamId,
      displayName: item.displayName ?? item.login,
      title: item.title,
      category: item.category,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      peakViewers: item.peakViewers,
      viewerSamples: item.viewerSamples,
      chatMessages: item.chatMessages,
      vodId: item.vodId,
    }))
  }, [streamsQuery.data?.items])
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

  const matchedStream = useMemo(() => {
    if (!streamId) return undefined
    return resolveMatchedStream(streamId, sidebarStreams, sidebarStreams)
  }, [streamId, sidebarStreams])

  const targetQueryStreamId = useMemo(() => {
    if (isLiveRoute) {
      return liveQuery.data?.stream?.streamId || streamsQuery.data?.items?.[0]?.streamId || ''
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
    streamsQuery.data?.items,
  ])

  const sessionResolving = Boolean(
    isHistoricalRoute && listsLoading && /^\d{4}-\d{2}-\d{2}$/.test(streamId),
  )
  const unresolvedSessionAlias = Boolean(
    isHistoricalRoute && isDateSlugUnresolved(streamId, matchedStream, listsLoading),
  )

  // Only a resolved live payload can prove that a historical route points at
  // the active broadcast. The stream list is ordered by recency, not liveness;
  // treating its first row as live suppresses the historical detail query for
  // ended sessions (and leaves the page stuck on an empty live frame).
  const liveActiveStreamId = liveQuery.data?.stream?.streamId || ''
  // A date-slug redirect can resolve to the session that the live query already
  // owns. Reuse that payload instead of starting a second historical detail /
  // minutes waterfall for the same stream id.
  const currentLiveTarget = Boolean(
    isHistoricalRoute
    && targetQueryStreamId
    && liveActiveStreamId
    && targetQueryStreamId === liveActiveStreamId,
  )

  const historicalDetailQuery = useQuery({
    queryKey: ['analytics-console-detail', targetQueryStreamId, channelLogin],
    queryFn: async () => {
      if (!targetQueryStreamId) return null
      // First load is always full timeline; status polls merge via statusQuery below.
      const session = await getAnalyticsStream(targetQueryStreamId, { sparse: false, channel: channelLogin })
      // The API may ignore `channel` for an explicit stream ID. Never render a
      // different creator's title, measurements, or moments under this URL.
      return session && streamBelongsToChannel(session, channelLogin) ? session : null
    },
    enabled: Boolean(
      channelLogin
      && targetQueryStreamId
      && isHistoricalRoute
      && !unresolvedSessionAlias
      && !currentLiveTarget,
    ),
    staleTime: 30_000,
    refetchInterval: false,
    // A confirmed-ended broadcast cannot change; re-downloading every minute on
    // each tab return is pure cost. Unconfirmed sessions keep the focus refresh.
    refetchOnWindowFocus: query => (query.state.data as AnalyticsStreamDetail | null | undefined)?.stream?.lifecycleState !== 'confirmed_ended',
  })

  const detailQuery = isLiveRoute || currentLiveTarget ? liveQuery : historicalDetailQuery
  const rawDetail = (detailQuery.data ?? undefined) as AnalyticsStreamDetail | undefined
  // A date alias can reuse the live query rather than historicalDetailQuery.
  // Apply the same ownership check to that route before any session data renders.
  const detailOwnershipMismatch = Boolean(
    isHistoricalRoute && rawDetail && !streamBelongsToChannel(rawDetail, channelLogin),
  )
  const baseDetail = detailOwnershipMismatch ? undefined : rawDetail

  const statusQuery = useQuery({
    queryKey: ['analytics-console-status', targetQueryStreamId, channelLogin],
    queryFn: async () => {
      if (!targetQueryStreamId) return null
      const status = await getStreamStatus(targetQueryStreamId)
      // When the status endpoint is unavailable (returns null — e.g. unregistered
      // hosted route or local routes), don't re-fetch a sparse detail: the full
      // detail is already loaded by historicalDetailQuery and statusMerged simply
      // falls back to baseDetail.
      return status ?? null
    },
    enabled: Boolean(isHistoricalRoute && targetQueryStreamId && baseDetail),
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
      if (baseDetail?.stream?.lifecycleState
        ? baseDetail.stream.lifecycleState === 'confirmed_live'
        : mergedState === 'live' || liveDvr === 'live') return backoff
      if (vod === 'pending_live' || vod === 'resolving' || vod === 'request_failed') return backoff
      return false
    },
    retry: 1,
  })

  const statusMerged = useMemo(() => {
    if (!baseDetail) return undefined
    if (!statusQuery.data) return baseDetail
    return mergeSessionStatusIntoDetail(baseDetail, statusQuery.data as Parameters<typeof mergeSessionStatusIntoDetail>[1])
  }, [baseDetail, statusQuery.data])

  const sessionIsLive = resolveChannelActuallyLive(statusMerged)

  const liveTailAfterOffset = maxRollupOffsetSeconds(statusMerged)
  const minutesTailQuery = useQuery({
    queryKey: ['analytics-console-minutes-tail', targetQueryStreamId, liveTailAfterOffset],
    queryFn: async () => {
      if (!targetQueryStreamId || liveTailAfterOffset < 0) return null
      return getStreamMinutesTail(targetQueryStreamId, liveTailAfterOffset)
    },
    enabled: Boolean(sessionIsLive && targetQueryStreamId && liveTailAfterOffset >= 0 && statusMerged),
    staleTime: 15_000,
    refetchInterval: sessionIsLive ? 30_000 : false,
  })

  const detail = useMemo(() => {
    if (!statusMerged) return undefined
    return mergeMinutesTailIntoDetail(statusMerged, minutesTailQuery.data ?? undefined)
  }, [statusMerged, minutesTailQuery.data])

  const sessionLoadFailed = Boolean(
    isHistoricalRoute && !detailQuery.isLoading && detailQuery.isError && !detail,
  )
  const sessionNotFound = unresolvedSessionAlias || detailOwnershipMismatch || Boolean(isHistoricalRoute && !detail && (
    (detailQuery.error as { status?: number } | null)?.status === 404
    || (detailQuery.isSuccess && detailQuery.data === null)
  ))
  const effectiveSessionNotFound = sessionNotFound || sessionLoadFailed

  const handleSelectOffset = useCallback((offsetSeconds: number) => {
    if (!Number.isFinite(offsetSeconds)) return
    const rollups = detail?.momentRollups?.length ? detail.momentRollups : detail?.rollups ?? []
    if (rollups.length === 0) return
    const currentOffset = selectedAnchorOffsetSeconds != null
      ? selectedAnchorOffsetSeconds
      : selectedRollup && detail?.stream?.startedAt
        ? rollupOffsetSeconds(selectedRollup, detail.stream.startedAt)
        : null
    if (currentOffset != null && Math.abs(currentOffset - offsetSeconds) < 1) {
      setSelectedRollup(null)
      setSelectedAnchorOffsetSeconds(null)
      setPreviewRollup(null)
      setPreviewOffsetSeconds(null)
      return
    }
    const nearest = findNearestRollupByOffset(rollups, detail?.stream?.startedAt, offsetSeconds)
    if (!nearest) return
    setSelectedRollup(nearest)
    setSelectedAnchorOffsetSeconds(Math.max(0, offsetSeconds))
    setPreviewRollup(null)
    setPreviewOffsetSeconds(null)
  }, [detail?.momentRollups, detail?.rollups, detail?.stream?.startedAt, selectedAnchorOffsetSeconds, selectedRollup])

  const chartDetailReady = Boolean(
    detail?.rollups?.some(rollupHasMinuteData) || detail?.stream?.streamId,
  )
  const stagedHeatmapEnabled =
    layer2LoadMode === 'eager'
    || stagedIdleStreamId === targetQueryStreamId
    || heatmapEngagedStreamId === targetQueryStreamId
  const stagedSyncEnabled =
    layer2LoadMode === 'eager'
    || stagedIdleStreamId === targetQueryStreamId
    || syncEngagedStreamId === targetQueryStreamId
  const stagedLayer2Enabled =
    layer2LoadMode === 'eager'
    || stagedIdleStreamId === targetQueryStreamId
    || heatmapEngagedStreamId === targetQueryStreamId
    || syncEngagedStreamId === targetQueryStreamId

  useEffect(() => {
    if (
      layer2LoadMode !== 'staged'
      || !layer2Enabled
      || !chartDetailReady
      || !targetQueryStreamId
      || stagedIdleStreamId === targetQueryStreamId
    ) {
      return
    }
    const timeout = window.setTimeout(
      () => setStagedIdleStreamId(targetQueryStreamId),
      1500,
    )
    return () => window.clearTimeout(timeout)
  }, [
    chartDetailReady,
    layer2Enabled,
    layer2LoadMode,
    stagedIdleStreamId,
    targetQueryStreamId,
  ])

  const gamesQuery = useQuery({
    queryKey: ['analytics-console-games', targetQueryStreamId],
    queryFn: () => getStreamGameSegments(targetQueryStreamId),
    // Game segments are optional enrichment; do not compete with first paint.
    enabled: Boolean(showGameSegments && targetQueryStreamId && stagedLayer2Enabled),
    staleTime: 60_000,
    refetchInterval: sessionIsLive ? 75_000 : false,
  })

  const syncQuery = useQuery({
    queryKey: ['analytics-console-sync', targetQueryStreamId],
    queryFn: () => getSyncStatus(targetQueryStreamId),
    enabled: Boolean(
      layer2Enabled
      && targetQueryStreamId
      && chartDetailReady
      && stagedSyncEnabled,
    ),
    staleTime: 30_000,
    refetchInterval: syncing ? 2000 : false,
  })

  const summaryQuery = useQuery({
    queryKey: ['analytics-console-summary', targetQueryStreamId, channelLogin],
    queryFn: () => getStreamSummary(targetQueryStreamId, channelLogin),
    enabled: Boolean(
      layer2Enabled
      && targetQueryStreamId
      && channelLogin
      && chartDetailReady
    ),
    staleTime: 30_000,
  })

  const recapQuery = useQuery({
    queryKey: ['analytics-console-recap', targetQueryStreamId],
    queryFn: () => getPulseStreamRecap(targetQueryStreamId),
    enabled: Boolean(
      layer2Enabled
      && targetQueryStreamId
      && chartDetailReady
    ),
    staleTime: 120_000,
    retry: 1,
  })

  const heatmapQuery = useQuery({
    queryKey: ['analytics-console-heatmap', targetQueryStreamId, channelLogin],
    queryFn: async () => {
      const data = await getReplayHeatmap(targetQueryStreamId, 60, channelLogin)
      return (data ?? null) as HeatmapResponse | null
    },
    enabled: Boolean(
      layer2Enabled
      && targetQueryStreamId
      && channelLogin
      && chartDetailReady
      && stagedHeatmapEnabled,
    ),
    staleTime: 120_000,
    retry: 1,
  })

  const heatmapPoints = heatmapQuery.data?.points
  const detailForRender = useMemo(() => {
    const stagedTopEmotes = summaryQuery.data?.topEmotes
    if (!detail || !stagedTopEmotes?.length) return detail
    return { ...detail, topEmotes: stagedTopEmotes }
  }, [detail, summaryQuery.data?.topEmotes])

  const canonicalStreamId = resolveCanonicalStreamId(detail?.stream?.streamId, targetQueryStreamId)

  const recapForStream =
    recapQuery.isSuccess
    && recapQuery.data
    && recapMatchesStreamIds(recapQuery.data.streamId, targetQueryStreamId, canonicalStreamId)
      ? recapQuery.data
      : null

  // One source of truth for chart markers: refined recap windows outrank the
  // coarse heatmap, while the heatmap remains the honest fallback when recap
  // refinement is unavailable. This prevents two competing marker sets from
  // rendering at different timestamps in the portal and extension.
  const reactionMoments = useMemo(
    () =>
      mergeRecapMoments(recapForStream, heatmapPoints ?? [], 40, true)
        .map((moment) => sanitizeReactionMoment(moment)),
    [heatmapPoints, recapForStream],
  )

  const isActiveLiveCollector = isActiveLiveCollectorStream(detail?.stream, detail?.state)
  // Deep-linked live sessions must keep advancing — path shape is not authoritative.
  const isLive = sessionIsLive

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
    if (nearest) {
      setSelectedRollup(nearest)
      setSelectedAnchorOffsetSeconds(offsetSeconds)
    }
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

  // Chart focus must never add or remove overlays. The Emote overlays
  // disclosure is the single owner of that selection state.
  const emotePlotViewMode = 'overview' as const

  const toggleSelected = useCallback((key: string) => {
    setEmotePlotSelection((current) =>
      toggleEmotePlotSelection(current, key, detail?.topEmotes ?? [], emotePlotViewMode),
    )
  }, [detail?.topEmotes])

  const clearEmotePlots = useCallback(() => {
    setEmotePlotSelection('none')
  }, [])

  const resetEmotePlots = useCallback(() => {
    setEmotePlotSelection('auto')
  }, [])

  const handleRightPanelTab = useCallback((tab: RightPanelTab) => {
    setRightPanelTab(tab)
    if (layer2LoadMode !== 'staged' || !targetQueryStreamId) return
    if (tab === 'moments') setHeatmapEngagedStreamId(targetQueryStreamId)
    if (tab === 'status') setSyncEngagedStreamId(targetQueryStreamId)
  }, [layer2LoadMode, targetQueryStreamId])

  const handleViewMode = useCallback((next: AnalyticsViewMode) => {
    setViewMode(next)
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
      if (nearest) {
        setSelectedRollup(nearest)
        setSelectedAnchorOffsetSeconds(offsetSeconds)
      }
    },
    [detail?.momentRollups, detail?.rollups, detail?.stream?.startedAt],
  )

  const handleSelectReactionMoment = useCallback(
    (moment: {
      offsetSeconds: number
      reactionOnsetOffsetSeconds?: number
      reactionApexOffsetSeconds?: number
      seekOffsetSeconds?: number
      precisionSeconds?: number
    }) => {
      handleJumpToRecapOffset(reactionAnalyticalOffset(moment))
    },
    [handleJumpToRecapOffset],
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
        refetches.push(summaryQuery.refetch())
        refetches.push(recapQuery.refetch())
        if (stagedSyncEnabled) refetches.push(syncQuery.refetch())
        if (stagedHeatmapEnabled) refetches.push(heatmapQuery.refetch())
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
    stagedHeatmapEnabled,
    stagedSyncEnabled,
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
      handleRightPanelTab('status')
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
      handleRightPanelTab,
      refetchChartDuringSync,
      syncQuery,
    ],
  )

  useEffect(() => {
    if (!enableSyncActions || !layer2Enabled || !targetQueryStreamId || !stagedSyncEnabled) return
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
  }, [
    enableSyncActions,
    layer2Enabled,
    targetQueryStreamId,
    refetchChartDuringSync,
    stagedSyncEnabled,
  ])

  const stream = detail?.stream
  const fallbackVodId = useMemo(
    () =>
      resolveSessionFallbackVodId({
        sidebarStreams,
        targetQueryStreamId,
        detail,
      }),
    [sidebarStreams, targetQueryStreamId, detail],
  )
  const recapMomentsAvailable = useMemo(
    () => Boolean(layer2Enabled && recapForStream && hasRecapMomentsAvailable(recapForStream)),
    [layer2Enabled, recapForStream],
  )
  const channelIsLive = useMemo(() => resolveChannelActuallyLive(detail), [detail])
  const streamVodId = resolveAnalyticsVodId(detail, recapForStream?.vodId) ?? fallbackVodId
  const hasVerifiedVodAlignment = typeof detail?.vodAlignSeconds === 'number'
    && Number.isFinite(detail.vodAlignSeconds)
  const vodLinkState = useMemo(
    () =>
      resolveVodLinkState({
        detail,
        recapVodId: recapForStream?.vodId,
        fallbackVodId,
        isLiveCollector: isActiveLiveCollector,
        channelIsLive,
      }),
    [detail, recapForStream?.vodId, fallbackVodId, isActiveLiveCollector, channelIsLive],
  )
  // Tiles and totals read every measured minute; `rollups` is the chart's downsampled series.
  const measuredRollups = detail?.momentRollups?.length ? detail.momentRollups : detail?.rollups
  const rollupCount = detail?.timelineMinutes ?? measuredRollups?.length ?? 0
  const isLongStreamChart = rollupCount >= 360

  const headerState = detail?.stream?.lifecycleState === 'unknown'
    ? 'unknown'
    : channelIsLive || isActiveLiveCollector || sessionIsLive
    ? 'live'
    : isHistoricalRoute
      ? detail?.state && detail.state !== 'live'
        ? detail.state
        : 'historical'
      : detail?.state || (detailQuery.isLoading ? 'loading' : 'not_collected')

  const headerStats = useMemo(() => {
    const rollups = measuredRollups ?? []
    const viewerStats = computeRollupViewerStats(rollups)
    const chatStats = computeRollupChatStats(rollups)
    return {
      current: viewerStats?.current ?? stream?.currentViewers,
      avg: viewerStats?.avg ?? stream?.avgViewers,
      peak: viewerStats?.peak ?? stream?.peakViewers,
      chat: chatStats.chat > 0 ? chatStats.chat : stream?.chatMessages,
      emotes: chatStats.emotes > 0 ? chatStats.emotes : undefined,
    }
  }, [measuredRollups, stream])

  const statCardClasses = useMemo(
    () =>
      classifyStatCards({
        state: (detail?.state as StreamCollectionState) ?? 'not_collected',
        avgViewers: stream?.avgViewers ?? 0,
        peakViewers: stream?.peakViewers ?? 0,
        rollups: measuredRollups ?? [],
      }),
    [detail?.state, measuredRollups, stream?.avgViewers, stream?.peakViewers],
  )

  const chartEmoteKeys = useMemo(
    () => resolveChartEmoteKeys(emotePlotSelection, detail?.topEmotes ?? [], emotePlotViewMode),
    [emotePlotSelection, detail?.topEmotes],
  )

  const chartEmoteKeysOrdered = useMemo(() => Array.from(chartEmoteKeys), [chartEmoteKeys])

  const chartGames = useMemo(() => {
    if (!showGameSegments || !targetQueryStreamId) return []
    return deriveChartGameSegments(targetQueryStreamId, detail, gamesQuery.data, {
      // Public portal: only render backend game segments, never silent category synthesis.
      allowCategoryFallback: mode !== 'public' && showGameSegments,
    })
  }, [showGameSegments, mode, targetQueryStreamId, detail, gamesQuery.data])

  const liveRouteSessionTarget = useMemo(() => {
    if (!isLiveRoute) return undefined
    return resolveCanonicalLiveSessionTarget(sidebarStreams, {
      liveStreamId: detail?.stream?.streamId || liveQuery.data?.stream?.streamId || liveActiveStreamId,
      channelLive: channelIsLive || isActiveLiveCollector,
      channelLogin,
      startedAt: detail?.stream?.startedAt ?? liveQuery.data?.stream?.startedAt,
    })
  }, [
    isLiveRoute,
    sidebarStreams,
    detail?.stream?.streamId,
    detail?.stream?.startedAt,
    liveQuery.data?.stream?.streamId,
    liveQuery.data?.stream?.startedAt,
    liveActiveStreamId,
    channelIsLive,
    isActiveLiveCollector,
    channelLogin,
  ])

  const liveRouteSessionSlug = useMemo(() => {
    if (!liveRouteSessionTarget) return undefined
    return analyticsStreamPathSlug(liveRouteSessionTarget, sidebarStreams)
  }, [liveRouteSessionTarget, sidebarStreams])

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
      liveStreamId: detail?.stream?.streamId || liveActiveStreamId,
      channelLive: channelIsLive || isActiveLiveCollector,
      channelLogin,
      startedAt: detail?.stream?.startedAt,
    })
    return target ? analyticsStreamPathSlug(target, sidebarStreams) : undefined
  }, [
    sidebarStreams,
    detail?.stream?.streamId,
    detail?.stream?.startedAt,
    liveActiveStreamId,
    channelIsLive,
    isActiveLiveCollector,
    channelLogin,
  ])

  const activeMinutesUnavailable = Boolean(
    isHistoricalRoute
    && !detailQuery.isLoading
    && matchedStream
    && (detail?.minutesUnavailable || !detail?.rollups?.some(rollupHasMinuteData))
    && ((matchedStream.viewerSamples ?? 0) > 0 || (matchedStream.chatMessages ?? 0) > 0),
  )

  const timelineRollups = useMemo(
    () =>
      (detail?.momentRollups?.length ? detail.momentRollups : detail?.rollups ?? [])
        .slice()
        .sort((left, right) => Date.parse(left.minuteTs) - Date.parse(right.minuteTs)),
    [detail?.momentRollups, detail?.rollups],
  )
  const sessionSignals = useMemo(() => {
    if (!detail || !targetQueryStreamId) return []
    const signals = buildSessionSignals({
      detail,
      recap: recapForStream,
      rollups: timelineRollups,
      startedAt: detail.stream?.startedAt,
      streamId: canonicalStreamId || targetQueryStreamId,
      activeMinutesUnavailable,
    })
    return activeMinutesUnavailable ? signals.filter(signal => signal.kind === 'coverage') : signals
  }, [
    activeMinutesUnavailable,
    canonicalStreamId,
    detail,
    recapForStream,
    targetQueryStreamId,
    timelineRollups,
  ])
  const minuteTsToRollup = useMemo(
    () => new Map(timelineRollups.map(rollup => [rollup.minuteTs, rollup])),
    [timelineRollups],
  )
  const handleSignalMinuteSelect = useCallback((minuteTs: string) => {
    const rollup = minuteTsToRollup.get(minuteTs)
    if (!rollup) return
    setSelectedRollup(rollup)
    setSelectedAnchorOffsetSeconds(null)
    setPreviewRollup(null)
    setPreviewOffsetSeconds(null)
  }, [minuteTsToRollup])
  const showSessionSignalTape = Boolean(
    layer2Enabled
    && detailQuery.data
    && !sessionResolving
    && !sessionNotFound,
  )

  const activeSyncEvidence = useMemo(() => {
    if (!isHistoricalRoute || !detail) return undefined
    const rollups = detail.rollups ?? []
    return {
      hasViewerMinutes: rollups.some(
        row => !row.missing && ((row.viewerSamples ?? 0) > 0 || (row.viewerAvg ?? 0) > 0),
      ),
      hasChatMinutes: rollups.some(
        row => !row.missing && ((row.chatCount ?? 0) > 0 || (row.totalEmoteCount ?? 0) > 0),
      ),
      coveragePct: summaryQuery.data?.metrics?.data_coverage_pct ?? detail.chatCoveragePct,
      syncHealthState: summaryQuery.data?.metrics?.sync_health_state,
    }
  }, [detail, isHistoricalRoute, summaryQuery.data?.metrics])

  const handlePreviewRecapOffset = useCallback(
    (offsetSeconds: number | null) => {
      if (offsetSeconds == null) {
        setPreviewRollup(null)
        setPreviewOffsetSeconds(null)
        return
      }
      const rollups = detail?.momentRollups?.length
        ? detail.momentRollups
        : detail?.rollups ?? []
      if (!rollups.length) return
      const nearest = findNearestRollupByOffset(rollups, detail?.stream?.startedAt, offsetSeconds)
      if (nearest) {
        setPreviewRollup(nearest)
        setPreviewOffsetSeconds(offsetSeconds)
      }
    },
    [detail?.momentRollups, detail?.rollups, detail?.stream?.startedAt],
  )

  const handlePreviewReactionMoment = useCallback(
    (moment: {
      offsetSeconds: number
      reactionOnsetOffsetSeconds?: number
      reactionApexOffsetSeconds?: number
      seekOffsetSeconds?: number
      precisionSeconds?: number
    } | null) => {
      handlePreviewRecapOffset(moment ? reactionAnalyticalOffset(moment) : null)
    },
    [handlePreviewRecapOffset],
  )

  const selectedOffsetSeconds = useMemo(() => {
    if (selectedAnchorOffsetSeconds != null) return selectedAnchorOffsetSeconds
    if (!selectedRollup || !detail?.stream?.startedAt) return null
    return rollupOffsetSeconds(selectedRollup, detail.stream.startedAt)
  }, [selectedAnchorOffsetSeconds, selectedRollup, detail?.stream?.startedAt])

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

  // Same resolver the Moments rail card uses, so the chart's jump and the
  // card's "Watch source" can never disagree about the timestamp.
  const selectedVodJump = useMemo(() => {
    if (!selectedRollup) return null
    return resolveMomentVodJump({
      rollup: selectedRollup,
      startedAt: stream?.startedAt,
      recapMoment: matchedRecapMoment,
      vodLinkState,
      vodAlignSeconds: detail?.vodAlignSeconds,
      vodDurationSeconds: detail?.vodDurationSeconds,
    })
  }, [
    detail?.vodAlignSeconds,
    detail?.vodDurationSeconds,
    matchedRecapMoment,
    selectedRollup,
    stream?.startedAt,
    vodLinkState,
  ])

  const syncLabel = useMemo(() => {
    const rollups = detail?.rollups ?? []
    const hasChat = rollups.some((row) => (row.chatCount ?? 0) > 0 || (row.totalEmoteCount ?? 0) > 0)
    const hasViewers = rollups.some((row) => (row.viewerSamples ?? 0) > 0 || (row.viewerAvg ?? 0) > 0)
    return syncCtaLabel({ syncing, hasChatRollups: hasChat, hasViewerSamples: hasViewers })
  }, [detail?.rollups, syncing])

  const qualityDiagnosis = useMemo(
    () =>
      diagnoseStreamQuality({
        detail,
        summaryMetrics: summaryQuery.data?.metrics,
        analyticsQuality: summaryQuery.data?.analyticsQuality ?? detail?.analyticsQuality,
        isLive: isActiveLiveCollector,
        syncing: syncing || detail?.state === 'syncing',
      }),
    [detail, summaryQuery.data, isActiveLiveCollector, syncing],
  )

  const activeSyncStatus = liveSyncStatus ?? syncQuery.data ?? null

  if (!channelLogin) {
    return (
      <section className="analytics-console" aria-label="Streamclone analytics console">
        <p className="muted">Missing channel login.</p>
      </section>
    )
  }

  const headerTitle = unresolvedSessionAlias
    ? `Session date ${streamId} outside loaded results`
    : sessionNotFound
    ? `Session ${streamId} not found`
    : sessionLoadFailed
      ? `Unable to load ${channelLogin} session`
    : displayStreamTitle(stream, channelLogin, [
    // When the detail title is a "Syncing..." placeholder, fall back to the real
    // broadcast title from the live frame / matched sidebar record before the
    // date slug, so a resolved date route shows the actual stream title.
    liveQuery.data?.stream?.title,
    matchedStream?.title,
    streamsQuery.data?.items?.[0]?.title,
    `${channelLogin} / ${getLocalDateString(stream?.startedAt) || 'session'}`,
      ])
  const consoleGridClassName = chartFocused
    ? 'grid grid-cols-1 gap-4'
    : streamsVisible
      ? 'grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)_340px] 2xl:grid-cols-[260px_minmax(0,1fr)_380px]'
      : 'grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]'
  const centerColumnClassName = chartFocused
    ? 'order-1 min-w-0'
    : 'order-1 min-w-0 xl:order-2'
  const streamColumnClassName = chartFocused
    ? 'order-2 min-w-0 w-full'
    : 'order-3 min-w-0 w-full xl:order-1 xl:w-auto'
  const rightColumnClassName = chartFocused
    ? 'order-3 w-full min-w-0 space-y-3'
    : 'order-2 flex w-full min-w-0 flex-col gap-3 xl:order-3 xl:w-auto'
  const StreamColumn = chartFocused ? 'details' : 'aside'
  const RightColumn = chartFocused ? 'details' : 'aside'

  return (
    <section
      className="analytics-console text-zinc-200"
      aria-label={`Analytics for ${channelLogin}`}
      data-analytics-console-shell
      data-chart-focused={chartFocused ? 'true' : 'false'}
      data-streams-visible={streamsVisible ? 'true' : 'false'}
      data-shell-nested={shellNested ? 'true' : 'false'}
    >
      <div className="flex w-full flex-col gap-4">
        <header data-session-header className="flex flex-col gap-3 border-b border-white/[0.07] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div data-session-header-badges className="flex flex-wrap items-center gap-2 text-xs font-black uppercase text-zinc-500">
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
                {sessionLoadFailed
                  ? 'unavailable'
                  : streamStateLabel(
                      (sessionNotFound ? 'not found' : headerState) as AnalyticsStreamDetail['state'] | 'not found' | 'loading',
                      isHistoricalRoute,
                    )}
              </span>
              {mode === 'public' ? (
                <DataQualityDisclosure detail={detail} summaryMetrics={summaryQuery.data?.metrics} />
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
              {stream?.startedAt ? <span><RelativeTimeText prefix="Started" value={stream.startedAt} /></span> : null}
              <span>
                {lastRefreshedAt
                  ? <RelativeTimeText prefix="Refreshed" value={lastRefreshedAt} />
                  : <RelativeTimeText prefix="Updated" value={detail?.updatedAt || undefined} />}
              </span>
            </div>
          </div>
          <div data-session-header-actions className="flex shrink-0 flex-wrap items-center gap-2">
            {enableLayoutControls ? (
              <>
                <button
                  type="button"
                  aria-expanded={streamsVisible}
                  aria-controls="analytics-console-streams"
                  onClick={() => setStreamsVisible(value => !value)}
                  className="min-h-11 rounded border border-white/15 bg-white/[0.05] px-3 py-2 text-xs font-black uppercase text-zinc-200 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  {streamsVisible ? 'Hide streams' : 'Show streams'}
                </button>
                <button
                  type="button"
                  aria-pressed={chartFocused}
                  onClick={() => setChartFocused(value => !value)}
                  className="min-h-11 rounded border border-violet-400/40 bg-violet-500/10 px-3 py-2 text-xs font-black uppercase text-violet-100 transition hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  {chartFocused ? 'Exit chart focus' : 'Focus chart'}
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              className="min-h-11 rounded border border-white/15 bg-white/[0.05] px-3 py-2 text-xs font-black uppercase text-zinc-200 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50"
              title="Reload chart and stats from server (does not start a sync job)"
            >
              {refreshing ? 'Refreshing…' : 'Refresh data'}
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          <StatCard
            label={isHistoricalRoute ? 'Last measured viewers' : 'Current viewers'}
            value={effectiveSessionNotFound ? '-' : statCardClasses.current.placeholder ?? count(headerStats.current)}
            tone={statCardClasses.current.muted ? STAT_PLACEHOLDER_MUTED_CLASS : 'text-cyan-300/90'}
          />
          <StatCard
            label="Average viewers"
            value={effectiveSessionNotFound ? '-' : statCardClasses.average.placeholder ?? count(headerStats.avg)}
            tone={statCardClasses.average.muted ? STAT_PLACEHOLDER_MUTED_CLASS : undefined}
          />
          <StatCard
            label="Peak viewers"
            value={effectiveSessionNotFound ? '-' : statCardClasses.peak.placeholder ?? count(headerStats.peak)}
            tone={statCardClasses.peak.muted ? STAT_PLACEHOLDER_MUTED_CLASS : undefined}
          />
          <StatCard
            label="Measured chat"
            value={effectiveSessionNotFound ? '-' : statCardClasses.chat.placeholder ?? count(headerStats.chat)}
            tone={statCardClasses.chat.muted ? STAT_PLACEHOLDER_MUTED_CLASS : 'text-violet-300/90'}
          />
          <StatCard
            label="Measured emote uses"
            value={effectiveSessionNotFound ? '-' : statCardClasses.emoteUses.placeholder ?? count(headerStats.emotes)}
            tone={statCardClasses.emoteUses.muted ? STAT_PLACEHOLDER_MUTED_CLASS : 'text-emerald-300/90'}
          />
          <StatCard
            label="Measured span"
            value={effectiveSessionNotFound ? '-' : durationFromDetail(detail)}
          />
        </section>

        <div className={consoleGridClassName} data-analytics-console-grid>
          <section className={centerColumnClassName} data-analytics-center-column>
            {sessionResolving || (!sessionNotFound && detailQuery.isLoading && !detail) ? (
              <AnalyticsConsoleDataSkeleton />
            ) : null}
            {effectiveSessionNotFound ? (
              <div role="alert" className="rounded border border-amber-500/20 bg-amber-500/[0.06] px-4 py-8 text-center text-sm font-semibold text-amber-100/90">
                {unresolvedSessionAlias ? (
                  <>Date <span className="font-mono">{streamId}</span> was not found in up to 100 recent stored streams. Older broadcasts may exist outside this sample.</>
                ) : sessionNotFound ? (
                  <>Session not found for <span className="font-mono">{streamId}</span>. Pick another stream from the sidebar.</>
                ) : (
                  <>Unable to load session data for <span className="font-mono">{streamId}</span>. Refresh to try again.</>
                )}
              </div>
            ) : null}
            {!sessionResolving && !effectiveSessionNotFound && !(detailQuery.isLoading && !detail) ? (
            <div className="min-w-0 space-y-4">
              <CoverageStartBanner
                offsetSeconds={detail?.coverageStartOffsetSeconds}
                missingRanges={detail?.availability?.missingRanges}
                message={detail?.availability?.coverageMessage}
              />
              <StreamQualityBanner
                diagnosis={qualityDiagnosis}
                syncing={syncing}
                canSync={enableSyncActions}
                onSync={() => void handleSync()}
                onSyncViewers={() => void handleSync({ viewersOnly: true })}
              />
              {syncError ? (
                <p className="text-xs font-semibold text-red-300">{syncError}</p>
              ) : null}
              {syncNotice && !syncError ? (
                <p className="text-xs font-semibold text-violet-200">{syncNotice}</p>
              ) : null}
              {detailQuery.isError && !detail ? (
                <p role="alert" className="text-xs font-semibold text-red-300">
                  Unable to load session data. Refresh to try again.
                </p>
              ) : null}
              <PastBroadcastBanner
                isLiveRoute={isLiveRoute}
                isActiveLiveCollector={isActiveLiveCollector}
                stream={stream}
                syncing={syncing}
                hasChartData={
                  (detail?.rollups ?? []).some(rollupHasMinuteData)
                  || rollupsHaveViewerData(detail?.rollups ?? [])
                }
                vodLinkState={vodLinkState}
                sessionStreamId={targetQueryStreamId}
                channelLogin={channelLogin}
                buildSessionPath={buildSessionPath}
              />
              {showSessionSignalTape ? (
                <SessionSignalTape
                  key={`${channelLogin}:${canonicalStreamId || targetQueryStreamId}`}
                  signals={sessionSignals}
                  selectedMinuteTs={selectedRollup?.minuteTs ?? null}
                  onSelectMinute={handleSignalMinuteSelect}
                />
              ) : null}
              <AnalyticsChart
                key={`analytics-chart:${channelLogin}:${canonicalStreamId || targetQueryStreamId || (isLiveRoute ? 'live' : 'pending')}`}
                detail={detailForRender}
                selectedEmotes={chartEmoteKeys}
                onSelectEmote={toggleSelected}
                onClearEmotePlots={clearEmotePlots}
                onResetEmotePlots={resetEmotePlots}
                selectedRollup={selectedRollup}
                previewRollup={previewRollup}
                selectedOffsetSeconds={selectedOffsetSeconds}
                previewOffsetSeconds={previewOffsetSeconds}
                onSelectRollup={handleSelectRollup}
                onSelectOffset={handleSelectOffset}
                onSelectReactionMoment={handleSelectReactionMoment}
                onPreviewReactionMoment={handlePreviewReactionMoment}
                onRefresh={() => void handleRefresh()}
                showRefreshControl={false}
                refreshing={refreshing}
                loading={detailQuery.isLoading && !detail}
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
                heatmapPoints={heatmapPoints}
                reactionMoments={reactionMoments}
                vodJump={selectedVodJump}
                selectedDetail={selectedRollup ? <><SelectedMomentCompactCard
                  recapMoment={matchedRecapMoment}
                  vodAlignSeconds={detail?.vodAlignSeconds}
                  vodDurationSeconds={detail?.vodDurationSeconds}
                  rollup={selectedRollup}
                  rollups={detail?.momentRollups ?? detail?.rollups ?? []}
                  startedAt={stream?.startedAt}
                  vodLinkState={vodLinkState}
                  topEmotesCatalog={detailForRender?.topEmotes}
                  heatmapPoint={matchedHeatmapPoint}
                  gameName={selectedGameName}
                  onClear={() => handleSelectRollup(null)}
                />{canonicalStreamId && selectedOffsetSeconds != null && Number.isFinite(selectedOffsetSeconds) && selectedOffsetSeconds >= 0
                  ? renderSelectedMomentActions?.({ login: channelLogin, streamId: canonicalStreamId, offsetSeconds: selectedOffsetSeconds,
                    at: Date.parse(selectedRollup.minuteTs), chatPerMin: selectedRollup.chatCount,
                    emotesPerMin: selectedRollup.totalEmoteCount, category: selectedGameName || undefined,
                    label: matchedHeatmapPoint?.reason ? momentScoreReasonLabel(matchedHeatmapPoint.reason) : undefined }) : null}</> : null}
              />
              {streamVodId ? (
                <p className="text-xs font-semibold text-zinc-400">
                  VOD {streamVodId} — {hasVerifiedVodAlignment
                    ? 'select a moment for a timestamped jump, or '
                    : 'timestamp alignment is not verified; '}
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
                <p className={`text-xs font-semibold ${vodLinkState.status === 'request_failed' ? 'text-amber-200' : 'text-zinc-400'}`}>
                  {vodLinkState.status === 'request_failed' ? `${vodLinkState.label} · ` : null}
                  {vodLinkState.detail}
                </p>
              ) : null}
            </div>
            ) : null}
          </section>

          {chartFocused || streamsVisible ? (
            <StreamColumn
              id="analytics-console-streams"
              className={streamColumnClassName}
              data-analytics-stream-column
              {...(chartFocused
                ? {
                    open: streamsVisible,
                    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
                      setStreamsVisible(event.currentTarget.open)
                    },
                  }
                : {})}
            >
              {chartFocused ? (
                <summary className="cursor-pointer rounded border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs font-black uppercase text-zinc-300">
                  Streams
                </summary>
              ) : null}
              <div className={chartFocused ? 'mt-3' : undefined}>
                <p className="mb-2 text-xs text-zinc-400">Up to 100 recent stored streams</p>
                <StreamSidebar
                  login={channelLogin}
                  streams={sidebarStreams}
                  activeID={isHistoricalRoute ? streamId : undefined}
                  isLiveView={isLiveRoute}
                  liveState={detail?.stream?.lifecycleState === 'unknown' ? 'unknown' : channelIsLive || isActiveLiveCollector ? 'live' : isLiveRoute ? detail?.state : undefined}
                  liveStreamId={liveActiveStreamId}
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
              </div>
            </StreamColumn>
          ) : null}

          <RightColumn className={rightColumnClassName} data-analytics-right-column>
            {chartFocused ? (
              <summary className="cursor-pointer rounded border border-white/[0.07] bg-white/[0.025] px-4 py-3 text-xs font-black uppercase text-zinc-300">
                Session details
              </summary>
            ) : null}
            <div className={chartFocused ? 'mt-3 space-y-3' : 'contents'}>
            {layer2Enabled && recapForStream ? (
              <StreamRecapPanel
                recap={recapForStream}
                topEmotesCatalog={detailForRender?.topEmotes}
                rollups={detail?.momentRollups ?? detail?.rollups ?? []}
                streamStartedAt={stream?.startedAt}
                vodId={streamVodId}
                vodAlignSeconds={detail?.vodAlignSeconds}
                vodDurationSeconds={detail?.vodDurationSeconds}
                onJumpToOffset={handleJumpToRecapOffset}
                onPreviewOffset={handlePreviewRecapOffset}
              />
            ) : null}
            <div
              className="flex w-full min-h-0 flex-1 flex-col overflow-hidden rounded border border-white/[0.07] bg-white/[0.025]"
              data-session-details-tabs
            >
              <div role="tablist" aria-label="Session details" className="flex shrink-0 border-b border-white/[0.07] text-xs font-black uppercase bg-white/[0.012]">
                {(['moments', 'emotes', 'status'] as const).map((tab, tabIndex, tabs) => (
                  <button
                    key={tab}
                    id={`session-tab-${tab}`}
                    type="button"
                    role="tab"
                    aria-selected={rightPanelTab === tab}
                    aria-controls={`session-panel-${tab}`}
                    tabIndex={rightPanelTab === tab ? 0 : -1}
                    onClick={() => handleRightPanelTab(tab)}
                    onKeyDown={(event) => {
                      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                      event.preventDefault()
                      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
                      const next = tabs[nextIndex]!
                      handleRightPanelTab(next)
                      document.getElementById(`session-tab-${next}`)?.focus()
                    }}
                    className={`min-h-11 flex-1 px-2 py-2 text-center transition border-r border-white/[0.07] last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-300 ${
                      rightPanelTab === tab ? 'bg-white/[0.028] text-zinc-200' : 'text-zinc-500 hover:text-zinc-400'
                    }`}
                  >
                    {tab === 'moments' ? 'Moments' : tab === 'emotes' ? 'Emotes' : 'Status'}
                  </button>
                ))}
              </div>
              <div id={`session-panel-${rightPanelTab}`} role="tabpanel" aria-labelledby={`session-tab-${rightPanelTab}`} tabIndex={0} className="flex min-h-0 flex-1 flex-col p-0">
                {rightPanelTab === 'moments' ? (
                  recapMomentsAvailable && recapForStream ? (
                    <SessionRecapMomentsStrip
                      recap={recapForStream}
                      streamStartedAt={stream?.startedAt}
                      selectedOffsetSeconds={selectedOffsetSeconds}
                      onSelectOffset={handleJumpToRecapOffset}
                      onPreviewOffset={handlePreviewRecapOffset}
                      layout="rightRail"
                      rollups={detail?.momentRollups ?? detail?.rollups ?? []}
                      heatmapPoints={heatmapPoints}
                      topEmotesCatalog={detailForRender?.topEmotes}
                    />
                  ) : (
                    <MomentReviewPanel
                      rollups={detail?.momentRollups ?? detail?.rollups ?? []}
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
                  <SyncStatusPanel detail={detail} syncStatus={activeSyncStatus} />
                ) : rightPanelTab === 'status' ? (
                  <p className="p-4 text-xs font-semibold text-zinc-400">
                    Open a session from the sidebar for sync status and Layer 2 detail.
                  </p>
                ) : null}
              </div>
            </div>
            </div>
          </RightColumn>
        </div>
      </div>
    </section>
  )
}
