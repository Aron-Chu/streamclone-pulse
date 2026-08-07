import {
  fetchAlwaysTracked,
  fetchExtensionCoverage,
  fetchExtensionHealth,
  fetchPastVodRows,
  fetchPulseBackfillStatus,
  fetchPulseArchiveCandidate,
  fetchPulseChannel,
  fetchPulseStream,
  fetchPulseVod,
  fetchTopClip,
  postPulseBackfill,
  postVodHint,
  postWatchChannel,
  setAlwaysTracked,
} from './api.ts'
import { fetchEmoteImageBytes } from './emoteImageFetch.ts'
import { isTracked, listTrackedLogins, pauseAllPolling, resumeAllPolling, startPolling, trackLogin } from './tracking.ts'
import type { BackgroundRequest, BackgroundResponse, ExtensionCoverageTierResponse, PastVodRow, PulsePayload, PulseStreamUpdateMessage, PulseUpdateMessage, VodPulseUpdateMessage } from '../shared/messages.ts'
import { ensureSessionBuildIdentity, getAutoUpdateEnabled, getBackendUrl, getPollIntervalMs, getSessionCoverage, getSessionPulse, isHostedBackendUrl, setAutoUpdateEnabled, cacheSessionPulseIfEnabled, setSessionCoverage, type PulseCacheWindow } from '../shared/storage.ts'
import { sanitizePulseErrorMessage } from '../shared/pulseError.ts'
import {
  addToWatchlist,
  getWatchlist,
  normalizeWatchlist,
  removeFromWatchlist,
} from '../shared/watchlist.ts'
import { initPulseDebug, pulseDebug } from '../shared/pulseDebug.ts'
import { discoverLiveVodIdFromGqlInTab } from './twitchPageGql.ts'
import {
  awaitPulsePrefetchInFlight,
  handleTwitchTabNavigation,
} from './pulsePrefetch.ts'
import { shouldAllowPulseRevalidate } from './pulseRevalidateGate.ts'
import { vodPulseStateAllowsRetry } from '../vod/normalizeVodPulseFetch.ts'
import {
  planWatchlistStartupSync,
  planWatchlistStorageDelta,
} from './alwaysTrackedSync.ts'

void initPulseDebug()

const buildMeta = typeof __STREAMPULSE_BUILD_META__ === 'undefined' ? null : __STREAMPULSE_BUILD_META__

async function ensureCurrentBuildIdentity(): Promise<void> {
  let buildId = buildMeta?.buildId ?? 'unknown'
  // `vite build --watch` rewrites build-meta.json on each cycle while the
  // compiled define above remains config-time state. Read the emitted file on
  // worker startup so a Chrome reload observes the newest bundle/cohort.
  try {
    const response = await fetch(chrome.runtime.getURL('build-meta.json'), {
      cache: 'no-store',
    })
    if (response.ok) {
      const payload = (await response.json()) as { buildId?: unknown }
      if (typeof payload.buildId === 'string' && payload.buildId.trim()) {
        buildId = payload.buildId
      }
    }
  } catch {
    // A partially written dev artifact should not prevent the worker from
    // starting; the compile-time fallback still provides a safe identity.
  }
  await ensureSessionBuildIdentity(buildId)
}

const buildIdentityReady = ensureCurrentBuildIdentity().catch(() => {
  // Storage can be temporarily unavailable while Chrome is reloading the
  // unpacked extension; message handling remains available in that case.
})

const revalidateInFlight = new Set<string>()
const lastRevalidateAt = new Map<string, number>()
/** Suppress storage-listener sync while message handlers own the mutation. */
let suppressWatchlistStorageSync = false

async function applyAlwaysTrackedPlan(plan: {
  trackTrue: string[]
  trackFalse: string[]
}): Promise<void> {
  await Promise.all([
    ...plan.trackTrue.map(login => setAlwaysTracked(login, true)),
    ...plan.trackFalse.map(login => setAlwaysTracked(login, false)),
  ])
}

async function withWatchlistMutationOwnership<T>(fn: () => Promise<T>): Promise<T> {
  suppressWatchlistStorageSync = true
  try {
    return await fn()
  } finally {
    suppressWatchlistStorageSync = false
  }
}

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
    broadcastPulse(login, null, sanitizePulseErrorMessage(err))
  }
}

