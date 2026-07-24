import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import {
  formatHeatOffset,
  LIVE_HEAT_MIN_COMPLETED_ROLLUPS,
  LIVE_HEAT_SUBTITLE,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import { CollapsedPill } from './CollapsedPill.tsx'
import { MiniDock } from './MiniDock.tsx'
import { LiveStatsBand } from './LiveStatsBand.tsx'
import { MostReactedSection } from './MostReactedSection.tsx'
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
  setOverlayMode,
  setSidebarTab,
  type OverlayMode,
  type OverlayPlacement,
  type SidebarTab,
  type PulseCacheWindow,
} from '../shared/storage.ts'
import { buildTwitchVodUrl } from '../shared/pastVods.ts'
import { resolvePulsePanelSections } from './pulsePanelLayout.ts'
import { AnalyticsHubCta } from './AnalyticsHubCta.tsx'
import { overlayTextLinkButton } from './momentReasonStyles.ts'
import { theme } from './theme.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import {
  isTwitchChattersOpen,
  readTwitchCollapseLabel,
  clickTwitchCollapseChat,
  toggleTwitchChatters,
} from '../content/twitchChatControls.ts'
import { getPrimaryVideo, seekPlaybackOffset, detectTwitchChannelLive, type TwitchPageContext } from '../content/twitch.ts'
import { discoverLiveVodIdFromDom } from '../content/twitchVodDiscovery.ts'
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
import { resolveVodPulseState } from '../vod/normalizeVodPulseFetch.ts'
import { PulseStatusPill, type PulseStatusKind } from './PulseStatusPill.tsx'
import { PulseSidebarTabs } from './PulseSidebarTabs.tsx'

function coverageErrorMessage(raw: string | null | undefined, fallback: string): string {
  return formatPulseApiError(raw) ?? fallback
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

export function Overlay(props: OverlayProps) {
  if (props.sidebarPart === 'tabs') {
    return <OverlayTabsShell {...props} />
  }
  return <OverlayMain {...props} />
}

/** Lightweight CHAT/PULSE header — must not own data-fetch/recap/chart effects. */
function OverlayTabsShell({
  effectivePlacement,
  sidebarTab: sidebarTabProp,
  overlayMode: overlayModeProp,
  onSidebarTabChange,
  onOverlayModeChange,
}: OverlayProps) {
  const [placement, setPlacementState] = useState<OverlayPlacement>('right')
  const [sidebarTab, setSidebarTabState] = useState<SidebarTab>('pulse')
  const [mode, setModeState] = useState<OverlayMode>('expanded')

  useEffect(() => {
    let mounted = true
    let displayRequestId = 0
    let tabRequestId = 0
    const refreshDisplay = () => {
      const requestId = ++displayRequestId
      void getOverlayDisplayPreferences().then(display => {
        if (!mounted || requestId !== displayRequestId) return
        setModeState(display.mode)
        setPlacementState(display.placement)
        onOverlayModeChange?.(display.mode)
      })
    }
    const refreshTab = () => {
      const requestId = ++tabRequestId
      void getSidebarTab().then(tab => {
        if (!mounted || requestId !== tabRequestId) return
        setSidebarTabState(tab)
        onSidebarTabChange?.(tab)
      })
    }
    void (async () => {
      const displayId = ++displayRequestId
      const tabId = ++tabRequestId
      const [display, storedSidebarTab] = await Promise.all([
        getOverlayDisplayPreferences(),
        getSidebarTab(),
      ])
      if (!mounted) return
      if (displayId === displayRequestId) {
        setModeState(display.mode)
        setPlacementState(display.placement)
      }
      if (tabId === tabRequestId) {
        setSidebarTabState(storedSidebarTab)
        onSidebarTabChange?.(storedSidebarTab)
      }
    })()
    const storageHandler = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'sync') return
      if (changes.overlayMode || changes.overlayPlacement) {
        refreshDisplay()
      }
      if (changes.sidebarTab) {
        refreshTab()
      }
    }
    chrome.storage.onChanged.addListener(storageHandler)
    return () => {
      mounted = false
      chrome.storage.onChanged.removeListener(storageHandler)
    }
  }, [onOverlayModeChange, onSidebarTabChange])

  const resolvedPlacement = effectivePlacement ?? placement
  const resolvedMode = overlayModeProp ?? mode
  const resolvedSidebarTab = sidebarTabProp ?? sidebarTab

  async function persistSidebarTab(next: SidebarTab): Promise<void> {
    if (next === 'pulse' && resolvedMode === 'collapsed') {
      setModeState('expanded')
      await setOverlayMode('expanded')
      onOverlayModeChange?.('expanded')
    }
    setSidebarTabState(next)
    await setSidebarTab(next)
    onSidebarTabChange?.(next)
  }

  if (resolvedPlacement === 'hidden') {
    return null
  }

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

