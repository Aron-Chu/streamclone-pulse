import { onPulseUpdate, onVodPulseUpdate, sendBackgroundMessage } from './bridge.ts'

import { createLivePollController } from './livePoll.ts'

import {
  ensureUniqueOverlayHosts,
  mountOverlay,
  unmountOverlay,
  updateOverlayContext,
  updateOverlayLogin,
  updateOverlayPayload,
  updateOverlayVodState,
} from './mount.tsx'

import { overlaySessionKey, placeholderLoginForContext, shouldActivateOverlay } from './contentActivation.ts'
import {
  createActivationGate,
  isSameChannelActivationCurrent,
  isVodActivationCurrent,
} from './activationGate.ts'
import { createRouteSyncScheduler } from './routeSyncScheduler.ts'

import { parseTwitchPage, detectTwitchChannelLive, type TwitchPageContext } from './twitch.ts'

import type { PulseUpdateMessage, VodPulseUpdateMessage } from '../shared/messages.ts'
import {
  requestPulseLoadCompletedAnalytics,
  resetAnalyticsActivationLatches,
} from '../shared/extensionAnalytics.ts'

import {
  getAutoTrackPolicy,
  getBackendUrl,
  CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY,
  isHostedBackendUrl,
  isLocalStackBackendUrl,
} from '../shared/storage.ts'

import { getWatchlist } from '../shared/watchlist.ts'

import { isPulseRosterEligible } from '../ui/pulseEligibility.ts'

import { vodPulseToChannelPayload } from '../vod/vodPulseToChannelPayload.ts'
import { isSupportedTwitchUrl } from '../background/pulseBroadcastTargets.ts'

if (isSupportedTwitchUrl(window.location.href)) {
type ActiveSession =
  | { kind: 'channel'; login: string }
  | { kind: 'vod'; vodId: string; login: string }

let activeSession: ActiveSession | null = null
/** Accepted live stream identity for rejecting late login-only broadcasts. */
let activeStreamId: string | null = null

let lastPageIsLive = false

let lastCollecting = false

let lastRosterEligible = true

let sessionOpenedAtMs: number | null = null

let overlayPrefsListenerInstalled = false

/** Production activation gate — tests import createActivationGate from activationGate.ts. */
const activationGate = createActivationGate()

const livePoll = createLivePollController(() => parseTwitchPage(window.location.pathname))

function setLivePollWindow(window: 'recent' | 'full'): void {
  livePoll.setPollWindow(window)
}

const overlayMountOptions = {
  onLivePollWindowChange: setLivePollWindow,
} as const

function installOverlayPrefsListener(): void {
  if (overlayPrefsListenerInstalled) return
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
  overlayPrefsListenerInstalled = true
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    if (!changes[CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY] && !changes.overlayPlacement) return
    const context = parseTwitchPage(window.location.pathname)
    if (!activeSession) return
    if (context.kind === 'channel' && activeSession.kind === 'channel' && context.login === activeSession.login) {
      updateOverlayContext(context)
    }
    if (context.kind === 'vod' && activeSession.kind === 'vod' && context.vodId === activeSession.vodId) {
      updateOverlayContext(context)
    }
  })
}

async function refreshChannelPulse(login: string): Promise<void> {
  const response = await sendBackgroundMessage({ type: 'GET_PULSE', login, watch: false })
  if (!activeSession || activeSession.kind !== 'channel' || activeSession.login !== login) return
  if (!('type' in response) || response.type !== 'PULSE_UPDATE') return
  if (response.payload?.streamId) activeStreamId = response.payload.streamId.trim()
  updateOverlayPayload(response.payload, response.error, response.coverageTier ?? null, { authoritative: true })
}

async function fetchChannelPulse(login: string): Promise<PulseUpdateMessage> {
  const response = await sendBackgroundMessage({ type: 'GET_PULSE', login, watch: false })
  if ('type' in response && response.type === 'PULSE_UPDATE') {
    return response
  }
  return { type: 'PULSE_UPDATE', login, payload: null }
}

async function loadInitialChannelPayload(
  login: string,
  autoTrack: boolean,
  hosted: boolean,
): Promise<PulseUpdateMessage> {
  const response = await fetchChannelPulse(login)

  if (hosted || !autoTrack || !isPulseRosterEligible(response.payload)) {
    return response
  }

  const tracked = await sendBackgroundMessage({ type: 'TRACK', login })
  if ('type' in tracked && tracked.type === 'PULSE_UPDATE') {
    return tracked
  }

  return response
}

function applyVodPulseMessage(message: VodPulseUpdateMessage): void {
  if (!activeSession || activeSession.kind !== 'vod' || activeSession.vodId !== message.vodId) {
    return
  }

  updateOverlayVodState({
    vodPulse: message.vodPulse,
    loading: false,
  })

  const payload = message.vodPulse ? vodPulseToChannelPayload(message.vodPulse) : null
  const channelLogin = message.vodPulse?.channelLogin?.trim().toLowerCase()

  if (channelLogin && channelLogin !== activeSession.login) {
    activeSession = { kind: 'vod', vodId: message.vodId, login: channelLogin }
    updateOverlayLogin(channelLogin)
  }

  if (message.vodPulse && !message.error) {
    requestPulseLoadCompletedAnalytics()
  }

  updateOverlayPayload(payload, message.error ?? (payload ? undefined : message.vodPulse?.coverageMessage))
}

