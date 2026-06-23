import { onPulseUpdate, sendBackgroundMessage } from './bridge.ts'
import { mountOverlay, unmountOverlay, updateOverlayContext, updateOverlayPayload } from './mount.tsx'
import { parseTwitchPage, detectTwitchChannelLive, type TwitchPageContext } from './twitch.ts'
import type { PulseUpdateMessage } from '../shared/messages.ts'
import { getAutoTrackPolicy } from '../shared/storage.ts'
import { getWatchlist } from '../shared/watchlist.ts'

let activeLogin: string | null = null
let lastPageIsLive = false

async function nudgeWatchOnLive(login: string): Promise<void> {
  await sendBackgroundMessage({ type: 'GET_PULSE', login, watch: true })
}

async function loadInitialPayload(login: string, autoTrack: boolean): Promise<PulseUpdateMessage['payload']> {
  const response = await sendBackgroundMessage(
    autoTrack ? { type: 'TRACK', login } : { type: 'GET_PULSE', login, watch: false },
  )
  return 'payload' in response ? response.payload : null
}

async function activate(context: TwitchPageContext): Promise<void> {
  const login = context.login
  if (!login) {
    deactivate()
    return
  }
  if (activeLogin === login) {
    updateOverlayContext(context)
    const pageIsLive = detectTwitchChannelLive(context)
    if (pageIsLive && !lastPageIsLive) {
      void nudgeWatchOnLive(login)
    }
    lastPageIsLive = pageIsLive
    return
  }
  activeLogin = login
  const [policy, watchlist] = await Promise.all([getAutoTrackPolicy(), getWatchlist()])
  const onWatchlist = watchlist.includes(login.toLowerCase())
  const autoTrack = policy === 'followed' || (policy === 'ask' && onWatchlist)
  const payload = await loadInitialPayload(login, autoTrack)
  mountOverlay(login, payload, context, { pendingTrackPrompt: policy === 'ask' && !autoTrack && !payload?.tracking })
  const pageIsLive = detectTwitchChannelLive(context)
  if (pageIsLive && !lastPageIsLive) {
    void nudgeWatchOnLive(login)
  }
  lastPageIsLive = pageIsLive
}

function deactivate(): void {
  activeLogin = null
  lastPageIsLive = false
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
  updateOverlayPayload(message.payload, message.error)
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
    if (pageIsLive) {
      void nudgeWatchOnLive(activeLogin)
    }
    lastPageIsLive = pageIsLive
    updateOverlayContext(context)
  }
}, 5000)

syncFromLocation()

export {}
