import { onPulseUpdate, onVodPulseUpdate, sendBackgroundMessage } from './bridge.ts'

import { createLivePollController, hasLivePollSettingsChange } from './livePoll.ts'

import {
  mountOverlay,
  unmountOverlay,
  updateOverlayContext,
  updateOverlayLogin,
  updateOverlayPayload,
  updateOverlayVodState,
} from './mount.tsx'

import {
  overlaySessionKey,
  resolveVodActivationLogin,
  shouldActivateOverlay,
} from './contentActivation.ts'

import { parseTwitchPage, detectTwitchChannelLive, type TwitchPageContext } from './twitch.ts'

import type { PulseUpdateMessage, VodPulseUpdateMessage } from '../shared/messages.ts'

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
import { provisionalPulseMatchesVod } from '../vod/provisionalLivePulse.ts'
import { readVodAnalyticsBridge } from '../shared/vodAnalyticsBridge.ts'
import { recoverStaleTwitchSidebarChrome } from './twitchSidebarChrome.ts'

type ActiveSession =
  | { kind: 'channel'; login: string }
  | { kind: 'vod'; vodId: string; login: string }

let activeSession: ActiveSession | null = null

let lastPageIsLive = false

let lastCollecting = false

let lastRosterEligible = true

let sessionOpenedAtMs: number | null = null

let overlayPrefsListenerInstalled = false

/** Bumped on every activate/deactivate; stale async work must not mutate state. */
let activationGeneration = 0

let lastSyncedPathname = ''

const livePoll = createLivePollController(() => parseTwitchPage(window.location.pathname))

function beginActivationGeneration(): number {
  activationGeneration += 1
  return activationGeneration
}

function isStaleActivation(generation: number): boolean {
  return generation !== activationGeneration
}

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
    const layoutChanged = Boolean(changes[CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY] || changes.overlayPlacement)
    const livePollChanged = hasLivePollSettingsChange(changes)
    if (!layoutChanged && !livePollChanged) return
    const context = parseTwitchPage(window.location.pathname)
    if (!activeSession) return
    const sameChannel =
      context.kind === 'channel'
      && activeSession.kind === 'channel'
      && context.login === activeSession.login
    if (layoutChanged && sameChannel) {
      updateOverlayContext(context)
    }
    if (
      layoutChanged
      && context.kind === 'vod'
      && activeSession.kind === 'vod'
      && context.vodId === activeSession.vodId
    ) {
      updateOverlayContext(context)
    }
    if (livePollChanged && sameChannel) {
      void getBackendUrl().then(url => {
        if (!activeSession || activeSession.kind !== 'channel') return
        livePoll.sync(activeSession.login, context, lastCollecting && lastRosterEligible, isHostedBackendUrl(url), {
          initialFetchDone: true,
          settingsChanged: true,
        })
      })
    }
  })
}

async function refreshChannelPulse(login: string): Promise<void> {
  await sendBackgroundMessage({ type: 'GET_PULSE', login, watch: false, forceRefresh: true })
}

async function fetchChannelPulse(login: string, forceRefresh = false): Promise<PulseUpdateMessage> {
  const response = await sendBackgroundMessage({
    type: 'GET_PULSE',
    login,
    watch: false,
    forceRefresh,
  })
  if ('type' in response && response.type === 'PULSE_UPDATE') {
    return response
  }
  const error = 'error' in response && typeof response.error === 'string'
    ? response.error
    : 'pulse_request_failed'
  return { type: 'PULSE_UPDATE', login, payload: null, error }
}

async function loadInitialChannelPayload(
  login: string,
  autoTrack: boolean,
  hosted: boolean,
  forceRefresh = false,
): Promise<PulseUpdateMessage> {
  const response = await fetchChannelPulse(login, forceRefresh)

  if (hosted || !autoTrack || !isPulseRosterEligible(response.payload)) {
    return response
  }

  const tracked = await sendBackgroundMessage({ type: 'TRACK', login })
  if ('type' in tracked && tracked.type === 'PULSE_UPDATE') {
    return tracked
  }

  return response
}

function stableActiveVodLogin(): string | undefined {
  if (!activeSession || activeSession.kind !== 'vod') return undefined
  const login = activeSession.login.trim().toLowerCase()
  if (!login || login.startsWith('__vod__:')) return undefined
  return login
}

function isActiveVodSession(vodId: string): boolean {
  return activeSession?.kind === 'vod' && activeSession.vodId === vodId
}

