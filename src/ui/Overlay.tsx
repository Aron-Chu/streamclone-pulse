import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import {
  formatHeatOffset,
  LIVE_HEAT_MIN_COMPLETED_ROLLUPS,
  reactionAnalyticalOffset,
  reactionLeadInOffset,
  reactionMomentWindow,
  type LiveHeatPoint,
} from '@streampulse/pulse-core'
import { CollapsedPill } from './CollapsedPill.tsx'
import { MiniDock } from './MiniDock.tsx'
import { LiveStatsBand } from './LiveStatsBand.tsx'
import { MostReactedSection } from './MostReactedSection.tsx'
import { PastVodsSection } from './PastVodsSection.tsx'
import { CoverageCard } from './CoverageCard.tsx'
import { PulseSettingsPanel } from './PulseSettingsPanel.tsx'
import { SettingsGearIcon } from './SettingsGearIcon.tsx'
import { useSupporterAppearance } from './useSupporterAppearance.ts'
import { StreamPulseTitleBlock, streamPulseHeaderChrome, streamPulseHeaderChromeSidebar } from './StreamPulseTitleBlock.tsx'
import { PulseBannerBackdrop, usePulseBanner } from './PulseBanner.tsx'
import { AnalyticsHubCta } from './AnalyticsHubCta.tsx'
import { rollupToRecapHeatPoint } from './recapChartPeaks.ts'
import { buildRecapEmoteCatalog } from './recapEmotes.ts'
import { PulseSectionCard } from './PulseSectionCard.tsx'
import { PanelErrorBoundary } from './PanelErrorBoundary.tsx'
import type { ExtensionClip, ExtensionCoverageTierResponse, ExtensionRollup, PulseBackfillJob, PulsePayload, PulseUpdateMessage } from '../shared/messages.ts'
import { openStreamAnalytics } from '../shared/analyticsLinks.ts'
import {
  DEFAULT_BACKEND_URL,
  getAutoUpdateEnabled,
  getBackendUrl,
  getDensityPreference,
  getVodJumpChartPinEnabled,
  getOverlayDisplayPreferences,
  getSidebarTab,
  isHostedBackendUrl,
  isLocalStackBackendUrl,
  setOverlayMode,
  setSidebarTab,
  type DensityPreference,
  type OverlayMode,
  type OverlayPlacement,
  type SidebarTab,
  type PulseCacheWindow,
} from '../shared/storage.ts'
import { buildTwitchVodUrl } from '../shared/pastVods.ts'
import { rememberVodAnalyticsBridge } from '../shared/vodAnalyticsBridge.ts'
import {
  pulseSurfaceStatusLabel,
  resolvePulsePanelSections,
  resolvePulsePanelSurfaceState,
  type PulsePanelSurfaceState,
} from './pulsePanelLayout.ts'
import { theme } from './theme.ts'
import { sendBackgroundMessage } from '../content/bridge.ts'
import { EXTENSION_RECONNECT_MESSAGE } from '../shared/backgroundResponse.ts'
import {
  activationFromOverlay,
  createBackfillOperationController,
  delay,
  isAbortError,
  type BackfillOperationToken,
} from './backfillOperation.ts'
import {
  hasStableFullHistoryActivation,
  hasValidatedFullHistory,
  sameFullHistoryActivation,
  type FullHistoryRequestResult,
} from '../shared/fullHistoryAuth.ts'
import {
  isTwitchChattersOpen,
  readTwitchCollapseLabel,
  clickTwitchCollapseChat,
  toggleTwitchChatters,
} from '../content/twitchChatControls.ts'
import { getPrimaryVideo, seekPlaybackOffset, seekPlaybackOffsetVerified, streamOffsetSecondsForLiveSeek, type TwitchPageContext } from '../content/twitch.ts'
import { observeMomentPlayback } from '../content/momentPlayback.ts'
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
import { isVodArchiveConflict, resolveVodPulseState } from '../vod/normalizeVodPulseFetch.ts'
import { PulseStatusPill, type PulseStatusKind } from './PulseStatusPill.tsx'
import { PulseSidebarTabs } from './PulseSidebarTabs.tsx'
import { safeImageUrl, safeTwitchNavigationUrl } from '../shared/safeUrl.ts'
import { mergePulsePayload } from '../background/pulsePayloadMerge.ts'
import type { LivePollController } from '../content/livePoll.ts'

function coverageErrorMessage(raw: string | null | undefined, fallback: string): string {
  return formatPulseApiError(raw) ?? fallback
}

export type SidebarTabChangeSource = 'user' | 'sync'

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
  onSidebarTabChange?: (tab: SidebarTab, source?: SidebarTabChangeSource) => void
  onOverlayModeChange?: (mode: OverlayMode) => void
  onPulseRefresh?: () => Promise<void>
  onPulsePayloadUpdate?: (message: PulseUpdateMessage) => void
  onLivePollWindowChange?: (window: PulseCacheWindow) => void
  livePollStore?: Pick<LivePollController, 'getSnapshot' | 'subscribe'>
  vodPulse?: ExtensionVodPulseResponse | null
  vodPulseLoading?: boolean
  /** Cached chart still shown; refresh failed softly. */
  softStaleRefreshWarning?: boolean
}

type NoticeKind = 'ok' | 'warn' | 'info'

