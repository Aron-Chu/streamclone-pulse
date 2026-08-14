import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import {
  formatHeatOffset,
  LIVE_HEAT_MIN_COMPLETED_ROLLUPS,
  LIVE_HEAT_SUBTITLE,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import { PeakBrandMark } from './PeakBrandMark.tsx'
import { LiveStatsBand } from './LiveStatsBand.tsx'
import { MostReactedSection, type MomentJumpControl } from './MostReactedSection.tsx'
import { PastVodsSection } from './PastVodsSection.tsx'
import { CoverageCard } from './CoverageCard.tsx'
import { PulseSettingsPanel } from './PulseSettingsPanel.tsx'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { PanelErrorBoundary } from './PanelErrorBoundary.tsx'
import type { ExtensionClip, ExtensionCoverageTierResponse, PulseBackfillJob, PulsePayload, PulseUpdateMessage } from '../shared/messages.ts'
import { openStreamAnalytics } from '../shared/analyticsLinks.ts'
import {
  DEFAULT_BACKEND_URL,
  getAutoUpdateEnabled,
  getBackendUrl,
  getOverlayDisplayPreferences,
  getSidebarTab,
  isHostedBackendUrl,
  isLocalStackBackendUrl,
  setAutoUpdateEnabled,
  setSidebarTab,
  type OverlayMode,
  type OverlayPlacement,
  type SidebarTab,
  type PulseCacheWindow,
} from '../shared/storage.ts'
import { buildTwitchVodUrl } from '../shared/pastVods.ts'
import { resolvePulsePanelSections, shouldShowSettingsPanel } from './pulsePanelLayout.ts'
import { AnalyticsHubCta } from './AnalyticsHubCta.tsx'
import { overlayTextLinkButton } from './momentReasonStyles.ts'
import { SettingsGearIcon } from './SettingsGearIcon.tsx'
import { theme } from './theme.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  isTwitchChattersOpen,
  readTwitchCollapseLabel,
  clickTwitchCollapseChat,
  toggleTwitchChatters,
} from '../content/twitchChatControls.ts'
import {
  getPrimaryVideo,
  seekPlaybackOffset,
  detectTwitchChannelLive,
  streamOffsetSecondsForLiveSeek,
  type LiveSeekResult,
  type TwitchPageContext,
} from '../content/twitch.ts'
import {
  discoverLiveJumpDestination,
  discoverLiveVodIdFromDom,
  discoverLiveVodNavigationCandidate,
} from '../content/twitchVodDiscovery.ts'
import { effectivePulseIsLive, pulsePayloadForDisplay } from './effectivePulseLive.ts'
import { isPulseTop500Supported } from './pulseEligibility.ts'
import { PulseLiveUnavailablePanel } from './PulseLiveUnavailablePanel.tsx'
import { PulseNotTrackedPanel } from './PulseNotTrackedPanel.tsx'
import { PulseRosterUnsupportedPanel } from './PulseRosterUnsupportedPanel.tsx'
import { PulseSidebarSkeleton } from './PulseSidebarSkeleton.tsx'
import { coverageTierStatusLabel, resolvePulseLiveAccess } from './resolvePulseLiveAccess.ts'
import { PULSE_STREAM_START_TOLERANCE_SEC } from './coverageStartHint.ts'
import {
  evaluateBackfillRefresh,
  isPulseBackfillTerminal,
  resolvePulseCoverage,
  shouldShowMissedMomentsBanner,
  shouldShowStreamStartAction,
  canShowVodBackfillCTA,
  backendResolvedVod,
} from './missedMoments.ts'
import { initPulseDebug, pulseDebug, summarizeVodDebugBlockers } from '../shared/pulseDebug.ts'
import { resolveMostReactedHeat } from './mostReacted.ts'
import { StreamRecapSection } from './StreamRecapSection.tsx'
import { resolveRecapUiState } from './recapUiState.ts'
import { formatPulseApiError } from './pulseApiErrors.ts'
import { resolveJumpMomentAction } from './jumpMomentAction.ts'
import type { ChartTimelineWindow } from './chatActivityEmotes.ts'
import type { ExtensionVodPulseResponse } from '../types/vodPulseTypes.ts'
import { resolveVodPulseState, vodPulseStateAllowsRetry } from '../vod/normalizeVodPulseFetch.ts'
import { rememberVodAnalyticsBridge } from '../shared/vodAnalyticsBridge.ts'
import { PulseStatusPill, type PulseStatusKind } from './PulseStatusPill.tsx'
import { PulseSidebarTabs } from './PulseSidebarTabs.tsx'
import { exactLiveArchiveVodId } from '../shared/twitchVodGql.ts'
import {
  confirmJumpSeek,
  type JumpSeekConfirmation,
} from './confirmJumpSeek.ts'

function coverageErrorMessage(raw: string | null | undefined, fallback: string): string {
  return formatPulseApiError(raw) ?? fallback
}

const VOD_STATUS_POLL_INTERVAL_MS = 45_000
const HOSTED_POST_STREAM_VOD_POLL_MS = 30 * 60_000
const VOD_PAGE_RETRY_WINDOW_MS = 30 * 60_000
const VOD_DISCOVERY_FAILURE_BACKOFF_MS = 30_000

function jumpVideoSnapshot(video: HTMLVideoElement | null): Record<string, unknown> {
  if (!video) return { video: false }
  // Twitch's MSE pipeline can replace a TimeRanges object (or one of its
  // ranges) between any two reads. Diagnostics must never turn that race into
  // a failed jump, so read each collection independently and keep whatever
  // entries were available before a volatile read failed.
  const snapshotRanges = (
    readRanges: () => TimeRanges | null | undefined,
  ): Array<{ start: number; end: number }> => {
    const snapshot: Array<{ start: number; end: number }> = []
    let ranges: TimeRanges | null | undefined
    try {
      ranges = readRanges()
    } catch {
      return snapshot
    }
    if (!ranges) return snapshot

    let length = 0
    try {
      length = ranges.length
    } catch {
      return snapshot
    }

    for (let index = 0; index < length; index += 1) {
      try {
        const start = ranges.start(index)
        const end = ranges.end(index)
        if (Number.isFinite(start) && Number.isFinite(end)) snapshot.push({ start, end })
      } catch {
        break
      }
    }
    return snapshot
  }

  const seekable = snapshotRanges(() => video.seekable)
  const buffered = snapshotRanges(() => video.buffered)
  return {
    video: true,
    currentTime: Number.isFinite(video.currentTime) ? Math.round(video.currentTime * 10) / 10 : null,
    duration: Number.isFinite(video.duration) ? Math.round(video.duration * 10) / 10 : String(video.duration),
    paused: video.paused,
    readyState: video.readyState,
    networkState: video.networkState,
    seeking: video.seeking,
    connected: video.isConnected,
    seekable,
    buffered,
  }
}

function failedJumpConfirmation(): JumpSeekConfirmation {
  return {
    ok: false,
    reason: 'timeout',
    elapsedMs: 0,
    events: [],
    progressSeconds: 0,
  }
}

interface SeekAndConfirmResult {
  video: HTMLVideoElement | null
  result: LiveSeekResult
  confirmation: JumpSeekConfirmation
}

/**
 * Twitch frequently replaces the media element during quality/ad transitions.
 * Retry a failed confirmation once against the replacement, never in a loop.
 */
async function seekAndConfirm(
  initialVideo: HTMLVideoElement | null,
  seek: (video: HTMLVideoElement | null, commit?: boolean) => LiveSeekResult,
  findVideo: () => HTMLVideoElement | null = getPrimaryVideo,
): Promise<SeekAndConfirmResult> {
  const attempt = async (video: HTMLVideoElement | null): Promise<SeekAndConfirmResult> => {
    const baselineSeconds = video && Number.isFinite(video.currentTime) ? video.currentTime : null
    const wasPaused = video?.paused ?? false
    // Probe without mutating Twitch's player. Confirmation attaches listeners
    // first, then performs the assignment through beforeSeek so early
    // seeking/seeked events cannot be missed.
    const preview = seek(video, false)
    let result = preview
    const seekDistanceSeconds = preview.ok && baselineSeconds != null
      ? Math.abs(preview.targetSeconds - baselineSeconds)
      : 0
    // Older live-DVR points can require Twitch to fetch and remux several HLS
    // segments. Six seconds was causing a valid deep seek to be restored to
    // Live before the player had a fair chance to produce a frame.
    const confirmationTimeoutMs = seekDistanceSeconds > 3_600
      ? 15_000
      : seekDistanceSeconds > 600
        ? 10_000
        : 6_000
    const confirmation = preview.ok
      ? await confirmJumpSeek(video, preview.targetSeconds, {
        baselineSeconds,
        wasPaused,
        timeoutMs: confirmationTimeoutMs,
        stallGraceMs: Math.min(6_000, confirmationTimeoutMs - 1_000),
        isCurrentVideo: () => findVideo() === video,
        beforeSeek: () => {
          result = seek(video, true)
          return result.ok
        },
      })
      : failedJumpConfirmation()
    if (!confirmation.ok && result.ok && video && baselineSeconds != null && video.isConnected !== false) {
      // A failed Twitch MSE seek can leave the page visibly buffering at an
      // unreachable timestamp. Restore the known-good position before the
      // caller renders a retry/archive notice; never restore a replacement
      // element or a preflight that did not mutate the player.
      try {
        video.currentTime = baselineSeconds
      } catch {
        // The element may have been detached between confirmation and cleanup.
      }
    }
    return { video, result, confirmation }
  }

  const first = await attempt(initialVideo)
  if (first.confirmation.reason !== 'video_replaced') return first
  const replacement = findVideo()
  if (!replacement || replacement === initialVideo) return first
  return await attempt(replacement)
}

interface OverlayProps {
  login: string
  context: TwitchPageContext
  payload: PulsePayload | null
  error?: string
  pendingTrackPrompt?: boolean
  onTrackStarted?: () => void
  sessionOpenedAtMs?: number | null
  coverageTier?: ExtensionCoverageTierResponse | null
  effectivePlacement?: OverlayPlacement
  sidebarSnapped?: boolean
  sidebarPart?: 'tabs' | 'body' | 'full'
  panelHostWidth?: number
  pageIsLive?: boolean
  /** When sidebar snap splits tabs + body hosts, mount owns tab/mode truth. */
  sidebarTab?: SidebarTab
  overlayMode?: OverlayMode
  onSidebarTabChange?: (tab: SidebarTab) => void
  onOverlayModeChange?: (mode: OverlayMode) => void
  onPulseRefresh?: () => Promise<void>
  onPulsePayloadUpdate?: (message: PulseUpdateMessage) => void
  onLivePollWindowChange?: (window: PulseCacheWindow) => void
  vodPulse?: ExtensionVodPulseResponse | null
  vodPulseLoading?: boolean
}

type NoticeKind = 'ok' | 'warn' | 'info'