async function peekPulse(
  login: string,
  window: PulseCacheWindow = 'recent',
  forceCoverage = false,
): Promise<{
  payload: PulseUpdateMessage['payload']
  coverageTier: ExtensionCoverageTierResponse | null
  error?: string
}> {
  try {
    const [payload, coverageTier] = await Promise.all([
      fetchPulseChannel(login, { window }),
      loadCoverageTier(login, forceCoverage),
    ])
    await cachePulseIfEnabled(login, payload, window)
    return { payload, coverageTier }
  } catch (err) {
    return {
      payload: null,
      coverageTier: null,
      error: sanitizePulseErrorMessage(err),
    }
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
    const { payload, coverageTier, error } = await peekPulse(login, window, forceCoverage)
    if (error) {
      broadcastPulse(login, null, error)
    } else {
      broadcastPulse(login, payload, undefined, coverageTier)
      lastRevalidateAt.set(key, Date.now())
    }
  } catch (err) {
    broadcastPulse(login, null, sanitizePulseErrorMessage(err))
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
  let channels: string[] | null = null
  try {
    channels = await getWatchlist()
  } catch {
    channels = null
  }

  const plan = planWatchlistStartupSync(channels, [])
  await applyAlwaysTrackedPlan(plan)

  if (channels && !(await hostedBackend())) {
    for (const login of channels) {
      if (!isTracked(login)) {
        await ensureTracked(login)
      }
    }
  }

  return channels ?? []
}

async function syncWatchlistStorageDelta(
  oldValue: unknown,
  newValue: unknown,
): Promise<void> {
  const plan = planWatchlistStorageDelta(
    normalizeWatchlist(oldValue),
    normalizeWatchlist(newValue),
  )
  await applyAlwaysTrackedPlan(plan)
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

function stableVodLogin(login?: string): string | undefined {
  const normalized = login?.trim().toLowerCase()
  if (!normalized || normalized.startsWith('__vod__:')) return undefined
  return normalized
}

async function resolveProvisionalLivePulse(
  vodPulse: import('../types/vodPulseTypes.ts').ExtensionVodPulseResponse,
  channelLogin?: string,
): Promise<PulsePayload | null> {
  const login = stableVodLogin(channelLogin)
  if (!login || vodPulse.retryable === false || !vodPulseStateAllowsRetry(vodPulse)) {
    return null
  }

  try {
    const channelPulse = await fetchPulseChannel(login, { window: 'full' })
    const streamId = channelPulse.streamId?.trim()
    if (!channelPulse.isLive || !channelPulse.tracking || !streamId) {
      return null
    }
    return await fetchPulseStream(streamId, {
      broadcasterLogin: login,
      allowLiveBridge: true,
      window: 'full',
    })
  } catch (error) {
    await pulseDebug(
      'vod.live.bridge',
      'provisional live stream bridge unavailable',
      { login, error: error instanceof Error ? error.message : 'bridge_failed' },
      'warn',
    )
    return null
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'sync' && changes.autoUpdateEnabled) {
    void applyAutoUpdateSetting(Boolean(changes.autoUpdateEnabled.newValue ?? true))
  }
  if (areaName !== 'sync' || !changes.watchlist) return
  if (suppressWatchlistStorageSync) return
  void syncWatchlistStorageDelta(changes.watchlist.oldValue, changes.watchlist.newValue)
})

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, sendResponse) => {
  void (async () => {
    await buildIdentityReady
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
        case 'GET_PULSE': {
          const window: PulseCacheWindow = message.window === 'full' ? 'full' : 'recent'
          const hosted = await hostedBackend()
          const allowWatch = Boolean(message.watch) && !hosted
          await awaitPulsePrefetchInFlight(message.login)
          if (message.forceRefresh) {
            const { payload, coverageTier, error } = await peekPulse(message.login, window)
            if (payload) {
              broadcastPulse(message.login, payload, undefined, coverageTier)
            } else if (error) {
              broadcastPulse(message.login, null, error)
            }
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload,
              coverageTier,
              error,
            } satisfies PulseUpdateMessage)
            return
          }
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
            const { payload, coverageTier, error } = await peekPulse(message.login, window)
            if (payload) {
              broadcastPulse(message.login, payload, undefined, coverageTier)
            } else if (error) {
              broadcastPulse(message.login, null, error)
            }
            sendResponse({
              type: 'PULSE_UPDATE',
              login: message.login,
              payload,
              coverageTier,
              error,
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
            const provisionalPulse = await resolveProvisionalLivePulse(vodPulse, message.channelLogin)
            sendResponse({
              type: 'VOD_PULSE_UPDATE',
              vodId: message.vodId,
              vodPulse,
              provisionalPulse,
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
        case 'GET_PULSE_STREAM': {
          try {
            const payload = await fetchPulseStream(message.streamId, {
              broadcasterLogin: message.broadcasterLogin,
              allowLiveBridge: message.allowLiveBridge,
              window: message.window,
            })
            sendResponse({
              type: 'PULSE_STREAM_UPDATE',
              streamId: message.streamId,
              login: message.broadcasterLogin,
              payload,
            } satisfies PulseStreamUpdateMessage)
          } catch (err) {
            sendResponse({
              type: 'PULSE_STREAM_UPDATE',
              streamId: message.streamId,
              login: message.broadcasterLogin,
              payload: null,
              error: err instanceof Error ? err.message : 'pulse_stream_failed',
            } satisfies PulseStreamUpdateMessage)
          }
          return
        }
        case 'GET_PULSE_ARCHIVE_CANDIDATE': {
          try {
            const candidate = await fetchPulseArchiveCandidate(message.streamId, message.login)
            sendResponse({
              type: 'PULSE_ARCHIVE_CANDIDATE',
              streamId: message.streamId,
              candidate,
            } satisfies BackgroundResponse)
          } catch (err) {
            const error = err instanceof Error ? err.message : 'pulse_archive_candidate_failed'
            await pulseDebug(
              'vod.archive.candidate',
              error === 'archive_candidate_unavailable'
                ? 'archive-candidate route is unavailable on the configured backend'
                : 'archive-candidate request failed',
              { streamId: message.streamId, login: message.login, error },
              error === 'archive_candidate_unavailable' ? 'info' : 'warn',
            )
            sendResponse({
              type: 'PULSE_ARCHIVE_CANDIDATE',
              streamId: message.streamId,
              candidate: null,
              error,
            } satisfies BackgroundResponse)
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
            if (!result.ok) {
              sendResponse({ ok: false, error: result.error ?? `vod_hint ${result.status ?? 'failed'}` })
              return
            }
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
            buildSha: health.buildSha,
            buildId: health.buildId,
            imageDigest: health.imageDigest,
            serviceGeneration: health.serviceGeneration,
            identityComplete: health.identityComplete,
            hostedMode: health.hostedMode,
            degraded: health.degraded,
            routes: health.routes,
            capabilities: health.capabilities,
          } satisfies BackgroundResponse)
          return
        }
        case 'LIST_WATCHLIST': {
          sendResponse({ type: 'WATCHLIST', channels: await getWatchlist() } satisfies BackgroundResponse)
          return
        }
        case 'ADD_WATCHLIST': {
          const channels = await withWatchlistMutationOwnership(async () => {
            const next = await addToWatchlist(message.login)
            await setAlwaysTracked(message.login, true)
            return next
          })
          sendResponse({ type: 'WATCHLIST', channels } satisfies BackgroundResponse)
          return
        }
        case 'REMOVE_WATCHLIST': {
          const channels = await withWatchlistMutationOwnership(async () => {
            const next = await removeFromWatchlist(message.login)
            await setAlwaysTracked(message.login, false)
            return next
          })
          sendResponse({ type: 'WATCHLIST', channels } satisfies BackgroundResponse)
          return
        }
        case 'SYNC_WATCHLIST': {
          const channels = await syncWatchlistToBackend()
          sendResponse({ type: 'SYNC_WATCHLIST', channels } satisfies BackgroundResponse)
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
          sendResponse({
            type: 'PULSE_BACKFILL',
            job: null,
            error: /(?:401|unauthorized|auth)/i.test(messageText) ? 'backfill_auth_required' : messageText,
          } satisfies BackgroundResponse)
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
        case 'GET_PULSE_STREAM':
          sendResponse({
            type: 'PULSE_STREAM_UPDATE',
            streamId: 'streamId' in message ? message.streamId : '',
            login: 'broadcasterLogin' in message ? message.broadcasterLogin : '',
            payload: null,
            error: messageText,
          } satisfies PulseStreamUpdateMessage)
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
    await buildIdentityReady
    await syncWatchlistToBackend()
    if (await hostedBackend()) return
    for (const login of listTrackedLogins()) {
      await ensureTracked(login)
    }
  })()
})

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    await buildIdentityReady
    await syncWatchlistToBackend()
  })()
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