/** Old responses must not repaint the Clip Spike card after navigation/unmount. */
export function shouldApplyTopClipResponse(requestId: number, currentRequestId: number): boolean {
  return requestId === currentRequestId
}

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
  const controlledSidebarTab = sidebarTabProp != null

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
      if (controlledSidebarTab) return
      const requestId = ++tabRequestId
      void getSidebarTab().then(tab => {
        if (!mounted || requestId !== tabRequestId) return
        setSidebarTabState(tab)
        onSidebarTabChange?.(tab, 'sync')
      })
    }
    void (async () => {
      const displayId = ++displayRequestId
      const tabId = ++tabRequestId
      const [display, storedSidebarTab] = await Promise.all([
        getOverlayDisplayPreferences(),
        controlledSidebarTab ? Promise.resolve<SidebarTab | null>(null) : getSidebarTab(),
      ])
      if (!mounted) return
      if (displayId === displayRequestId) {
        setModeState(display.mode)
        setPlacementState(display.placement)
      }
      if (!controlledSidebarTab && storedSidebarTab != null && tabId === tabRequestId) {
        setSidebarTabState(storedSidebarTab)
        onSidebarTabChange?.(storedSidebarTab, 'sync')
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
      if (changes.sidebarTab && !controlledSidebarTab) {
        refreshTab()
      }
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(storageHandler)
    }
    return () => {
      mounted = false
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(storageHandler)
      }
    }
  // In snapped mode mount.tsx owns tab state. Keeping a second async storage
  // reader here lets a late read win over a direct CHAT/PULSE click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledSidebarTab])

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
    // The content mount must hide/show the panel synchronously on a direct
    // click. Waiting for sync storage here leaves the old Pulse host intercepting
    // Twitch chat during the transition window.
    onSidebarTabChange?.(next, 'user')
    await setSidebarTab(next)
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
  softStaleRefreshWarning = false,
}: OverlayProps) {
  const [mode, setModeState] = useState<OverlayMode>('expanded')
  const [placement, setPlacementState] = useState<OverlayPlacement>('right')
  const [density, setDensityState] = useState<DensityPreference>('comfortable')
  const banner = usePulseBanner()
  const [sidebarTab, setSidebarTabState] = useState<SidebarTab>('pulse')
  const controlledSidebarTab = sidebarTabProp != null
  const [backendUrl, setBackendUrlState] = useState(DEFAULT_BACKEND_URL)
  const [notice, setNotice] = useState<{ kind: NoticeKind; text: string } | null>(null)
  const [trackBusy, setTrackBusy] = useState(false)
  const [awaitingTrack, setAwaitingTrack] = useState(pendingTrackPrompt)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [streamClips, setStreamClips] = useState<ExtensionClip[]>([])
  const [streamClipsState, setStreamClipsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const topClipRequestRef = useRef(0)
  const [fullTimeline, setFullTimeline] = useState(false)
  const [fullHistoryPayload, setFullHistoryPayload] = useState<PulsePayload | null>(null)
  const [missedBusy, setMissedBusy] = useState(false)
  const [missedRefreshed, setMissedRefreshed] = useState(false)
  const [missedJob, setMissedJob] = useState<PulseBackfillJob | null>(null)
  const [coverageLastCheck, setCoverageLastCheck] = useState<number | null>(null)
  const [coverageCheckError, setCoverageCheckError] = useState<string | null>(null)
  const [vodDebugDetail, setVodDebugDetail] = useState<string | null>(null)
  const [panelView, setPanelView] = useState<'pulse' | 'settings'>('pulse')
  const [chartPinOffset, setChartPinOffset] = useState<number | null>(null)
  const [vodJumpChartPinEnabled, setVodJumpChartPinEnabled] = useState(true)
  const [mostReactedPinOffset, setMostReactedPinOffset] = useState<number | null>(null)
  const [mostReactedPreviewOffset, setMostReactedPreviewOffset] = useState<number | null>(null)
  const [chartMinuteSelection, setChartMinuteSelection] = useState<ExtensionRollup | null>(null)
  const jumpBusyRef = useRef(false)
  const [alwaysTrackedLogins, setAlwaysTrackedLogins] = useState<string[]>([])
  const [coverageTierState, setCoverageTierState] = useState<ExtensionCoverageTierResponse | null>(
    coverageTierProp,
  )
  // Route/session identity is deliberately separate from payload.vodId. A
  // channel payload can gain its linked VOD asynchronously without becoming a
  // new UI surface, while a real channel/VOD/stream transition must clear all
  // chart and notice state.
  const activationIdentity = [
    login,
    payload?.streamId ?? '',
    context.kind,
    context.vodId ?? '',
    payload?.startedAt ?? '',
  ].join(':')
  const surfaceIdentity = [
    activationIdentity,
    effectivePulseIsLive(payload, pageIsLive, context) ? 'live' : 'recap',
    payload?.mode ?? '',
  ].join(':')
  /** Activation + generation + abort — obsolete backfill/Full ops must not mutate UI. */
  const jumpSurfaceRef = useRef(surfaceIdentity)
  jumpSurfaceRef.current = surfaceIdentity
  const backfillOpsRef = useRef(createBackfillOperationController())
  const mountedRef = useRef(true)

  useEffect(() => {
    setCoverageTierState(coverageTierProp)
  }, [coverageTierProp, login])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      backfillOpsRef.current.invalidate()
    }
  }, [])

  useEffect(() => {
    backfillOpsRef.current.invalidate()
    setMissedBusy(false)
    setMissedJob(null)
    setFullTimeline(false)
    setFullHistoryPayload(null)
  }, [login, payload?.streamId, context.vodId])

  useEffect(() => {
    setNotice(null)
  }, [surfaceIdentity])

  // Recurring live poll always stays on window=recent. Explicit full-timeline
  // actions (requestFullTimeline) are one-shot fetches; do not flip the poll window.
  useEffect(() => {
    onLivePollWindowChange?.('recent')
  }, [onLivePollWindowChange])

  function currentActivation() {
    return activationFromOverlay({
      login,
      streamId: payload?.streamId,
      vodId: payload?.vodId ?? context.vodId,
      startedAt: payload?.startedAt,
    })
  }

  // The first recent poll can replace an activation payload that arrived with
  // fullRollups. Keep that validated source in the activation cache too; a
  // user should not lose Full stream merely because the background poll has
  // the intentionally smaller recent shape. Explicit Full requests still
  // replace this cache with their newer validated response below.
  useEffect(() => {
    if (!payload) return
    const activation = currentActivation()
    if (!hasValidatedFullHistory(payload, activation)) return
    setFullHistoryPayload(current => {
      if (current && hasValidatedFullHistory(current, activation)) return current
      return payload
    })
    setFullTimeline(true)
    // Activation identity is the cache boundary; currentActivation is derived
    // from the same values and intentionally not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationIdentity, payload])

  function tokenIsLive(token: BackfillOperationToken | null | undefined): boolean {
    return Boolean(
      mountedRef.current
      && token?.isCurrent()
      && sameFullHistoryActivation(token.activation, currentActivation()),
    )
  }

  function applyPulseResponse(
    response: PulseUpdateMessage | { type?: string; payload?: PulsePayload | null },
    token?: BackfillOperationToken | null,
  ): PulsePayload | null {
    if (token && !tokenIsLive(token)) return null
    if (response.type !== 'PULSE_UPDATE') return null
    const message = response as PulseUpdateMessage
    if (message.payload) {
      onPulsePayloadUpdate?.(message)
      return message.payload
    }
    return null
  }

  /** Transport only — does not mutate busy/Full/payload. */
  async function fetchPulseTransport(full = false): Promise<{
    response: unknown
    payload: PulsePayload | null
  }> {
    if (context.kind === 'vod' && context.vodId) {
      await onPulseRefresh?.()
      return { response: null, payload }
    }
    const response = await sendBackgroundMessage({
      type: 'GET_PULSE',
      login,
      watch: false,
      window: full ? 'full' : 'recent',
      streamId: payload?.streamId,
    })
    const next =
      response && typeof response === 'object' && 'type' in response && response.type === 'PULSE_UPDATE'
        ? (response as PulseUpdateMessage).payload
        : null
    return { response, payload: next }
  }

  function handleChartWindowChange(window: ChartTimelineWindow): void {
    if (window !== 'full') {
      setFullTimeline(false)
    }
  }

  const handleMostReactedPin = useCallback((offsetSeconds: number | null) => {
    setMostReactedPreviewOffset(null)
    setMostReactedPinOffset(offsetSeconds)
    setChartPinOffset(offsetSeconds)
    setChartMinuteSelection(null)
  }, [])

  const handleChartPin = useCallback((offsetSeconds: number | null) => {
    setMostReactedPreviewOffset(null)
    setChartPinOffset(offsetSeconds)
    // A chart click is a raw minute selection, not a ranked-moment selection.
    // Clear any prior ranked pin so Most Reacted can render the minute inspector
    // even when the clicked bucket is near a backend-ranked moment.
    setMostReactedPinOffset(null)
    if (offsetSeconds == null) setChartMinuteSelection(null)
  }, [])

  const handleChartMinuteSelect = useCallback((rollup: ExtensionRollup | null) => {
    setMostReactedPreviewOffset(null)
    setChartMinuteSelection(rollup)
  }, [])

  const [clipPoint, setClipPoint] = useState<LiveHeatPoint | null>(null)
  useEffect(() => { setClipPoint(null) }, [payload?.streamId, context.vodId])
  const clipSelectionRef = useRef(0)
  async function selectClip(clip: ExtensionClip) {
    const request = ++clipSelectionRef.current
    const surface = surfaceIdentity
    const isCurrent = () => mountedRef.current && jumpSurfaceRef.current === surface && clipSelectionRef.current === request
    const offset = clip.vodOffsetSeconds
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0 || !clip.videoId || !chartSourcePayload) {
      setNotice({ kind: 'warn', text: 'Clip timestamp unavailable.' })
      return
    }
    let source = chartSourcePayload
    let vodId = source.vodId ?? context.vodId
    try {
      if (!vodId && source.streamId) {
        const history = await sendBackgroundMessage({ type: 'LIST_PAST_VODS', login, liveStreamId: source.streamId, isLive: source.isLive })
        if (!isCurrent()) return
        if ('type' in history && history.type === 'PAST_VODS') {
          vodId = history.items.find(item => item.streamId === source.streamId && item.videoId)?.videoId ?? null
        }
      }
      if (!vodId || clip.videoId !== vodId) {
        setNotice({ kind: 'warn', text: 'This clip could not be matched to this stream.' })
        return
      }
      const findBucket = (data: PulsePayload) => (data.fullRollups?.length ? data.fullRollups : data.rollups ?? [])
        .find(row => !row.missing && row.offsetSeconds <= offset && offset < row.offsetSeconds + 60)
      let bucket = findBucket(source)
      if (!bucket) {
        const result = await requestFullTimeline()
        if (!isCurrent()) return
        if (result.ok) { source = result.payload; bucket = findBucket(source) }
      }
      if (!bucket) {
        setNotice({ kind: 'warn', text: 'No chart data is available for this clip minute.' })
        return
      }
      setNotice(null)
      setClipPoint(rollupToRecapHeatPoint(bucket, source.startedAt, buildRecapEmoteCatalog(source)))
      handleChartPin(bucket.offsetSeconds)
      handleChartMinuteSelect(bucket)
    } catch {
      if (isCurrent()) setNotice({ kind: 'warn', text: 'Could not load this clip moment. Try again.' })
    }
  }

  useEffect(() => {
    let mounted = true
    void sendBackgroundMessage({ type: 'GET_ALWAYS_TRACKED', login }).then(response => {
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
      const [display, storedBackend, storedSidebarTab, storedAutoUpdate, storedDensity] = await Promise.all([
        getOverlayDisplayPreferences(),
        getBackendUrl(),
        controlledSidebarTab ? Promise.resolve<SidebarTab | null>(null) : getSidebarTab(),
        getAutoUpdateEnabled(),
        getDensityPreference(),
      ])
      if (!mounted) return
      if (displayId === displayRequestId) {
        setModeState(display.mode)
        setPlacementState(display.placement)
      }
      setDensityState(storedDensity)
      void getVodJumpChartPinEnabled().then(value => {
        if (mounted) setVodJumpChartPinEnabled(value)
      })
      if (backendId === backendRequestId) setBackendUrlState(storedBackend)
      if (!controlledSidebarTab && storedSidebarTab != null && tabId === tabRequestId) {
        setSidebarTabState(storedSidebarTab)
        onSidebarTabChange?.(storedSidebarTab, 'sync')
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
      if (changes.density) {
        setDensityState(changes.density.newValue === 'compact' ? 'compact' : 'comfortable')
      }
      if (changes.sidebarTab && !controlledSidebarTab) {
        const requestId = ++tabRequestId
        void getSidebarTab().then(tab => {
          if (!mounted || requestId !== tabRequestId) return
          setSidebarTabState(tab)
          onSidebarTabChange?.(tab, 'sync')
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
      if (changes.vodJumpChartPinEnabled) {
        void getVodJumpChartPinEnabled().then(value => {
          if (mounted) setVodJumpChartPinEnabled(value)
        })
      }
    }
    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(storageHandler)
    }
    return () => {
      mounted = false
      if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(storageHandler)
      }
    }
  // The snapped mount is the single source of truth for CHAT/PULSE. The
  // backend/auto-update readers still hydrate once, but sidebar storage is not
  // allowed to race a user click.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarTabProp != null])

  useEffect(() => {
    const requestId = ++topClipRequestRef.current
    setStreamClips([])
    setStreamClipsState('loading')
    if (!payload) return
    void loadTopClip(requestId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only when the clip activation changes
  }, [surfaceIdentity, payload?.startedAt, payload?.endedAt, payload?.latestEndedAt, payload?.vodId, payload?.isLive])

  useEffect(() => {
    setFullTimeline(false)
    setMissedBusy(false)
    setMissedRefreshed(false)
    setMissedJob(null)
    setCoverageCheckError(null)
    setPanelView('pulse')
    setChartPinOffset(null)
    setMostReactedPinOffset(null)
    setMostReactedPreviewOffset(null)
    setChartMinuteSelection(null)
  }, [surfaceIdentity])

  useEffect(() => {
    function clearOnEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') handleMostReactedPin(null)
    }

    document.addEventListener('keydown', clearOnEscape)
    return () => document.removeEventListener('keydown', clearOnEscape)
  }, [handleMostReactedPin])

  const chartSourcePayload = useMemo(() => {
    if (!payload || !fullHistoryPayload) return payload
    return mergePulsePayload(payload, fullHistoryPayload, { source: 'full' })
  }, [fullHistoryPayload, payload])
  const displayPayload = chartSourcePayload ? pulsePayloadForDisplay(chartSourcePayload, pageIsLive, context) : null
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
        error,
        pulseSupported,
      })
    : null
  const panelSurfaceState = resolvePulsePanelSurfaceState({
    payload,
    error,
    pageIsLive,
    pulseLiveAccess: pulseLiveAccess.state,
    pulseSupported,
  })
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
  const isVodPage = context.kind === 'vod' && payload?.mode !== 'live_dvr'
  const hasRecapPanel = Boolean(
    payload
    && pulseSupported
    && panelSections?.showRecap
    && panelSurfaceState !== 'identity_mismatch',
  )
  const showHostedOfflineFallback = Boolean(
    !isVodPage
    && payload
    && panelSections?.showOffline
    && !hasRecapPanel,
  )
  const canRenderPayload = Boolean(payload && panelSurfaceState !== 'identity_mismatch')
  const sidebarChatOnly = showSidebarTabs && resolvedSidebarTab === 'chat'
  const metricsCompact = sidebarSnapped && (panelHostWidth ?? 0) > 0 && (panelHostWidth ?? 0) < 360
  const shellClass = [
    'pulse-shell',
    `placement-${resolvedPlacement}`,
    `mode-${resolvedMode}`,
    `pulse-density-${density}`,
    resolvedPlacement === 'hidden' ? 'pulse-hidden' : '',
    sidebarChatOnly ? 'sidebar-chat-only' : '',
    sidebarBodyOnly ? 'pulse-sidebar-panel' : '',
  ].filter(Boolean).join(' ')

  async function persistAutoUpdate(next: boolean): Promise<void> {
    const previous = autoUpdate
    setAutoUpdate(next)
    try {
      const response = await sendBackgroundMessage({ type: 'SET_AUTO_UPDATE', enabled: next })
      if (!('ok' in response) || !response.ok) setAutoUpdate(previous)
    } catch {
      setAutoUpdate(previous)
    }
  }

  async function persistSidebarTab(next: SidebarTab): Promise<void> {
    if (next === 'pulse' && resolvedMode === 'collapsed') {
      await persistMode('expanded')
    }
    setSidebarTabState(next)
    // Apply user tab intent before the storage write resolves so the hidden
    // Pulse host cannot win the next click in native Twitch chat.
    onSidebarTabChange?.(next, 'user')
    await setSidebarTab(next)
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

  async function refreshPulse(full = false, token?: BackfillOperationToken | null): Promise<PulsePayload | null> {
    const op = token ?? null
    if (context.kind === 'vod' && context.vodId) {
      if (op && !tokenIsLive(op)) return null
      if (!op) setTrackBusy(true)
      try {
        const { payload: next } = await fetchPulseTransport(false)
        if (op && !tokenIsLive(op)) return null
        return next
      } finally {
        if (!op && mountedRef.current) setTrackBusy(false)
      }
    }

    if (!op) setTrackBusy(true)
    try {
      const { response, payload: next } = await fetchPulseTransport(full)
      if (op && !tokenIsLive(op)) return null
      if (full && response) {
        const applied = applyPulseResponse(response as PulseUpdateMessage, op)
        if ((!op || tokenIsLive(op)) && hasValidatedFullHistory(applied, currentActivation())) {
          setFullTimeline(true)
        }
      }
      return next
    } finally {
      if (!op && mountedRef.current) setTrackBusy(false)
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
    const token = backfillOpsRef.current.begin(currentActivation())
    if (!payload?.streamId) {
      if (!tokenIsLive(token)) return
      setNotice({ kind: 'warn', text: 'Stream ID missing — track this channel and retry.' })
      return
    }
    const coverage = resolvePulseCoverage(payload)
    if (!coverage) {
      if (!tokenIsLive(token)) return
      setNotice({ kind: 'warn', text: 'No coverage info yet — wait for the first minute of rollups.' })
      return
    }
    const pageHint = payload.vodId ? null : await submitPageVodHint(token)
    if (!tokenIsLive(token)) return
    const activePayload = pageHint && !payload.vodId ? { ...payload, vodId: pageHint } : payload
    if (!canShowVodBackfillCTA(activePayload, pageHint)) {
      setNotice({
        kind: 'info',
        text: 'No validated archive is linked yet — live IRC tracking continues. Try again later.',
      })
      return
    }
    await loadMissedMomentsWithPayload(activePayload, pageHint, token)
  }

  async function pollMissedBackfill(
    jobId: string,
    beforePayload: PulsePayload,
    token: BackfillOperationToken,
  ): Promise<void> {
    const maxAttempts = 120
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!tokenIsLive(token)) return
      try {
        await delay(attempt === 0 ? 2000 : 7000, token.signal)
      } catch (err) {
        if (isAbortError(err) || !tokenIsLive(token)) return
        throw err
      }
      if (!tokenIsLive(token)) return
      const response = await sendBackgroundMessage({ type: 'GET_PULSE_BACKFILL_STATUS', login, jobId })
      if (!tokenIsLive(token)) return
      if (!('type' in response) || response.type !== 'PULSE_BACKFILL_STATUS' || !response.job) {
        continue
      }
      const job = response.job
      setMissedJob(job)
      if (!isPulseBackfillTerminal(job.status)) {
        continue
      }
      if (job.status === 'done' || job.status === 'already_available') {
        const { response: refreshResponse, payload: fresh } = await fetchPulseTransport(true)
        if (!tokenIsLive(token)) return
        if (refreshResponse) applyPulseResponse(refreshResponse as PulseUpdateMessage, token)
        if (!tokenIsLive(token)) return
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
    if (!tokenIsLive(token)) return
    setNotice({ kind: 'warn', text: 'Backfill is taking longer than expected — try again shortly.' })
  }

  async function refreshVodDebugDetail(
    activePayload?: PulsePayload | null,
    token?: BackfillOperationToken | null,
  ): Promise<void> {
    const source = activePayload ?? payload
    const summary = await summarizeVodDebugBlockers({
      backendVodResolved: source ? backendResolvedVod(source) : false,
    })
    if (token && !tokenIsLive(token)) return
    setVodDebugDetail(summary)
  }

  async function submitPageVodHint(token?: BackfillOperationToken | null): Promise<string | null> {
    const op = token ?? backfillOpsRef.current.current()
    if (!payload?.streamId || payload.vodId) return payload?.vodId ?? null
    const domHint = discoverLiveVodIdFromDom(payload.streamId)
    await pulseDebug('vod.discover.dom', domHint ? 'found archive id in page' : 'no archive id in page html', {
      login,
      streamId: payload.streamId,
      id: domHint,
    }, 'info')
    if (op && !tokenIsLive(op)) return null
    let hint = domHint
    if (!hint) {
      const gqlRes = await sendBackgroundMessage({
        type: 'DISCOVER_LIVE_VOD',
        login,
        streamId: payload.streamId,
      })
      if (op && !tokenIsLive(op)) return null
      const gql =
        'type' in gqlRes && gqlRes.type === 'DISCOVER_LIVE_VOD'
          ? gqlRes.result
          : { vodId: null, streamId: null, source: null, gqlErrors: ['background_unreachable'] as string[] }
      // Reject uncorrelated archives (previous broadcast, sidebar links).
      hint =
        gql.vodId
        && (!gql.streamId || gql.streamId === payload.streamId)
          ? gql.vodId
          : null
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
        'info',
      )
    }
    if (op && !tokenIsLive(op)) return null
    if (!hint) {
      // Twitch can publish the current archive in stream history before the
      // channel page exposes archiveVideo in DOM/GQL. Use only the row whose
      // stream id exactly matches this Pulse activation; never use the latest
      // channel VOD as an uncorrelated fallback.
      const historyRes = await sendBackgroundMessage({
        type: 'LIST_PAST_VODS',
        login,
        liveStreamId: payload.streamId,
        isLive: true,
      })
      if (op && !tokenIsLive(op)) return null
      if ('type' in historyRes && historyRes.type === 'PAST_VODS') {
        hint = historyRes.items.find(item => item.streamId === payload.streamId && item.videoId)?.videoId ?? null
      }
      await pulseDebug('vod.discover.history', hint ? 'found archive id in stream history' : 'stream history has no matching archive yet', {
        login,
        streamId: payload.streamId,
        id: hint,
        error: 'error' in historyRes ? historyRes.error : undefined,
      }, hint ? 'info' : 'warn')
    }
    if (op && !tokenIsLive(op)) return null
    if (!hint) {
      await refreshVodDebugDetail(undefined, op)
      return null
    }
    try {
      const res = await sendBackgroundMessage({
        type: 'HINT_VOD',
        login,
        streamId: payload.streamId,
        vodId: hint,
      })
      if (op && !tokenIsLive(op)) return null
      if ('ok' in res && res.ok) {
        const { response } = await fetchPulseTransport(false)
        if (op && !tokenIsLive(op)) return null
        if (response) applyPulseResponse(response as PulseUpdateMessage, op)
      }
    } catch {
      /* ignore hint failures */
    }
    return hint
  }

  async function refreshVodStatus(): Promise<void> {
    if (!payload?.streamId || missedBusy) return
    const token = backfillOpsRef.current.begin(currentActivation())
    setMissedBusy(true)
    setCoverageCheckError(null)
    try {
      await submitPageVodHint(token)
      if (!tokenIsLive(token)) return
      const healthRes = await sendBackgroundMessage({ type: 'HEALTH' }).catch(() => null)
      if (!tokenIsLive(token)) return
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
      const { response, payload: fresh } = await fetchPulseTransport(false)
      if (!tokenIsLive(token)) return
      if (response) applyPulseResponse(response as PulseUpdateMessage, token)
      if (!tokenIsLive(token)) return
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
      if (!tokenIsLive(token)) return
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
        await refreshVodDebugDetail(next, token)
        return
      }
      if (next.helixEnabled === false) {
        setCoverageCheckError(
          'Backend Helix is off — analytics needs TWITCH_OAUTH_CLIENT_ID/SECRET (or redeploy latest analytics).',
        )
        await refreshVodDebugDetail(next, token)
        return
      }
      if (!next.vodId && healthRes && 'type' in healthRes && healthRes.type === 'HEALTH' && healthRes.helixEnabled == null) {
        setCoverageCheckError(
          'Backend archive capability is unavailable. Live analytics remain active; deploy the latest analytics backend.',
        )
      } else if (!next.vodId) {
        setCoverageCheckError(
          'No validated archive is linked yet. Live analytics remain active; try again later.',
        )
      } else {
        setCoverageCheckError(null)
      }
      await refreshVodDebugDetail(next, token)
    } catch (err) {
      if (!tokenIsLive(token) || isAbortError(err)) return
      setCoverageCheckError(coverageErrorMessage(
        err instanceof Error ? err.message : null,
        'Could not check VOD status',
      ))
    } finally {
      if (tokenIsLive(token)) setMissedBusy(false)
    }
  }

  async function loadMissedMomentsWithPayload(
    activePayload: PulsePayload,
    explicitHint?: string | null,
    token: BackfillOperationToken = backfillOpsRef.current.begin(currentActivation()),
  ): Promise<void> {
    const coverage = resolvePulseCoverage(activePayload)
    if (!coverage || !activePayload.streamId) return
    if (!canShowVodBackfillCTA(activePayload, explicitHint)) return
    if (!tokenIsLive(token)) return
    const beforePayload = activePayload
    setMissedBusy(true)
    setMissedRefreshed(false)
    setFullTimeline(true)
    setNotice({ kind: 'info', text: 'Loading VOD chat from Twitch… this can take a few minutes.' })
    try {
      if (!tokenIsLive(token)) return
      const range = coverage.missingRanges?.[0]
      const hintedVodId =
        activePayload.vodId
        ?? (await submitPageVodHint(token))
        ?? undefined
      if (!tokenIsLive(token)) return
      const response = await sendBackgroundMessage({
        type: 'LOAD_MISSED_MOMENTS',
        login,
        streamId: activePayload.streamId,
        vodId: hintedVodId,
        fromOffsetSeconds: range?.fromOffsetSeconds ?? 0,
        toOffsetSeconds: range?.toOffsetSeconds ?? Math.max(0, coverage.coverageStartOffsetSeconds - 60),
      })
      if (!tokenIsLive(token)) return
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
        const { response: refreshResponse, payload: fresh } = await fetchPulseTransport(true)
        if (!tokenIsLive(token)) return
        if (refreshResponse) applyPulseResponse(refreshResponse as PulseUpdateMessage, token)
        if (!tokenIsLive(token)) return
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
      await pollMissedBackfill(job.jobId, beforePayload, token)
    } catch (err) {
      if (!tokenIsLive(token) || isAbortError(err)) return
      setCoverageCheckError(coverageErrorMessage(
        err instanceof Error ? err.message : null,
        'Backfill failed.',
      ))
    } finally {
      if (tokenIsLive(token)) {
        setMissedBusy(false)
      }
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
  const sawLiveRef = useRef(false)
  useEffect(() => {
    // Reset only when leaving the activation, not when that same stream moves
    // from live to recap; the latter is what authorizes VOD linkage polling.
    sawLiveRef.current = uiIsLive
  }, [activationIdentity])
  useEffect(() => {
    if (uiIsLive) sawLiveRef.current = true
  }, [uiIsLive])

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

  // After live→ended, poll VOD linkage at least 30s apart until linked / terminal / leave.
  useEffect(() => {
    if (!sawLiveRef.current) return
    if (uiIsLive) return
    if (!payload?.streamId || payload.vodId) return
    const terminal = new Set(['unavailable', 'deleted', 'private', 'not_found', 'error'])
    const vodStatus = String(payload.coverage?.vodStatus ?? '').trim().toLowerCase()
    if (terminal.has(vodStatus)) return

    void refreshVodStatus()
    const timer = window.setInterval(() => {
      void refreshVodStatus()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [
    uiIsLive,
    payload?.streamId,
    payload?.vodId,
    payload?.coverage?.vodStatus,
  ])

  function openInlineSettings(): void {
    setPanelView('settings')
    if (resolvedMode !== 'expanded') void persistMode('expanded')
  }

  function openAnalytics(offsetSeconds?: number): void {
    openStreamAnalytics({
      apiBaseUrl: backendUrl,
      channelLogin: login,
      streamId: payload?.streamId,
      offsetSeconds: offsetSeconds ?? 0,
    })
  }

  async function loadTopClip(requestId: number): Promise<void> {
    setStreamClipsState('loading')
    try {
      const res = await sendBackgroundMessage({
        type: 'GET_CLIP',
        login,
        startedAt: payload?.startedAt,
        endedAt: payload?.endedAt ?? payload?.latestEndedAt,
        streamId: payload?.streamId,
        vodId: isVodPage ? context.vodId ?? payload?.vodId ?? undefined : undefined,
        isLive: payload?.isLive,
      })
      if (!mountedRef.current || !shouldApplyTopClipResponse(requestId, topClipRequestRef.current)) return
      if ('type' in res && res.type === 'CLIP') {
        setStreamClips(res.clips ?? [])
        setStreamClipsState(res.error ? 'error' : 'ready')
      } else {
        setStreamClipsState('error')
      }
    } catch {
      if (mountedRef.current && shouldApplyTopClipResponse(requestId, topClipRequestRef.current)) setStreamClipsState('error')
    }
  }

  async function loadStreamFromStart(): Promise<void> {
    setNotice(null)
    void requestFullTimeline()
    // Seeking the current playback surface must not wait for optional archive
    // discovery or backfill work.
    seekToStreamStart()
    if (!payload?.vodId) {
      void submitPageVodHint()
    }
  }

  function seekToStreamStart(): void {
    setNotice(null)
    const vodId = payload?.vodId ?? undefined
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
      if (payload?.streamId) {
        void rememberVodAnalyticsBridge({ vodId, login, streamId: payload.streamId })
      }
      window.open(vodUrl, '_blank', 'noopener,noreferrer')
      setNotice({
        kind: 'ok',
        text: 'Opened Twitch VOD at stream start.',
      })
      return
    }

    if (uiIsLive && context.kind === 'channel') {
      const liveCurrentOffset = streamOffsetSecondsForLiveSeek({
        startedAt: payload?.startedAt,
        payloadOffsetSeconds: payload?.currentOffsetSeconds ?? 0,
      })
      const result = seekPlaybackOffset(getPrimaryVideo(), offset, {
        isLive: true,
        liveCurrentOffset: liveCurrentOffset ?? payload?.currentOffsetSeconds ?? 0,
      })
      if (result.ok) {
        setNotice({ kind: 'ok', text: 'Jumped to stream start in the live DVR buffer.' })
        return
      }
      if (result.reason === 'outside_buffer') {
        openAnalytics(offset)
        setNotice({
          kind: 'warn',
          text: 'That moment is outside Twitch’s live DVR window — opened the StreamPulse analytics moment.',
        })
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

  async function requestFullTimeline(): Promise<FullHistoryRequestResult> {
    const activation = currentActivation()
    if (!hasStableFullHistoryActivation(activation)) {
      return { ok: false, reason: 'activation_unavailable' }
    }
    const token = backfillOpsRef.current.begin(activation)
    try {
      const { response } = await fetchPulseTransport(true)
      if (!tokenIsLive(token)) return { ok: false, reason: 'activation_changed' }
      if (!response || typeof response !== 'object' || !('type' in response)) {
        return { ok: false, reason: 'missing_payload' }
      }
      const next = applyPulseResponse(response as PulseUpdateMessage, token)
      if (!tokenIsLive(token)) return { ok: false, reason: 'activation_changed' }
      if (!next) return { ok: false, reason: 'missing_payload' }
      if (!hasValidatedFullHistory(next, activation)) {
        return { ok: false, reason: 'incomplete_history' }
      }
      // Keep the validated source in this activation even if a tab transition
      // temporarily hides OverlayMain or a recent poll arrives immediately
      // after the Full request. Recent fields remain authoritative through the
      // merge above; fullRollups/peaks remain available to the chart.
      setFullHistoryPayload(next)
      setFullTimeline(true)
      return { ok: true, payload: next }
    } catch (err) {
      if (!tokenIsLive(token) || isAbortError(err)) {
        return { ok: false, reason: 'activation_changed' }
      }
      setNotice({
        kind: 'warn',
        text: err instanceof Error ? err.message : 'Could not load full stream chart.',
      })
      return { ok: false, reason: 'request_failed' }
    }
  }

  function openAnalyticsForMoment(point: LiveHeatPoint): void {
    openAnalytics(reactionAnalyticalOffset(point))
  }

  async function jumpMoment(point: LiveHeatPoint): Promise<void> {
    if (jumpBusyRef.current) return
    jumpBusyRef.current = true
    const jumpSurface = surfaceIdentity
    setNotice(null)
    try {
      // A live channel's payload can arrive before the archive id is linked.
      // Resolve that id at action time so Jump prefers the growing Twitch VOD
      // over the much smaller in-player DVR buffer. The discovery path is
      // stream-bound (DOM/GQL validation plus a backend hint), so it cannot
      // silently open a previous broadcast or a sidebar VOD.
      const jumpVodId = payload?.vodId ?? (
        uiIsLive && context.kind === 'channel' && payload?.streamId
          ? await submitPageVodHint().catch(() => null)
          : null
      )
      if (!mountedRef.current || jumpSurfaceRef.current !== jumpSurface) return
      const action = resolveJumpMomentAction({
        context,
        payloadVodId: jumpVodId,
        payloadMode: payload?.mode === 'live_dvr' ? 'live_dvr' : payload?.mode === 'vod' ? 'vod' : undefined,
        vodOriginDeltaSeconds: payload?.vodOriginDeltaSeconds,
        effectiveIsLive: uiIsLive,
        payloadIsLive: payload?.isLive,
        liveCurrentOffset: payload?.currentOffsetSeconds,
        offsetSeconds: reactionLeadInOffset(point, 5),
      })
      if (action.kind === 'seek-vod' || action.kind === 'open-vod-tab' || action.kind === 'seek-live-dvr') {
        if (vodJumpChartPinEnabled) {
          setChartPinOffset(action.offsetSeconds)
        } else {
          setChartPinOffset(null)
          setMostReactedPinOffset(null)
        }
      }

      const remember = (target: number) => {
        if (point.estimated || point.collecting) return
        const window = reactionMomentWindow(point)
        const start = target + window.startSeconds - reactionLeadInOffset(point, 5)
        void observeMomentPlayback(getPrimaryVideo(), { id: 'moment', channel: login, title: point.reasonLabel,
          vodId: jumpVodId ?? null, streamId: payload?.streamId, offsetSeconds: point.offsetSeconds, availability: 'unresolved' }, start, start + window.durationSeconds)
      }
      if (action.kind === 'seek-vod') {
        const result = await seekPlaybackOffsetVerified(getPrimaryVideo(), action.offsetSeconds, { isLive: false })
        if (!mountedRef.current || jumpSurfaceRef.current !== jumpSurface) return
        if (result.ok) remember(result.targetSeconds)
        setNotice({
          kind: result.ok ? 'ok' : 'warn',
          text: result.ok
            ? `Jumped to ${formatHeatOffset(action.offsetSeconds)} in the VOD player.`
            : `The VOD player did not hold ${formatHeatOffset(action.offsetSeconds)}. Try scrubbing there or use Analytics.`,
        })
        return
      }

      if (action.kind === 'open-vod-tab') {
        if (payload?.streamId) {
          void rememberVodAnalyticsBridge({
            vodId: action.vodId,
            login,
            streamId: payload.streamId,
          })
        }
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
        const liveCurrentOffset = streamOffsetSecondsForLiveSeek({
          startedAt: payload?.startedAt,
          payloadOffsetSeconds: action.liveCurrentOffset,
        })
        const result = await seekPlaybackOffsetVerified(getPrimaryVideo(), action.offsetSeconds, {
          isLive: true,
          liveCurrentOffset: liveCurrentOffset ?? action.liveCurrentOffset,
        })
        if (!mountedRef.current || jumpSurfaceRef.current !== jumpSurface) return
        if (result.ok) {
          remember(result.targetSeconds)
          setNotice({ kind: 'ok', text: `Jumped to ${formatHeatOffset(action.offsetSeconds)} inside the live DVR buffer.` })
          return
        }
        setNotice({
          kind: 'warn',
          text: result.reason === 'outside_buffer'
            ? jumpVodId
              ? `${formatHeatOffset(action.offsetSeconds)} is outside Twitch’s live DVR window. Use the linked VOD or Analytics for the full moment.`
              : `${formatHeatOffset(action.offsetSeconds)} is outside Twitch’s live DVR window, and Twitch has not linked a live VOD yet. Use Analytics for the full moment.`
            : 'Twitch did not hold the requested live-player position. Use Analytics for the full moment.',
        })
        return
      }

      const secondary = action.kind === 'live-outside-buffer' ? action.secondaryVodId?.trim() : undefined
      setNotice({
        kind: 'warn',
        text: secondary
          ? `${formatHeatOffset(action.offsetSeconds)} is outside the live DVR buffer. Use Analytics; a linked VOD is available separately.`
          : `${formatHeatOffset(action.offsetSeconds)} is outside the live DVR buffer. Use Analytics for the full moment.`,
      })
    } catch {
      if (mountedRef.current && jumpSurfaceRef.current === jumpSurface) {
        setNotice({ kind: 'warn', text: 'Could not open this moment. Retry or use Analytics.' })
      }
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

  // Body host visibility is owned by mount.tsx (hidden entirely on Chat tab).
  if (resolvedMode === 'collapsed') {
    return (
      <section className={shellClass} data-pulse-density={density} style={styles.collapsedHost} aria-label="StreamPulse collapsed">
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
      <section className={shellClass} data-pulse-density={density} style={styles.miniHost} aria-label="StreamPulse mini overlay">
        <MiniDock
          login={login}
          payload={payload}
          tracking={pulseLiveAccess.state === 'full_live'}
          isLive={uiIsLive}
          trackBusy={trackBusy}
          sidebarFill={sidebarBodyOnly}
          onExpand={() => void persistMode('expanded')}
          onSettings={openInlineSettings}
          onHide={() => void hideOverlay()}
          onTrack={localStackBackend ? () => void startTracking() : undefined}
        />
      </section>
    )
  }

  return (
    <section
      className={`${shellClass} pulse-personal-panel`}
      data-pulse-density={density}
      style={{ ...styles.panel, overflow: 'hidden', boxSizing: 'border-box', height: sidebarBodyOnly ? '100%' : undefined, padding: showSidebarTabs || sidebarBodyOnly ? 0 : 12 }}
      aria-label="StreamPulse overlay"
    >
      {panelView === 'pulse' && !sidebarChatOnly && <PulseBannerBackdrop value={banner.value} />}
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
          flex: '1 1 auto',
          minWidth: 0,
          minHeight: 0,
          height: sidebarBodyOnly ? 'auto' : undefined,
          overflow: 'auto',
          position: sidebarBodyOnly ? 'relative' : undefined,
        }}
      >
      <PanelErrorBoundary>
      {panelView === 'settings' ? (
        <div key="settings" className="pulse-panel-view-enter pulse-panel-view-settings pulse-panel-view-stack">
          <PulseSettingsPanel onBack={() => setPanelView('pulse')} />
        </div>
      ) : (
        <div
          key={sidebarBodyOnly ? 'pulse' : 'pulse-full'}
          className={
            sidebarBodyOnly
              ? 'pulse-workspace pulse-panel-view-enter pulse-panel-view-pulse pulse-panel-view-stack'
              : 'pulse-workspace pulse-panel-view-stack'
          }
        >
      <StreamPulseHeader
        personalTitle={banner.value.title}
        isLive={uiIsLive}
        surfaceState={panelSurfaceState}
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
        onMini={() => void persistMode('mini')}
        onHide={() => void hideOverlay()}
      />

      {panelView === 'pulse' && !sidebarChatOnly ? (
        <AnalyticsHubCta backendUrl={backendUrl} compact />
      ) : null}

      {showHostedOfflineFallback ? (
        <PulseSectionCard title="Channel offline" titleTone="muted" className="pulse-offline-state">
          <p style={styles.stateText}>
            No live Pulse session or recap is available for <strong>{login}</strong> right now. Check back when they go live, or use Analytics Hub above to browse tracked channels.
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
          <p style={styles.stateText}>Track <strong>{login}</strong> to collect live chat and 7TV rollups from your StreamPulse stack.</p>
          <div style={styles.footerActions}>
            <button type="button" style={styles.primaryButton} disabled={trackBusy} onClick={() => void startTracking()}>
              {trackBusy ? 'Starting…' : 'Track this channel'}
            </button>
            <button type="button" style={styles.secondaryButton} onClick={openInlineSettings}>Manage watchlist</button>
          </div>
        </section>
      ) : null}

      {error && !payload && !(isVodPage && isVodArchiveConflict(vodPulse)) ? (
        <BackendError backendUrl={backendUrl} error={error} onRetry={() => void refreshPulse()} onSettings={openInlineSettings} />
      ) : null}

      {error && payload && panelSurfaceState !== 'identity_mismatch' ? (
        <PulseRefreshError error={error} onRetry={() => void refreshPulse()} />
      ) : null}

      {panelSurfaceState === 'identity_mismatch' ? (
        <PulseIdentityMismatchPanel login={login} onRetry={() => void refreshPulse()} />
      ) : null}

      {softStaleRefreshWarning && payload ? (
        <div role="status" style={styles.softStaleBanner}>
          Live refresh paused briefly — showing last good chart.
        </div>
      ) : null}

      {payload && !pulseSupported ? (
        <PulseRosterUnsupportedPanel login={login} />
      ) : null}

      {!isVodPage && hostedBackend && uiIsLive && pulseSupported && panelSurfaceState === 'live_untracked' ? (
        <PulseNotTrackedPanel
          login={login}
          hostedActiveCount={pulseLiveAccess.hostedActiveCount}
          hostedActiveLimit={pulseLiveAccess.hostedActiveLimit}
        />
      ) : null}

      {!isVodPage && !hostedBackend && payload && pulseSupported && panelSurfaceState === 'live_untracked' ? (
        <PulseLiveUnavailablePanel
          variant="not_irc_tracked"
          login={login}
          coverageStartOffsetSeconds={pulseLiveAccess.coverageStartOffsetSeconds}
          hostedActiveCount={pulseLiveAccess.hostedActiveCount}
          hostedActiveLimit={pulseLiveAccess.hostedActiveLimit}
          onOpenSettings={() => openInlineSettings()}
        />
      ) : null}

      {!isVodPage && !hostedBackend && payload && pulseSupported && panelSurfaceState === 'live_late' ? (
        <PulseLiveUnavailablePanel
          variant="late_session"
          login={login}
          coverageStartOffsetSeconds={pulseLiveAccess.coverageStartOffsetSeconds}
          hostedActiveCount={pulseLiveAccess.hostedActiveCount}
          hostedActiveLimit={pulseLiveAccess.hostedActiveLimit}
          onOpenSettings={() => openInlineSettings()}
        />
      ) : null}

      {!isVodPage && canRenderPayload && pulseSupported && pulseLiveAccess.state === 'full_live' ? (
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
                  currentOffsetSeconds={payload?.currentOffsetSeconds ?? 0}
                  isLive={uiIsLive}
                  autoUpdate={autoUpdate}
                  fullTimeline={fullTimeline}
                  showLoadFromStart={!hostedBackend && Boolean(payload && shouldShowStreamStartAction({ ...payload, tracking: payload.tracking }))}
                  loadFromStartBusy={missedBusy}
                  onLoadFromStart={() => void loadStreamFromStart()}
                  onJumpToOffset={jumpToOffset}
                  onOpenAnalytics={openAnalytics}
                  onOpenFullAnalytics={() => openAnalytics()}
                  onRequestFullTimeline={requestFullTimeline}
                  onChartWindowChange={handleChartWindowChange}
                  onPinOffset={handleChartPin}
                  onChartMinuteSelect={handleChartMinuteSelect}
                  chartMinuteSelection={chartMinuteSelection}
                  onMomentSelect={peak => handleMostReactedPin(reactionAnalyticalOffset(peak))}
                  pinOffsetSeconds={chartPinOffset}
                  previewOffsetSeconds={mostReactedPreviewOffset}
                  selectedMomentOffsetSeconds={mostReactedPinOffset}
                  hasVodContext={Boolean(payload?.vodId ?? context.vodId)}
                  coverageTier={coverageTierState?.coverageTier ?? null}
                  liveMetadata={coverageTierState?.liveMetadata ?? null}
                />
              ) : null}

              {panelSections?.showMostReacted ? (
                <MostReactedSection
                  payload={displayPayload}
                  backendUrl={backendUrl}
                  sidebarFill={sidebarSnapped}
                  pinnedOffsetSeconds={mostReactedPinOffset}
                  chartMinuteSelection={chartMinuteSelection}
                  onJump={jumpMoment}
                  onAnalytics={openAnalyticsForMoment}
                  onJumpToOffset={jumpToOffset}
                  onAnalyticsAtOffset={openAnalytics}
                  onHighlightOffset={setMostReactedPreviewOffset}
                  onPinOffset={handleMostReactedPin}
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

      {isVodPage && !hasRecapPanel && panelSurfaceState !== 'identity_mismatch' ? (
        <VodPulseStatusCard
          vodPulse={vodPulse}
          loading={vodPulseLoading}
          error={error}
          onRetry={() => void refreshPulse()}
        />
      ) : null}

      {canRenderPayload && pulseSupported ? (
        <>
          {panelSections?.showRecap && payload ? (
            <StreamRecapSection
              externalPoint={clipPoint}
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

          <StreamClipCarousel clips={streamClips} backendUrl={backendUrl} state={streamClipsState} onSelect={selectClip} onRetry={() => void loadTopClip(++topClipRequestRef.current)} />

          {!isVodPage ? (
          <PastVodsSection
            login={login}
            backendUrl={backendUrl}
            liveStreamId={payload?.streamId}
            isLive={uiIsLive}
            channelOffline={!uiIsLive}
            onOpenFromStart={openStreamStartToLive}
          />
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
      {panelView === 'pulse' && !sidebarChatOnly ? (
        <div className="pulse-settings-footer" style={styles.settingsFooter}>
          <button
            type="button"
            className="pulse-settings-bottom-bar"
            data-pulse-settings-entry="bottom-bar"
            style={styles.settingsBottomBar}
            aria-label="Open settings"
            title="Settings"
            onClick={() => setPanelView('settings')}
          >
            <SettingsGearIcon size={16} />
            <span>Settings</span>
            <span aria-hidden="true">›</span>
          </button>
        </div>
      ) : null}
    </section>
  )
}

function StreamPulseHeader({
  personalTitle,
  isLive,
  surfaceState,
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
  onMini,
  onHide,
}: {
  personalTitle: string
  isLive: boolean
  surfaceState: PulsePanelSurfaceState
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
  onMini: () => void
  onHide: () => void
}) {
  const headerStyle = sidebarFill ? streamPulseHeaderChromeSidebar : streamPulseHeaderChrome
  const finish = useSupporterAppearance()
  const actionsStyle = sidebarFill ? styles.streamPulseHeaderActionsSidebar : styles.streamPulseHeaderActions
  const trackButtonStyle = sidebarFill ? styles.trackingButtonFull : styles.trackingButton
  const trackStreamerStyle = sidebarFill ? styles.trackStreamerButtonFull : styles.trackStreamerButton
  const autoUpdateStyle = sidebarFill ? styles.autoUpdateLabelFull : styles.autoUpdateLabel
  const iconRowStyle = sidebarFill ? styles.headerIconRowFull : styles.headerIconRow

  const statusLabel = pulseSurfaceStatusLabel(surfaceState)

  return (
    <header
      className="pulse-personal-banner"
      style={headerStyle}
      data-supporter-finish={finish ?? undefined}
      title={finish ? 'Pulse Supporter' : undefined}
    >
      <div className="pulse-banner-copy" style={sidebarFill ? styles.streamPulseHeaderMainSidebar : styles.streamPulseHeaderMain}>
        <StreamPulseTitleBlock
          title={personalTitle || undefined}
          finish={finish}
          statusLabel={hostedBackend ? statusLabel : 'Local dev API'}
          statusTone={hostedBackend ? (isLive ? 'live' : 'idle') : 'local'}
        />
      </div>
      <div style={{ ...actionsStyle, ...(hostedBackend && hideUtilityActions ? { display: 'none' } : {}) }}>
        {!pulseSupported && !hostedBackend ? (
          <span style={trackButtonStyle} aria-label="Limited tracked roster">
            Limited roster
          </span>
        ) : hostedBackend ? null : pulseLiveAccess === 'full_live' ? (
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

              <button type="button" style={sidebarFill ? styles.headerIconButtonFull : styles.headerIconButton} onClick={onMini} title="Mini mode">Mini</button>
              <button type="button" style={sidebarFill ? styles.headerIconButtonFull : styles.headerIconButton} onClick={onHide} title="Hide overlay">Hide</button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

function vodPulseStatusKind(state: ReturnType<typeof resolveVodPulseState>): PulseStatusKind {
  switch (state.status) {
    case 'live_dvr':
      return 'tracking'
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
      return state.status === 'error' && state.archiveConflict ? 'archive-conflict' : 'backend-error'
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
      : state.status === 'live_dvr'
        ? 'Live analytics are active. Replay chat may remain unavailable until Twitch publishes the archive.'
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
        {onRetry && !(state.status === 'error' && state.retryable === false) ? (
          <button type="button" style={styles.secondaryButton} onClick={onRetry}>
            Retry
          </button>
        ) : null}
      </div>
    </PulseSectionCard>
  )
}

function StreamClipCarousel({ clips, backendUrl, state, onRetry, onSelect }: { clips: ExtensionClip[]; backendUrl: string; state: 'loading' | 'ready' | 'error'; onRetry: () => void; onSelect: (clip: ExtensionClip) => void }) {
  const rail = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ start: true, end: false })
  const validClips = clips.filter(clip => safeTwitchNavigationUrl(clip.url))
  function updatePosition() {
    const element = rail.current
    if (element) setPosition({ start: element.scrollLeft < 2, end: element.scrollLeft + element.clientWidth >= element.scrollWidth - 2 })
  }
  useEffect(() => {
    const element = rail.current
    if (!element) return
    element.scrollLeft = 0
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(element)
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const delta = event.deltaY
      const end = element.scrollWidth - element.clientWidth
      if (!delta || end <= 0 || (delta < 0 && element.scrollLeft <= 0) || (delta > 0 && element.scrollLeft >= end - 1)) return
      event.preventDefault()
      move(delta < 0 ? -1 : 1)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel) }
  }, [clips])
  function move(direction: number) {
    const element = rail.current
    if (element) element.scrollBy({ left: direction * element.clientWidth * .88, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  return <section className="pulse-clips-section" aria-label="Top clips from this stream" aria-busy={state === 'loading'}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <h3 style={styles.clipSpikeHeading}>Top clips <span className="pulse-clips-count">{validClips.length || ''}</span></h3>
      <div style={{ display: 'flex', gap: 4 }}>
        <button type="button" className="pulse-clip-control" aria-label="Refresh stream clips" title="Refresh stream clips" disabled={state === 'loading'} onClick={onRetry}>↻</button>
        {validClips.length > 1 && <>
        <button type="button" className="pulse-clip-control" aria-label="Previous clips" title="Previous clips" disabled={position.start} onClick={() => move(-1)}>←</button>
        <button type="button" className="pulse-clip-control" aria-label="Next clips" title="Next clips" disabled={position.end} onClick={() => move(1)}>→</button>
        </>}
      </div>
    </div>
    {!validClips.length && <p role="status" style={styles.stateText}>{state === 'loading' ? 'Loading stream clips...' : state === 'error' ? 'Clips could not be loaded. Try refreshing.' : 'No clips available for this stream yet.'}</p>}
    <div ref={rail} className="pulse-clips-rail" tabIndex={validClips.length ? 0 : -1} aria-label="Stream clips carousel" onScroll={updatePosition}
      onKeyDown={event => { if (event.target === event.currentTarget && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1) } }}
      style={{ display: 'flex', gap: 12, overflowX: 'auto', scrollSnapType: 'x mandatory', padding: '10px 0 2px', scrollbarWidth: 'none' }}>
      {validClips.map(clip => <div key={clip.id} style={{ flex: '0 0 min(232px, 88%)', minWidth: 0, scrollSnapAlign: 'start' }}><ClipSpikeCard clip={clip} backendUrl={backendUrl} onSelect={onSelect} /></div>)}
    </div>
  </section>
}

export function ClipSpikeCard({ clip, backendUrl, onSelect }: { clip: ExtensionClip; backendUrl: string; onSelect?: (clip: ExtensionClip) => void }) {
  const duration = formatClipDuration(clip.durationSeconds)
  const clipUrl = safeTwitchNavigationUrl(clip.url)
  const thumbnailUrl = safeImageUrl(clip.thumbnailUrl, backendUrl)
  if (!clipUrl) return null
  return (
      <a
        className="pulse-clip-spike-card"
        data-clip-spike-card
        onClick={() => onSelect?.(clip)}
        href={clipUrl}
        target="_blank"
        rel="noreferrer"
        referrerPolicy="no-referrer"
        style={styles.clipSpikeCard}
        aria-label={`Clip spike: ${clip.title}`}
      >
        <div style={styles.clipThumbWrap}>
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={clip.title}
              style={styles.clipThumb}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
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
            ? `StreamPulse is tracking this broadcast (${formatHeatOffset(coverageStart)} in). Top Moments unlock after ${LIVE_HEAT_MIN_COMPLETED_ROLLUPS} completed minutes of chat rollups.`
            : `Collecting chat and emote activity. Top Moments unlock after ${LIVE_HEAT_MIN_COMPLETED_ROLLUPS} completed minutes, never shown as final early.`}
      </p>
      <div className="pulse-shimmer" style={styles.progressTrack}><span style={{ ...styles.progressFill, width: `${progress * 100}%` }} /></div>
      <p style={styles.muted}>{count} / {LIVE_HEAT_MIN_COMPLETED_ROLLUPS} minutes collected · updates automatically</p>
    </section>
  )
}

function BackendError({ backendUrl, error, onRetry, onSettings }: { backendUrl: string; error?: string; onRetry: () => void; onSettings: () => void }) {
  // A disconnected tab is not an unreachable backend. Retrying and opening
  // settings both go through the same dead port, so a reload is the only thing
  // worth offering.
  if (error === EXTENSION_RECONNECT_MESSAGE) {
    return (
      <section style={styles.errorBlock}>
        <h2 style={styles.errorTitle}>Extension disconnected</h2>
        <p style={styles.stateText}>This tab lost its connection to StreamPulse, which happens whenever the extension updates or reloads. Refreshing the page reconnects it.</p>
        <div style={styles.footerActions}>
          <button type="button" style={styles.secondaryButton} onClick={() => window.location.reload()}>Reload page</button>
        </div>
      </section>
    )
  }
  return (
    <section style={styles.errorBlock}>
      <h2 style={styles.errorTitle}>Can&apos;t reach StreamPulse</h2>
      <p style={styles.stateText}>No response from {backendUrl}. Is the StreamPulse stack running? Showing this instead of empty charts.</p>
      <div style={styles.footerActions}>
        <button type="button" style={styles.secondaryButton} onClick={onRetry}>Retry</button>
        <button type="button" style={styles.textButtonLarge} onClick={onSettings}>Open settings</button>
      </div>
    </section>
  )
}

function PulseRefreshError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div role="status" className="pulse-refresh-error" style={styles.refreshError}>
      <span>{formatPulseApiError(error) ?? 'The latest Pulse refresh failed; showing the last good data.'}</span>
      <button type="button" style={styles.textButtonLarge} onClick={onRetry}>Retry</button>
    </div>
  )
}

function PulseIdentityMismatchPanel({ login, onRetry }: { login: string; onRetry: () => void }) {
  return (
    <PulseSectionCard title="Stream changed" titleTone="muted" className="pulse-identity-mismatch-state">
      <p style={styles.stateText}>
        StreamPulse received data for a different broadcast while refreshing <strong>{login}</strong>. The previous stream was not reused.
      </p>
      <div style={styles.footerActions}>
        <button type="button" style={styles.secondaryButton} onClick={onRetry}>Refresh current stream</button>
      </div>
    </PulseSectionCard>
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
  panel: { background: theme.bgCanvas, display: 'flex', flexDirection: 'column', minHeight: 0 },
  panelHidden: { display: 'none' },
  sidebarTabsWrap: { flexShrink: 0, padding: 8 },
  headerTabsShell: { alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'center', width: '100%' },
  miniHost: { display: 'flex', height: '100%', width: '100%' },
  collapsedHost: { display: 'flex', height: '100%', width: '100%' },
  muted: { color: '#8b8ba0' },
  trackPrompt: { background: '#1f1f27', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35)', borderRadius: 12, marginBottom: 14, padding: 14 },
  textButtonLarge: { background: 'transparent', border: 0, color: 'var(--pulse-accent-soft, #c4b5fd)', cursor: 'pointer', fontSize: 14, fontWeight: 800, padding: '8px 0' },
  footerActions: { display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 14 },
  primaryButton: { background: 'var(--pulse-accent-strong, #7c3aed)', border: 0, borderRadius: 10, color: 'var(--pulse-on-accent, #fff)', cursor: 'pointer', fontWeight: 800, minHeight: 44, padding: '11px 14px' },
  secondaryButton: { background: '#2b2b32', border: '1px solid #3f3f50', borderRadius: 10, color: '#fafafc', cursor: 'pointer', fontWeight: 800, minHeight: 44, padding: '11px 14px' },
  stateBlock: { background: '#1f1f27', borderRadius: 12, marginTop: 16, padding: 16 },
  stateTitle: { fontSize: 18, margin: '0 0 10px' },
  stateText: { color: '#b7b7c6', fontSize: 13, lineHeight: 1.35, margin: '0 0 14px' },
  softStaleBanner: {
    background: 'rgba(212, 160, 23, 0.12)',
    border: '1px solid rgba(212, 160, 23, 0.35)',
    borderRadius: 8,
    color: '#e8d48a',
    fontSize: 12,
    lineHeight: 1.35,
    margin: '0 0 10px',
    padding: '8px 10px',
  },
  vodStateWrap: { display: 'grid', gap: 8 },
  progressTrack: { background: '#33333d', borderRadius: 999, height: 8, marginBottom: 10, overflow: 'hidden' },
  progressFill: { background: 'var(--pulse-accent-soft, #a78bfa)', borderRadius: 999, display: 'block', height: '100%' },
  errorBlock: { background: '#1f1f27', borderRadius: 12, padding: 16 },
  errorTitle: { color: '#f87171', fontSize: 18, margin: '0 0 10px' },
  refreshError: {
    alignItems: 'center',
    background: 'rgba(245, 158, 11, 0.1)',
    border: '1px solid rgba(245, 158, 11, 0.28)',
    borderRadius: 8,
    color: '#fcd34d',
    display: 'flex',
    flexWrap: 'wrap',
    fontSize: 11,
    fontWeight: 700,
    gap: 8,
    justifyContent: 'space-between',
    marginBottom: 10,
    padding: '7px 9px',
  },
  notice: { background: '#2a2440', border: '1px solid #3f3f50', borderRadius: 10, color: 'var(--pulse-accent-soft, #c4b5fd)', fontSize: 12, fontWeight: 700, margin: '14px 0 0', padding: '10px 12px' },
  noticeWarn: { background: 'rgba(249,115,22,0.12)', borderColor: 'rgba(249,115,22,0.35)', color: '#fdba74' },
  noticeOk: { background: 'rgba(34,197,94,0.12)', borderColor: 'rgba(34,197,94,0.35)', color: '#86efac' },
  streamPulseHeaderMain: { flex: '1 1 180px', minWidth: 0, width: '100%' },
  streamPulseHeaderMainSidebar: { flex: '0 0 auto', minWidth: 0, width: '100%' },
  streamPulseHeaderActions: { alignItems: 'flex-end', display: 'flex', flexDirection: 'column', flexShrink: 0, gap: 8 },
  streamPulseHeaderActionsSidebar: { alignItems: 'stretch', display: 'flex', flexDirection: 'column', gap: 10, width: '100%' },
  trackStreamerButton: { background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1)', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.3)', borderRadius: theme.radiusButton, color: 'var(--pulse-accent-ink, #ddd6fe)', cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '8px 12px', textTransform: 'uppercase' },
  trackStreamerButtonFull: { background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.1)', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.3)', borderRadius: theme.radiusButton, color: 'var(--pulse-accent-ink, #ddd6fe)', cursor: 'pointer', fontSize: 11, fontWeight: 900, padding: '10px 12px', textAlign: 'center', textTransform: 'uppercase', width: '100%' },
  trackingButton: { background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22)', border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.45)', borderRadius: 999, color: 'var(--pulse-accent-soft, #c4b5fd)', display: 'inline-block', fontSize: 10, fontWeight: 900, letterSpacing: '0.04em', padding: '4px 10px', textTransform: 'uppercase' },
  trackingButtonFull: {
    alignSelf: 'flex-start',
    background: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.16)',
    border: '1px solid rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35)',
    borderRadius: 999,
    color: 'var(--pulse-accent-soft, #c4b5fd)',
    display: 'inline-block',
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: '0.04em',
    padding: '4px 10px',
    textAlign: 'center',
    textTransform: 'uppercase',
    width: 'fit-content',
  },
  headerIconButton: { alignItems: 'center', background: 'transparent', border: 0, color: theme.textMuted, cursor: 'pointer', display: 'inline-flex', fontSize: 11, fontWeight: 700, justifyContent: 'center', minHeight: 32, minWidth: 44, padding: '4px 8px' },
  headerIconButtonFull: { alignItems: 'center', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: theme.textMuted, cursor: 'pointer', display: 'inline-flex', fontSize: 11, fontWeight: 700, justifyContent: 'center', minHeight: 40, padding: '8px 6px', textAlign: 'center', width: '100%' },
  autoUpdateLabel: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 11, fontWeight: 600, gap: 8 },
  autoUpdateLabelFull: { alignItems: 'center', color: theme.textSecondary, display: 'flex', fontSize: 11, fontWeight: 600, gap: 8, justifyContent: 'space-between', width: '100%' },
  autoUpdateSwitch: { border: 0, borderRadius: 999, cursor: 'pointer', flexShrink: 0, height: 22, position: 'relative', width: 36 },
  autoUpdateKnob: { background: '#fff', borderRadius: 999, height: 18, position: 'absolute', top: 2, width: 18 },
  headerIconRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  headerIconRowFull: { display: 'grid', gap: 6, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', width: '100%' },
  clipSpikeHeading: { color: theme.textSecondary, fontSize: 12, fontWeight: 700, letterSpacing: 0, margin: 0 },
  clipSpikeCard: { color: theme.textPrimary, display: 'block', borderRadius: 6, textDecoration: 'none' },
  clipThumbWrap: { aspectRatio: '16 / 9', background: '#18181b', position: 'relative', borderRadius: 6, overflow: 'hidden' },
  clipThumb: { display: 'block', height: '100%', objectFit: 'cover', width: '100%' },
  clipThumbFallback: { background: '#18181b', height: '100%', width: '100%' },
  clipDurationBadge: { background: 'rgba(0,0,0,0.8)', borderRadius: 3, bottom: 6, color: '#fafafc', fontSize: 10, fontWeight: 600, padding: '2px 5px', position: 'absolute', right: 6 },
  clipBody: { display: 'grid', gap: 4, padding: '8px 2px 2px' },
  clipTitle: { display: '-webkit-box', fontSize: 12, fontWeight: 600, lineHeight: 1.4, height: '2.8em', overflowWrap: 'anywhere', overflow: 'hidden', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 },
  clipViews: { color: theme.textMuted, fontSize: 10, fontWeight: 500 },
  settingsFooter: { flexShrink: 0, padding: '0 10px 10px' },
  settingsBottomBar: { alignItems: 'center', background: 'rgba(17, 17, 23, 0.96)', border: `1px solid ${theme.borderAccent}`, borderRadius: 8, boxSizing: 'border-box', color: theme.textSecondary, cursor: 'pointer', display: 'flex', fontSize: 11, fontWeight: 800, gap: 8, justifyContent: 'space-between', marginTop: 0, minHeight: 44, padding: '9px 11px', textAlign: 'left', width: '100%' },
}