export function Overlay({
  login,
  context,
  payload,
  error,
  pendingTrackPrompt = false,
  onTrackStarted,
  sessionOpenedAtMs = null,
  coverageTier: coverageTierProp = null,
  effectivePlacement,
  sidebarSnapped = false,
  sidebarPart = 'full',
  panelHostWidth,
  pageIsLive = false,
  sidebarTab: sidebarTabProp,
  overlayMode: _overlayModeProp,
  onSidebarTabChange,
  onOverlayModeChange,
  onPulseRefresh,
  onPulsePayloadUpdate,
  onLivePollWindowChange,
  vodPulse = null,
  vodPulseLoading = false,
}: OverlayProps) {
  const [placement, setPlacementState] = useState<OverlayPlacement>('right')
  const [sidebarTab, setSidebarTabState] = useState<SidebarTab>('pulse')
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [notice, setNotice] = useState<{
    kind: NoticeKind
    text: string
    action?: { label: string; href: string }
  } | null>(null)
  const [trackBusy, setTrackBusy] = useState(false)
  const [awaitingTrack, setAwaitingTrack] = useState(pendingTrackPrompt)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [topClip, setTopClip] = useState<ExtensionClip | null>(null)
  const [fullTimeline, setFullTimeline] = useState(false)
  const [missedBusy, setMissedBusy] = useState(false)
  const [missedRefreshed, setMissedRefreshed] = useState(false)
  const [missedJob, setMissedJob] = useState<PulseBackfillJob | null>(null)
  const [coverageLastCheck, setCoverageLastCheck] = useState<number | null>(null)
  const [coverageCheckError, setCoverageCheckError] = useState<string | null>(null)
  const [vodDebugDetail, setVodDebugDetail] = useState<string | null>(null)
  const [locallyValidatedVod, setLocallyValidatedVod] = useState<{ streamId: string; vodId: string } | null>(null)
  /** Current-live VOD id from Past Streams (Helix/history) — navigation when page GQL is blocked. */
  const [pastStreamsLiveVodId, setPastStreamsLiveVodId] = useState<string | null>(null)
  const pastStreamsLiveVodIdRef = useRef<string | null>(null)
  const [panelView, setPanelView] = useState<'pulse' | 'settings'>('pulse')
  const [chartPinOffset, setChartPinOffset] = useState<number | null>(null)
  const [mostReactedPinOffset, setMostReactedPinOffset] = useState<number | null>(null)
  const [chartPreviewOffset, setChartPreviewOffset] = useState<number | null>(null)
  const [alwaysTrackedLogins, setAlwaysTrackedLogins] = useState<string[]>([])
  const [coverageTierState, setCoverageTierState] = useState<ExtensionCoverageTierResponse | null>(
    coverageTierProp,
  )
  const hostedVodPollDeadlineRef = useRef<{ streamId: string; untilMs: number } | null>(null)
  const vodPagePollDeadlineRef = useRef<{ vodId: string; untilMs: number } | null>(null)
  const vodHintAuthBlockedRef = useRef<string | null>(null)
  const vodDiscoveryBackoffRef = useRef<{ streamId: string; untilMs: number } | null>(null)
  const locallyValidatedVodRef = useRef<{ streamId: string; vodId: string } | null>(null)
  const jumpBusyRef = useRef(false)
  /** Once-per-streamId Past Streams fetch for waiting_for_vod honesty (not jump-only). */
  const pastStreamsNavFetchStreamIdRef = useRef<string | null>(null)

  useEffect(() => {
    setCoverageTierState(coverageTierProp)
  }, [coverageTierProp, login])

  // Recurring live poll always stays on window=recent. Explicit full-timeline
  // actions (requestFullTimeline) are one-shot fetches; do not flip the poll window.
  useEffect(() => {
    onLivePollWindowChange?.('recent')
  }, [onLivePollWindowChange])

  const prevStreamIdRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const streamId = payload?.streamId
    if (prevStreamIdRef.current !== undefined && prevStreamIdRef.current !== streamId) {
      setFullTimeline(false)
      locallyValidatedVodRef.current = null
      setLocallyValidatedVod(null)
      pastStreamsLiveVodIdRef.current = null
      setPastStreamsLiveVodId(null)
      pastStreamsNavFetchStreamIdRef.current = null
      vodHintAuthBlockedRef.current = null
      vodDiscoveryBackoffRef.current = null
    }
    prevStreamIdRef.current = streamId
  }, [payload?.streamId])

  function applyPulseResponse(
    response: PulseUpdateMessage | { type?: string; payload?: PulsePayload | null },
  ): PulsePayload | null {
    if (response.type !== 'PULSE_UPDATE') return null
    const message = response as PulseUpdateMessage
    if (message.payload) {
      onPulsePayloadUpdate?.(message)
      return message.payload
    }
    return null
  }

  function handleChartWindowChange(window: ChartTimelineWindow): void {
    if (window !== 'full') {
      setFullTimeline(false)
    }
  }

  const handleMostReactedPin = useCallback((offsetSeconds: number | null) => {
    setMostReactedPinOffset(offsetSeconds)
    if (offsetSeconds != null) {
      setChartPinOffset(offsetSeconds)
      setChartPreviewOffset(null)
    }
  }, [])

  const handleChartPin = useCallback((offsetSeconds: number | null) => {
    setChartPinOffset(offsetSeconds)
    if (offsetSeconds != null) {
      setMostReactedPinOffset(offsetSeconds)
      setChartPreviewOffset(null)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void sendBackgroundMessage({ type: 'GET_ALWAYS_TRACKED' }).then(response => {
      if (!mounted) return
      if ('channels' in response && Array.isArray(response.channels)) {
        setAlwaysTrackedLogins(response.channels)
      }
    })
    return () => {
      mounted = false
    }
  }, [login, payload?.streamId])

  useEffect(() => {
    void initPulseDebug()
  }, [])

  useEffect(() => {
    setAwaitingTrack(pendingTrackPrompt && !payload?.tracking)
  }, [pendingTrackPrompt, payload?.tracking])

  useEffect(() => {
    let mounted = true
    void (async () => {
      const [storedDisplay, storedBackend, storedSidebarTab, storedAutoUpdate] = await Promise.all([
        getOverlayDisplayPreferences(),
        getBackendUrl(),
        getSidebarTab(),
        getAutoUpdateEnabled(),
      ])
      if (!mounted) return
      setPlacementState(storedDisplay.placement)
      setBackendUrlState(storedBackend)
      setSidebarTabState(storedSidebarTab)
      setAutoUpdate(storedAutoUpdate)
      onSidebarTabChange?.(storedSidebarTab)
      onOverlayModeChange?.('expanded')
    })()
    const storageHandler = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'sync') return
      void getOverlayDisplayPreferences().then(display => {
        setPlacementState(display.placement)
        onOverlayModeChange?.('expanded')
      })
      void getSidebarTab().then(tab => {
        setSidebarTabState(tab)
        onSidebarTabChange?.(tab)
      })
      void getBackendUrl().then(setBackendUrlState)
      if (changes.autoUpdateEnabled) {
        void getAutoUpdateEnabled().then(setAutoUpdate)
      }
    }
    chrome.storage.onChanged.addListener(storageHandler)
    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(storageHandler)
    }
  }, [])

  useEffect(() => {
    if (!payload) return
    void loadTopClip()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when stream/vod context changes
  }, [payload?.login, payload?.streamId, payload?.vodId, payload?.startedAt, payload?.isLive])

  const rememberPastStreamsLiveVodId = useCallback((videoId: string | null) => {
    const next = videoId?.trim() || null
    pastStreamsLiveVodIdRef.current = next
    setPastStreamsLiveVodId(next)
  }, [])

  async function fetchPastStreamsLiveVodId(): Promise<string | null> {
    const streamId = payload?.streamId?.trim()
    if (!login || !streamId) return pastStreamsLiveVodIdRef.current
    try {
      const pastRes = await sendBackgroundMessage({
        type: 'LIST_PAST_VODS',
        login,
        liveStreamId: streamId,
        isLive: true,
      })
      if (!('type' in pastRes) || pastRes.type !== 'PAST_VODS') return pastStreamsLiveVodIdRef.current
      const liveRow = pastRes.items.find(
        row =>
          Boolean(row.videoId?.trim())
          && (row.analyticsStatus === 'current-live' || row.streamId === streamId),
      )
      const videoId = liveRow?.videoId?.trim() || null
      if (videoId) rememberPastStreamsLiveVodId(videoId)
      return videoId ?? pastStreamsLiveVodIdRef.current
    } catch {
      return pastStreamsLiveVodIdRef.current
    }
  }

  useEffect(() => {
    setFullTimeline(false)
    setMissedBusy(false)
    setMissedRefreshed(false)
    setMissedJob(null)
    setCoverageCheckError(null)
    setPanelView('pulse')
    setChartPinOffset(null)
    setMostReactedPinOffset(null)
    setChartPreviewOffset(null)
  }, [payload?.streamId, payload?.login])

  const displayPayload = payload ? pulsePayloadForDisplay(payload, pageIsLive, context) : null
  const uiIsLive = effectivePulseIsLive(payload, pageIsLive, context)
  const pulseSupported = isPulseTop500Supported(payload)
  const hostedBackend = isHostedBackendUrl(backendUrl)
  const localStackBackend = isLocalStackBackendUrl(backendUrl)
  const pulseLiveAccess = resolvePulseLiveAccess({
    payload,
    coverageTier: coverageTierState,
    alwaysTrackedLogins,
    sessionOpenedAtMs,
    pageIsLive,
    hosted: hostedBackend,
  })
  const mostReactedHeat = displayPayload ? resolveMostReactedHeat(displayPayload) : null
  const warming = Boolean(uiIsLive && mostReactedHeat && !mostReactedHeat.visible)
  const panelSections = payload
    ? resolvePulsePanelSections(payload, {
        liveHeatVisible: Boolean(mostReactedHeat?.visible),
        warming,
        pageIsLive,
        pulseLiveAccess: pulseLiveAccess.state,
      })
    : null
  const recapCoverageTier = coverageTierState
  const recapUiState = payload
    ? resolveRecapUiState({
        isLive: uiIsLive,
        tracking: payload.tracking,
        streamId: payload.streamId,
        recap: payload.recap,
        pollError: error ?? null,
        payload,
        coverage: recapCoverageTier,
      })
    : null
  const coverageStart = pulseLiveAccess.coverageStartOffsetSeconds
  const resolvedPlacement = effectivePlacement ?? placement
  const resolvedMode: OverlayMode = 'expanded'
  const resolvedSidebarTab = sidebarTabProp ?? sidebarTab
  const showSidebarTabs = sidebarSnapped && resolvedPlacement === 'sidebar' && sidebarPart !== 'body'
  const sidebarBodyOnly = sidebarPart === 'body'
  const sidebarTabsOnly = sidebarPart === 'tabs'
  const isVodPage = context.kind === 'vod'
  const hasLivePanel = Boolean(
    !error && payload && pulseSupported && pulseLiveAccess.state === 'full_live',
  )
  const hasRecapPanel = Boolean(
    !error && payload && pulseSupported && panelSections?.showRecap,
  )
  const showHostedOfflineFallback = Boolean(
    !isVodPage
    && sidebarBodyOnly
    && !uiIsLive
    && hostedBackend
    && payload
    && !error
    && pulseSupported
    && !hasLivePanel
    && !hasRecapPanel,
  )
  const sidebarChatOnly = showSidebarTabs && resolvedSidebarTab === 'chat'
  /** Narrow chat column — compact metrics/padding by host width, not viewport. */
  const metricsCompact = sidebarSnapped && (panelHostWidth ?? 0) > 0 && (panelHostWidth ?? 0) < 480
  const contentSessionKey = isVodPage
    ? `vod:${context.vodId ?? payload?.vodId ?? 'pending'}`
    : uiIsLive
      ? `live:${payload?.streamId ?? 'pending'}`
      : 'offline'
  const routeContentKey = `${login}:${contentSessionKey}`
  const shellClass = [
    'pulse-shell',
    `placement-${resolvedPlacement}`,
    `mode-${resolvedMode}`,
    resolvedPlacement === 'hidden' ? 'pulse-hidden' : '',
    sidebarChatOnly ? 'sidebar-chat-only' : '',
    sidebarBodyOnly ? 'pulse-sidebar-panel' : '',
  ].filter(Boolean).join(' ')

  async function persistAutoUpdate(next: boolean): Promise<void> {
    setAutoUpdate(next)
    await setAutoUpdateEnabled(next)
    await sendBackgroundMessage({ type: 'SET_AUTO_UPDATE', enabled: next })
  }

  async function persistSidebarTab(next: SidebarTab): Promise<void> {
    setSidebarTabState(next)
    await setSidebarTab(next)
    onSidebarTabChange?.(next)
  }

  async function startTracking(): Promise<void> {
    if (!isPulseTop500Supported(payload)) {
      setNotice({
        kind: 'info',
        text: 'StreamPulse live chat is only available for channels on the actively tracked roster.',
      })
      return
    }
    setTrackBusy(true)
    setNotice(null)
    try {
      const response = await sendBackgroundMessage({ type: 'TRACK', login })
      if ('payload' in response) {
        setAwaitingTrack(false)
        onTrackStarted?.()
      }
      if ('error' in response && response.error) {
        setNotice({ kind: 'warn', text: String(response.error) })
      }
    } catch (err) {
      setNotice({ kind: 'warn', text: err instanceof Error ? err.message : 'Could not start tracking.' })
    } finally {
      setTrackBusy(false)
    }
  }

  async function refreshPulse(full = false): Promise<PulsePayload | null> {
    if (context.kind === 'vod' && context.vodId) {
      setTrackBusy(true)
      try {
        await onPulseRefresh?.()
        return payload
      } finally {
        setTrackBusy(false)
      }
    }

    setTrackBusy(true)
    try {
      const response = await sendBackgroundMessage({
        type: 'GET_PULSE',
        login,
        watch: false,
        window: full ? 'full' : 'recent',
        streamId: payload?.streamId,
      })
      if (full) {
        applyPulseResponse(response as PulseUpdateMessage)
        setFullTimeline(true)
      }
      if ('type' in response && response.type === 'PULSE_UPDATE') {
        return response.payload
      }
      return null
    } finally {
      setTrackBusy(false)
    }
  }

  function applyBackfillRefreshOutcome(
    before: PulsePayload | null | undefined,
    after: PulsePayload | null | undefined,
  ): void {
    const outcome = evaluateBackfillRefresh(before, after)
    setFullTimeline(true)
    if (outcome === 'full') {
      setMissedRefreshed(true)
      setNotice({ kind: 'ok', text: 'Moments refreshed with earlier stream coverage.' })
      return
    }
    if (outcome === 'partial') {
      setMissedRefreshed(false)
      const missing = after?.coverage?.missingRanges?.[0]
      const label = missing
        ? formatHeatOffset(Math.max(0, missing.toOffsetSeconds - missing.fromOffsetSeconds))
        : 'part of the stream'
      setNotice({
        kind: 'info',
        text: `Loaded some earlier chat — still missing about ${label}. Try again after more VOD chat publishes.`,
      })
      return
    }
    setMissedRefreshed(false)
    setNotice({
      kind: 'warn',
      text: 'Backfill finished but Twitch VOD chat still does not include the missing stream start.',
    })
  }

  async function loadMissedMoments(): Promise<void> {
    if (!payload?.streamId) {
      setNotice({ kind: 'warn', text: 'Stream ID missing — track this channel and retry.' })
      return
    }
    const coverage = resolvePulseCoverage(payload)
    if (!coverage) {
      setNotice({ kind: 'warn', text: 'No coverage info yet — wait for the first minute of rollups.' })
      return
    }
    const pageHint = payload.vodId ? null : await submitPageVodHint()
    const activePayload = pageHint && !payload.vodId ? { ...payload, vodId: pageHint } : payload
    if (!canShowVodBackfillCTA(activePayload, pageHint)) {
      setNotice({
        kind: 'info',
        text: 'Twitch VOD not ready yet — live IRC tracking continues. Try again after the archive publishes.',
      })
      return
    }
    await loadMissedMomentsWithPayload(activePayload, pageHint)
  }

  async function pollMissedBackfill(jobId: string, beforePayload: PulsePayload): Promise<void> {
    const maxAttempts = 120
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 2000 : 7000))
      const response = await sendBackgroundMessage({ type: 'GET_PULSE_BACKFILL_STATUS', jobId })
      if (!('type' in response) || response.type !== 'PULSE_BACKFILL_STATUS' || !response.job) {
        continue
      }
      const job = response.job
      setMissedJob(job)
      if (!isPulseBackfillTerminal(job.status)) {
        continue
      }
      if (job.status === 'done' || job.status === 'already_available') {
        const fresh = await refreshPulse(true)
        applyBackfillRefreshOutcome(beforePayload, fresh ?? payload)
        setCoverageCheckError(null)
        return
      }
      if (job.status === 'waiting_for_vod') {
        setCoverageCheckError(null)
        setNotice({
          kind: 'info',
          text: 'Still waiting for VOD chat — will retry on the next check.',
        })
        return
      }
      setMissedRefreshed(false)
      setNotice({ kind: 'warn', text: job.message || job.error || 'Backfill failed.' })
      return
    }
    setNotice({ kind: 'warn', text: 'Backfill is taking longer than expected — try again shortly.' })
  }

  async function refreshVodDebugDetail(
    activePayload?: PulsePayload | null,
    currentHelixEnabled?: boolean | null,
  ): Promise<void> {
    const source = activePayload ?? payload
    const backendHelixEnabled = typeof currentHelixEnabled === 'boolean'
      ? currentHelixEnabled
      : typeof source?.helixEnabled === 'boolean'
        ? source.helixEnabled
        : undefined
    const summary = await summarizeVodDebugBlockers({
      backendVodResolved: source ? backendResolvedVod(source) : false,
      backendHelixEnabled,
      navigationVodId: pastStreamsLiveVodIdRef.current ?? pastStreamsLiveVodId,
    })
    setVodDebugDetail(summary)
  }

  async function submitPageVodHint(): Promise<string | null> {
    if (!payload?.streamId || payload.vodId) return payload?.vodId ?? null
    const discoveryBackoff = vodDiscoveryBackoffRef.current
    if (discoveryBackoff?.streamId === payload.streamId && discoveryBackoff.untilMs > Date.now()) {
      return null
    }
    const domHint = discoverLiveVodIdFromDom()
    // DOM miss is common on live pages — info only (warn shows up in Chrome Web Store Errors).
    await pulseDebug('vod.discover.dom', domHint ? 'found archive id in page' : 'no archive id in page html', {
      login,
      streamId: payload.streamId,
      id: domHint,
    }, 'info')
    // A DOM/page-script/archive-list ID is only a candidate. It has no proof
    // that it belongs to this exact live stream, so it must never be persisted
    // or used to start backfill. Only the stream.archiveVideo GQL result with
    // an exact stream-id match is trusted for mutation/navigation decisions.
    // Always run the exact stream.archiveVideo query. A stale DOM or
    // videos.archive candidate is diagnostic only and must never suppress the
    // one lookup that can prove this archive belongs to the active stream.
    const gqlRes = await sendBackgroundMessage({ type: 'DISCOVER_LIVE_VOD', login }, { timeoutMs: 12_000 })
    const gql =
      'type' in gqlRes && gqlRes.type === 'DISCOVER_LIVE_VOD'
        ? gqlRes.result
        : { vodId: null, streamId: null, source: null, gqlErrors: ['background_unreachable'] as string[] }
    const exactVodId = exactLiveArchiveVodId(gql, payload.streamId)
    let hint: string | null = exactVodId
    if (exactVodId) {
      // This is the only unauthenticated archive discovery that proves the
      // VOD belongs to this exact live broadcast. The videos.archive list
      // can be an older archive and must not drive navigation by itself.
      locallyValidatedVodRef.current = { streamId: payload.streamId, vodId: exactVodId }
      setLocallyValidatedVod({ streamId: payload.streamId, vodId: exactVodId })
    }
    const gqlBlocked = (gql.gqlErrors?.length ?? 0) > 0
    if (!hint && gqlBlocked) {
      vodDiscoveryBackoffRef.current = {
        streamId: payload.streamId,
        untilMs: Date.now() + VOD_DISCOVERY_FAILURE_BACKOFF_MS,
      }
    } else if (hint) {
      vodDiscoveryBackoffRef.current = null
    }
    await pulseDebug(
      'vod.discover.gql',
      hint
        ? 'found exact archive id via Twitch GQL (stream.archiveVideo)'
        : gql.vodId
          ? `found unverified archive candidate via Twitch GQL (${gql.source ?? 'unknown'}); not used`
          : 'GQL returned no archive id',
      {
        login,
        id: gql.vodId,
        source: gql.source,
        streamId: gql.streamId,
        pulseStreamId: payload.streamId,
        domCandidate: domHint,
        gqlErrors: gql.gqlErrors,
      },
      hint ? 'info' : gqlBlocked ? 'warn' : 'info',
    )
    if (!hint) {
      await refreshVodDebugDetail()
      return null
    }
    const authBlockKey = `${payload.streamId}:${hint}`
    if (vodHintAuthBlockedRef.current === authBlockKey) {
      // The hosted API intentionally protects this write. Avoid posting the
      // same unauthenticated hint on every coverage refresh/render; the local
      // Twitch VOD id remains available to navigation/backfill decisions.
      await refreshVodDebugDetail()
      return hint
    }
    try {
      const res = await sendBackgroundMessage({
        type: 'HINT_VOD',
        login,
        streamId: payload.streamId,
        vodId: hint,
      }, { timeoutMs: 8_000 })
      if ('ok' in res && res.ok) {
        await refreshPulse(false)
      } else if ('ok' in res && !res.ok && 'error' in res && res.error === 'vod_hint_auth_required') {
        vodHintAuthBlockedRef.current = authBlockKey
      }
    } catch {
      await pulseDebug('vod.hint.api', 'vod-hint endpoint failed — backfill will still send vodId in POST body', {
        login,
        streamId: payload.streamId,
        vodId: hint,
      }, 'warn')
    }
    await refreshVodDebugDetail()
    return hint
  }

  async function refreshVodStatus(): Promise<void> {
    if (!payload?.streamId || missedBusy) return
    setMissedBusy(true)
    setCoverageCheckError(null)
    try {
      const pastVodId = await fetchPastStreamsLiveVodId()
      await submitPageVodHint()
      const healthRes = await sendBackgroundMessage({ type: 'HEALTH' }).catch(() => null)
      let currentHelixEnabled: boolean | null | undefined
      if (healthRes && 'type' in healthRes && healthRes.type === 'HEALTH') {
        const helix = healthRes.helixEnabled
        currentHelixEnabled = helix
        const helixMessage =
          helix === true
            ? 'Helix enabled on backend'
            : helix === false
              ? 'Helix disabled on backend'
              : 'Helix unknown — backend analytics needs redeploy'
        await pulseDebug('vod.helix.health', helixMessage, {
          helixEnabled: helix ?? null,
          version: healthRes.version ?? null,
        }, helix === true ? 'info' : 'warn')
      }
      const fresh = await refreshPulse(false)
      setCoverageLastCheck(Date.now())
      const next = fresh ?? payload
      const coverage = resolvePulseCoverage(next)
      const navigationVodId = pastVodId ?? pastStreamsLiveVodIdRef.current
      await pulseDebug('ui.coverage', 'vod check finished', {
        login,
        streamId: next.streamId ?? null,
        vodId: next.vodId ?? null,
        navigationVodId: navigationVodId ?? null,
        resolvedState: coverage?.state ?? null,
        canBackfill: coverage?.canBackfill ?? null,
      })
      if (coverage?.state === 'backfill_running') {
        setNotice({ kind: 'info', text: 'VOD backfill already running…' })
        return
      }
      if (canShowVodBackfillCTA(next)) {
        setCoverageCheckError(null)
        setNotice({
          kind: 'info',
          text: 'Twitch VOD linked — tap Fill from Twitch VOD when you want to load missing chat.',
        })
        await refreshVodDebugDetail(next, currentHelixEnabled)
        return
      }
      if (next.helixEnabled === false) {
        setCoverageCheckError(
          'Backend Helix is off — analytics needs TWITCH_OAUTH_CLIENT_ID/SECRET (or redeploy latest analytics).',
        )
        await refreshVodDebugDetail(next, currentHelixEnabled)
        return
      }
      if (navigationVodId && !next.vodId) {
        setCoverageCheckError(null)
        setNotice({
          kind: 'info',
          text: 'Current-broadcast VOD is available for Jump — Pulse has not linked it for chat backfill yet.',
        })
      } else if (!next.vodId && healthRes && 'type' in healthRes && healthRes.type === 'HEALTH' && healthRes.helixEnabled == null) {
        setCoverageCheckError(
          'Backend analytics needs redeploy (Helix/vod-hint). Local page GQL may still be blocked by an ad blocker.',
        )
      } else if (!next.vodId) {
        setCoverageCheckError(
          'Twitch has not published a VOD id for this stream yet — try again after a few minutes or when the stream ends.',
        )
      } else {
        setCoverageCheckError(null)
      }
      await refreshVodDebugDetail(next, currentHelixEnabled)
    } catch (err) {
      setCoverageCheckError(coverageErrorMessage(
        err instanceof Error ? err.message : null,
        'Could not check VOD status',
      ))
    } finally {
      setMissedBusy(false)
    }
  }

  async function loadMissedMomentsWithPayload(
    activePayload: PulsePayload,
    explicitHint?: string | null,
  ): Promise<void> {
    const coverage = resolvePulseCoverage(activePayload)
    if (!coverage || !activePayload.streamId) return
    if (!canShowVodBackfillCTA(activePayload, explicitHint)) return
    const beforePayload = activePayload
    setMissedBusy(true)
    setMissedRefreshed(false)
    setFullTimeline(true)
    setNotice({ kind: 'info', text: 'Loading VOD chat from Twitch… this can take a few minutes.' })
    try {
      const range = coverage.missingRanges?.[0]
      const hintedVodId =
        activePayload.vodId
        ?? (await submitPageVodHint())
        ?? undefined
      const response = await sendBackgroundMessage({
        type: 'LOAD_MISSED_MOMENTS',
        login,
        streamId: activePayload.streamId,
        vodId: hintedVodId,
        fromOffsetSeconds: range?.fromOffsetSeconds ?? 0,
        toOffsetSeconds: range?.toOffsetSeconds ?? Math.max(0, coverage.coverageStartOffsetSeconds - 60),
      })
      if ('error' in response && response.error) {
        setCoverageCheckError(coverageErrorMessage(String(response.error), 'Backfill failed.'))
        return
      }
      if (!('type' in response) || response.type !== 'PULSE_BACKFILL' || !response.job) {
         setCoverageCheckError('Could not start backfill — check the backend connection in settings.')
        return
      }
      const job = response.job
      setMissedJob(job)
      if (job.status === 'already_available') {
        const fresh = await refreshPulse(true)
        applyBackfillRefreshOutcome(beforePayload, fresh ?? activePayload)
        return
      }
      if (job.status === 'waiting_for_vod') {
        setNotice({ kind: 'info', text: job.message || 'VOD chat not ready yet.' })
        return
      }
      if (job.status === 'failed') {
        setCoverageCheckError(coverageErrorMessage(job.error ?? job.message, 'Backfill failed.'))
        return
      }
      await pollMissedBackfill(job.jobId, beforePayload)
    } catch (err) {
      setCoverageCheckError(coverageErrorMessage(
        err instanceof Error ? err.message : null,
        'Backfill failed.',
      ))
    } finally {
      setMissedBusy(false)
    }
  }

  useEffect(() => {
    if (!payload) return
    const coverage = resolvePulseCoverage(payload)
    void pulseDebug('ui.coverage', 'pulse payload in overlay', {
      login,
      streamId: payload.streamId ?? null,
      vodId: payload.vodId ?? null,
      tracking: payload.tracking,
      coverageState: coverage?.state ?? null,
      coverageStart: payload.coverageStartOffsetSeconds ?? null,
      helixEnabled: payload.helixEnabled ?? null,
    })
    if (coverage?.state === 'waiting_for_vod') {
      void refreshVodDebugDetail()
    }
  }, [login, payload?.streamId, payload?.vodId, payload?.tracking, payload?.coverageStartOffsetSeconds, payload?.coverage?.state, payload?.helixEnabled])

  const coverageForPoll = payload ? resolvePulseCoverage(payload) : undefined

  // Once per streamId: resolve Past Streams current-live videoId while waiting
  // for Pulse to link, so CoverageCard honesty does not wait on jump/list alone.
  useEffect(() => {
    const streamId = payload?.streamId?.trim()
    if (
      !streamId
      || payload?.vodId
      || coverageForPoll?.state !== 'waiting_for_vod'
      || context.kind === 'vod'
    ) {
      return
    }
    if (pastStreamsNavFetchStreamIdRef.current === streamId) return
    pastStreamsNavFetchStreamIdRef.current = streamId
    void fetchPastStreamsLiveVodId()
  }, [
    payload?.streamId,
    payload?.vodId,
    coverageForPoll?.state,
    context.kind,
  ])

  useEffect(() => {
    if (isVodPage || !payload?.tracking || payload.vodId) {
      if (hostedBackend && payload?.vodId) hostedVodPollDeadlineRef.current = null
      return
    }
    if (!hostedBackend && !uiIsLive) return
    if (coverageCheckError?.includes('at capacity')) return
    if (coverageForPoll?.state !== 'waiting_for_vod' && !coverageForPoll?.canBackfill) return
    if (missedBusy || missedJob?.status === 'fetching_chat') return
    const streamId = payload.streamId

    if (hostedBackend && !uiIsLive) {
      if (!streamId) return
      const current = hostedVodPollDeadlineRef.current
      if (!current || current.streamId !== streamId) {
        hostedVodPollDeadlineRef.current = {
          streamId,
          untilMs: Date.now() + HOSTED_POST_STREAM_VOD_POLL_MS,
        }
      }
    } else if (hostedBackend) {
      hostedVodPollDeadlineRef.current = null
    }

    const postStreamDeadline = hostedBackend && !uiIsLive
      ? hostedVodPollDeadlineRef.current?.untilMs ?? null
      : null
    const timer = window.setInterval(() => {
      if (postStreamDeadline != null && Date.now() >= postStreamDeadline) {
        window.clearInterval(timer)
        return
      }
      void refreshVodStatus()
    }, VOD_STATUS_POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [
    payload?.tracking,
    payload?.streamId,
    payload?.vodId,
    uiIsLive,
    coverageForPoll?.state,
    coverageForPoll?.canBackfill,
    missedBusy,
    missedJob?.status,
    coverageCheckError,
    hostedBackend,
    isVodPage,
  ])

  useEffect(() => {
    const vodId = isVodPage ? context.vodId : undefined
    const shouldRetry = isVodPage && vodPulseStateAllowsRetry(vodPulse, error)
    if (!vodId || !onPulseRefresh || !shouldRetry) {
      vodPagePollDeadlineRef.current = null
      return
    }
    if (vodPulseLoading || trackBusy) return

    const current = vodPagePollDeadlineRef.current
    if (!current || current.vodId !== vodId) {
      vodPagePollDeadlineRef.current = {
        vodId,
        untilMs: Date.now() + VOD_PAGE_RETRY_WINDOW_MS,
      }
    }
    const retryDeadline = vodPagePollDeadlineRef.current?.untilMs ?? null
    const timer = window.setInterval(() => {
      if (retryDeadline != null && Date.now() >= retryDeadline) {
        if (vodPagePollDeadlineRef.current?.vodId === vodId) {
          vodPagePollDeadlineRef.current = null
        }
        window.clearInterval(timer)
        return
      }
      if (vodPulseLoading || trackBusy) return
      void refreshPulse()
    }, VOD_STATUS_POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [
    context.vodId,
    error,
    isVodPage,
    onPulseRefresh,
    trackBusy,
    vodPulse?.coverageStatus,
    vodPulseLoading,
  ])

  function openInlineSettings(): void {
    setPanelView('settings')
  }

  function closeInlineSettings(): void {
    setPanelView('pulse')
  }

  function toggleInlineSettings(): void {
    setPanelView(current => (current === 'settings' ? 'pulse' : 'settings'))
  }

  function openAnalytics(offsetSeconds?: number): void {
    openStreamAnalytics({
      apiBaseUrl: backendUrl,
      channelLogin: login,
      streamId: payload?.streamId,
      offsetSeconds: offsetSeconds ?? 0,
    })
  }

  async function loadTopClip(): Promise<void> {
    const res = await sendBackgroundMessage({
      type: 'GET_CLIP',
      login,
      startedAt: payload?.startedAt,
      isLive: payload?.isLive,
    })
    if ('type' in res && res.type === 'CLIP') {
      setTopClip(res.clip)
    }
  }

  async function loadStreamFromStart(): Promise<void> {
    setFullTimeline(true)
    setNotice(null)
    void requestFullTimeline()
    if (!payload?.vodId) {
      await submitPageVodHint()
    }
    await seekToStreamStart()
  }

  function openVodUrlOrOffer(url: string, successText: string): void {
    const vodIdMatch = url.match(/\/videos\/(\d{6,20})/)
    const vodId = vodIdMatch?.[1] ?? payload?.vodId ?? context.vodId
    if (vodId && login) {
      void rememberVodAnalyticsBridge({
        vodId,
        login,
        streamId: payload?.streamId,
      })
    }
    // Archive discovery often completes after the original click activation
    // has expired. Same-tab navigation is not popup-gated and is therefore
    // the reliable default for a verified archive. Keep the explicit link as
    // a fallback for unusual navigation-policy failures.
    try {
      window.location.assign(url)
      setNotice({ kind: 'info', text: successText })
    } catch {
      setNotice({
        kind: 'warn',
        text: 'Verified VOD found. Use the link to open it.',
        action: { label: 'Open verified VOD', href: url },
      })
    }
  }

  async function seekToStreamStart(): Promise<void> {
    setFullTimeline(true)
    setNotice(null)
    const localVod = locallyValidatedVodRef.current
    const vodId = payload?.vodId
      ?? context.vodId
      ?? (localVod && localVod.streamId === payload?.streamId
        ? localVod.vodId
        : undefined)
    const offset = 0

    if (vodId) {
      const vodUrl = buildTwitchVodUrl(vodId, offset)
      if (context.kind === 'vod' && context.vodId === vodId) {
        const video = getPrimaryVideo()
        const { result, confirmation } = await seekAndConfirm(
          video,
          (currentVideo, commit) => seekPlaybackOffset(currentVideo, offset, { isLive: false, commit }),
        )
        setNotice({
          kind: result.ok && confirmation.ok ? 'ok' : 'warn',
          text: result.ok && confirmation.ok
            ? 'Jumped to stream start in the VOD player.'
            : 'Twitch did not confirm stream start; scrub the VOD player manually.',
        })
        return
      }
      openVodUrlOrOffer(vodUrl, 'Opened Twitch VOD at stream start.')
      return
    }

    if (uiIsLive && context.kind === 'channel') {
      const liveCurrentOffset = streamOffsetSecondsForLiveSeek({
        startedAt: payload?.startedAt,
        payloadOffsetSeconds: payload?.currentOffsetSeconds ?? 0,
      })
      const { result, confirmation } = await seekAndConfirm(
        getPrimaryVideo(),
        (currentVideo, commit) => seekPlaybackOffset(currentVideo, offset, {
          isLive: true,
          liveCurrentOffset: liveCurrentOffset ?? payload?.currentOffsetSeconds ?? 0,
          commit,
        }),
      )
      if (result.ok && confirmation.ok) {
        setNotice({ kind: 'ok', text: 'Jumped to stream start in the live DVR buffer.' })
        return
      }
    }

    setNotice({
      kind: 'info',
      text:
        coverageStart > PULSE_STREAM_START_TOLERANCE_SEC
          ? `Chart expanded from stream start — chat data begins at ${formatHeatOffset(coverageStart)}. Backfill still needs a Twitch VOD link.`
          : 'Chart expanded from stream start.',
    })
  }

  useEffect(() => {
    if (!payload?.tracking || !uiIsLive || payload.vodId) return
    const coverage = resolvePulseCoverage(payload)
    if (coverage?.state !== 'waiting_for_vod' && !coverage?.canBackfill) return
    void submitPageVodHint()
  }, [payload?.tracking, payload?.streamId, payload?.vodId, uiIsLive, payload?.coverageStartOffsetSeconds])

  function openStreamStartToLive(): void {
    void seekToStreamStart()
  }

  function jumpToOffset(offsetSeconds: number): void {
    jumpMoment({
      minuteTs: '',
      offsetSeconds,
      score: 0,
      estimated: false,
      reason: 'manual',
      reasonLabel: 'Chart minute',
      chatCount: 0,
      emoteCount: 0,
      topEmotes: [],
      collecting: false,
    })
  }

  async function requestFullTimeline(): Promise<void> {
    try {
      const response = await sendBackgroundMessage({
        type: 'GET_PULSE',
        login,
        watch: false,
        window: 'full',
        streamId: payload?.streamId,
      })
      applyPulseResponse(response as PulseUpdateMessage)
      setFullTimeline(true)
    } catch (err) {
      setNotice({
        kind: 'warn',
        text: err instanceof Error ? err.message : 'Could not load full stream chart.',
      })
    }
  }

  function openAnalyticsForMoment(point: LiveHeatPoint): void {
    openAnalytics(point.offsetSeconds)
  }

  function currentLiveJumpDestination() {
    return discoverLiveJumpDestination({
      streamId: payload?.streamId,
      locallyValidatedVodId: locallyValidatedVod?.vodId,
      locallyValidatedStreamId: locallyValidatedVod?.streamId,
      pastStreamsVodId: pastStreamsLiveVodIdRef.current ?? pastStreamsLiveVodId,
    })
  }

  function resolveMomentJumpControl(point: LiveHeatPoint): MomentJumpControl {
    if (context.kind === 'vod' || payload?.vodId || context.vodId) {
      return { label: context.kind === 'vod' ? 'Jump in VOD' : 'Open VOD' }
    }
    const destination = currentLiveJumpDestination()
    if (destination) {
      return {
        label: 'Jump in VOD',
        hint: 'Opens Twitch’s current-broadcast VOD at this moment.',
      }
    }
    if (!payload?.isLive) {
      return { label: 'Open analytics', hint: 'Player replay is available after Twitch publishes the VOD.' }
    }
    const video = getPrimaryVideo()
    if (!video) {
      return { label: 'Player unavailable', disabled: true, hint: 'Twitch’s video player is not ready.' }
    }
    const liveCurrentOffset = streamOffsetSecondsForLiveSeek({
      startedAt: payload.startedAt,
      payloadOffsetSeconds: payload.currentOffsetSeconds,
    })
    if (liveCurrentOffset == null) {
      return { label: 'Wait for VOD', disabled: true, hint: 'Stream timing is not ready for a safe live seek.' }
    }
    const preview = seekPlaybackOffset(video, point.offsetSeconds, {
      isLive: true,
      liveCurrentOffset,
      commit: false,
    })
    if (preview.ok) return { label: 'Jump in player' }
    return {
      label: 'Jump in VOD',
      hint: 'This moment is outside Twitch’s usable live-player window; Pulse will open the current-broadcast VOD when Twitch exposes it.',
    }
  }

  async function tryOpenVerifiedArchive(
    offsetSeconds: number,
    jumpStartedAt: number,
  ): Promise<'opened' | 'not_published' | 'route_unavailable' | 'auth_required' | 'identity_mismatch' | 'missing'> {
    if (payload?.streamId) {
      const existingLocalVod = locallyValidatedVodRef.current
      if (existingLocalVod?.streamId === payload.streamId) {
        openVodUrlOrOffer(
          buildTwitchVodUrl(existingLocalVod.vodId, offsetSeconds),
          `Opened the Twitch archive at ${formatHeatOffset(offsetSeconds)} (exact stream match).`,
        )
        return 'opened'
      }
      // Twitch's own watch-from-beginning/archive control is the most direct
      // answer when its raw MediaSource exposes a sentinel seek range. Use the
      // same archive ID for user navigation, with the selected moment appended.
      // This is intentionally navigation-only: it is never persisted as
      // stream identity and never authorizes analytics backfill.
      const pageArchive = discoverLiveVodNavigationCandidate(payload.streamId)
      if (pageArchive) {
        void pulseDebug('ui.jump', 'using Twitch current-broadcast archive navigation', {
          streamId: payload.streamId,
          source: pageArchive.source,
          vodId: pageArchive.vodId,
          elapsedMs: Math.round(performance.now() - jumpStartedAt),
        })
        openVodUrlOrOffer(
          buildTwitchVodUrl(pageArchive.vodId, offsetSeconds),
          `Opened Twitch’s current broadcast replay at ${formatHeatOffset(offsetSeconds)}.`,
        )
        return 'opened'
      }
      // "Check for VOD" must actually perform the exact Twitch stream.archiveVideo
      // lookup. Hosted persistence may return 401, but that does not invalidate
      // the locally proven stream/VOD identity used for navigation.
      const discoveredVodId = await submitPageVodHint().catch(() => null)
      const discoveredLocalVod = locallyValidatedVodRef.current
      if (discoveredVodId && discoveredLocalVod?.streamId === payload.streamId) {
        openVodUrlOrOffer(
          buildTwitchVodUrl(discoveredVodId, offsetSeconds),
          `Opened the Twitch archive at ${formatHeatOffset(offsetSeconds)} (exact stream match).`,
        )
        return 'opened'
      }
      try {
        const archiveResponse = await sendBackgroundMessage({
          type: 'GET_PULSE_ARCHIVE_CANDIDATE',
          streamId: payload.streamId,
          login,
        }, { timeoutMs: 5_000 })
        void pulseDebug('ui.jump', 'archive candidate request completed', {
          streamId: payload.streamId,
          responseType: 'type' in archiveResponse ? archiveResponse.type : null,
          error: 'error' in archiveResponse ? archiveResponse.error ?? null : null,
          timedOut: !('type' in archiveResponse),
          elapsedMs: Math.round(performance.now() - jumpStartedAt),
        })
        if ('type' in archiveResponse && archiveResponse.type === 'PULSE_ARCHIVE_CANDIDATE') {
          const candidate = archiveResponse.candidate
          if (candidate?.navigationValidated && candidate.navigationVodId) {
            openVodUrlOrOffer(
              buildTwitchVodUrl(candidate.navigationVodId, offsetSeconds),
              `Opened the verified archive VOD at ${formatHeatOffset(offsetSeconds)}.`,
            )
            return 'opened'
          }
          if (candidate?.analyticsResolutionState === 'archive_not_published') return 'not_published'
          if (archiveResponse.error === 'archive_candidate_unavailable') return 'route_unavailable'
          if (archiveResponse.error === 'archive_candidate_auth_required') return 'auth_required'
          if (archiveResponse.error === 'pulse_archive_identity_mismatch') return 'identity_mismatch'
        }
      } catch {
        // A locally validated exact GQL stream match can still be used below.
      }
    }
    return 'missing'
  }

  async function jumpMoment(point: LiveHeatPoint): Promise<void> {
    if (jumpBusyRef.current) {
      setNotice({ kind: 'info', text: 'Jump already in progress…' })
      return
    }
    jumpBusyRef.current = true
    const jumpStartedAt = performance.now()
    try {
      const initialVideo = getPrimaryVideo()
      void pulseDebug('ui.jump', 'jump requested', {
        login,
        streamId: payload?.streamId ?? null,
        offsetSeconds: point.offsetSeconds,
        payloadCurrentOffsetSeconds: payload?.currentOffsetSeconds ?? null,
        startedAtPresent: Boolean(payload?.startedAt),
        ...jumpVideoSnapshot(initialVideo),
      })

      // Prefer Twitch's current-broadcast VOD (Past Streams / player control / exact GQL)
      // over live DVR so the CTA matches what the click does.
      let navigationDestination = currentLiveJumpDestination()
      if (
        !navigationDestination
        && payload?.isLive
        && payload.streamId
        && !payload.vodId
        && context.kind !== 'vod'
      ) {
        // Past Streams already resolves the live archive via Helix/history — reuse it
        // when page GQL is blocked (common with ad blockers).
        const pastVodId = await fetchPastStreamsLiveVodId()
        if (pastVodId) {
          navigationDestination = {
            vodId: pastVodId,
            source: 'past_streams_current_live',
          }
        } else {
          await submitPageVodHint().catch(() => null)
          navigationDestination = currentLiveJumpDestination()
        }
      }

      const liveCurrentOffset = streamOffsetSecondsForLiveSeek({
        startedAt: payload?.startedAt,
        payloadOffsetSeconds: payload?.currentOffsetSeconds,
      })
      const navigationVodId = navigationDestination?.vodId
        ?? (payload?.streamId && locallyValidatedVodRef.current?.streamId === payload.streamId
          ? locallyValidatedVodRef.current.vodId
          : null)
      const livePreview = payload?.isLive
        && !payload.vodId
        && !navigationVodId
        && context.kind !== 'vod'
        && liveCurrentOffset != null
        ? seekPlaybackOffset(initialVideo, point.offsetSeconds, {
          isLive: true,
          liveCurrentOffset,
          commit: false,
        })
        : null
      const action = resolveJumpMomentAction({
        context,
        payloadVodId: payload?.vodId ?? context.vodId,
        navigationVodId,
        payloadIsLive: payload?.isLive,
        liveCurrentOffset: liveCurrentOffset ?? payload?.currentOffsetSeconds,
        liveSeekable: livePreview?.ok,
        offsetSeconds: point.offsetSeconds,
      })
      void pulseDebug('ui.jump', 'jump destination resolved', {
        action: action.kind,
        navigationVodId: navigationVodId ?? null,
        navigationSource: navigationDestination?.source ?? null,
        elapsedMs: Math.round(performance.now() - jumpStartedAt),
      })
      setNotice({
        kind: 'info',
        text: action.kind === 'open-vod-tab'
          ? `Opening Twitch VOD at ${formatHeatOffset(point.offsetSeconds)}…`
          : action.kind === 'live-outside-buffer'
            ? `Checking for a VOD at ${formatHeatOffset(point.offsetSeconds)}…`
            : action.kind === 'seek-live-dvr'
              && liveCurrentOffset != null
              && liveCurrentOffset - point.offsetSeconds > 600
              ? `Loading ${formatHeatOffset(point.offsetSeconds)} from Twitch DVR… older points can buffer for up to 15 seconds.`
              : `Jumping to ${formatHeatOffset(point.offsetSeconds)}…`,
      })

    if (action.kind === 'seek-vod') {
      const { result, confirmation, video: confirmedVideo } = await seekAndConfirm(
        initialVideo,
        (video, commit) => seekPlaybackOffset(video, action.offsetSeconds, { isLive: false, commit }),
      )
      const confirmed = result.ok && confirmation.ok
      void pulseDebug('ui.jump', confirmed ? 'vod seek confirmed' : 'vod seek not confirmed', {
        action: action.kind,
        offsetSeconds: action.offsetSeconds,
        result,
        confirmed,
        confirmationReason: confirmation.reason,
        confirmationEvents: confirmation.events,
        progressSeconds: confirmation.progressSeconds,
        elapsedMs: Math.round(performance.now() - jumpStartedAt),
        ...jumpVideoSnapshot(confirmedVideo),
      }, confirmed ? 'info' : 'warn')
      setNotice({
        kind: confirmed ? 'ok' : 'warn',
        text: confirmed
          ? `Jumped to ${formatHeatOffset(action.offsetSeconds)} in the VOD player.`
          : `Scrub the VOD player to ${formatHeatOffset(action.offsetSeconds)}.`,
      })
      return
    }

    if (action.kind === 'open-vod-tab') {
      openVodUrlOrOffer(
        buildTwitchVodUrl(action.vodId, action.offsetSeconds),
        `Opened Twitch’s current-broadcast VOD at ${formatHeatOffset(action.offsetSeconds)}.`,
      )
      return
    }

    if (action.kind === 'open-analytics') {
      openAnalytics(action.offsetSeconds)
      return
    }

    if (action.kind === 'seek-live-dvr') {
      const liveCurrentOffset = streamOffsetSecondsForLiveSeek({
        startedAt: payload?.startedAt,
        payloadOffsetSeconds: action.liveCurrentOffset,
      })
      const { result, confirmation, video: confirmedVideo } = await seekAndConfirm(
        initialVideo,
        (video, commit) => seekPlaybackOffset(video, action.offsetSeconds, {
          isLive: true,
          liveCurrentOffset: liveCurrentOffset ?? action.liveCurrentOffset,
          commit,
        }),
      )
      const confirmed = result.ok && confirmation.ok
      void pulseDebug('ui.jump', confirmed ? 'live DVR seek confirmed' : 'live DVR seek not confirmed', {
        action: action.kind,
        offsetSeconds: action.offsetSeconds,
        liveCurrentOffset: liveCurrentOffset ?? action.liveCurrentOffset,
        result,
        confirmed,
        confirmationReason: confirmation.reason,
        confirmationEvents: confirmation.events,
        progressSeconds: confirmation.progressSeconds,
        elapsedMs: Math.round(performance.now() - jumpStartedAt),
        ...jumpVideoSnapshot(confirmedVideo),
      }, confirmed ? 'info' : 'warn')
      if (confirmed) {
        setNotice({ kind: 'ok', text: `Jumped to ${formatHeatOffset(action.offsetSeconds)} inside the live DVR buffer.` })
        return
      }
      // A failed live seek may still have a verified exact-stream archive.
      const archiveOutcome = await tryOpenVerifiedArchive(action.offsetSeconds, jumpStartedAt)
      if (archiveOutcome === 'opened') return
      if (archiveOutcome === 'not_published') {
        setNotice({ kind: 'info', text: 'Twitch has not published the archive VOD yet; retry shortly.' })
        return
      }
      if (archiveOutcome === 'route_unavailable') {
        setNotice({
          kind: 'warn',
          text: 'This moment is outside Twitch’s live DVR window, and archive lookup is not available on the current StreamPulse backend.',
        })
        return
      }
      if (archiveOutcome === 'auth_required') {
        setNotice({
          kind: 'warn',
          text: 'This moment is outside the live DVR window. Archive lookup needs an authenticated extension session.',
        })
        return
      }
      if (archiveOutcome === 'identity_mismatch') {
        setNotice({
          kind: 'warn',
          text: 'Twitch returned an archive for a different broadcast, so it was not opened.',
        })
        return
      }
      setNotice({
        kind: 'warn',
        text:
          !result.ok && result.reason === 'outside_buffer'
            ? `Replay after VOD: ${formatHeatOffset(action.offsetSeconds)} is outside the live DVR buffer.`
            : result.ok && !confirmed
              ? confirmation.reason === 'video_replaced'
                ? 'Twitch replaced the player while seeking; try the jump again.'
                : confirmation.reason === 'media_error'
                  ? 'Twitch could not load that point; try again or wait for the VOD.'
                  : confirmation.reason === 'stalled'
                    ? 'Twitch is still buffering that point; try again or wait for the VOD.'
                  : 'Twitch did not confirm playback; the player may be buffering or reloading.'
            : 'Open in Streamclone once VOD context is available.',
      })
      return
    }

      // live-outside-buffer (and any other unresolved live jump): open Past Streams
      // current-live VOD before falling back to page GQL archive discovery.
      const pastVodForOutside = pastStreamsLiveVodIdRef.current ?? await fetchPastStreamsLiveVodId()
      if (pastVodForOutside) {
        openVodUrlOrOffer(
          buildTwitchVodUrl(pastVodForOutside, point.offsetSeconds),
          `Opened Twitch’s current-broadcast VOD at ${formatHeatOffset(point.offsetSeconds)}.`,
        )
        return
      }

      const archiveOutcome = await tryOpenVerifiedArchive(action.offsetSeconds, jumpStartedAt)
      if (archiveOutcome === 'opened') return
      setNotice({
        kind: archiveOutcome === 'not_published' ? 'info' : 'warn',
        text: archiveOutcome === 'route_unavailable'
          ? 'This moment is outside Twitch’s live DVR window, and archive lookup is not available on the current StreamPulse backend.'
          : archiveOutcome === 'auth_required'
            ? 'This moment is outside Twitch’s live DVR window. Archive lookup needs an authenticated extension session.'
            : archiveOutcome === 'identity_mismatch'
              ? 'Twitch returned an archive for a different broadcast, so it was not opened.'
          : archiveOutcome === 'not_published'
            ? 'This moment is outside Twitch’s live DVR window. Twitch has not published the archive VOD yet.'
            : `Replay after VOD: ${formatHeatOffset(action.offsetSeconds)} is outside Twitch’s live DVR window.`,
      })
    } finally {
      jumpBusyRef.current = false
    }
  }

  if (resolvedPlacement === 'hidden') {
    return null
  }

  if (sidebarBodyOnly && resolvedSidebarTab === 'chat') {
    return null
  }

  if (sidebarTabsOnly) {
    const tabsShellClass = ['pulse-shell', `placement-${resolvedPlacement}`, 'pulse-sidebar-header-tabs'].join(' ')
    return (
      <section
        className={tabsShellClass}
        style={styles.headerTabsShell}
        aria-label="Chat or Pulse"
      >
        <SidebarHeaderBar active={resolvedSidebarTab} onChange={tab => void persistSidebarTab(tab)} />
      </section>
    )
  }

  // Body host visibility is owned by mount.tsx (hidden entirely on Chat tab).

  const settingsOpen = shouldShowSettingsPanel(panelView)
  const panelBodyStyle: CSSProperties = {
    ...(sidebarChatOnly ? styles.panelHidden : undefined),
    padding: showSidebarTabs
      ? metricsCompact
        ? '0 8px 8px'
        : '0 10px 10px'
      : sidebarBodyOnly
        ? metricsCompact
          ? '8px'
          : '10px'
        : 0,
    flex: 1,
    minWidth: 0,
    minHeight: sidebarBodyOnly ? 120 : 0,
    overflow: 'hidden',
    overflowX: 'hidden',
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
  }

  return (
    <section
      key="expanded"
      className={`${shellClass} pulse-mode-enter`}
      style={{ ...styles.panel, height: sidebarBodyOnly ? '100%' : undefined, padding: showSidebarTabs || sidebarBodyOnly ? 0 : 20 }}
      aria-label="Streamclone Pulse overlay"
    >
      {showSidebarTabs ? (
        <div className="pulse-sidebar-tabs-wrap" style={styles.sidebarTabsWrap}>
          <PulseSidebarTabs active={resolvedSidebarTab} onChange={tab => void persistSidebarTab(tab)} />
        </div>
      ) : null}

      <div
        className={`pulse-panel-body ${showSidebarTabs ? 'pulse-tab-fade' : ''}${metricsCompact ? ' pulse-panel-body-compact' : ''}`}
        style={panelBodyStyle}
      >
      <div className="pulse-panel-scroll pulse-no-scrollbar" style={styles.panelScroll} data-testid="pulse-panel-scroll">
      <PanelErrorBoundary>
      {settingsOpen ? (
        <div
          key="settings"
          className="pulse-panel-view-enter pulse-panel-view-settings pulse-panel-view-stack"
        >
          <PulseSettingsPanel
            onAutoUpdateChange={next => void persistAutoUpdate(next)}
            onBack={closeInlineSettings}
          />
        </div>
      ) : (
        <div
          key={`${sidebarBodyOnly ? 'pulse' : 'pulse-full'}:${routeContentKey}`}
          className={
            sidebarBodyOnly
              ? 'pulse-panel-view-enter pulse-panel-view-pulse pulse-route-content-enter pulse-panel-view-stack'
              : 'pulse-route-content-enter pulse-panel-view-stack'
          }
        >
      <StreamPulseHeader
        isLive={uiIsLive}
        pulseLiveAccess={pulseLiveAccess.state}
        pulseSupported={pulseSupported}
        trackBusy={trackBusy}
        autoUpdate={autoUpdate}
        sidebarFill={sidebarSnapped}
        hostedBackend={hostedBackend}
        backendUrl={backendUrl}
        onAutoUpdateChange={next => void persistAutoUpdate(next)}
        onTrack={localStackBackend ? () => void startTracking() : undefined}
      />

      {notice ? (
        <div
          style={{ ...styles.notice, ...(notice.kind === 'warn' ? styles.noticeWarn : notice.kind === 'ok' ? styles.noticeOk : {}) }}
          role={notice.kind === 'warn' ? 'status' : 'status'}
          aria-live="polite"
        >
          <span>{notice.text}</span>
          {notice.action ? (
            <a href={notice.action.href} target="_blank" rel="noreferrer" style={styles.noticeLink}>
              {notice.action.label}
            </a>
          ) : null}
        </div>
      ) : null}

      {showHostedOfflineFallback ? (
        <PulseSectionCard title="Channel offline" titleTone="muted">
          <p style={styles.stateText}>
            No live Pulse session for this channel right now. Check back when they go live, or use Analytics Hub above to browse tracked channels.
          </p>
          <div style={styles.footerActions}>
            <button type="button" style={styles.secondaryButton} onClick={() => void refreshPulse()}>
              Refresh
            </button>
          </div>
        </PulseSectionCard>
      ) : null}

      {awaitingTrack && !isVodPage && localStackBackend && pulseSupported && !payload?.tracking ? (
        <section style={styles.trackPrompt}>
          <p style={styles.stateText}>Track <strong>{login}</strong> to collect live chat and 7TV rollups from your Streamclone stack.</p>
          <div style={styles.footerActions}>
            <button type="button" style={styles.primaryButton} disabled={trackBusy} onClick={() => void startTracking()}>
              {trackBusy ? 'Starting…' : 'Track this channel'}
            </button>
            <button type="button" style={styles.secondaryButton} onClick={openInlineSettings}>Manage watchlist</button>
          </div>
        </section>
      ) : null}

      {error && !isVodPage ? (
        <BackendError backendUrl={backendUrl} onRetry={() => void refreshPulse()} onSettings={openInlineSettings} />
      ) : null}

      {!error && payload && !pulseSupported ? (
        <PulseRosterUnsupportedPanel login={login} />
      ) : null}

      {!error && !isVodPage && hostedBackend && uiIsLive && pulseSupported && pulseLiveAccess.state !== 'full_live' ? (
        <PulseNotTrackedPanel
          login={login}
          hostedActiveCount={pulseLiveAccess.hostedActiveCount}
          hostedActiveLimit={pulseLiveAccess.hostedActiveLimit}
        />
      ) : null}

      {!error && !isVodPage && !hostedBackend && payload && pulseSupported && pulseLiveAccess.state === 'not_irc_tracked' ? (
        <PulseLiveUnavailablePanel
          variant="not_irc_tracked"
          login={login}
          coverageStartOffsetSeconds={pulseLiveAccess.coverageStartOffsetSeconds}
          hostedActiveCount={pulseLiveAccess.hostedActiveCount}
          hostedActiveLimit={pulseLiveAccess.hostedActiveLimit}
          onOpenSettings={() => openInlineSettings()}
        />
      ) : null}

      {!error && !isVodPage && !hostedBackend && payload && pulseSupported && pulseLiveAccess.state === 'late_session' ? (
        <PulseLiveUnavailablePanel
          variant="late_session"
          login={login}
          coverageStartOffsetSeconds={pulseLiveAccess.coverageStartOffsetSeconds}
          hostedActiveCount={pulseLiveAccess.hostedActiveCount}
          hostedActiveLimit={pulseLiveAccess.hostedActiveLimit}
          onOpenSettings={() => openInlineSettings()}
        />
      ) : null}

      {!error && !isVodPage && payload && pulseSupported && pulseLiveAccess.state === 'full_live' ? (
        <>
          {displayPayload && (panelSections?.showLiveStatsBand || panelSections?.showMostReacted) ? (
            <div>
              {panelSections?.showLiveStatsBand ? (
                <LiveStatsBand
                  payload={displayPayload}
                  backendUrl={backendUrl}
                  sidebarFill={sidebarSnapped}
                  compact={metricsCompact}
                  coverageStartOffsetSeconds={coverageStart}
                  currentOffsetSeconds={payload.currentOffsetSeconds}
                  isLive={uiIsLive}
                  fullTimeline={fullTimeline}
                  showLoadFromStart={!hostedBackend && shouldShowStreamStartAction({ ...payload, tracking: payload.tracking })}
                  loadFromStartBusy={missedBusy}
                  onLoadFromStart={() => void loadStreamFromStart()}
                  onJumpToOffset={jumpToOffset}
                  onOpenAnalytics={openAnalytics}
                  onOpenFullAnalytics={() => openAnalytics()}
                  onRequestFullTimeline={requestFullTimeline}
                  onChartWindowChange={handleChartWindowChange}
                  onPinOffset={handleChartPin}
                  pinOffsetSeconds={chartPinOffset}
                  previewOffsetSeconds={chartPreviewOffset}
                  hasVodContext={Boolean(payload?.vodId ?? context.vodId)}
                  coverageTier={coverageTierState?.coverageTier ?? null}
                />
              ) : null}

              {panelSections?.showMostReacted ? (
                <MostReactedSection
                  payload={displayPayload}
                  backendUrl={backendUrl}
                  sidebarFill={sidebarSnapped}
                  pinnedOffsetSeconds={mostReactedPinOffset}
                  onJump={jumpMoment}
                  onAnalytics={openAnalyticsForMoment}
                  onHighlightOffset={setChartPreviewOffset}
                  onPinOffset={handleMostReactedPin}
                  resolveJumpControl={resolveMomentJumpControl}
                  hasVodContext={Boolean(payload?.vodId ?? context.vodId)}
                />
              ) : null}
            </div>
          ) : null}

          {payload && pulseLiveAccess.state === 'full_live' && shouldShowMissedMomentsBanner(payload) ? (
            <CoverageCard
              source={{
                ...payload,
                tracking: payload.tracking,
                navigationVodId: pastStreamsLiveVodId,
              }}
              busy={missedBusy}
              refreshed={missedRefreshed}
              job={missedJob}
              lastCheckedAt={coverageLastCheck}
              checkError={coverageCheckError}
              debugDetail={vodDebugDetail}
              onLoad={() => void loadMissedMoments()}
              onCheckVod={() => void refreshVodStatus()}
              onOpenSettings={openInlineSettings}
              onOpenAnalytics={() => openAnalytics()}
            />
          ) : null}

          {panelSections?.showWarming ? (
            <WarmingState
              count={mostReactedHeat?.completedRollupCount ?? 0}
              coverageStart={coverageStart}
              tracking={payload?.tracking ?? false}
              coverageTier={coverageTierState?.coverageTier}
            />
          ) : null}
        </>
      ) : null}

      {isVodPage && !hasRecapPanel ? (
        <VodPulseStatusCard
          vodPulse={vodPulse}
          loading={vodPulseLoading}
          error={error}
          onRetry={() => void refreshPulse()}
        />
      ) : null}

      {!error && payload && pulseSupported ? (
        <>
          {panelSections?.showRecap && payload ? (
            <StreamRecapSection
              payload={payload}
              backendUrl={backendUrl}
              uiState={recapUiState === 'partial' ? 'ready' : (recapUiState ?? 'ready')}
              isLive={uiIsLive}
              coverage={recapCoverageTier}
              pollError={error ?? null}
              sidebarFill={sidebarSnapped}
              hideHubLink
              onJump={jumpMoment}
              onAnalytics={openAnalyticsForMoment}
              onOpenAnalytics={openAnalytics}
              onRequestFullRollups={requestFullTimeline}
              onRetry={() => void refreshPulse()}
            />
          ) : null}

          {topClip && !isVodPage ? <ClipSpikeCard clip={topClip} /> : null}

          {!isVodPage ? (
          <PastVodsSection
            login={login}
            backendUrl={backendUrl}
            liveStreamId={payload.streamId}
            isLive={uiIsLive}
            channelOffline={!uiIsLive}
            onOpenFromStart={openStreamStartToLive}
            onCurrentLiveVodId={rememberPastStreamsLiveVodId}
          />
          ) : null}
        </>
      ) : null}

      {!error && !payload && !isVodPage ? (
        sidebarBodyOnly && resolvedPlacement === 'sidebar' ? (
          <PulseSidebarSkeleton hostedBackend={hostedBackend} />
        ) : (
          <section style={styles.stateBlock}>
            <h2 style={styles.stateTitle}>Loading Pulse</h2>
            <p style={styles.stateText}>
              {hostedBackend
                ? 'Fetching live analytics from StreamPulse…'
                : `Waiting for Pulse data from ${backendUrl}. Make sure the stack is running, then retry.`}
            </p>
          </section>
        )
      ) : null}

      {error && !payload && !isVodPage ? (
        <section style={styles.stateBlock} role="alert">
          <h2 style={styles.stateTitle}>Pulse unavailable</h2>
          <p style={styles.stateText}>
            {coverageErrorMessage(error, hostedBackend
              ? 'StreamPulse did not respond in time. The Twitch page is still usable.'
              : `No response from ${backendUrl}. Make sure the local stack is running.`)}
          </p>
          <button type="button" style={styles.secondaryButton} onClick={() => void refreshPulse()}>
            Try again
          </button>
        </section>
      ) : null}
        </div>
      )}
      </PanelErrorBoundary>
      </div>
      <PulsePanelFooter
        compact={sidebarSnapped}
        settingsOpen={settingsOpen}
        onToggleSettings={toggleInlineSettings}
      />
      </div>
    </section>
  )
}

function StreamPulseHeader({
  isLive,
  pulseLiveAccess,
  pulseSupported,
  trackBusy,
  autoUpdate,
  sidebarFill = false,
  hostedBackend = true,
  backendUrl,
  onAutoUpdateChange,
  onTrack,
}: {
  isLive: boolean
  pulseLiveAccess: import('./resolvePulseLiveAccess.ts').PulseLiveAccessState
  pulseSupported: boolean
  trackBusy: boolean
  autoUpdate: boolean
  sidebarFill?: boolean
  hostedBackend?: boolean
  backendUrl: string
  onAutoUpdateChange: (next: boolean) => void
  onTrack?: () => void
}) {
  const headerStyle = sidebarFill ? styles.streamPulseHeaderSidebar : styles.streamPulseHeader
  const actionsStyle = sidebarFill ? styles.streamPulseHeaderActionsSidebar : styles.streamPulseHeaderActions
  const trackButtonStyle = sidebarFill ? styles.trackingButtonFull : styles.trackingButton
  const trackStreamerStyle = sidebarFill ? styles.trackStreamerButtonFull : styles.trackStreamerButton
  const autoUpdateStyle = sidebarFill ? styles.autoUpdateLabelFull : styles.autoUpdateLabel

  const statusLabel = hostedBackend
    ? pulseLiveAccess === 'full_live'
      ? 'Live chart'
      : 'Not tracked'
    : !pulseSupported
      ? 'Limited roster'
      : pulseLiveAccess === 'full_live'
        ? 'Live chart'
        : pulseLiveAccess === 'late_session'
          ? 'Joined late'
          : pulseLiveAccess === 'not_irc_tracked'
            ? 'Not in IRC pool'
            : 'Pulse'

  return (
    <header style={headerStyle} data-testid="stream-pulse-header">
      <div style={sidebarFill ? styles.streamPulseHeaderMainSidebar : styles.streamPulseHeaderMain}>
        <div style={styles.streamPulseTitleRow}>
          <h2 style={styles.streamPulseTitle}>Stream Pulse</h2>
          {isLive ? <span style={styles.liveBadge}>Live</span> : null}
          <span style={hostedBackend ? styles.apiPillHosted : styles.apiPillLocal}>
            {hostedBackend ? 'Hosted API' : 'Local dev API'}
          </span>
        </div>
        <p style={styles.streamPulseLead}>{LIVE_HEAT_SUBTITLE}</p>
      </div>
      <div style={actionsStyle}>
        {!pulseSupported && !hostedBackend ? (
          <span style={trackButtonStyle} aria-label="Limited tracked roster">
            Limited roster
          </span>
        ) : hostedBackend ? (
          <span style={trackButtonStyle} aria-label={statusLabel}>
            {statusLabel}
          </span>
        ) : pulseLiveAccess === 'full_live' ? (
          <span style={trackButtonStyle} aria-label="Tracking this streamer">
            Tracking
          </span>
        ) : onTrack ? (
          <button type="button" style={trackStreamerStyle} disabled={trackBusy} onClick={onTrack}>
            {trackBusy ? 'Starting…' : 'Track streamer'}
          </button>
        ) : (
          <span style={trackButtonStyle}>{statusLabel}</span>
        )}
        {pulseSupported && !hostedBackend ? (
        <label style={autoUpdateStyle}>
          <span>Auto-updating</span>
          <button
            type="button"
            role="switch"
            aria-checked={autoUpdate}
            style={{ ...styles.autoUpdateSwitch, background: autoUpdate ? theme.accentStrong : theme.border }}
            onClick={() => onAutoUpdateChange(!autoUpdate)}
          >
            <span style={{ ...styles.autoUpdateKnob, left: autoUpdate ? 18 : 2 }} />
          </button>
        </label>
        ) : null}
      </div>
      <AnalyticsHubCta backendUrl={backendUrl} compact={sidebarFill} />
    </header>
  )
}

function PulsePanelFooter({
  compact = false,
  settingsOpen,
  onToggleSettings,
}: {
  compact?: boolean
  settingsOpen: boolean
  onToggleSettings: () => void
}) {
  return (
    <footer
      className="pulse-panel-footer"
      style={compact ? styles.panelFooterCompact : styles.panelFooter}
      data-testid="pulse-panel-footer"
    >
      <div style={styles.panelFooterGearRow}>
        <button
          type="button"
          className="pulse-settings-gear-btn"
          style={styles.footerSettingsGear}
          onClick={onToggleSettings}
          title={settingsOpen ? 'Back to Pulse' : 'Settings'}
          aria-label={settingsOpen ? 'Back to Pulse' : 'Open settings'}
          aria-pressed={settingsOpen}
        >
          <SettingsGearIcon size={14} />
        </button>
      </div>
    </footer>
  )
}

function vodPulseStatusKind(state: ReturnType<typeof resolveVodPulseState>): PulseStatusKind {
  switch (state.status) {
    case 'ready':
      return 'replay-synced'
    case 'partial':
      return 'partial'
    case 'syncing':
    case 'loading':
      return 'syncing'
    case 'missing':
    case 'untracked_actionable':
      return 'missing'
    default:
      return 'backend-error'
  }
}

function VodPulseStatusCard({
  vodPulse,
  loading,
  error,
  onRetry,
}: {
  vodPulse: ExtensionVodPulseResponse | null
  loading?: boolean
  error?: string
  onRetry?: () => void
}) {
  const state = resolveVodPulseState(vodPulse, error, loading)
  const status = vodPulseStatusKind(state)
  const subtitle =
    state.status === 'loading'
      ? 'Loading replay analytics…'
      : state.status === 'syncing'
        ? state.reason ?? 'Replay analytics are still syncing for this VOD.'
        : state.status === 'untracked_actionable'
          ? state.reason ?? 'Pulse hasn’t indexed this VOD yet.'
          : state.status === 'missing'
            ? state.reason ?? 'No replay analytics have been indexed for this VOD yet.'
            : state.status === 'error'
              ? state.message
              : state.status === 'ready'
                ? 'Replay analytics are ready for this VOD.'
                : 'Replay analytics are partially available.'

  const showRetry =
    Boolean(onRetry)
    && state.status !== 'untracked_actionable'
    && state.status !== 'ready'
    && (state.status === 'error' || state.status === 'missing' || state.status === 'syncing' || state.status === 'partial')

  return (
    <PulseSectionCard title="Replay Pulse">
      <div style={styles.vodStateWrap}>
        <PulseStatusPill status={status} />
        <p style={styles.stateText}>{subtitle}</p>
        {state.status === 'untracked_actionable' ? (
          <p style={styles.stateText}>
            This VOD was never collected live. Explicit indexing will be available once the authenticated Load Pulse workflow is enabled on the hosted API.
          </p>
        ) : null}
        {showRetry ? (
          <button type="button" style={styles.secondaryButton} onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </PulseSectionCard>
  )
}

function ClipSpikeCard({ clip }: { clip: ExtensionClip }) {
  const duration = formatClipDuration(clip.durationSeconds)
  const [hovered, setHovered] = useState(false)
  return (
    <section style={styles.clipSpikeSection}>
      <h3 style={styles.clipSpikeHeading}>Clip spike</h3>
      <a
        href={clip.url}
        target="_blank"
        rel="noreferrer"
        style={{
          ...styles.clipSpikeCard,
          ...(hovered ? styles.clipSpikeCardHover : null),
        }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <div style={styles.clipThumbWrap}>
          {clip.thumbnailUrl ? (
            <img src={clip.thumbnailUrl} alt={clip.title} style={styles.clipThumb} loading="lazy" />
          ) : (
            <div style={styles.clipThumbFallback} />
          )}
          {duration ? <span style={styles.clipDurationBadge}>{duration}</span> : null}
          <span style={styles.clipSpikeCta}>{hovered ? 'Open on Twitch →' : 'Twitch clip'}</span>
        </div>
        <div style={styles.clipBody}>
          <strong style={styles.clipTitle}>{clip.title}</strong>
          <span style={styles.clipViews}>{formatNumber(clip.viewCount ?? 0)} views</span>
        </div>
      </a>
    </section>
  )
}

function SidebarHeaderBar({
  active,
  onChange,
}: {
  active: SidebarTab
  onChange: (tab: SidebarTab) => void
}) {
  const [collapseLabel, setCollapseLabel] = useState('Hide chat panel')
  const [chattersOpen, setChattersOpen] = useState(false)

  useEffect(() => {
    const sync = () => {
      setCollapseLabel(readTwitchCollapseLabel())
      setChattersOpen(isTwitchChattersOpen())
    }
    sync()
    const id = window.setInterval(sync, 600)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="pulse-sidebar-header-row">
      <button
        type="button"
        className="pulse-sidebar-header-edge pulse-sidebar-header-edge-wide"
        aria-label={collapseLabel}
        title={collapseLabel}
        onClick={() => {
          clickTwitchCollapseChat()
          window.setTimeout(() => setCollapseLabel(readTwitchCollapseLabel()), 120)
        }}
      >
        <PanelCollapseIcon />
      </button>
      <PulseSidebarTabs active={active} onChange={onChange} compact />
      <button
        type="button"
        className={`pulse-sidebar-header-edge${chattersOpen ? ' pulse-sidebar-header-edge-active' : ''}`}
        aria-label={chattersOpen ? 'Close chatters list' : 'Open chatters list'}
        aria-pressed={chattersOpen}
        title={chattersOpen ? 'Close chatters list' : 'Open chatters list'}
        onClick={() => {
          toggleTwitchChatters()
          window.setTimeout(() => setChattersOpen(isTwitchChattersOpen()), 120)
        }}
      >
        <ChattersIcon />
      </button>
    </div>
  )
}

function PanelCollapseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="4" width="7.5" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 9H15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M14.5 7 16.5 9 14.5 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChattersIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.5 7a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 5.5 7Zm5 0a2.25 2.25 0 1 0 0-4.5A2.25 2.25 0 0 0 10.5 7ZM2 12.25c0-1.933 1.567-3.5 3.5-3.5s3.5 1.567 3.5 3.5H2Zm5 0c0-1.567 1.015-2.896 2.422-3.364A3.49 3.49 0 0 0 10.5 8c.96 0 1.83.388 2.458 1.014A3.49 3.49 0 0 0 10.5 12.25H7Z" />
    </svg>
  )
}

function BrandMark() {
  return <PeakBrandMark size={34} />
}

function StatusPill({ tracking, isLive, compact = false }: { tracking: boolean; isLive: boolean; compact?: boolean }) {
  return (
    <span style={tracking ? (compact ? styles.statusLiveCompact : styles.statusLive) : (compact ? styles.statusIdleCompact : styles.statusIdle)}>
      <span className={tracking && isLive ? 'pulse-live-dot' : undefined} style={tracking ? styles.dotGreen : styles.dotMuted} />
      {tracking ? (isLive ? 'Live' : 'Tracking') : 'Not tracking'}
    </span>
  )
}

function HeatStrip({ values, compact = false }: { values: number[]; compact?: boolean }) {
  const display = values.slice(-30)
  if (display.length === 0 || display.every(value => value <= 0)) {
    return (
      <div style={compact ? styles.heatStripEmptyCompact : styles.heatStripEmpty} aria-hidden="true">
        {compact ? 'No heat yet' : 'Heatmap fills in after the first completed minutes'}
      </div>
    )
  }
  const max = Math.max(...display, 1)
  return (
    <div style={compact ? styles.heatStripCompact : styles.heatStrip}>
      {display.map((value, index) => {
        const hot = value >= max * 0.88 && max > 0
        return (
          <span
            key={`${index}-${value}`}
            className="pulse-bar-grow"
            style={{
              ...styles.heatBar,
              height: `${Math.max(12, Math.round((value / max) * (compact ? 34 : 92)))}%`,
              background: hot
                ? `linear-gradient(180deg, ${theme.rank1}, #fb7185)`
                : `linear-gradient(180deg, ${theme.accent}, ${theme.accentStrong})`,
              animationDelay: `${index * 18}ms`,
            }}
          />
        )
      })}
    </div>
  )
}

function WarmingState({
  count,
  coverageStart = 0,
  tracking = true,
  coverageTier,
}: {
  count: number
  coverageStart?: number
  tracking?: boolean
  coverageTier?: string
}) {
  const statusLabel = coverageTierStatusLabel(coverageTier, tracking)
  if (statusLabel === 'Metadata only — no chat coverage') {
    return (
      <section style={styles.stateBlock}>
        <h2 style={styles.stateTitle}>{statusLabel}</h2>
        <p style={styles.stateText}>
          Viewer metadata may still update, but this channel has no IRC chat coverage right now. Most reacted requires measured minute chat rollups.
        </p>
      </section>
    )
  }

  const progress = Math.min(1, count / LIVE_HEAT_MIN_COMPLETED_ROLLUPS)
  const lateTracking = coverageStart > PULSE_STREAM_START_TOLERANCE_SEC
  const firstMinutePending = count === 0
  return (
    <section style={styles.stateBlock}>
      <h2 style={styles.stateTitle}>{statusLabel}</h2>
      <p style={styles.stateText}>
        {firstMinutePending
          ? 'IRC chat rollups close once per minute. The chart and Top Moments fill in automatically — nothing to load from stream start yet.'
          : lateTracking
            ? `Streamclone is tracking this broadcast (${formatHeatOffset(coverageStart)} in). Top Moments unlock after ${LIVE_HEAT_MIN_COMPLETED_ROLLUPS} completed minutes of chat rollups.`
            : `Collecting chat and emote activity. Top Moments unlock after ${LIVE_HEAT_MIN_COMPLETED_ROLLUPS} completed minutes, never shown as final early.`}
      </p>
      <div className="pulse-shimmer" style={styles.progressTrack}><span style={{ ...styles.progressFill, width: `${progress * 100}%` }} /></div>
      <p style={styles.muted}>{count} / {LIVE_HEAT_MIN_COMPLETED_ROLLUPS} minutes collected · updates automatically</p>
    </section>
  )
}

function BackendError({ backendUrl, onRetry, onSettings }: { backendUrl: string; onRetry: () => void; onSettings: () => void }) {
  return (
    <section style={styles.errorBlock}>
      <h2 style={styles.errorTitle}>Can&apos;t reach Streamclone</h2>
      <p style={styles.stateText}>No response from {backendUrl}. Is the Streamclone stack running? Showing this instead of empty charts.</p>
      <div style={styles.footerActions}>
        <button type="button" style={styles.secondaryButton} onClick={onRetry}>Retry</button>
        <button type="button" style={styles.textButtonLarge} onClick={onSettings}>Open settings</button>
      </div>
    </section>
  )
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US', { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatClipDuration(durationSeconds?: number): string | null {
  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  const total = Math.round(durationSeconds)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`
}

const styles: Record<string, CSSProperties> = {
  panel: { background: theme.bgCanvas, display: 'flex', flexDirection: 'column' },
  panelHidden: { display: 'none' },
  sidebarTabsWrap: { flexShrink: 0, padding: 8 },
  headerTabsShell: { alignItems: 'center', display: 'flex', height: '100%', width: '100%', justifyContent: 'center' },
  panelScroll: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', overflowX: 'hidden' as const },
  panelFooter: {
    borderTop: `1px solid ${theme.borderSubtle}`,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
  },
  panelFooterCompact: {
    borderTop: `1px solid ${theme.borderSubtle}`,
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    gap: 2,
    marginTop: 6,
    paddingTop: 6,
  },
  panelFooterGearRow: { display: 'flex', justifyContent: 'flex-end' },
  footerSettingsGear: {
    alignItems: 'center',
    display: 'inline-flex',
    flexShrink: 0,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  header: { alignItems: 'flex-start', display: 'flex', gap: 12, justifyContent: 'space-between' },
  titleRow: { alignItems: 'center', display: 'flex', gap: 12 },
  headerActions: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  title: { fontSize: 22, fontWeight: 800, lineHeight: 1.15 },
  titleLogin: { color: theme.textSecondary, fontWeight: 700, marginLeft: 6 },
  subtitle: { color: theme.textSecondary, fontSize: 12, marginTop: 3 },
  statusLive: { alignItems: 'center', background: theme.statusOkBg, border: `1px solid ${theme.statusOkBorder}`, borderRadius: theme.radiusPill, color: theme.statusOkText, display: 'inline-flex', fontSize: 12, fontWeight: 800, gap: 8, padding: '7px 12px' },
  statusIdle: { alignItems: 'center', background: theme.panelElevated, border: `1px solid ${theme.border}`, borderRadius: theme.radiusPill, color: theme.textSecondary, display: 'inline-flex', fontSize: 12, fontWeight: 800, gap: 8, padding: '7px 12px' },
  statusLiveCompact: { alignItems: 'center', background: theme.statusOkBg, border: `1px solid ${theme.statusOkBorder}`, borderRadius: theme.radiusPill, color: theme.statusOkText, display: 'inline-flex', fontSize: 10, fontWeight: 800, gap: 6, padding: '4px 8px', width: 'fit-content' },
  statusIdleCompact: { alignItems: 'center', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: theme.radiusPill, color: theme.textSecondary, display: 'inline-flex', fontSize: 10, fontWeight: 800, gap: 6, padding: '4px 8px', width: 'fit-content' },
  dotGreen: { background: theme.live, borderRadius: 999, display: 'inline-block', height: 9, width: 9 },
  dotMuted: { background: theme.textMuted, borderRadius: 999, display: 'inline-block', height: 9, width: 9 },
  trackingText: { alignItems: 'center', color: theme.statusOkText, display: 'inline-flex', fontWeight: 800, gap: 6 },
  muted: { color: theme.textMuted },
  smallButton: { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, color: theme.textPrimary, cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '7px 10px' },
  primaryButtonSmall: { background: theme.accent, border: 0, borderRadius: theme.radiusButton, color: theme.onAccent, cursor: 'pointer', fontSize: 12, fontWeight: 800, padding: '7px 12px' },
  heatStripEmpty: { alignItems: 'center', background: theme.chartBg, border: `1px dashed ${theme.border}`, borderRadius: 12, color: theme.textMuted, display: 'flex', fontSize: 12, height: 112, justifyContent: 'center', padding: 16, textAlign: 'center' },
  heatStripEmptyCompact: { alignItems: 'center', color: theme.textMuted, display: 'flex', fontSize: 11, height: 44, justifyContent: 'center', minWidth: 96 },
  trackPrompt: { background: theme.panelElevated, border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35)', borderRadius: 12, marginBottom: 14, padding: 14 },
  statsGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 18 },
  recapGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 12 },
  statCard: { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 12, minWidth: 0, padding: 12 },
  statLabel: { color: theme.textSecondary, fontSize: 10, fontWeight: 800 },
  statValue: { fontSize: 26, fontWeight: 800, lineHeight: 1.15, marginTop: 6 },
  statDetail: { fontSize: 12, fontWeight: 800, marginTop: 6 },
  section: { borderTop: `1px solid ${theme.borderSubtle}`, marginTop: 16, paddingTop: 16 },
  sectionHeading: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 12, fontWeight: 800, justifyContent: 'space-between', marginBottom: 10, textTransform: 'uppercase' },
  heatStrip: { alignItems: 'end', background: theme.chartBg, borderRadius: 12, display: 'flex', gap: 5, height: 112, padding: '16px 14px 12px' },
  heatStripCompact: { alignItems: 'end', display: 'flex', flex: 1, gap: 5, height: 44, justifyContent: 'flex-end', minWidth: 140 },
  heatBar: { borderRadius: 4, display: 'block', flex: '1 1 7px', minWidth: 4 },
  axis: { color: theme.textMuted, display: 'flex', fontSize: 11, justifyContent: 'space-between', marginTop: 8 },
  lanes: { display: 'grid', gap: 12 },
  lane: { alignItems: 'center', display: 'grid', gap: 14, gridTemplateColumns: '74px 1fr' },
  laneLabel: { color: theme.textMuted, display: 'grid', fontSize: 11, gap: 2 },
  laneBars: { alignItems: 'end', display: 'flex', gap: 6, height: 34 },
  laneBar: { borderRadius: 4, display: 'block', flex: 1, minWidth: 6 },
  momentList: { display: 'grid', gap: 8 },
  momentRow: { alignItems: 'center', background: theme.panelElevated, borderRadius: 10, display: 'grid', gap: 10, gridTemplateColumns: '34px 1fr auto', padding: '10px 12px', transition: 'transform 0.15s ease, box-shadow 0.15s ease' },
  rank: { alignItems: 'center', background: theme.accentStrong, borderRadius: 9, display: 'inline-flex', fontWeight: 800, height: 34, justifyContent: 'center', width: 34 },
  momentMain: { display: 'grid', gap: 3, minWidth: 0 },
  rowActions: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  textButton: { background: 'transparent', border: 0, color: theme.accentText, cursor: 'pointer', fontSize: 11, fontWeight: 800, padding: 0 },
  textButtonLarge: { background: 'transparent', border: 0, color: theme.accentText, cursor: 'pointer', fontSize: 14, fontWeight: 800, padding: '8px 0' },
  score: { color: '#fb7185', display: 'grid', fontSize: 11, justifyItems: 'end' },
  footerActions: { display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginTop: 14 },
  emoteChips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  emoteChip: { alignItems: 'center', background: theme.panelElevated, border: `1px solid ${theme.border}`, borderRadius: 999, color: theme.textPrimary, display: 'inline-flex', fontSize: 11, fontWeight: 800, gap: 6, padding: '6px 9px' },
  emoteChipImg: { display: 'block', objectFit: 'contain' },
  saveTools: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 12 },
  offsetInput: { background: theme.chartBg, border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textPrimary, font: 'inherit', minWidth: 0, padding: '10px 12px' },
  savedList: { display: 'grid', gap: 8 },
  savedRow: { alignItems: 'center', background: theme.panelElevated, borderRadius: 10, display: 'grid', gap: 10, gridTemplateColumns: '1fr auto', padding: '9px 12px' },
  savedMain: { background: 'transparent', border: 0, color: theme.textPrimary, cursor: 'pointer', display: 'grid', gap: 3, minWidth: 0, padding: 0, textAlign: 'left' },
  primaryButton: { background: 'var(--pulse-accent, #8b5cf6)', border: 0, borderRadius: 10, color: 'var(--pulse-on-accent, #fff)', cursor: 'pointer', fontWeight: 800, padding: '12px 14px' },
  hubLinkButton: { background: 'var(--pulse-accent, #8b5cf6)', border: 0, borderRadius: 10, color: 'var(--pulse-on-accent, #fff)', cursor: 'pointer', fontWeight: 800, padding: '12px 14px' },
  secondaryButton: { background: theme.panelElevated, border: `1px solid ${theme.border}`, borderRadius: 10, color: theme.textPrimary, cursor: 'pointer', fontWeight: 800, padding: '12px 14px' },
  stateBlock: { background: theme.panelElevated, borderRadius: 12, marginTop: 16, padding: 16 },
  stateTitle: { fontSize: 18, margin: '0 0 10px' },
  stateText: { color: theme.textSecondary, fontSize: 13, lineHeight: 1.35, margin: '0 0 14px' },
  vodStateWrap: { display: 'grid', gap: 8 },
  progressTrack: { background: theme.inputBg, borderRadius: 999, height: 8, marginBottom: 10, overflow: 'hidden' },
  progressFill: { background: theme.accent, borderRadius: 999, display: 'block', height: '100%' },
  errorBlock: { background: theme.panel, borderRadius: 12, padding: 16 },
  errorTitle: { color: theme.error, fontSize: 18, margin: '0 0 10px' },
  notice: { background: theme.accentSurface, border: `1px solid ${theme.borderAccent}`, borderRadius: 10, color: theme.accentText, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, fontWeight: 700, margin: '14px 0 0', padding: '10px 12px' },
  noticeLink: { color: theme.accentText, textDecoration: 'underline', textUnderlineOffset: 2 },
  noticeWarn: { background: theme.statusWarnBg, borderColor: theme.statusWarnBorder, color: theme.statusWarnText },
  noticeOk: { background: theme.statusOkBg, borderColor: theme.statusOkBorder, color: theme.statusOkText },
  streamPulseHeader: { alignItems: 'flex-start', border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 14, padding: '12px 14px', width: '100%' },
  streamPulseHeaderSidebar: { alignItems: 'stretch', border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10, padding: '10px 12px', width: '100%' },
  streamPulseHeaderMain: { flex: '1 1 180px', minWidth: 0, width: '100%' },
  streamPulseHeaderMainSidebar: { flex: '0 0 auto', minWidth: 0, width: '100%' },
  streamPulseTitleRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  streamPulseTitle: { fontSize: 13, fontWeight: 900, letterSpacing: '0.06em', margin: 0, textTransform: 'uppercase' },
  liveBadge: { background: '#dc2626', borderRadius: 4, color: '#fff', fontSize: 10, fontWeight: 900, padding: '2px 6px', textTransform: 'uppercase' },
  apiPillHosted: {
    background: theme.statusOkBg,
    border: `1px solid ${theme.statusOkBorder}`,
    borderRadius: 999,
    color: theme.statusOkText,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    padding: '2px 8px',
    textTransform: 'uppercase',
  },
  apiPillLocal: {
    background: theme.statusWarnBg,
    border: `1px solid ${theme.statusWarnBorder}`,
    borderRadius: 999,
    color: theme.statusWarnText,
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    padding: '2px 8px',
    textTransform: 'uppercase',
  },
  streamPulseLead: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, lineHeight: 1.4, margin: '6px 0 0' },
  headerHubLink: {
    ...overlayTextLinkButton,
    flexBasis: '100%',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
    marginTop: 2,
    textTransform: 'uppercase',
    width: '100%',
  },
  streamPulseHeaderActions: { alignItems: 'flex-end', display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 8 },
  streamPulseHeaderActionsSidebar: { alignItems: 'stretch', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' },
  trackStreamerButton: { background: theme.accentSurface, border: `1px solid ${theme.borderAccent}`, borderRadius: theme.radiusButton, color: theme.accentText, cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '8px 12px', textTransform: 'uppercase' },
  trackStreamerButtonFull: { background: theme.accentSurface, border: `1px solid ${theme.borderAccent}`, borderRadius: theme.radiusButton, color: theme.accentText, cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '10px 12px', textAlign: 'center', textTransform: 'uppercase', width: '100%' },
  trackingButton: { background: theme.accentSurface, border: `1px solid ${theme.borderAccent}`, borderRadius: 999, color: theme.accentTextSubtle, display: 'inline-block', fontSize: 10, fontWeight: 900, letterSpacing: '0.04em', padding: '4px 10px', textTransform: 'uppercase' },
  trackingButtonFull: { background: theme.accentSurface, border: `1px solid ${theme.borderAccent}`, borderRadius: 999, color: theme.accentTextSubtle, display: 'block', fontSize: 10, fontWeight: 900, letterSpacing: '0.04em', padding: '8px 12px', textAlign: 'center', textTransform: 'uppercase', width: '100%' },
  autoUpdateLabel: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 11, fontWeight: 600, gap: 8 },
  autoUpdateLabelFull: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 11, fontWeight: 600, gap: 8, justifyContent: 'space-between', width: '100%' },
  autoUpdateSwitch: { border: 0, borderRadius: 999, cursor: 'pointer', flexShrink: 0, height: 22, position: 'relative', width: 36 },
  autoUpdateKnob: { background: '#fff', borderRadius: 999, height: 18, position: 'absolute', top: 2, width: 18 },
  coverageNotice: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, lineHeight: 1.4, margin: '0 0 12px' },
  liveNowBand: { background: theme.inputBg, border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, marginBottom: 14, padding: 12 },
  liveNowHeader: { alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 },
  liveNowTitle: { fontSize: 11, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase' },
  syncedBadge: { background: theme.statusOkBg, border: `1px solid ${theme.statusOkBorder}`, borderRadius: 999, color: theme.statusOkText, fontSize: 10, fontWeight: 800, padding: '3px 8px' },
  liveNowMetrics: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 10, width: '100%' },
  liveNowMetricsSidebar: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
  liveNowMetricsCompact: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  liveNowMetric: { display: 'grid', gap: 2, minWidth: 0 },
  liveNowMetricLabel: { color: theme.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  liveNowMetricValue: { fontSize: 22, fontWeight: 900, lineHeight: 1.1 },
  liveNowMetricMeta: { color: theme.textSecondary, fontSize: 10, fontWeight: 600 },
  emoteProviderRate: { marginRight: 8 },
  sparklineBlock: { display: 'grid', gap: 6, marginTop: 10 },
  sparklineHeader: { alignItems: 'center', display: 'flex', justifyContent: 'space-between', gap: 8 },
  sparklineLabel: { color: theme.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  chartWindowToggle: { alignItems: 'center', display: 'inline-flex', gap: 4 },
  chartWindowButton: { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.textSecondary, cursor: 'pointer', fontSize: 10, fontWeight: 800, padding: '3px 8px', textTransform: 'uppercase' },
  chartWindowButtonActive: { background: theme.accentSurface, borderColor: theme.borderAccent, color: theme.accentText },
  topEmotesRow: { alignItems: 'center', display: 'flex', gap: 8, marginTop: 10 },
  topEmotesLabel: { color: theme.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  topEmoteChips: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  topEmoteChip: { alignItems: 'center', background: 'var(--pulse-surface-hover-fill, rgba(255,255,255,0.05))', border: '1px solid transparent', borderRadius: 6, display: 'inline-flex', gap: 6, padding: '4px 6px' },
  topEmoteChipButton: { background: 'var(--pulse-surface-hover-fill, rgba(255,255,255,0.05))', color: 'inherit', cursor: 'pointer', font: 'inherit' },
  topEmoteChipActive: { background: theme.statusOkBg, borderColor: theme.statusOkBorder },
  topEmoteImg: { display: 'block', height: 24, objectFit: 'contain', width: 24 },
  topEmoteName: { color: theme.textSecondary, fontSize: 11, fontWeight: 700 },
  topEmoteCount: { color: theme.textMuted, fontSize: 10, fontWeight: 800 },
  clipSpikeSection: { display: 'grid', gap: 10, marginBottom: 14, marginTop: 14 },
  clipSpikeHeading: { color: theme.textMuted, fontSize: 11, fontWeight: 900, letterSpacing: '0.04em', margin: 0, textTransform: 'uppercase' },
  analyticsFooter: { marginTop: 14, paddingBottom: 8, textAlign: 'center' },
  analyticsFooterLink: { background: 'transparent', border: 0, color: theme.accentText, cursor: 'pointer', fontSize: 11, fontWeight: 900, letterSpacing: '0.04em', padding: '4px 0', textTransform: 'uppercase' },
  clipSpikeCard: {
    background: 'var(--pulse-surface-hover-fill, rgba(255,255,255,0.035))',
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusButton,
    color: theme.textPrimary,
    display: 'block',
    overflow: 'hidden',
    textDecoration: 'none',
    transition: 'border-color 120ms ease, background 120ms ease, transform 120ms ease',
  },
  clipSpikeCardHover: {
    background: 'rgba(34, 211, 238, 0.06)',
    borderColor: 'rgba(34, 211, 238, 0.45)',
    transform: 'translateY(-1px)',
  },
  clipThumbWrap: { aspectRatio: '16 / 9', background: theme.chartBg, position: 'relative' },
  clipThumb: { display: 'block', height: '100%', objectFit: 'cover', width: '100%' },
  clipThumbFallback: { background: `linear-gradient(135deg, ${theme.panelElevated}, ${theme.chartBg})`, height: '100%', width: '100%' },
  clipDurationBadge: { background: 'rgba(0,0,0,0.75)', borderRadius: 4, bottom: 8, color: '#fff', fontSize: 11, fontWeight: 800, padding: '2px 8px', position: 'absolute', right: 8 },
  clipSpikeCta: {
    background: 'rgba(0,0,0,0.72)',
    borderRadius: 4,
    bottom: 8,
    color: '#e0f2fe',
    fontSize: 10,
    fontWeight: 800,
    left: 8,
    letterSpacing: '0.03em',
    padding: '2px 8px',
    position: 'absolute',
    textTransform: 'uppercase',
  },
  clipBody: { display: 'grid', gap: 6, padding: 12 },
  clipTitle: { display: '-webkit-box', fontSize: 13, fontWeight: 800, lineHeight: 1.35, overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 },
  clipViews: { color: theme.textMuted, fontSize: 11, fontWeight: 700 },
  collectingBadge: { background: theme.statusWarnBg, border: `1px solid ${theme.statusWarnBorder}`, borderRadius: 999, color: theme.statusWarnText, display: 'inline-block', fontSize: 10, fontWeight: 800, padding: '2px 8px', width: 'fit-content' },
  footerActionsSingle: { display: 'grid', gap: 8, marginTop: 12 },
}
