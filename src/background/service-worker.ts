import {
  createPulseBookmark,
  deletePulseBookmark,
  fetchAlwaysTracked,
  fetchExtensionCoverage,
  fetchExtensionHealth,
  fetchPastVodRows,
  fetchPulseBackfillStatus,
  fetchPulseBookmarks,
  fetchPulseChannel,
  fetchPulseVod,
  fetchTopClip,
  postPulseBackfill,
  postVodHint,
  postWatchChannel,
  setAlwaysTracked,
} from './api.ts'
import { fetchEmoteImageBytes } from './emoteImageFetch.ts'
import { isTracked, listTrackedLogins, pauseAllPolling, resumeAllPolling, startPolling, trackLogin, untrackLogin } from './tracking.ts'
import type { BackgroundResponse, ExtensionCoverageTierResponse, PastVodRow, PulseUpdateMessage, VodPulseUpdateMessage } from '../shared/messages.ts'
import { parseBackgroundRequest } from '../shared/parseBackgroundRequest.ts'
import { getAutoUpdateEnabled, getBackendUrl, getPollIntervalMs, getSessionCoverage, getSessionPulse, isHostedBackendUrl, setAutoUpdateEnabled, cacheSessionPulseIfEnabled, setSessionCoverage, type PulseCacheWindow } from '../shared/storage.ts'
import {
  addToWatchlist,
  getWatchlist,
  removeFromWatchlist,
} from '../shared/watchlist.ts'
import { initPulseDebug, getPulseDebugLog, pulseDebug } from '../shared/pulseDebug.ts'
import { discoverLiveVodIdFromGqlInTab } from './twitchPageGql.ts'
import {
  awaitPulsePrefetchInFlight,
  handleTwitchTabNavigation,
} from './pulsePrefetch.ts'
import { shouldAllowPulseRevalidate } from './pulseRevalidateGate.ts'

void initPulseDebug()

const revalidateInFlight = new Set<string>()
const lastRevalidateAt = new Map<string, number>()

async function hostedBackend(): Promise<boolean> {
  return isHostedBackendUrl(await getBackendUrl())
}

async function loadCoverageTier(
  login: string,
  force = false,
): Promise<ExtensionCoverageTierResponse | null> {
  if (!force) {
    const cached = await getSessionCoverage(login)
    if (cached) return cached.coverageTier
  }
  try {
    const coverageTier = await fetchExtensionCoverage(login)
    if (coverageTier) {
      await setSessionCoverage(login, { coverageTier, fetchedAt: Date.now() })
    }
    return coverageTier
  } catch {
    return null
  }
}

async function cachePulseIfEnabled(
  login: string,
  payload: NonNullable<PulseUpdateMessage['payload']>,
  window: PulseCacheWindow,
): Promise<void> {
  await cacheSessionPulseIfEnabled(login, {
    payload,
    fetchedAt: Date.now(),
    window,
    streamId: String(payload.streamId ?? '').trim(),
  })
}

async function refreshPulse(
  login: string,
  window: PulseCacheWindow = 'recent',
  forceCoverage = false,
): Promise<void> {
  try {
    const [payload, coverageTier] = await Promise.all([
      fetchPulseChannel(login, { window }),
      loadCoverageTier(login, forceCoverage),
    ])
    await cachePulseIfEnabled(login, payload, window)
    broadcastPulse(login, payload, undefined, coverageTier)
  } catch (err) {
    broadcastPulse(login, null, err instanceof Error ? err.message : 'fetch_failed')
  }
}

async function peekPulse(
  login: string,
  window: PulseCacheWindow = 'recent',
  forceCoverage = false,
): Promise<{
  payload: PulseUpdateMessage['payload']
  coverageTier: ExtensionCoverageTierResponse | null
}> {
  try {
    const [payload, coverageTier] = await Promise.all([
      fetchPulseChannel(login, { window }),
      loadCoverageTier(login, forceCoverage),
    ])
    await cachePulseIfEnabled(login, payload, window)
    return { payload, coverageTier }
  } catch {
    return { payload: null, coverageTier: null }
  }
}

async function revalidatePulse(login: string, window: PulseCacheWindow, forceCoverage = false): Promise<void> {
  const key = `${login.toLowerCase()}:${window}:${forceCoverage ? '1' : '0'}`
  if (revalidateInFlight.has(key)) return
  if (!shouldAllowPulseRevalidate(lastRevalidateAt.get(key), Date.now(), { force: forceCoverage })) {
    return
  }
  revalidateInFlight.add(key)
  try {
    const { payload, coverageTier } = await peekPulse(login, window, forceCoverage)
    broadcastPulse(login, payload, undefined, coverageTier)
    lastRevalidateAt.set(key, Date.now())
  } catch (err) {
    broadcastPulse(login, null, err instanceof Error ? err.message : 'fetch_failed')
  } finally {
    revalidateInFlight.delete(key)
  }
}

function broadcastPulse(
  login: string,
  payload: PulseUpdateMessage['payload'],
  error?: string,
  coverageTier?: ExtensionCoverageTierResponse | null,
): void {
  const message: PulseUpdateMessage = { type: 'PULSE_UPDATE', login, payload, error, coverageTier }
  chrome.runtime.sendMessage(message).catch(() => {
    // No listeners when overlay is closed.
  })
  void chrome.tabs
    .query({ url: ['*://*.twitch.tv/*'] })
    .then(tabs => {
      for (const tab of tabs) {
        if (!tab.id) continue
        chrome.tabs.sendMessage(tab.id, message).catch(() => {})
      }
    })
    .catch(() => {})
}