/** Fetch only — caller applies after generation check. */
async function fetchVodPulseResult(vodId: string): Promise<VodPulseUpdateMessage> {
  const response = await sendBackgroundMessage({ type: 'GET_PULSE_VOD', vodId })
  if ('type' in response && response.type === 'VOD_PULSE_UPDATE') {
    return response
  }
  return {
    type: 'VOD_PULSE_UPDATE',
    vodId,
    vodPulse: null,
    error: 'vod_pulse_failed',
  }
}

async function activateChannel(context: TwitchPageContext): Promise<void> {
  const login = context.login
  if (!login) {
    deactivate()
    return
  }

  installOverlayPrefsListener()

  const pageIsLive = detectTwitchChannelLive(context)
  const generation = activationGate.begin()
  const intendedLogin = login
  const intendedPath = window.location.pathname

  if (activeSession?.kind === 'channel' && activeSession.login === login) {
    updateOverlayContext(context)
    updateOverlayVodState({ vodPulse: null, loading: false })
    if (pageIsLive !== lastPageIsLive) {
      void refreshChannelPulse(login)
    }
    lastPageIsLive = pageIsLive
    const hostedNow = isHostedBackendUrl(await getBackendUrl())
    if (
      !isSameChannelActivationCurrent({
        generation,
        gateCurrent: activationGate.current(),
        activeSession,
        intendedLogin,
      })
    ) {
      return
    }
    livePoll.sync(login, context, lastCollecting && lastRosterEligible, hostedNow)
    return
  }

  resetAnalyticsActivationLatches()

  // Capture session intent before any await that could race with navigation.
  activeSession = { kind: 'channel', login: intendedLogin }
  activeStreamId = null
  sessionOpenedAtMs = Date.now()
  lastCollecting = false
  lastRosterEligible = true
  lastPageIsLive = pageIsLive

  const backendUrl = await getBackendUrl()
  if (generation !== activationGate.current()) return
  if (activeSession?.kind !== 'channel' || activeSession.login !== intendedLogin) return
  if (window.location.pathname !== intendedPath && parseTwitchPage(window.location.pathname).login !== intendedLogin) {
    return
  }

  const hosted = isHostedBackendUrl(backendUrl)
  const localStack = isLocalStackBackendUrl(backendUrl)

  mountOverlay(intendedLogin, null, context, {
    sessionOpenedAtMs,
    onPulseRefresh: () => refreshChannelPulse(intendedLogin),
    ...overlayMountOptions,
  })
  updateOverlayVodState({ vodPulse: null, loading: false })
  livePoll.sync(intendedLogin, context, false, hosted)

  const [policy, watchlist] = await Promise.all([getAutoTrackPolicy(), getWatchlist()])
  if (generation !== activationGate.current()) return
  if (activeSession?.kind !== 'channel' || activeSession.login !== intendedLogin) return

  const onWatchlist = watchlist.includes(intendedLogin.toLowerCase())
  const autoTrack = localStack && (policy === 'followed' || (policy === 'ask' && onWatchlist))
  const message = await loadInitialChannelPayload(intendedLogin, autoTrack, hosted)
  if (generation !== activationGate.current()) return
  if (activeSession?.kind !== 'channel' || activeSession.login !== intendedLogin) return

  const payload = message.payload
  activeStreamId = payload?.streamId?.trim() || null
  lastCollecting = payload?.tracking ?? false
  lastRosterEligible = isPulseRosterEligible(payload)

  const contextNow = parseTwitchPage(window.location.pathname)
  if (contextNow.kind !== 'channel' || contextNow.login !== intendedLogin) return

  mountOverlay(intendedLogin, payload, contextNow, {
    sessionOpenedAtMs,
    coverageTier: message.coverageTier ?? null,
    pendingTrackPrompt: localStack && policy === 'ask' && !autoTrack && !payload?.tracking && lastRosterEligible,
    onPulseRefresh: () => refreshChannelPulse(intendedLogin),
    ...overlayMountOptions,
  })

  if (payload && !message.error) {
    requestPulseLoadCompletedAnalytics()
  }

  livePoll.sync(intendedLogin, contextNow, lastCollecting && lastRosterEligible, hosted)
}