function OverlayMain({
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
  overlayMode: overlayModeProp,
  onSidebarTabChange,
  onOverlayModeChange,
  onPulseRefresh,
  onPulsePayloadUpdate,
  onLivePollWindowChange,
  vodPulse = null,
  vodPulseLoading = false,
}: OverlayProps) {
  const [mode, setModeState] = useState<OverlayMode>('expanded')
  const [placement, setPlacementState] = useState<OverlayPlacement>('right')
  const [sidebarTab, setSidebarTabState] = useState<SidebarTab>('pulse')
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null)
  const [trackBusy, setTrackBusy] = useState(false)
  const [awaitingTrack, setAwaitingTrack] = useState(pendingTrackPrompt)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [topClip, setTopClip] = useState<ExtensionClip | null>(null)
  const [fullTimeline, setFullTimeline] = useState(false)
  const [missedBusy, setMissedBusy] = useState(false)
  const [missedRefreshed, setMissedRefreshed] = useState(false)
  const [missedJob, setMissedJob] = useState<PulseBackfillJob | null>(null)
  const [saveBusy, setSaveBusy] = useState(false)
  const [coverageLastCheck, setCoverageLastCheck] = useState<number | null>(null)
  const [coverageCheckError, setCoverageCheckError] = useState<string | null>(null)
  const [vodDebugDetail, setVodDebugDetail] = useState<string | null>(null)
  const [panelView, setPanelView] = useState<'pulse' | 'settings'>('pulse')
  const [chartPinOffset, setChartPinOffset] = useState<number | null>(null)
  const [mostReactedPinOffset, setMostReactedPinOffset] = useState<number | null>(null)
  const [chartPreviewOffset, setChartPreviewOffset] = useState<number | null>(null)
  const [alwaysTrackedLogins, setAlwaysTrackedLogins] = useState<string[]>([])
  const [coverageTierState, setCoverageTierState] = useState<ExtensionCoverageTierResponse | null>(
    coverageTierProp,
  )
  /** Bumped on login/stream change so obsolete backfill status polls exit. */
  const backfillGenerationRef = useRef(0)

  useEffect(() => {
    setCoverageTierState(coverageTierProp)
  }, [coverageTierProp, login])

  useEffect(() => {
    backfillGenerationRef.current += 1
    setMissedBusy(false)
    setMissedJob(null)
  }, [login, payload?.streamId])

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
    let displayRequestId = 0
    let tabRequestId = 0
    let backendRequestId = 0
    let autoUpdateRequestId = 0
    const refreshDisplay = () => {
      const requestId = ++displayRequestId
      void getOverlayDisplayPreferences().then(display => {
        if (!mounted || requestId !== displayRequestId) return
        setModeState(display.mode)
        setPlacementState(display.placement)
        onOverlayModeChange?.(display.mode)
      })
    }
    void (async () => {
      const displayId = ++displayRequestId
      const tabId = ++tabRequestId
      const backendId = ++backendRequestId
      const autoUpdateId = ++autoUpdateRequestId
      const [display, storedBackend, storedSidebarTab, storedAutoUpdate] = await Promise.all([
        getOverlayDisplayPreferences(),
        getBackendUrl(),
        getSidebarTab(),
        getAutoUpdateEnabled(),
      ])
      if (!mounted) return
      if (displayId === displayRequestId) {
        setModeState(display.mode)
        setPlacementState(display.placement)
      }
      if (backendId === backendRequestId) setBackendUrlState(storedBackend)
      if (tabId === tabRequestId) {
        setSidebarTabState(storedSidebarTab)
        onSidebarTabChange?.(storedSidebarTab)
      }
      if (autoUpdateId === autoUpdateRequestId) setAutoUpdate(storedAutoUpdate)
    })()
    const storageHandler = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== 'sync') return
      if (changes.overlayMode || changes.overlayPlacement) {
        refreshDisplay()
      }
      if (changes.sidebarTab) {
        const requestId = ++tabRequestId
        void getSidebarTab().then(tab => {
          if (!mounted || requestId !== tabRequestId) return
          setSidebarTabState(tab)
          onSidebarTabChange?.(tab)
        })
      }
      if (changes.backendUrl) {
        const requestId = ++backendRequestId
        void getBackendUrl().then(next => {
          if (mounted && requestId === backendRequestId) setBackendUrlState(next)
        })
      }
      if (changes.autoUpdateEnabled) {
        const requestId = ++autoUpdateRequestId
        void getAutoUpdateEnabled().then(next => {
          if (mounted && requestId === autoUpdateRequestId) setAutoUpdate(next)
        })
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
  const resolvedMode = overlayModeProp ?? mode
  const resolvedSidebarTab = sidebarTabProp ?? sidebarTab
  const showSidebarTabs = sidebarSnapped && resolvedPlacement === 'sidebar' && sidebarPart !== 'body'
  const sidebarBodyOnly = sidebarPart === 'body'
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
  const metricsCompact = sidebarSnapped && (panelHostWidth ?? 0) > 0 && (panelHostWidth ?? 0) < 360
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
    if (next === 'pulse' && resolvedMode === 'collapsed') {
      await persistMode('expanded')
    }
    setSidebarTabState(next)
    await setSidebarTab(next)
    onSidebarTabChange?.(next)
  }

  async function persistMode(next: OverlayMode): Promise<void> {
    setModeState(next)
    await setOverlayMode(next)
    onOverlayModeChange?.(next)
  }

  async function hideOverlay(): Promise<void> {
    await persistMode('collapsed')
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
    const generation = backfillGenerationRef.current
    const maxAttempts = 120
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (generation !== backfillGenerationRef.current) return
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 2000 : 7000))
      if (generation !== backfillGenerationRef.current) return
      const response = await sendBackgroundMessage({ type: 'GET_PULSE_BACKFILL_STATUS', jobId })
      if (generation !== backfillGenerationRef.current) return
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
        if (generation !== backfillGenerationRef.current) return
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
    if (generation !== backfillGenerationRef.current) return
    setNotice({ kind: 'warn', text: 'Backfill is taking longer than expected — try again shortly.' })
  }

  async function refreshVodDebugDetail(activePayload?: PulsePayload | null): Promise<void> {
    const source = activePayload ?? payload
    const summary = await summarizeVodDebugBlockers({
      backendVodResolved: source ? backendResolvedVod(source) : false,
    })
    setVodDebugDetail(summary)
  }

  async function submitPageVodHint(): Promise<string | null> {
    if (!payload?.streamId || payload.vodId) return payload?.vodId ?? null
    const domHint = discoverLiveVodIdFromDom()
    await pulseDebug('vod.discover.dom', domHint ? 'found archive id in page' : 'no archive id in page html', {
      login,
      streamId: payload.streamId,
      id: domHint,
    }, domHint ? 'info' : 'warn')
    let hint = domHint
    if (!hint) {
      const gqlRes = await sendBackgroundMessage({ type: 'DISCOVER_LIVE_VOD', login })
      const gql =
        'type' in gqlRes && gqlRes.type === 'DISCOVER_LIVE_VOD'
          ? gqlRes.result
          : { vodId: null, streamId: null, source: null, gqlErrors: ['background_unreachable'] as string[] }
      hint = gql.vodId
      await pulseDebug(
        'vod.discover.gql',
        hint ? `found archive id via Twitch GQL (${gql.source})` : 'GQL returned no archive id',
        {
          login,
          id: hint,
          source: gql.source,
          streamId: gql.streamId,
          pulseStreamId: payload.streamId,
          gqlErrors: gql.gqlErrors,
        },
        hint ? 'info' : 'warn',
      )
    }
    if (!hint) {
      await refreshVodDebugDetail()
      return null
    }
    try {
      const res = await sendBackgroundMessage({
        type: 'HINT_VOD',
        login,
        streamId: payload.streamId,
        vodId: hint,
      })
      if ('ok' in res && res.ok) {
        await refreshPulse(false)
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
      await submitPageVodHint()
      const healthRes = await sendBackgroundMessage({ type: 'HEALTH' }).catch(() => null)
      if (healthRes && 'type' in healthRes && healthRes.type === 'HEALTH') {
        const helix = healthRes.helixEnabled
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
      await pulseDebug('ui.coverage', 'vod check finished', {
        login,
        streamId: next.streamId ?? null,
        vodId: next.vodId ?? null,
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
        await refreshVodDebugDetail(next)
        return
      }
      if (next.helixEnabled === false) {
        setCoverageCheckError(
          'Backend Helix is off — analytics needs TWITCH_OAUTH_CLIENT_ID/SECRET (or redeploy latest analytics).',
        )
        await refreshVodDebugDetail(next)
        return
      }
      if (!next.vodId && healthRes && 'type' in healthRes && healthRes.type === 'HEALTH' && healthRes.helixEnabled == null) {
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
      await refreshVodDebugDetail(next)
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
        setCoverageCheckError('Could not start backfill — check backend URL in settings.')
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
  useEffect(() => {
    if (hostedBackend) return
    if (!payload?.tracking || !uiIsLive) return
    if (coverageCheckError?.includes('at capacity')) return
    if (coverageForPoll?.state !== 'waiting_for_vod' && !coverageForPoll?.canBackfill) return
    if (missedBusy || missedJob?.status === 'fetching_chat') return

    const timer = window.setInterval(() => {
      void refreshVodStatus()
    }, 45_000)

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
  ])

  function openSettings(): void {
    void sendBackgroundMessage({ type: 'OPEN_OPTIONS' })
  }

  function openInlineSettings(): void {
    setPanelView('settings')
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
    seekToStreamStart()
  }

  function seekToStreamStart(): void {
    setFullTimeline(true)
    setNotice(null)
    const vodId = payload?.vodId ?? context.vodId ?? undefined
    const offset = 0

    if (vodId) {
      const vodUrl = buildTwitchVodUrl(vodId, offset)
      if (context.kind === 'vod' && context.vodId === vodId) {
        const result = seekPlaybackOffset(getPrimaryVideo(), offset, { isLive: false })
        setNotice({
          kind: 'ok',
          text: result.ok
            ? 'Jumped to stream start in the VOD player.'
            : 'Scrub the VOD player to stream start.',
        })
        return
      }
      window.open(vodUrl, '_blank', 'noopener,noreferrer')
      setNotice({
        kind: 'ok',
        text: 'Opened Twitch VOD at stream start.',
      })
      return
    }

    if (uiIsLive && context.kind === 'channel') {
      const result = seekPlaybackOffset(getPrimaryVideo(), offset, {
        isLive: true,
        liveCurrentOffset: payload?.currentOffsetSeconds ?? 0,
      })
      if (result.ok) {
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
    seekToStreamStart()
  }

  async function saveMoment(point: LiveHeatPoint): Promise<void> {
    if (!payload) return
    setSaveBusy(true)
    setNotice(null)
    try {
      const response = await sendBackgroundMessage({
        type: 'SAVE_BOOKMARK',
        bookmark: {
          login: payload.login,
          streamId: payload.streamId,
          vodId: payload.vodId ?? undefined,
          offsetSeconds: point.offsetSeconds,
          label: `${formatHeatOffset(point.offsetSeconds)} · ${point.reasonLabel}`,
          score: point.score,
          source: 'extension',
        },
      })
      if ('type' in response && response.type === 'BOOKMARK') {
        setNotice({ kind: 'ok', text: `Saved moment at ${formatHeatOffset(point.offsetSeconds)}.` })
        return
      }
      if ('error' in response && response.error) {
        setNotice({ kind: 'warn', text: String(response.error) })
      }
    } catch (err) {
      setNotice({ kind: 'warn', text: err instanceof Error ? err.message : 'Could not save moment.' })
    } finally {
      setSaveBusy(false)
    }
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

  function jumpMoment(point: LiveHeatPoint): void {
    setNotice(null)
    const action = resolveJumpMomentAction({
      context,
      payloadVodId: payload?.vodId ?? context.vodId,
      payloadIsLive: payload?.isLive,
      liveCurrentOffset: payload?.currentOffsetSeconds,
      offsetSeconds: point.offsetSeconds,
    })

    if (action.kind === 'seek-vod') {
      const result = seekPlaybackOffset(getPrimaryVideo(), action.offsetSeconds, { isLive: false })
      setNotice({
        kind: result.ok ? 'ok' : 'warn',
        text: result.ok
          ? `Jumped to ${formatHeatOffset(action.offsetSeconds)} in the VOD player.`
          : `Scrub the VOD player to ${formatHeatOffset(action.offsetSeconds)}.`,
      })
      return
    }

    if (action.kind === 'open-vod-tab') {
      window.open(buildTwitchVodUrl(action.vodId, action.offsetSeconds), '_blank', 'noopener,noreferrer')
      setNotice({
        kind: 'ok',
        text: `Opened Twitch VOD at ${formatHeatOffset(action.offsetSeconds)}.`,
      })
      return
    }

    if (action.kind === 'open-analytics') {
      openAnalytics(action.offsetSeconds)
      return
    }

    if (action.kind === 'seek-live-dvr') {
      const result = seekPlaybackOffset(getPrimaryVideo(), action.offsetSeconds, {
        isLive: true,
        liveCurrentOffset: action.liveCurrentOffset,
      })
      if (result.ok) {
        setNotice({ kind: 'ok', text: `Jumped to ${formatHeatOffset(action.offsetSeconds)} inside the live DVR buffer.` })
        return
      }
      setNotice({
        kind: 'warn',
        text:
          result.reason === 'outside_buffer'
            ? `Replay after VOD: ${formatHeatOffset(action.offsetSeconds)} is outside the live DVR buffer.`
            : 'Open in Streamclone once VOD context is available.',
      })
      return
    }

    setNotice({
      kind: 'warn',
      text: `Replay after VOD: ${formatHeatOffset(action.offsetSeconds)} is outside the live DVR buffer.`,
    })
  }

  if (resolvedPlacement === 'hidden') {
    return null
  }

  if (sidebarBodyOnly && resolvedSidebarTab === 'chat') {
    return null
  }

  // Body host visibility is owned by mount.tsx (hidden entirely on Chat tab).
  if (resolvedMode === 'collapsed') {
    return (
      <section className={shellClass} style={styles.collapsedHost} aria-label="StreamPulse collapsed">
        <CollapsedPill
          tracking={payload?.tracking ?? false}
          isLive={uiIsLive}
          sidebarFill={sidebarBodyOnly}
          onOpen={() => void persistMode('expanded')}
        />
      </section>
    )
  }

  if (resolvedMode === 'mini') {
    return (
      <section className={shellClass} style={styles.miniHost} aria-label="StreamPulse mini overlay">
        <MiniDock
          login={login}
          payload={payload}
          tracking={pulseLiveAccess.state === 'full_live'}
          isLive={uiIsLive}
          trackBusy={trackBusy}
          sidebarFill={sidebarBodyOnly}
          onExpand={() => void persistMode('expanded')}
          onSettings={openSettings}
          onHide={() => void hideOverlay()}
          onTrack={localStackBackend ? () => void startTracking() : undefined}
        />
      </section>
    )
  }

  return (
    <section
      className={shellClass}
      style={{ ...styles.panel, height: sidebarBodyOnly ? '100%' : undefined, padding: showSidebarTabs || sidebarBodyOnly ? 0 : 20 }}
      aria-label="StreamPulse overlay"
    >
      {showSidebarTabs ? (
        <div className="pulse-sidebar-tabs-wrap" style={styles.sidebarTabsWrap}>
          <PulseSidebarTabs active={resolvedSidebarTab} onChange={tab => void persistSidebarTab(tab)} />
        </div>
      ) : null}

      <div
        className={`pulse-panel-body ${showSidebarTabs ? 'pulse-tab-fade' : ''}`}
        style={{
          ...(sidebarChatOnly ? styles.panelHidden : undefined),
          padding: showSidebarTabs ? '0 10px 10px' : sidebarBodyOnly ? '10px' : 0,
          flex: sidebarBodyOnly ? 1 : undefined,
          minWidth: 0,
          minHeight: sidebarBodyOnly ? 120 : undefined,
          overflow: sidebarBodyOnly ? 'auto' : undefined,
          position: sidebarBodyOnly ? 'relative' : undefined,
        }}
      >
      <PanelErrorBoundary>
      {panelView === 'settings' && sidebarBodyOnly ? (
        <div key="settings" className="pulse-panel-view-enter pulse-panel-view-settings pulse-panel-view-stack">
          <PulseSettingsPanel
            onAutoUpdateChange={next => void persistAutoUpdate(next)}
            onBack={() => setPanelView('pulse')}
            onOpenFullSettings={openSettings}
          />
        </div>
      ) : (
        <div
          key={sidebarBodyOnly ? 'pulse' : 'pulse-full'}
          className={
            sidebarBodyOnly
              ? 'pulse-panel-view-enter pulse-panel-view-pulse pulse-panel-view-stack'
              : 'pulse-panel-view-stack'
          }
        >
      <StreamPulseHeader
        isLive={uiIsLive}
        pulseLiveAccess={pulseLiveAccess.state}
        pulseSupported={pulseSupported}
        trackBusy={trackBusy}
        autoUpdate={autoUpdate}
        sidebarFill={sidebarSnapped}
        hideUtilityActions={sidebarSnapped}
        hostedBackend={hostedBackend}
        backendUrl={backendUrl}
        onAutoUpdateChange={next => void persistAutoUpdate(next)}
        onTrack={localStackBackend ? () => void startTracking() : undefined}
        onSettings={() => (sidebarSnapped ? openInlineSettings() : openSettings())}
        onMini={() => void persistMode('mini')}
        onHide={() => void hideOverlay()}
      />

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
            <button type="button" style={styles.secondaryButton} onClick={openSettings}>Manage watchlist</button>
          </div>
        </section>
      ) : null}

      {error ? (
        <BackendError backendUrl={backendUrl} onRetry={() => void refreshPulse()} onSettings={openSettings} />
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
                  compact={metricsCompact && !sidebarSnapped}
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
                  onSaveMoment={point => void saveMoment(point)}
                  saveMomentBusy={saveBusy}
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
                  onSave={point => void saveMoment(point)}
                  onAnalytics={openAnalyticsForMoment}
                  onHighlightOffset={setChartPreviewOffset}
                  onPinOffset={handleMostReactedPin}
                  saveBusy={saveBusy}
                  hasVodContext={Boolean(payload?.vodId ?? context.vodId)}
                />
              ) : null}
            </div>
          ) : null}

          {payload && pulseLiveAccess.state === 'full_live' && !hostedBackend && shouldShowMissedMomentsBanner(payload) ? (
            <CoverageCard
              source={{ ...payload, tracking: payload.tracking }}
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

          {notice ? <p style={{ ...styles.notice, ...(notice.kind === 'warn' ? styles.noticeWarn : notice.kind === 'ok' ? styles.noticeOk : {}) }}>{notice.text}</p> : null}

          {topClip && !isVodPage ? <ClipSpikeCard clip={topClip} /> : null}

          {!isVodPage ? (
          <PastVodsSection
            login={login}
            backendUrl={backendUrl}
            liveStreamId={payload.streamId}
            isLive={uiIsLive}
            channelOffline={!uiIsLive}
            onOpenFromStart={openStreamStartToLive}
          />
          ) : null}

          {sidebarBodyOnly && panelView === 'pulse' && !sidebarChatOnly ? (
            <div style={styles.settingsFabDock}>
              <button
                type="button"
                className="pulse-settings-gear-fab"
                style={styles.settingsGearFab}
                aria-label="Open settings"
                title="Settings"
                onClick={() => setPanelView('settings')}
              >
                <SettingsGearIcon />
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {!error && !payload ? (
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
        </div>
      )}
      </PanelErrorBoundary>
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
  hideUtilityActions = false,
  hostedBackend = true,
  backendUrl,
  onAutoUpdateChange,
  onTrack,
  onSettings,
  onMini,
  onHide,
}: {
  isLive: boolean
  pulseLiveAccess: import('./resolvePulseLiveAccess.ts').PulseLiveAccessState
  pulseSupported: boolean
  trackBusy: boolean
  autoUpdate: boolean
  sidebarFill?: boolean
  hideUtilityActions?: boolean
  hostedBackend?: boolean
  backendUrl: string
  onAutoUpdateChange: (next: boolean) => void
  onTrack?: () => void
  onSettings: () => void
  onMini: () => void
  onHide: () => void
}) {
  const headerStyle = sidebarFill ? styles.streamPulseHeaderSidebar : styles.streamPulseHeader
  const actionsStyle = sidebarFill ? styles.streamPulseHeaderActionsSidebar : styles.streamPulseHeaderActions
  const trackButtonStyle = sidebarFill ? styles.trackingButtonFull : styles.trackingButton
  const trackStreamerStyle = sidebarFill ? styles.trackStreamerButtonFull : styles.trackStreamerButton
  const autoUpdateStyle = sidebarFill ? styles.autoUpdateLabelFull : styles.autoUpdateLabel
  const iconRowStyle = sidebarFill ? styles.headerIconRowFull : styles.headerIconRow

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
    <header style={headerStyle}>
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
        <div style={iconRowStyle}>
          {hideUtilityActions ? null : (
            <>
              <button type="button" style={sidebarFill ? styles.headerIconButtonFull : styles.headerIconButton} onClick={onSettings} title="Settings">Settings</button>
              <button type="button" style={sidebarFill ? styles.headerIconButtonFull : styles.headerIconButton} onClick={onMini} title="Mini mode">Mini</button>
              <button type="button" style={sidebarFill ? styles.headerIconButtonFull : styles.headerIconButton} onClick={onHide} title="Hide overlay">Hide</button>
            </>
          )}
        </div>
      </div>
      <AnalyticsHubCta backendUrl={backendUrl} compact={sidebarFill} />
    </header>
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
        : state.status === 'missing'
          ? state.reason ?? 'No replay analytics have been indexed for this VOD yet.'
          : state.status === 'error'
            ? state.message
            : 'Replay analytics are partially available.'

  return (
    <PulseSectionCard title="Replay Pulse">
      <div style={styles.vodStateWrap}>
        <PulseStatusPill status={status} />
        <p style={styles.stateText}>{subtitle}</p>
        {onRetry ? (
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
  return (
    <section style={styles.clipSpikeSection}>
      <h3 style={styles.clipSpikeHeading}>Clip spike</h3>
      <a href={clip.url} target="_blank" rel="noreferrer" style={styles.clipSpikeCard}>
        <div style={styles.clipThumbWrap}>
          {clip.thumbnailUrl ? (
            <img src={clip.thumbnailUrl} alt={clip.title} style={styles.clipThumb} loading="lazy" />
          ) : (
            <div style={styles.clipThumbFallback} />
          )}
          {duration ? <span style={styles.clipDurationBadge}>{duration}</span> : null}
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
  return <span style={styles.brandMark}><span style={styles.brandDot} /></span>
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
  headerTabsShell: { alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'center', width: '100%' },
  miniHost: { display: 'flex', height: '100%', width: '100%' },
  collapsedHost: { display: 'flex', height: '100%', width: '100%' },
  header: { alignItems: 'flex-start', display: 'flex', gap: 12, justifyContent: 'space-between' },
  titleRow: { alignItems: 'center', display: 'flex', gap: 12 },
  headerActions: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
  title: { fontSize: 22, fontWeight: 800, lineHeight: 1.15 },
  titleLogin: { color: theme.textSecondary, fontWeight: 700, marginLeft: 6 },
  subtitle: { color: theme.textSecondary, fontSize: 12, marginTop: 3 },
  brandMark: { alignItems: 'center', background: theme.accent, borderRadius: 10, display: 'inline-flex', height: 34, justifyContent: 'center', minWidth: 34 },
  brandDot: { background: theme.textPrimary, borderRadius: 999, display: 'block', height: 12, width: 12 },
  statusLive: { alignItems: 'center', background: 'rgba(34,197,94,0.18)', border: '1px solid rgba(34,197,94,0.55)', borderRadius: theme.radiusPill, color: theme.liveSoft, display: 'inline-flex', fontSize: 12, fontWeight: 800, gap: 8, padding: '7px 12px' },
  statusIdle: { alignItems: 'center', background: theme.panelElevated, border: `1px solid ${theme.border}`, borderRadius: theme.radiusPill, color: theme.textSecondary, display: 'inline-flex', fontSize: 12, fontWeight: 800, gap: 8, padding: '7px 12px' },
  statusLiveCompact: { alignItems: 'center', background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: theme.radiusPill, color: theme.liveSoft, display: 'inline-flex', fontSize: 10, fontWeight: 800, gap: 6, padding: '4px 8px', width: 'fit-content' },
  statusIdleCompact: { alignItems: 'center', background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: theme.radiusPill, color: theme.textSecondary, display: 'inline-flex', fontSize: 10, fontWeight: 800, gap: 6, padding: '4px 8px', width: 'fit-content' },
  dotGreen: { background: theme.live, borderRadius: 999, display: 'inline-block', height: 9, width: 9 },
  dotMuted: { background: '#6b7280', borderRadius: 999, display: 'inline-block', height: 9, width: 9 },
  trackingText: { alignItems: 'center', color: '#4ade80', display: 'inline-flex', fontWeight: 800, gap: 6 },
  muted: { color: '#8b8ba0' },
  smallButton: { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, color: theme.textPrimary, cursor: 'pointer', fontSize: 12, fontWeight: 700, padding: '7px 10px' },
  primaryButtonSmall: { background: theme.accent, border: 0, borderRadius: theme.radiusButton, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 800, padding: '7px 12px' },
  heatStripEmpty: { alignItems: 'center', background: '#101014', border: '1px dashed #3f3f50', borderRadius: 12, color: '#8b8ba0', display: 'flex', fontSize: 12, height: 112, justifyContent: 'center', padding: 16, textAlign: 'center' },
  heatStripEmptyCompact: { alignItems: 'center', color: '#8b8ba0', display: 'flex', fontSize: 11, height: 44, justifyContent: 'center', minWidth: 96 },
  trackPrompt: { background: '#1f1f27', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35)', borderRadius: 12, marginBottom: 14, padding: 14 },
  statsGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginBottom: 18 },
  recapGrid: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginBottom: 12 },
  statCard: { background: theme.panel, border: `1px solid ${theme.border}`, borderRadius: 12, minWidth: 0, padding: 12 },
  statLabel: { color: '#a1a1b2', fontSize: 10, fontWeight: 800 },
  statValue: { fontSize: 26, fontWeight: 800, lineHeight: 1.15, marginTop: 6 },
  statDetail: { fontSize: 12, fontWeight: 800, marginTop: 6 },
  section: { borderTop: '1px solid rgba(63,63,80,0.75)', marginTop: 16, paddingTop: 16 },
  sectionHeading: { alignItems: 'center', color: '#a1a1b2', display: 'flex', fontSize: 12, fontWeight: 800, justifyContent: 'space-between', marginBottom: 10, textTransform: 'uppercase' },
  heatStrip: { alignItems: 'end', background: '#101014', borderRadius: 12, display: 'flex', gap: 5, height: 112, padding: '16px 14px 12px' },
  heatStripCompact: { alignItems: 'end', display: 'flex', flex: 1, gap: 5, height: 44, justifyContent: 'flex-end', minWidth: 140 },
  heatBar: { borderRadius: 4, display: 'block', flex: '1 1 7px', minWidth: 4 },
  axis: { color: '#8b8ba0', display: 'flex', fontSize: 11, justifyContent: 'space-between', marginTop: 8 },
  lanes: { display: 'grid', gap: 12 },
  lane: { alignItems: 'center', display: 'grid', gap: 14, gridTemplateColumns: '74px 1fr' },
  laneLabel: { color: '#8b8ba0', display: 'grid', fontSize: 11, gap: 2 },
  laneBars: { alignItems: 'end', display: 'flex', gap: 6, height: 34 },
  laneBar: { borderRadius: 4, display: 'block', flex: 1, minWidth: 6 },
  momentList: { display: 'grid', gap: 8 },
  momentRow: { alignItems: 'center', background: '#22222b', borderRadius: 10, display: 'grid', gap: 10, gridTemplateColumns: '34px 1fr auto', padding: '10px 12px', transition: 'transform 0.15s ease, box-shadow 0.15s ease' },
  rank: { alignItems: 'center', background: '#7c3aed', borderRadius: 9, display: 'inline-flex', fontWeight: 800, height: 34, justifyContent: 'center', width: 34 },
  momentMain: { display: 'grid', gap: 3, minWidth: 0 },
  rowActions: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  textButton: { background: 'transparent', border: 0, color: 'var(--pulse-accent-soft, #c4b5fd)', cursor: 'pointer', fontSize: 11, fontWeight: 800, padding: 0 },
  textButtonLarge: { background: 'transparent', border: 0, color: 'var(--pulse-accent-soft, #c4b5fd)', cursor: 'pointer', fontSize: 14, fontWeight: 800, padding: '8px 0' },
  score: { color: '#fb7185', display: 'grid', fontSize: 11, justifyItems: 'end' },
  footerActions: { display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr', marginTop: 14 },
  emoteChips: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  emoteChip: { alignItems: 'center', background: '#22222b', border: '1px solid #3f3f50', borderRadius: 999, color: '#fafafc', display: 'inline-flex', fontSize: 11, fontWeight: 800, gap: 6, padding: '6px 9px' },
  emoteChipImg: { display: 'block', objectFit: 'contain' },
  saveTools: { display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr 1fr', marginBottom: 12 },
  offsetInput: { background: '#101014', border: '1px solid #3f3f50', borderRadius: 10, color: '#fafafc', font: 'inherit', minWidth: 0, padding: '10px 12px' },
  savedList: { display: 'grid', gap: 8 },
  savedRow: { alignItems: 'center', background: '#22222b', borderRadius: 10, display: 'grid', gap: 10, gridTemplateColumns: '1fr auto', padding: '9px 12px' },
  savedMain: { background: 'transparent', border: 0, color: '#fafafc', cursor: 'pointer', display: 'grid', gap: 3, minWidth: 0, padding: 0, textAlign: 'left' },
  primaryButton: { background: 'var(--pulse-accent, #8b5cf6)', border: 0, borderRadius: 10, color: 'var(--pulse-on-accent, #fff)', cursor: 'pointer', fontWeight: 800, padding: '12px 14px' },
  hubLinkButton: { background: 'var(--pulse-accent, #8b5cf6)', border: 0, borderRadius: 10, color: 'var(--pulse-on-accent, #fff)', cursor: 'pointer', fontWeight: 800, padding: '12px 14px' },
  secondaryButton: { background: '#2b2b32', border: '1px solid #3f3f50', borderRadius: 10, color: '#fafafc', cursor: 'pointer', fontWeight: 800, padding: '12px 14px' },
  stateBlock: { background: '#1f1f27', borderRadius: 12, marginTop: 16, padding: 16 },
  stateTitle: { fontSize: 18, margin: '0 0 10px' },
  stateText: { color: '#b7b7c6', fontSize: 13, lineHeight: 1.35, margin: '0 0 14px' },
  vodStateWrap: { display: 'grid', gap: 8 },
  progressTrack: { background: '#33333d', borderRadius: 999, height: 8, marginBottom: 10, overflow: 'hidden' },
  progressFill: { background: 'var(--pulse-accent-soft, #a78bfa)', borderRadius: 999, display: 'block', height: '100%' },
  errorBlock: { background: '#1f1f27', borderRadius: 12, padding: 16 },
  errorTitle: { color: '#f87171', fontSize: 18, margin: '0 0 10px' },
  notice: { background: '#2a2440', border: '1px solid #3f3f50', borderRadius: 10, color: 'var(--pulse-accent-soft, #c4b5fd)', fontSize: 12, fontWeight: 700, margin: '14px 0 0', padding: '10px 12px' },
  noticeWarn: { background: 'rgba(249,115,22,0.12)', borderColor: 'rgba(249,115,22,0.35)', color: '#fdba74' },
  noticeOk: { background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)', color: '#86efac' },
  streamPulseHeader: { alignItems: 'flex-start', border: '1px solid rgba(255,255,255,0.1)', borderRadius: theme.radiusButton, display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', marginBottom: 14, padding: '12px 14px', width: '100%' },
  streamPulseHeaderSidebar: { alignItems: 'stretch', border: '1px solid rgba(255,255,255,0.1)', borderRadius: theme.radiusButton, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10, padding: '10px 12px', width: '100%' },
  streamPulseHeaderMain: { flex: '1 1 180px', minWidth: 0, width: '100%' },
  streamPulseHeaderMainSidebar: { flex: '0 0 auto', minWidth: 0, width: '100%' },
  streamPulseTitleRow: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  streamPulseTitle: { fontSize: 13, fontWeight: 900, letterSpacing: '0.06em', margin: 0, textTransform: 'uppercase' },
  liveBadge: { background: '#dc2626', borderRadius: 4, color: '#fff', fontSize: 10, fontWeight: 900, padding: '2px 6px', textTransform: 'uppercase' },
  apiPillHosted: {
    background: 'rgba(34, 197, 94, 0.14)',
    border: '1px solid rgba(34, 197, 94, 0.35)',
    borderRadius: 999,
    color: 'rgba(187, 247, 208, 0.95)',
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.04em',
    padding: '2px 8px',
    textTransform: 'uppercase',
  },
  apiPillLocal: {
    background: 'rgba(245, 158, 11, 0.14)',
    border: '1px solid rgba(245, 158, 11, 0.4)',
    borderRadius: 999,
    color: 'rgba(253, 230, 138, 0.95)',
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
  trackStreamerButton: { background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1)', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.3)', borderRadius: theme.radiusButton, color: 'var(--pulse-accent-ink, #ddd6fe)', cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '8px 12px', textTransform: 'uppercase' },
  trackStreamerButtonFull: { background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1)', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.3)', borderRadius: theme.radiusButton, color: 'var(--pulse-accent-ink, #ddd6fe)', cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '10px 12px', textAlign: 'center', textTransform: 'uppercase', width: '100%' },
  trackingButton: { background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22)', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45)', borderRadius: 999, color: 'var(--pulse-accent-soft, #c4b5fd)', display: 'inline-block', fontSize: 10, fontWeight: 900, letterSpacing: '0.04em', padding: '4px 10px', textTransform: 'uppercase' },
  trackingButtonFull: { background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22)', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45)', borderRadius: 999, color: 'var(--pulse-accent-soft, #c4b5fd)', display: 'block', fontSize: 10, fontWeight: 900, letterSpacing: '0.04em', padding: '8px 12px', textAlign: 'center', textTransform: 'uppercase', width: '100%' },
  headerIconButton: { background: 'transparent', border: 0, color: theme.textMuted, cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '2px 4px' },
  headerIconButtonFull: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: theme.textMuted, cursor: 'pointer', fontSize: 11, fontWeight: 700, padding: '8px 6px', textAlign: 'center', width: '100%' },
  autoUpdateLabel: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 11, fontWeight: 600, gap: 8 },
  autoUpdateLabelFull: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 11, fontWeight: 600, gap: 8, justifyContent: 'space-between', width: '100%' },
  autoUpdateSwitch: { border: 0, borderRadius: 999, cursor: 'pointer', flexShrink: 0, height: 22, position: 'relative', width: 36 },
  autoUpdateKnob: { background: '#fff', borderRadius: 999, height: 18, position: 'absolute', top: 2, width: 18 },
  headerIconRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  headerIconRowFull: { display: 'grid', gap: 6, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', width: '100%' },
  coverageNotice: { color: theme.textSecondary, fontSize: 11, fontWeight: 600, lineHeight: 1.4, margin: '0 0 12px' },
  liveNowBand: { background: 'rgba(0,0,0,0.25)', border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, marginBottom: 14, padding: 12 },
  liveNowHeader: { alignItems: 'center', display: 'flex', justifyContent: 'space-between', marginBottom: 10 },
  liveNowTitle: { fontSize: 11, fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase' },
  syncedBadge: { background: 'rgba(34,211,238,0.15)', border: '1px solid rgba(34,211,238,0.35)', borderRadius: 999, color: theme.accent2, fontSize: 10, fontWeight: 800, padding: '3px 8px' },
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
  chartWindowButtonActive: { background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.2)', borderColor: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45)', color: 'var(--pulse-accent-ink, #ddd6fe)' },
  topEmotesRow: { alignItems: 'center', display: 'flex', gap: 8, marginTop: 10 },
  topEmotesLabel: { color: theme.textMuted, fontSize: 9, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' },
  topEmoteChips: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8 },
  topEmoteChip: { alignItems: 'center', background: 'rgba(255,255,255,0.05)', border: '1px solid transparent', borderRadius: 6, display: 'inline-flex', gap: 6, padding: '4px 6px' },
  topEmoteChipButton: { background: 'rgba(255,255,255,0.05)', color: 'inherit', cursor: 'pointer', font: 'inherit' },
  topEmoteChipActive: { background: 'rgba(74, 222, 128, 0.12)', borderColor: 'rgba(74, 222, 128, 0.45)' },
  topEmoteImg: { display: 'block', height: 24, objectFit: 'contain', width: 24 },
  topEmoteName: { color: theme.textSecondary, fontSize: 11, fontWeight: 700 },
  topEmoteCount: { color: theme.textMuted, fontSize: 10, fontWeight: 800 },
  clipSpikeSection: { display: 'grid', gap: 10, marginBottom: 14, marginTop: 14 },
  clipSpikeHeading: { color: theme.textMuted, fontSize: 11, fontWeight: 900, letterSpacing: '0.04em', margin: 0, textTransform: 'uppercase' },
  analyticsFooter: { marginTop: 14, paddingBottom: 8, textAlign: 'center' },
  analyticsFooterLink: { background: 'transparent', border: 0, color: 'var(--pulse-accent-soft, #c4b5fd)', cursor: 'pointer', fontSize: 11, fontWeight: 900, letterSpacing: '0.04em', padding: '4px 0', textTransform: 'uppercase' },
  clipSpikeCard: { background: 'rgba(255,255,255,0.035)', border: `1px solid ${theme.border}`, borderRadius: theme.radiusButton, color: theme.textPrimary, display: 'block', overflow: 'hidden', textDecoration: 'none' },
  clipThumbWrap: { aspectRatio: '16 / 9', background: '#101014', position: 'relative' },
  clipThumb: { display: 'block', height: '100%', objectFit: 'cover', width: '100%' },
  clipThumbFallback: { background: 'linear-gradient(135deg, #1f1f27, #101014)', height: '100%', width: '100%' },
  clipDurationBadge: { background: 'rgba(0,0,0,0.75)', borderRadius: 4, bottom: 8, color: '#fafafc', fontSize: 11, fontWeight: 800, padding: '2px 8px', position: 'absolute', right: 8 },
  clipBody: { display: 'grid', gap: 6, padding: 12 },
  clipTitle: { display: '-webkit-box', fontSize: 13, fontWeight: 800, lineHeight: 1.35, overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 },
  clipViews: { color: theme.textMuted, fontSize: 11, fontWeight: 700 },
  collectingBadge: { background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 999, color: '#fde68a', display: 'inline-block', fontSize: 10, fontWeight: 800, padding: '2px 8px', width: 'fit-content' },
  footerActionsSingle: { display: 'grid', gap: 8, marginTop: 12 },
  settingsFabDock: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: 4,
    paddingTop: 4,
  },
  settingsGearFab: {
    alignItems: 'center',
    background: 'rgba(17, 17, 23, 0.96)',
    border: `1px solid ${theme.borderAccent}`,
    borderRadius: 999,
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
    color: theme.textSecondary,
    cursor: 'pointer',
    display: 'inline-flex',
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
}

function SettingsGearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path
        d="M8 1.8 9.2 3.1l1.7-.3.8 1.6 1.6.8-.3 1.7 1.3 1.2v1.8L13.2 12l.3 1.7-1.6.8-.8 1.6-1.7-.3L8 16.2l-1.2-1.3-1.7.3-.8-1.6-1.6-.8.3-1.7L2.8 12V10.2l1.3-1.2-.3-1.7 1.6-.8.8-1.6 1.7.3L8 1.8Z"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}