function applyVodPulseMessage(message: VodPulseUpdateMessage): void {
  if (!isActiveVodSession(message.vodId)) {
    return
  }
  const currentSession = activeSession
  if (!currentSession || currentSession.kind !== 'vod') return

  updateOverlayVodState({
    vodPulse: message.vodPulse,
    loading: false,
  })

  const payload = message.vodPulse ? vodPulseToChannelPayload(message.vodPulse) : null
  const provisionalPayload = provisionalPulseMatchesVod(message.vodPulse, message.provisionalPulse)
    ? message.provisionalPulse ?? null
    : null
  const channelLogin = (
    message.vodPulse?.channelLogin
    ?? payload?.login
  )?.trim().toLowerCase()

  if (channelLogin && channelLogin !== currentSession.login) {
    activeSession = { kind: 'vod', vodId: message.vodId, login: channelLogin }
    updateOverlayLogin(channelLogin)
  }

  const displayedPayload = provisionalPayload ?? payload
  // Never promote HTTP 200 coverageMessage into the transport error field —
  // that renders "Can't reach Streamclone" alongside the VOD status card.
  updateOverlayPayload(displayedPayload, message.error)
}

const VOD_FETCH_ATTEMPTS = 2
const VOD_FETCH_RETRY_DELAY_MS = 300

function isVodPulseUpdateMessage(value: unknown): value is VodPulseUpdateMessage {
  return Boolean(
    value
    && typeof value === 'object'
    && 'type' in value
    && value.type === 'VOD_PULSE_UPDATE',
  )
}

function waitForVodFetchRetry(): Promise<void> {
  return new Promise(resolve => {
    window.setTimeout(resolve, VOD_FETCH_RETRY_DELAY_MS)
  })
}

async function fetchVodPulse(vodId: string): Promise<void> {
  if (!isActiveVodSession(vodId)) return
  updateOverlayVodState({ loading: true })

  for (let attempt = 0; attempt < VOD_FETCH_ATTEMPTS; attempt += 1) {
    if (!isActiveVodSession(vodId)) return
    try {
      const bridge = await readVodAnalyticsBridge(vodId)
      if (!isActiveVodSession(vodId)) return
      const response = await sendBackgroundMessage({
        type: 'GET_PULSE_VOD',
        vodId,
        channelLogin: stableActiveVodLogin() ?? bridge?.login,
        streamId: bridge?.streamId,
      })

      if (isVodPulseUpdateMessage(response)) {
        // A normal missing/syncing/ready response is terminal. Retry only a
        // transport/API failure that returned no VOD payload.
        if (response.vodPulse || !response.error || attempt + 1 >= VOD_FETCH_ATTEMPTS) {
          applyVodPulseMessage(response)
          return
        }
      } else if (attempt + 1 >= VOD_FETCH_ATTEMPTS) {
        break
      }
    } catch {
      // The service worker can be cold during a tab/extension reload. Retry once.
    }

    if (!isActiveVodSession(vodId)) return
    await waitForVodFetchRetry()
  }

  applyVodPulseMessage({
    type: 'VOD_PULSE_UPDATE',
    vodId,
    vodPulse: null,
    error: 'vod_pulse_failed',
  })
}

