import {
  createPulseBookmark,
  deletePulseBookmark,
  fetchAlwaysTracked,
  fetchExtensionHealth,
  fetchPastVodRows,
  fetchPulseBackfillStatus,
  fetchPulseBookmarks,
  fetchPulseChannel,
  fetchTopClip,
  postPulseBackfill,
  postVodHint,
  postWatchChannel,
  setAlwaysTracked,
} from './api.ts'
import { fetchEmoteImageBytes } from './emoteImageFetch.ts'
import { isTracked, listTrackedLogins, pauseAllPolling, resumeAllPolling, startPolling, trackLogin, untrackLogin } from './tracking.ts'
import type { BackgroundRequest, BackgroundResponse, PastVodRow, PulseUpdateMessage } from '../shared/messages.ts'
import { getAutoUpdateEnabled, getPollIntervalMs, getSessionPulse, setAutoUpdateEnabled, setSessionPulse } from '../shared/storage.ts'
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
} from '../shared/watchlist.ts'
import { initPulseDebug, getPulseDebugLog, pulseDebug } from '../shared/pulseDebug.ts'
import { discoverLiveVodIdFromGqlInTab } from './twitchPageGql.ts'

void initPulseDebug()

async function refreshPulse(login: string, window: 'recent' | 'full' = 'recent'): Promise<void> {
  try {
    const payload = await fetchPulseChannel(login, { window })
    await setSessionPulse(login, { payload, fetchedAt: Date.now() })
    broadcastPulse(login, payload)
  } catch (err) {
    broadcastPulse(login, null, err instanceof Error ? err.message : 'fetch_failed')
  }
}

