import { onPulseUpdate, sendBackgroundMessage } from './bridge.ts'

import { createLivePollController } from './livePoll.ts'

import { mountOverlay, unmountOverlay, updateOverlayContext, updateOverlayPayload } from './mount.tsx'

import { parseTwitchPage, detectTwitchChannelLive, type TwitchPageContext } from './twitch.ts'

import type { PulseUpdateMessage } from '../shared/messages.ts'

import {
  getAutoTrackPolicy,
  getBackendUrl,
  CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY,
  isHostedBackendUrl,
  isLocalStackBackendUrl,
} from '../shared/storage.ts'

import { getWatchlist } from '../shared/watchlist.ts'

import { isPulseTop500Supported } from '../ui/pulseEligibility.ts'

let activeLogin: string | null = null

let lastPageIsLive = false

let lastCollecting = false

let lastTop500Eligible = true

let sessionOpenedAtMs: number | null = null

let overlayPrefsListenerInstalled = false

const livePoll = createLivePollController(() => parseTwitchPage(window.location.pathname))

function installOverlayPrefsListener(): void {
  if (overlayPrefsListenerInstalled) return
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return
  overlayPrefsListenerInstalled = true
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return
    if (!changes[CHAT_CLOSED_PULSE_DOCK_ENABLED_KEY] && !changes.overlayPlacement) return
    const context = parseTwitchPage(window.location.pathname)
    if (!activeLogin || !context.login || context.login !== activeLogin) return
    updateOverlayContext(context)
  })
}

async function refreshPulse(login: string): Promise<void> {
  await sendBackgroundMessage({ type: 'GET_PULSE', login, watch: false })
}

async function fetchPulse(login: string): Promise<PulseUpdateMessage> {
  const response = await sendBackgroundMessage({ type: 'GET_PULSE', login, watch: false })
  if ('type' in response && response.type === 'PULSE_UPDATE') {
    return response
  }
  return { type: 'PULSE_UPDATE', login, payload: null }
}

async function loadInitialPayload(
  login: string,
  autoTrack: boolean,
  hosted: boolean,
): Promise<PulseUpdateMessage> {
  const response = await fetchPulse(login)

  if (hosted || !autoTrack || !isPulseTop500Supported(response.payload)) {
    return response
  }

  const tracked = await sendBackgroundMessage({ type: 'TRACK', login })
  if ('type' in tracked && tracked.type === 'PULSE_UPDATE') {
    return tracked
  }

  return response
}

async function activate(context: TwitchPageContext): Promise<void> {
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

  if (activeLogin === login) {
    updateOverlayContext(context)
    if (pageIsLive !== lastPageIsLive) {
      void refreshPulse(login)
    }
    lastPageIsLive = pageIsLive
    livePoll.sync(login, context, lastCollecting && lastTop500Eligible, hosted)
    return
  }

  activeLogin = login
  sessionOpenedAtMs = Date.now()
  lastCollecting = false
  lastTop500Eligible = true
  lastPageIsLive = pageIsLive

  mountOverlay(login, null, context, { sessionOpenedAtMs })
  livePoll.sync(login, context, false, hosted)

  const [policy, watchlist] = await Promise.all([getAutoTrackPolicy(), getWatchlist()])
  const onWatchlist = watchlist.includes(login.toLowerCase())
  const autoTrack = localStack && (policy === 'followed' || (policy === 'ask' && onWatchlist))
  const message = await loadInitialPayload(login, autoTrack, hosted)
  const payload = message.payload
  lastCollecting = payload?.tracking ?? false
  lastTop500Eligible = isPulseTop500Supported(payload)

  mountOverlay(login, payload, context, {
    sessionOpenedAtMs,
    coverageTier: message.coverageTier ?? null,
    pendingTrackPrompt: localStack && policy === 'ask' && !autoTrack && !payload?.tracking && lastTop500Eligible,
  })

  livePoll.sync(login, context, lastCollecting && lastTop500Eligible, hosted)
}

function deactivate(): void {
  activeLogin = null
  sessionOpenedAtMs = null
  lastPageIsLive = false
  lastCollecting = false
  lastTop500Eligible = true
  livePoll.stop()
  unmountOverlay()
}

const NAV_DEBOUNCE_MS = 350

function syncFromLocation(): void {
  const context = parseTwitchPage(window.location.pathname)

  if (context.kind === 'non-channel' || !context.login) {
    deactivate()
    return
  }

  void activate(context)
}

onPulseUpdate((message: PulseUpdateMessage) => {
  if (!activeLogin || message.login !== activeLogin) return

  updateOverlayPayload(message.payload, message.error, message.coverageTier ?? null)

  lastCollecting = message.payload?.tracking ?? false
  lastTop500Eligible = isPulseTop500Supported(message.payload)

  const context = parseTwitchPage(window.location.pathname)

  if (context.login === activeLogin) {
    void getBackendUrl().then(url => {
      livePoll.sync(activeLogin!, context, lastCollecting && lastTop500Eligible, isHostedBackendUrl(url))
    })
  }
})

let navTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSync(): void {
  if (navTimer) clearTimeout(navTimer)
  navTimer = setTimeout(syncFromLocation, NAV_DEBOUNCE_MS)
}

const observer = new MutationObserver(() => {
  scheduleSync()
})

observer.observe(document.documentElement, { childList: true, subtree: true })
window.addEventListener('popstate', scheduleSync)

const originalPushState = history.pushState.bind(history)
history.pushState = (...args) => {
  originalPushState(...args)
  scheduleSync()
}

const originalReplaceState = history.replaceState.bind(history)
history.replaceState = (...args) => {
  originalReplaceState(...args)
  scheduleSync()
}

setInterval(() => {
  if (!activeLogin) return

  const context = parseTwitchPage(window.location.pathname)

  if (context.login !== activeLogin) return

  const pageIsLive = detectTwitchChannelLive(context)

  if (pageIsLive !== lastPageIsLive) {
    void refreshPulse(activeLogin)
    lastPageIsLive = pageIsLive
    updateOverlayContext(context)
    void getBackendUrl().then(url => {
      livePoll.sync(activeLogin!, context, lastCollecting && lastTop500Eligible, isHostedBackendUrl(url))
    })
  }
}, 5000)

syncFromLocation()

export {}