async function activateChannel(context: TwitchPageContext): Promise<void> {
  const login = context.login
  if (!login) {
    deactivate()
    return
  }

  installOverlayPrefsListener()

  const pageIsLive = detectTwitchChannelLive(context)
  const backendUrl = await getBackendUrl()
  const hosted = isHostedBackendUrl(backendUrl)
  const localStack = isLocalStackBackendUrl(backendUrl)

  if (activeSession?.kind === 'channel' && activeSession.login === login) {
    updateOverlayContext(context)
    updateOverlayVodState({ vodPulse: null, loading: false })
    if (pageIsLive !== lastPageIsLive) {
      void refreshChannelPulse(login)
    }
    lastPageIsLive = pageIsLive
    livePoll.sync(login, context, lastCollecting && lastRosterEligible, hosted, {
      initialFetchDone: true,
    })
    return
  }

  const generation = beginActivationGeneration()
  const forceRefresh = activeSession?.kind === 'vod'
  activeSession = { kind: 'channel', login }
  sessionOpenedAtMs = Date.now()
  lastCollecting = false
  lastRosterEligible = true
  lastPageIsLive = pageIsLive

  mountOverlay(login, null, context, {
    sessionOpenedAtMs,
    onPulseRefresh: () => refreshChannelPulse(login),
    ...overlayMountOptions,
  })
  updateOverlayVodState({ vodPulse: null, loading: false })

  const [policy, watchlist] = await Promise.all([getAutoTrackPolicy(), getWatchlist()])
  if (isStaleActivation(generation)) return
  const onWatchlist = watchlist.includes(login.toLowerCase())
  const autoTrack = localStack && (policy === 'followed' || (policy === 'ask' && onWatchlist))
  const message = await loadInitialChannelPayload(login, autoTrack, hosted, forceRefresh)
  if (isStaleActivation(generation)) return
  const payload = message.payload
  lastCollecting = payload?.tracking ?? false
  lastRosterEligible = isPulseRosterEligible(payload)

  mountOverlay(login, payload, context, {
    sessionOpenedAtMs,
    coverageTier: message.coverageTier ?? null,
    pendingTrackPrompt: localStack && policy === 'ask' && !autoTrack && !payload?.tracking && lastRosterEligible,
    onPulseRefresh: () => refreshChannelPulse(login),
    ...overlayMountOptions,
  })
  // mountOverlay resets currentError; apply the worker error (or clear on recovery).
  updateOverlayPayload(payload, message.error, message.coverageTier ?? null)

  livePoll.sync(login, context, lastCollecting && lastRosterEligible, hosted, {
    initialFetchDone: true,
  })
}

async function activateVod(context: TwitchPageContext): Promise<void> {
  const vodId = context.vodId
  if (!vodId) {
    deactivate()
    return
  }

  installOverlayPrefsListener()
  livePoll.stop()

  const login = resolveVodActivationLogin({
    contextLogin: context.login,
    scrapedLogin: null,
    vodId,
  })

  if (activeSession?.kind === 'vod' && activeSession.vodId === vodId) {
    updateOverlayContext(context)
    const bridge = await readVodAnalyticsBridge(vodId)
    if (!isActiveVodSession(vodId)) return
    const betterLogin = (context.login ?? bridge?.login)?.trim().toLowerCase()
    const currentLogin = activeSession.login.trim().toLowerCase()
    if (betterLogin && (currentLogin.startsWith('__vod__:') || betterLogin !== currentLogin)) {
      activeSession = { kind: 'vod', vodId, login: betterLogin }
      updateOverlayLogin(betterLogin)
      await fetchVodPulse(vodId)
    }
    return
  }

  const generation = beginActivationGeneration()
  activeSession = { kind: 'vod', vodId, login }
  sessionOpenedAtMs = Date.now()
  lastCollecting = false
  lastRosterEligible = true
  lastPageIsLive = false

  mountOverlay(login, null, context, {
    sessionOpenedAtMs,
    onPulseRefresh: () => fetchVodPulse(vodId),
  })
  updateOverlayVodState({ vodPulse: null, loading: true })

  await fetchVodPulse(vodId)
  if (isStaleActivation(generation)) return
}

function deactivate(): void {
  beginActivationGeneration()
  activeSession = null
  sessionOpenedAtMs = null
  lastPageIsLive = false
  lastCollecting = false
  lastRosterEligible = true
  livePoll.stop()
  updateOverlayVodState({ vodPulse: null, loading: false })
  unmountOverlay()
}

/**
 * Route sync is driven by URL changes (history + pathname poll), not by chat
 * DOM churn. MutationObserver only checks live/offline flips for the active
 * channel so sustained chat traffic cannot starve navigation.
 */
const URL_POLL_MS = 500
const NAV_DEBOUNCE_MS = 50

function syncFromLocation(): void {
  lastSyncedPathname = window.location.pathname
  const context = parseTwitchPage(window.location.pathname)

  if (!shouldActivateOverlay(context)) {
    if (activeSession) deactivate()
    return
  }

  if (context.kind === 'vod') {
    if (activeSession?.kind === 'vod' && activeSession.vodId === context.vodId) {
      return
    }
    void activateVod(context)
    return
  }

  if (activeSession?.kind === 'channel' && activeSession.login === context.login) {
    const pageIsLive = detectTwitchChannelLive(context)
    if (pageIsLive !== lastPageIsLive) {
      const login = activeSession.login
      lastPageIsLive = pageIsLive
      updateOverlayContext(context)
      void refreshChannelPulse(login)
      void getBackendUrl().then(url => {
        if (
          !activeSession
          || activeSession.kind !== 'channel'
          || activeSession.login !== login
        ) {
          return
        }
        livePoll.sync(
          login,
          context,
          lastCollecting && lastRosterEligible,
          isHostedBackendUrl(url),
        )
      })
    }
    return
  }

  void activateChannel(context)
}