async function activateVod(context: TwitchPageContext): Promise<void> {
  const vodId = context.vodId
  if (!vodId) {
    deactivate()
    return
  }

  installOverlayPrefsListener()
  livePoll.stop()

  const login = placeholderLoginForContext(context)
  const generation = activationGate.begin()

  if (activeSession?.kind === 'vod' && activeSession.vodId === vodId) {
    updateOverlayContext(context)
    return
  }

  resetAnalyticsActivationLatches()
  activeSession = { kind: 'vod', vodId, login }
  activeStreamId = null
  sessionOpenedAtMs = Date.now()
  lastCollecting = false
  lastRosterEligible = true
  lastPageIsLive = false

  mountOverlay(login, null, context, {
    sessionOpenedAtMs,
    onPulseRefresh: async () => {
      const result = await fetchVodPulseResult(vodId)
      if (activeSession?.kind !== 'vod' || activeSession.vodId !== vodId) return
      applyVodPulseMessage(result)
    },
  })
  updateOverlayVodState({ vodPulse: null, loading: true })

  const result = await fetchVodPulseResult(vodId)
  if (
    !isVodActivationCurrent({
      generation,
      gateCurrent: activationGate.current(),
      activeSession,
      intendedVodId: vodId,
    })
  ) {
    return
  }
  applyVodPulseMessage(result)
}

function deactivate(): void {
  activationGate.cancel()
  activeSession = null
  activeStreamId = null
  sessionOpenedAtMs = null
  lastPageIsLive = false
  lastCollecting = false
  lastRosterEligible = true
  livePoll.stop()
  updateOverlayVodState({ vodPulse: null, loading: false })
  unmountOverlay()
}

const NAV_DEBOUNCE_MS = 350

function syncFromLocation(): void {
  const context = parseTwitchPage(window.location.pathname)
  // Reinjection / duplicate DOM hosts can appear without a full remount.
  ensureUniqueOverlayHosts()

  if (!shouldActivateOverlay(context)) {
    deactivate()
    return
  }

  if (context.kind === 'vod') {
    void activateVod(context)
    return
  }

  void activateChannel(context)
}

onPulseUpdate((message: PulseUpdateMessage) => {
  if (!activeSession || activeSession.kind !== 'channel' || message.login !== activeSession.login) {
    return
  }

  const broadcastStreamId = message.streamId?.trim()
  const payloadStreamId = message.payload?.streamId?.trim()
  // Service-worker broadcasts are stream-scoped. A missing metadata identity is
  // rejected so a late login-only error cannot blank a different broadcast.
  if (!broadcastStreamId) return
  if (payloadStreamId && payloadStreamId !== broadcastStreamId) return
  if (activeStreamId && activeStreamId !== broadcastStreamId) return
  if (message.payload && !payloadStreamId) return
  activeStreamId = broadcastStreamId

  if (message.softStaleRefresh) {
    updateOverlayPayload(null, undefined, message.coverageTier ?? null, { softStaleRefresh: true })
    return
  }

  updateOverlayPayload(message.payload, message.error, message.coverageTier ?? null)


  lastCollecting = message.payload?.tracking ?? false
  lastRosterEligible = isPulseRosterEligible(message.payload)

  const context = parseTwitchPage(window.location.pathname)
  const sessionLogin = activeSession.login

  if (context.kind === 'channel' && context.login === sessionLogin) {
    const generationSnapshot = activationGate.current()
    void getBackendUrl().then(url => {
      if (generationSnapshot !== activationGate.current()) return
      if (!activeSession || activeSession.kind !== 'channel' || activeSession.login !== sessionLogin) return
      livePoll.sync(sessionLogin, context, lastCollecting && lastRosterEligible, isHostedBackendUrl(url))
    })
  }
})

onVodPulseUpdate((message: VodPulseUpdateMessage) => {
  applyVodPulseMessage(message)
})

const NAV_MAX_WAIT_MS = 1_200

const routeSync = createRouteSyncScheduler(syncFromLocation, {
  debounceMs: NAV_DEBOUNCE_MS,
  maxWaitMs: NAV_MAX_WAIT_MS,
})

const observer = new MutationObserver(() => {
  routeSync.schedule()
})

observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('popstate', () => routeSync.schedule())

const originalPushState = history.pushState.bind(history)
history.pushState = (...args) => {
  originalPushState(...args)
  routeSync.schedule()
}

const originalReplaceState = history.replaceState.bind(history)
history.replaceState = (...args) => {
  originalReplaceState(...args)
  routeSync.schedule()
}

setInterval(() => {
  if (!activeSession || activeSession.kind !== 'channel') return

  const context = parseTwitchPage(window.location.pathname)
  const sessionKey = overlaySessionKey(context)

  if (sessionKey !== activeSession.login) return

  const pageIsLive = detectTwitchChannelLive(context)
  const login = activeSession.login

  if (pageIsLive !== lastPageIsLive) {
    void refreshChannelPulse(login)
    lastPageIsLive = pageIsLive
    updateOverlayContext(context)
    const generationSnapshot = activationGate.current()
    void getBackendUrl().then(url => {
      if (generationSnapshot !== activationGate.current()) return
      if (!activeSession || activeSession.kind !== 'channel' || activeSession.login !== login) return
      livePoll.sync(login, context, lastCollecting && lastRosterEligible, isHostedBackendUrl(url))
    })
  }
}, 5000)

routeSync.schedule()
}

export {}