async function ensureTracked(login: string): Promise<void> {
  if (await hostedBackend()) {
    return
  }
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

  if (!(await hostedBackend())) {
    for (const login of channels) {
      if (!isTracked(login)) {
        await ensureTracked(login)
      }
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

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  void (async () => {
    const message = parseBackgroundRequest(rawMessage)
    if (!message) {
      sendResponse({ error: 'invalid_message' })
      return
    }
    try {
      switch (message.type) {
        case 'TRACK': {
          if (await hostedBackend()) {
            const cached = await getSessionPulse(message.login, 'recent')
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload: cached?.payload ?? null,
              error: 'extension_watch_disabled',
            } satisfies PulseUpdateMessage)
            return
          }
          await ensureTracked(message.login)
          const cached = await getSessionPulse(message.login, 'recent')
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
          const window: PulseCacheWindow = message.window === 'full' ? 'full' : 'recent'
          const hosted = await hostedBackend()
          const allowWatch = Boolean(message.watch) && !hosted
          await awaitPulsePrefetchInFlight(message.login)
          const cached = await getSessionPulse(message.login, window, message.streamId)
          const cachedCoverage = await getSessionCoverage(message.login)

          if (cached) {
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload: cached.payload,
              coverageTier: cachedCoverage?.coverageTier ?? null,
            } satisfies PulseUpdateMessage)
            void revalidatePulse(message.login, window)
            return
          }

          if (allowWatch) {
            await ensureTracked(message.login)
          } else if (isTracked(message.login)) {
            await refreshPulse(message.login, window)
          } else {
            const { payload, coverageTier } = await peekPulse(message.login, window)
            if (payload) {
              broadcastPulse(message.login, payload, undefined, coverageTier)
            }
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload,
              coverageTier,
            } satisfies PulseUpdateMessage)
            return
          }
          const fresh = await getSessionPulse(message.login, window, message.streamId)
          const coverageTier = fresh
            ? (await getSessionCoverage(message.login))?.coverageTier ?? null
            : cachedCoverage?.coverageTier ?? null
          sendResponse({
            type: 'PULSE_UPDATE',
            login: message.login,
            payload: fresh?.payload ?? null,
            coverageTier,
          } satisfies PulseUpdateMessage)
          return
        }
        case 'GET_PULSE_VOD': {
          try {
            const vodPulse = await fetchPulseVod(message.vodId)
            sendResponse({
              type: 'VOD_PULSE_UPDATE',
              vodId: message.vodId,
              vodPulse,
            } satisfies VodPulseUpdateMessage)
          } catch (err) {
            sendResponse({
              type: 'VOD_PULSE_UPDATE',
              vodId: message.vodId,
              vodPulse: null,
              error: err instanceof Error ? err.message : 'vod_pulse_failed',
            } satisfies VodPulseUpdateMessage)
          }
          return
        }
        case 'GET_COVERAGE': {
          try {
            const cachedCoverage = await getSessionCoverage(message.login)
            const coverageTier = cachedCoverage?.coverageTier ?? await loadCoverageTier(message.login)
            const pulseCache = await getSessionPulse(message.login, 'recent')
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload: pulseCache?.payload ?? null,
              coverageTier,
            } satisfies PulseUpdateMessage)
          } catch (err) {
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload: null,
              error: err instanceof Error ? err.message : 'coverage_failed',
            } satisfies PulseUpdateMessage)
          }
          return
        }
        case 'GET_ALWAYS_TRACKED': {
          try {
            const channels = await fetchAlwaysTracked()
            sendResponse({ type: 'ALWAYS_TRACKED', channels } satisfies BackgroundResponse)
          } catch (err) {
            sendResponse({
              type: 'ALWAYS_TRACKED',
              channels: [],
              error: err instanceof Error ? err.message : 'always_tracked_failed',
            } satisfies BackgroundResponse)
          }
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
            await refreshPulse(message.login, 'full', true)
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
            await refreshPulse(message.login, 'full', true)
          }
          sendResponse({ type: 'PULSE_BACKFILL', job } satisfies BackgroundResponse)
          return
        }
        case 'GET_PULSE_BACKFILL_STATUS': {
          const job = await fetchPulseBackfillStatus(message.jobId)
          if (job.status === 'done' || job.status === 'already_available') {
            const login = job.login
            if (login) {
              await refreshPulse(login, 'full', true)
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
        case 'GET_PULSE_VOD':
          sendResponse({
            type: 'VOD_PULSE_UPDATE',
            vodId: 'vodId' in message ? message.vodId : '',
            vodPulse: null,
            error: messageText,
          } satisfies VodPulseUpdateMessage)
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
    if (await hostedBackend()) return
    for (const login of listTrackedLogins()) {
      await ensureTracked(login)
    }
  })()
})

chrome.runtime.onInstalled.addListener(() => {
  void syncWatchlistToBackend()
})

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    handleTwitchTabNavigation(changeInfo.url)
    return
  }
  if (changeInfo.status === 'complete') {
    handleTwitchTabNavigation(tab.url)
  }
})

export {}