function syncLiveStateFromDom(): void {
  if (!activeSession || activeSession.kind !== 'channel') return
  const context = parseTwitchPage(window.location.pathname)
  if (context.kind !== 'channel' || context.login !== activeSession.login) return
  const pageIsLive = detectTwitchChannelLive(context)
  if (pageIsLive === lastPageIsLive) return
  lastPageIsLive = pageIsLive
  updateOverlayContext(context)
  const login = activeSession.login
  void refreshChannelPulse(login)
  void getBackendUrl().then(url => {
    if (
      !activeSession
      || activeSession.kind !== 'channel'
      || activeSession.login !== login
    ) {
      return
    }
    livePoll.sync(
      login,
      context,
      lastCollecting && lastRosterEligible,
      isHostedBackendUrl(url),
    )
  })
}

type ContentLifecycle = {
  dispose: () => void
}

declare global {
  interface Window {
    __STREAMPULSE_CONTENT_LIFECYCLE__?: ContentLifecycle
  }
}

/** Dispose any prior content-bundle instance before this module claims the page. */
window.__STREAMPULSE_CONTENT_LIFECYCLE__?.dispose()

const stopPulseUpdate = onPulseUpdate((message: PulseUpdateMessage) => {
  if (!activeSession || activeSession.kind !== 'channel' || message.login !== activeSession.login) {
    return
  }

  updateOverlayPayload(message.payload, message.error, message.coverageTier ?? null)

  lastCollecting = message.payload?.tracking ?? false
  lastRosterEligible = isPulseRosterEligible(message.payload)

  const context = parseTwitchPage(window.location.pathname)

  if (context.kind === 'channel' && context.login === activeSession.login) {
    void getBackendUrl().then(url => {
      livePoll.sync(activeSession!.login, context, lastCollecting && lastRosterEligible, isHostedBackendUrl(url))
    })
  }
})

const stopVodPulseUpdate = onVodPulseUpdate((message: VodPulseUpdateMessage) => {
  applyVodPulseMessage(message)
})

let navTimer: ReturnType<typeof setTimeout> | null = null

function scheduleUrlSync(): void {
  if (navTimer) clearTimeout(navTimer)
  navTimer = setTimeout(() => {
    navTimer = null
    syncFromLocation()
  }, NAV_DEBOUNCE_MS)
}

/** Chat/layout mutations must not reset the route timer. */
const observer = new MutationObserver(() => {
  if (window.location.pathname !== lastSyncedPathname) {
    scheduleUrlSync()
    return
  }
  syncLiveStateFromDom()
})

observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('popstate', scheduleUrlSync)

const originalPushState = history.pushState.bind(history)
history.pushState = (...args) => {
  originalPushState(...args)
  scheduleUrlSync()
}

const originalReplaceState = history.replaceState.bind(history)
history.replaceState = (...args) => {
  originalReplaceState(...args)
  scheduleUrlSync()
}

const urlPollId = window.setInterval(() => {
  if (window.location.pathname !== lastSyncedPathname) {
    syncFromLocation()
    return
  }
  if (!activeSession || activeSession.kind !== 'channel') return

  const context = parseTwitchPage(window.location.pathname)
  const sessionKey = overlaySessionKey(context)

  if (sessionKey !== activeSession.login) {
    syncFromLocation()
    return
  }

  syncLiveStateFromDom()
}, URL_POLL_MS)

function disposeContentLifecycle(): void {
  stopPulseUpdate()
  stopVodPulseUpdate()
  observer.disconnect()
  window.removeEventListener('popstate', scheduleUrlSync)
  if (navTimer) {
    clearTimeout(navTimer)
    navTimer = null
  }
  window.clearInterval(urlPollId)
  history.pushState = originalPushState
  history.replaceState = originalReplaceState
  deactivate()
  if (window.__STREAMPULSE_CONTENT_LIFECYCLE__?.dispose === disposeContentLifecycle) {
    delete window.__STREAMPULSE_CONTENT_LIFECYCLE__
  }
}

window.__STREAMPULSE_CONTENT_LIFECYCLE__ = { dispose: disposeContentLifecycle }

// Fail-open before first activation: clear orphaned hide styles from a prior lifecycle.
recoverStaleTwitchSidebarChrome()
syncFromLocation()

export {}