async function peekPulse(login: string, window: 'recent' | 'full' = 'recent'): Promise<PulseUpdateMessage['payload']> {
  try {
    const payload = await fetchPulseChannel(login, { window })
    await setSessionPulse(login, { payload, fetchedAt: Date.now() })
    return payload
  } catch {
    return null
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
  const autoUpdate = await getAutoUpdateEnabled()
  if (autoUpdate) {
    startPolling(login, refreshPulse, intervalMs)
  }
  await refreshPulse(login)
}

async function applyAutoUpdateSetting(enabled: boolean): Promise<void> {
  if (!enabled) {
    pauseAllPolling()
    return
  }
  const intervalMs = await getPollIntervalMs()
  resumeAllPolling(refreshPulse, intervalMs)
}

async function syncWatchlistToBackend(): Promise<string[]> {
  const channels = await getWatchlist()
  let backendChannels: string[] = []
  try {
    backendChannels = await fetchAlwaysTracked()
  } catch {
    backendChannels = []
  }

  const backendSet = new Set(backendChannels.map(item => item.toLowerCase()))
  const localSet = new Set(channels)

  await Promise.all([
    ...channels.map(login => setAlwaysTracked(login, true)),
    ...backendChannels
      .filter(login => !localSet.has(login.toLowerCase()))
      .map(login => setAlwaysTracked(login, false)),
  ])

  for (const login of channels) {
    if (!isTracked(login)) {
      await ensureTracked(login)
    }
  }

  return channels
}

const PAST_VODS_CACHE_MS = 5 * 60 * 1000
const pastVodsCache = new Map<string, { rows: PastVodRow[]; fetchedAt: number }>()

async function listPastVods(
  login: string,
  options?: { liveStreamId?: string; isLive?: boolean },
): Promise<PastVodRow[]> {
  const key = `${login.toLowerCase()}:${options?.isLive ? options.liveStreamId ?? 'live' : 'offline'}`
  const cached = pastVodsCache.get(key)
  const now = Date.now()

  if (cached && now - cached.fetchedAt < PAST_VODS_CACHE_MS) {
    return cached.rows
  }

  const rows = await fetchPastVodRows(login, {
    liveStreamId: options?.liveStreamId,
    isLive: options?.isLive,
  })
  pastVodsCache.set(key, { rows, fetchedAt: now })
  return rows
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.autoUpdateEnabled) {
    void applyAutoUpdateSetting(Boolean(changes.autoUpdateEnabled.newValue ?? true))
  }
  if (areaName !== 'sync' || !changes.watchlist) return
  void syncWatchlistToBackend()
})

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, sendResponse) => {
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
          const window = message.window === 'full' ? 'full' : 'recent'
          if (message.watch) {
            await ensureTracked(message.login)
          } else if (isTracked(message.login)) {
            await refreshPulse(message.login, window)
          } else {
            const payload = await peekPulse(message.login, window)
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload,
            } satisfies PulseUpdateMessage)
            return
          }
          const fresh = await getSessionPulse(message.login)
          sendResponse({
            type: 'PULSE_UPDATE',
            login: message.login,
            payload: fresh?.payload ?? null,
          } satisfies PulseUpdateMessage)
          return
        }
        case 'DISCOVER_LIVE_VOD': {
          try {
            const tabId = sender.tab?.id
            if (!tabId) {
              sendResponse({
                type: 'DISCOVER_LIVE_VOD',
                result: { vodId: null, streamId: null, source: null, gqlErrors: ['no_twitch_tab'] },
                error: 'no_twitch_tab',
              } satisfies BackgroundResponse)
              return
            }
            const result = await discoverLiveVodIdFromGqlInTab(tabId, message.login)
            sendResponse({ type: 'DISCOVER_LIVE_VOD', result } satisfies BackgroundResponse)
          } catch (err) {
            sendResponse({
              type: 'DISCOVER_LIVE_VOD',
              result: { vodId: null, streamId: null, source: null, gqlErrors: [err instanceof Error ? err.message : 'discover_failed'] },
              error: err instanceof Error ? err.message : 'discover_failed',
            } satisfies BackgroundResponse)
          }
          return
        }
        case 'HINT_VOD': {
          try {
            const result = await postVodHint(message.login, {
              streamId: message.streamId,
              vodId: message.vodId,
            })
            await refreshPulse(message.login, 'full')
            sendResponse({ ok: true, vodId: result.vodId ?? message.vodId })
          } catch (err) {
            await pulseDebug(
              'vod.hint.api',
              err instanceof Error ? err.message : 'vod hint failed',
              { login: message.login, streamId: message.streamId, vodId: message.vodId },
              'warn',
            )
            sendResponse({ ok: false, error: err instanceof Error ? err.message : 'vod_hint_failed' })
          }
          return
        }
        case 'LOAD_MISSED_MOMENTS': {
          const job = await postPulseBackfill(message.login, {
            streamId: message.streamId,
            vodId: message.vodId,
            fromOffsetSeconds: message.fromOffsetSeconds,
            toOffsetSeconds: message.toOffsetSeconds,
          })
          if (job.status === 'already_available' || job.status === 'done') {
            await refreshPulse(message.login, 'full')
          }
          sendResponse({ type: 'PULSE_BACKFILL', job } satisfies BackgroundResponse)
          return
        }
        case 'GET_PULSE_BACKFILL_STATUS': {
          const job = await fetchPulseBackfillStatus(message.jobId)
          if (job.status === 'done' || job.status === 'already_available') {
            const login = job.login
            if (login) {
              await refreshPulse(login, 'full')
            }
          }
          sendResponse({ type: 'PULSE_BACKFILL_STATUS', job } satisfies BackgroundResponse)
          return
        }
        case 'GET_CLIP': {
          const clip = await fetchTopClip(message.login, {
            startedAt: message.startedAt,
            isLive: message.isLive,
          })
          sendResponse({ type: 'CLIP', clip } satisfies BackgroundResponse)
          return
        }
        case 'HEALTH': {
          const health = await fetchExtensionHealth()
          sendResponse({
            type: 'HEALTH',
            ok: health.ok,
            version: health.version,
            helixEnabled: health.helixEnabled,
          } satisfies BackgroundResponse)
          return
        }
        case 'GET_PULSE_DEBUG_LOG': {
          sendResponse({ type: 'PULSE_DEBUG_LOG', entries: await getPulseDebugLog() } satisfies BackgroundResponse)
          return
        }
        case 'OPEN_OPTIONS': {
          chrome.runtime.openOptionsPage()
          sendResponse({ ok: true })
          return
        }
        case 'LIST_WATCHLIST': {
          sendResponse({ type: 'WATCHLIST', channels: await getWatchlist() } satisfies BackgroundResponse)
          return
        }
        case 'ADD_WATCHLIST': {
          const channels = await addToWatchlist(message.login)
          await syncWatchlistToBackend()
          sendResponse({ type: 'WATCHLIST', channels } satisfies BackgroundResponse)
          return
        }
        case 'REMOVE_WATCHLIST': {
          const channels = await removeFromWatchlist(message.login)
          await syncWatchlistToBackend()
          sendResponse({ type: 'WATCHLIST', channels } satisfies BackgroundResponse)
          return
        }
        case 'SYNC_WATCHLIST': {
          const channels = await syncWatchlistToBackend()
          sendResponse({ type: 'SYNC_WATCHLIST', channels } satisfies BackgroundResponse)
          return
        }
        case 'LIST_BOOKMARKS': {
          const items = await fetchPulseBookmarks({
            login: message.login,
            streamId: message.streamId,
            vodId: message.vodId,
          })
          sendResponse({ type: 'BOOKMARKS', items } satisfies BackgroundResponse)
          return
        }
        case 'SAVE_BOOKMARK': {
          const item = await createPulseBookmark(message.bookmark)
          sendResponse({ type: 'BOOKMARK', item } satisfies BackgroundResponse)
          return
        }
        case 'DELETE_BOOKMARK': {
          await deletePulseBookmark(message.id)
          sendResponse({ type: 'DELETE_BOOKMARK', ok: true } satisfies BackgroundResponse)
          return
        }
        case 'SET_AUTO_UPDATE': {
          await setAutoUpdateEnabled(message.enabled)
          await applyAutoUpdateSetting(message.enabled)
          sendResponse({ ok: true })
          return
        }
        case 'LIST_PAST_VODS': {
          try {
            const items = await listPastVods(message.login, {
              liveStreamId: message.liveStreamId,
              isLive: message.isLive,
            })
            sendResponse({ type: 'PAST_VODS', items } satisfies BackgroundResponse)
          } catch (err) {
            sendResponse({
              type: 'PAST_VODS',
              items: [],
              error: err instanceof Error ? err.message : 'past_vods_failed',
            } satisfies BackgroundResponse)
          }
          return
        }
        case 'FETCH_EMOTE_IMAGE': {
          try {
            const image = await fetchEmoteImageBytes(message.url)
            sendResponse({
              type: 'EMOTE_IMAGE',
              mimeType: image.mimeType,
              buffer: image.buffer,
            } satisfies BackgroundResponse)
          } catch (err) {
            sendResponse({
              type: 'EMOTE_IMAGE',
              error: err instanceof Error ? err.message : 'emote_image_failed',
            } satisfies BackgroundResponse)
          }
          return
        }
        default:
          sendResponse({ error: 'unknown_message' })
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'error'
      switch (message.type) {
        case 'LOAD_MISSED_MOMENTS':
          sendResponse({ type: 'PULSE_BACKFILL', job: null, error: messageText } satisfies BackgroundResponse)
          return
        case 'GET_PULSE_BACKFILL_STATUS':
          sendResponse({ type: 'PULSE_BACKFILL_STATUS', job: null, error: messageText } satisfies BackgroundResponse)
          return
        case 'LIST_PAST_VODS':
          sendResponse({ type: 'PAST_VODS', items: [], error: messageText } satisfies BackgroundResponse)
          return
        default:
          sendResponse({
            type: 'PULSE_UPDATE',
            login: 'login' in message ? (message.login ?? '') : '',
            payload: null,
            error: messageText,
          } satisfies PulseUpdateMessage)
      }
    }
  })()
  return true
})

chrome.runtime.onStartup.addListener(() => {
  void (async () => {
    await syncWatchlistToBackend()
    for (const login of listTrackedLogins()) {
      await ensureTracked(login)
    }
  })()
})

chrome.runtime.onInstalled.addListener(() => {
  void syncWatchlistToBackend()
})

export {}
