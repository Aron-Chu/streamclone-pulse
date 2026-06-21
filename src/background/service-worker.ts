import { fetchExtensionHealth, fetchPulseChannel, postWatchChannel } from './api.ts'
import { isTracked, listTrackedLogins, startPolling, trackLogin, untrackLogin } from './tracking.ts'
import type { BackgroundRequest, BackgroundResponse, PulseUpdateMessage } from '../shared/messages.ts'
import { getPollIntervalMs, getSessionPulse, setSessionPulse } from '../shared/storage.ts'

async function refreshPulse(login: string): Promise<void> {
  try {
    const payload = await fetchPulseChannel(login)
    await setSessionPulse(login, { payload, fetchedAt: Date.now() })
    broadcastPulse(login, payload)
  } catch (err) {
    broadcastPulse(login, null, err instanceof Error ? err.message : 'fetch_failed')
  }
}

function broadcastPulse(login: string, payload: PulseUpdateMessage['payload'], error?: string): void {
  const message: PulseUpdateMessage = { type: 'PULSE_UPDATE', login, payload, error }
  chrome.runtime.sendMessage(message).catch(() => {
    // No listeners when overlay is closed.
  })
}

async function ensureTracked(login: string): Promise<void> {
  trackLogin(login)
  await postWatchChannel(login)
  const intervalMs = await getPollIntervalMs()
  startPolling(login, refreshPulse, intervalMs)
  await refreshPulse(login)
}

chrome.runtime.onMessage.addListener((message: BackgroundRequest, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case 'TRACK': {
          await ensureTracked(message.login)
          const cached = await getSessionPulse(message.login)
          sendResponse({
            type: 'PULSE_UPDATE',
            login: message.login,
            payload: cached?.payload ?? null,
          } satisfies PulseUpdateMessage)
          return
        }
        case 'UNTRACK': {
          untrackLogin(message.login)
          sendResponse({ ok: true })
          return
        }
        case 'GET_PULSE': {
          const cached = await getSessionPulse(message.login)
          if (cached) {
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload: cached.payload,
            } satisfies PulseUpdateMessage)
            return
          }
          if (!isTracked(message.login)) {
            await ensureTracked(message.login)
          } else {
            await refreshPulse(message.login)
          }
          const fresh = await getSessionPulse(message.login)
          sendResponse({
            type: 'PULSE_UPDATE',
            login: message.login,
            payload: fresh?.payload ?? null,
          } satisfies PulseUpdateMessage)
          return
        }
        case 'HEALTH': {
          const health = await fetchExtensionHealth()
          sendResponse({ type: 'HEALTH', ok: health.ok, version: health.version } satisfies BackgroundResponse)
          return
        }
        default:
          sendResponse({ error: 'unknown_message' })
      }
    } catch (err) {
      sendResponse({
        type: 'PULSE_UPDATE',
        login: 'type' in message && 'login' in message ? message.login : '',
        payload: null,
        error: err instanceof Error ? err.message : 'error',
      })
    }
  })()
  return true
})

chrome.runtime.onStartup.addListener(() => {
  for (const login of listTrackedLogins()) {
    void ensureTracked(login)
  }
})

export {}
