import { onPulseUpdate, sendBackgroundMessage } from './bridge.ts'
import { mountOverlay, unmountOverlay, updateOverlayPayload } from './mount.tsx'
import { isTwitchChannelPage, parseChannelLogin } from './twitch.ts'
import type { PulseUpdateMessage } from '../shared/messages.ts'

let activeLogin: string | null = null

async function activate(login: string): Promise<void> {
  if (activeLogin === login) {
    return
  }
  activeLogin = login
  const response = await sendBackgroundMessage({ type: 'TRACK', login })
  const payload = 'payload' in response ? response.payload : null
  mountOverlay(login, payload)
}

function deactivate(): void {
  activeLogin = null
  unmountOverlay()
}

const NAV_DEBOUNCE_MS = 350

function syncFromLocation(): void {
  const login = parseChannelLogin(window.location.pathname)
  if (!login || !isTwitchChannelPage(window.location.pathname)) {
    deactivate()
    return
  }
  void activate(login)
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

syncFromLocation()

export {}
