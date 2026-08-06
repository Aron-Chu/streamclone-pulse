import {
  addPulseWatchlist,
  createPulseBookmark,
  deletePulseWatchlist,
  deletePulseBookmark,
  enrollDevice,
  fetchAlwaysTracked,
  fetchExtensionCoverage,
  fetchExtensionHealth,
  fetchExtensionMe,
  fetchPastVodRows,
  fetchPulseBackfillStatus,
  fetchPulseBookmarks,
  fetchPulseChannel,
  fetchPulseWatchlist,
  fetchPulseVod,
  fetchTopClip,
  postPulseBackfill,
  postVodHint,
  postWatchChannel,
  postExtensionDiagnostic,
  revokeDevice,
  rotateDevice,
  setAlwaysTracked,
} from './api.ts'
import {
  classifyDeviceAuthError,
  clearDeviceCredential,
  getDeviceCredential,
  isDeviceCredentialInvalidatedError,
  isDeviceCredentialLive,
  safeDeviceAuthErrorMessage,
} from './deviceAuth.ts'
import { fetchEmoteImageBytes } from './emoteImageFetch.ts'
import { isTracked, listTrackedLogins, trackLogin, untrackLogin } from './tracking.ts'
import type { BackgroundRequest, BackgroundResponse, DeviceAuthStatus, ExtensionCoverageTierResponse, PastVodRow, PulseUpdateMessage, ProtectChannelSyncStatus, ProtectSyncOperation, ProtectSyncState, VodPulseUpdateMessage, WatchlistSyncStatus } from '../shared/messages.ts'
import { parseBackgroundRequest } from '../shared/parseBackgroundRequest.ts'
import {
  EXTENSION_DIAGNOSTICS_INGEST_ENABLED,
  isDiagnosticsConsentEnabled,
  sanitizeDiagnosticsFrames,
} from '../shared/diagnosticsConsent.ts'
import {
  buildTrustedDiagnosticPayload,
  clearPendingDiagnosticsWork,
  deriveDiagnosticsSurface,
  installBackgroundDiagnosticsEmitters,
  isTrustedDiagnosticsSender,
  trackDiagnosticsWork,
  trustedDiagnosticsBuildMeta,
} from '../shared/extensionDiagnostics.ts'
import { getBackendUrl, getProtectSyncState, getSessionCoverage, getSessionPulse, isHostedBackendUrl, setAutoUpdateEnabled, cacheSessionPulseIfEnabled, setProtectSyncState, setSessionCoverage, type ProtectSyncStorageState, type PulseCacheWindow } from '../shared/storage.ts'
import { sanitizePulseErrorMessage } from '../shared/pulseError.ts'
import {
  addToWatchlist,
  getWatchlist,
  normalizeWatchlist,
  removeFromWatchlist,
} from '../shared/watchlist.ts'
import {
  appendPulseDebugEntryDirect,
  clearPulseDebugLog,
  getPulseDebugEnabled,
  getPulseDebugLog,
  initPulseDebug,
  pulseDebug,
} from '../shared/pulseDebug.ts'
import { isExtensionPageSender, isSupportedTwitchUrl, isTrustedTwitchTopFrameSender, tabUrlMatchesPulseLogin } from './pulseBroadcastTargets.ts'
import { discoverLiveVodIdFromGqlInTab } from './twitchPageGql.ts'
import {
  awaitPulsePrefetchInFlight,
  handleTwitchTabNavigation,
} from './pulsePrefetch.ts'
import {
  createPulseCoordinatorState,
  handleGetPulse,
} from './pulseGetCoordinator.ts'
import {
  createWatchCoordinatorState,
  ensureWatchCoalesced,
} from './watchCoordinator.ts'
import {
  classifyProtectError,
  classifyProtectHttpStatus,
  planWatchlistStorageDelta,
  protectStatusMessage,
} from './alwaysTrackedSync.ts'
import {
  emitAnalyticsEvents,
  type AnalyticsEmitEventName,
} from '../shared/extensionAnalytics.ts'

void initPulseDebug()

const pulseCoord = createPulseCoordinatorState()
const watchCoord = createWatchCoordinatorState()
/** Soft stale-refresh notice for content overlays (non-fatal). */
const softStaleFailureByLogin = new Map<string, number>()
/** Suppress storage-listener sync while message handlers own the mutation. */
let suppressWatchlistStorageSync = false

type ProtectWriteOutcome = {
  login: string
  operation: ProtectSyncOperation
  state: ProtectSyncState | 'removed'
  status?: number
  message?: string
}

async function executeProtectWrite(login: string, track: boolean): Promise<ProtectWriteOutcome> {
  const operation: ProtectSyncOperation = track ? 'add' : 'remove'
  try {
    const result = (await hostedBackend())
      ? track ? await addPulseWatchlist(login) : await deletePulseWatchlist(login)
      : await setAlwaysTracked(login, track)
    if (result.ok) {
      return { login, operation, state: track ? 'protected' : 'removed' }
    }
    const state = classifyProtectHttpStatus(result.status, operation)
    return {
      login,
      operation,
      state,
      status: result.status,
      message: protectStatusMessage(state, operation, result.status),
    }
  } catch (error) {
    const state = classifyProtectError(error)
    return {
      login,
      operation,
      state,
      message: protectStatusMessage(state, operation),
    }
  }
}

async function applyAlwaysTrackedPlan(plan: {
  trackTrue: string[]
  trackFalse: string[]
}): Promise<ProtectWriteOutcome[]> {
  return Promise.all([
    ...plan.trackTrue.map(login => executeProtectWrite(login, true)),
    ...plan.trackFalse.map(login => executeProtectWrite(login, false)),
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

const PROTECT_STATE_PRIORITY: Record<ProtectSyncState | 'idle', number> = {
  idle: 0,
  protected: 1,
  pending: 2,
  retry: 3,
  failure: 4,
  cap: 5,
  unauthorized: 6,
}

function statusFromStorageState(state: ProtectSyncStorageState, localChannels: string[]): WatchlistSyncStatus {
  const channels: Record<string, ProtectChannelSyncStatus> = {}
  const visibleLogins = new Set([...localChannels, ...state.tombstones])
  for (const login of visibleLogins) {
    const record = state.channels[login]
    if (record) {
      channels[login] = { ...record }
      continue
    }
    if (state.serverConfirmed.includes(login)) {
      channels[login] = { state: 'protected' }
    }
  }
  let overall: WatchlistSyncStatus['overall'] = 'idle'
  for (const record of Object.values(channels)) {
    if (PROTECT_STATE_PRIORITY[record.state] > PROTECT_STATE_PRIORITY[overall]) {
      overall = record.state
    }
  }
  return {
    overall,
    channels,
    serverConfirmed: [...state.serverConfirmed],
    tombstones: [...state.tombstones],
  }
}

function setProtectChannelState(
  state: ProtectSyncStorageState,
  login: string,
  next: ProtectChannelSyncStatus,
): void {
  state.channels[login] = { ...next, updatedAt: Date.now() }
}

function markProtectPlanPending(
  state: ProtectSyncStorageState,
  plan: { trackTrue: string[]; trackFalse: string[] },
): void {
  for (const login of plan.trackTrue) {
    setProtectChannelState(state, login, { state: 'pending', operation: 'add' })
    state.tombstones = state.tombstones.filter(item => item !== login)
  }
  for (const login of plan.trackFalse) {
    setProtectChannelState(state, login, { state: 'pending', operation: 'remove' })
    if (!state.tombstones.includes(login)) state.tombstones = [...state.tombstones, login].sort()
  }
}

function applyProtectOutcomes(state: ProtectSyncStorageState, outcomes: ProtectWriteOutcome[]): void {
  for (const outcome of outcomes) {
    if (outcome.state === 'removed') {
      state.serverConfirmed = state.serverConfirmed.filter(login => login !== outcome.login)
      state.tombstones = state.tombstones.filter(login => login !== outcome.login)
      delete state.channels[outcome.login]
      continue
    }
    if (outcome.state === 'protected') {
      if (!state.serverConfirmed.includes(outcome.login)) {
        state.serverConfirmed = [...state.serverConfirmed, outcome.login].sort()
      }
      state.tombstones = state.tombstones.filter(login => login !== outcome.login)
    }
    setProtectChannelState(state, outcome.login, {
      state: outcome.state,
      operation: outcome.operation,
      ...(outcome.status ? { status: outcome.status } : {}),
      ...(outcome.message ? { message: outcome.message } : {}),
    })
  }
}

function shouldRetryProtectAdd(
  record: ProtectChannelSyncStatus | undefined,
  force: boolean,
): boolean {
  if (!record || record.state === 'protected') return !record
  if (force) return true
  return record.state !== 'unauthorized' && record.state !== 'cap'
}

function markProtectReadFailure(
  state: ProtectSyncStorageState,
  localChannels: string[],
  tombstones: string[],
  error: unknown,
): void {
  const status = classifyProtectError(error)
  state.serverConfirmed = status === 'unauthorized' ? [] : state.serverConfirmed
  for (const login of localChannels) {
    setProtectChannelState(state, login, {
      state: status,
      operation: 'add',
      message: protectStatusMessage(status, 'add'),
    })
  }
  for (const login of tombstones) {
    setProtectChannelState(state, login, {
      state: status,
      operation: 'remove',
      message: protectStatusMessage(status, 'remove'),
    })
  }
}

async function resetProtectPrincipalIfChanged(
  state: ProtectSyncStorageState,
  principalId: string | undefined,
  localChannels: string[],
): Promise<void> {
  if (state.principalId === principalId) return
  state.principalId = principalId
  state.serverConfirmed = []
  for (const login of localChannels) {
    setProtectChannelState(state, login, { state: 'pending', operation: 'add' })
  }
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
  requestedStreamId?: string,
): Promise<void> {
  const expected = String(requestedStreamId ?? '').trim()
  const actual = String(payload.streamId ?? '').trim()
  if (expected && actual !== expected) {
    throw new Error('pulse_stream_mismatch')
  }
  await cacheSessionPulseIfEnabled(login, {
    payload,
    fetchedAt: Date.now(),
    window,
    streamId: actual,
  })
}

async function refreshPulse(
  login: string,
  window: PulseCacheWindow = 'recent',
  forceCoverage = false,
  streamId?: string,
): Promise<void> {
  // Coalesced via handleGetPulse cold path (same in-flight map as GET_PULSE).
  const result = await handleGetPulse(
    { login, window, streamId, forceCoverage, allowWatch: false },
    pulseFetchDeps(),
    pulseCoord,
  )
  if (result.error && !result.payload) {
    broadcastPulse(login, null, result.error, null, streamId)
  }
}

function pulseFetchDeps() {
  return {
    getCached: getSessionPulse,
    getCoverage: async (login: string) => {
      const cached = await getSessionCoverage(login)
      return cached?.coverageTier ?? null
    },
    fetchPulse: peekPulse,
    ensureTracked,
    isTracked,
    onBroadcast: (
      login: string,
      payload: PulseUpdateMessage['payload'],
      error: string | undefined,
      coverageTier: ExtensionCoverageTierResponse | null | undefined,
      meta?: { softStaleFailure?: boolean; streamId?: string; window?: PulseCacheWindow },
    ) => {
      if (meta?.softStaleFailure) {
        softStaleFailureByLogin.set(login.toLowerCase(), Date.now())
        // Soft: notify listeners without clearing cached payload.
        const message: PulseUpdateMessage = {
          type: 'PULSE_UPDATE',
          login,
          payload: null,
          streamId: meta?.streamId,
          error: undefined,
          coverageTier: undefined,
          softStaleRefresh: true,
        }
        chrome.runtime.sendMessage(message).catch(() => {})
        void chrome.tabs
          .query({ url: ['*://*.twitch.tv/*'] })
          .then(tabs => {
            for (const tab of tabs) {
              if (!tab.id) continue
              if (!tabUrlMatchesPulseLogin(tab.url, login)) continue
              chrome.tabs.sendMessage(tab.id, message).catch(() => {})
            }
          })
          .catch(() => {})
        return
      }
      softStaleFailureByLogin.delete(login.toLowerCase())
        broadcastPulse(login, payload, error, coverageTier, meta?.streamId)
    },
  }
}

async function peekPulse(
  login: string,
  window: PulseCacheWindow = 'recent',
  forceCoverage = false,
  streamId?: string,
): Promise<{
  payload: PulseUpdateMessage['payload']
  coverageTier: ExtensionCoverageTierResponse | null
  error?: string
}> {
  try {
    const [payload, coverageTier] = await Promise.all([
      fetchPulseChannel(login, { window, streamId }),
      loadCoverageTier(login, forceCoverage),
    ])
      await cachePulseIfEnabled(login, payload, window, streamId)
    return { payload, coverageTier }
  } catch (err) {
    return {
      payload: null,
      coverageTier: null,
      error: sanitizePulseErrorMessage(err),
    }
  }
}

async function getDeviceAuthStatus(): Promise<DeviceAuthStatus> {
  const credential = await getDeviceCredential()
  if (!isDeviceCredentialLive(credential)) {
    return { connected: false, state: 'not_connected', error: 'device_not_connected' }
  }
  try {
    const me = await fetchExtensionMe()
    if (
      me.principalKind !== 'device'
      || me.principalId !== credential.principalId
      || me.deviceId !== credential.deviceId
    ) {
      await clearDeviceCredential()
      await markProtectCredentialUnavailable('device_identity_mismatch')
      return { connected: false, state: 'unauthorized', error: 'device_identity_mismatch' }
    }
    return {
      connected: true,
      state: 'connected',
      principalId: credential.principalId,
      deviceId: credential.deviceId,
      expiresAt: credential.expiresAt,
      watchlistCount: me.watchlistCount,
    }
  } catch (err) {
    if (isDeviceCredentialInvalidatedError(err)) {
      await clearDeviceCredential()
      await markProtectCredentialUnavailable('device_authorization_required')
      return {
        connected: false,
        state: 'unauthorized',
        error: safeDeviceAuthErrorMessage(err, 'device_authorization_required'),
      }
    }
    return {
      connected: true,
      state: classifyDeviceAuthError(err),
      principalId: credential.principalId,
      deviceId: credential.deviceId,
      expiresAt: credential.expiresAt,
      error: safeDeviceAuthErrorMessage(err, 'device_status_failed'),
    }
  }
}

async function markProtectCredentialUnavailable(message: string): Promise<void> {
  const channels = await getWatchlist().catch(() => [])
  const state = await getProtectSyncState()
  state.serverConfirmed = []
  markProtectReadFailure(state, channels, state.tombstones, new Error(message))
  await setProtectSyncState(state)
}

function senderIsExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return isExtensionPageSender(sender, chrome.runtime.id)
}

function senderIsTwitchPage(sender: chrome.runtime.MessageSender): boolean {
  return isTrustedTwitchTopFrameSender(sender, chrome.runtime.id)
}

const EXTENSION_PAGE_ONLY_MESSAGES = new Set<BackgroundRequest['type']>([
  'ENROLL_DEVICE',
  'GET_DEVICE_AUTH_STATUS',
  'ROTATE_DEVICE',
  'REVOKE_DEVICE',
  'LIST_WATCHLIST',
  'ADD_WATCHLIST',
  'REMOVE_WATCHLIST',
  'SYNC_WATCHLIST',
  'DELETE_BOOKMARK',
  'GET_PULSE_DEBUG_LOG',
  'CLEAR_PULSE_DEBUG_LOG',
])

function messageLogin(message: BackgroundRequest): string | undefined {
  switch (message.type) {
    case 'TRACK':
    case 'UNTRACK':
    case 'GET_PULSE':
    case 'GET_COVERAGE':
    case 'GET_ALWAYS_TRACKED':
    case 'GET_CLIP':
    case 'HINT_VOD':
    case 'DISCOVER_LIVE_VOD':
    case 'LOAD_MISSED_MOMENTS':
    case 'GET_PULSE_BACKFILL_STATUS':
    case 'LIST_PAST_VODS':
      return message.login
    case 'LIST_BOOKMARKS':
      return message.login
    case 'SAVE_BOOKMARK':
      return message.bookmark.login
    default:
      return undefined
  }
}

const CHANNEL_BOUND_MESSAGES = new Set<BackgroundRequest['type']>([
  'TRACK',
  'UNTRACK',
  'GET_PULSE',
  'GET_COVERAGE',
  'GET_ALWAYS_TRACKED',
  'GET_CLIP',
  'HINT_VOD',
  'DISCOVER_LIVE_VOD',
  'LOAD_MISSED_MOMENTS',
  'GET_PULSE_BACKFILL_STATUS',
  'LIST_PAST_VODS',
  'LIST_BOOKMARKS',
  'SAVE_BOOKMARK',
])

function isAuthorizedRuntimeSender(message: BackgroundRequest, sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id) return false
  if (EXTENSION_PAGE_ONLY_MESSAGES.has(message.type)) {
    return senderIsExtensionPage(sender)
  }
  if (senderIsExtensionPage(sender)) return true
  if (!senderIsTwitchPage(sender)) return false
  if (!CHANNEL_BOUND_MESSAGES.has(message.type)) return true
  const login = messageLogin(message)
  return Boolean(login && tabUrlMatchesPulseLogin(sender.tab?.url, login))
}

function broadcastPulse(
  login: string,
  payload: PulseUpdateMessage['payload'],
  error?: string,
  coverageTier?: ExtensionCoverageTierResponse | null,
  streamId?: string,
): void {
  const message: PulseUpdateMessage = {
    type: 'PULSE_UPDATE',
    login,
    payload,
    streamId: String(streamId ?? payload?.streamId ?? '').trim() || undefined,
    error,
    coverageTier,
  }
  chrome.runtime.sendMessage(message).catch(() => {
    // No listeners when overlay is closed.
  })
  void chrome.tabs
    .query({ url: ['*://*.twitch.tv/*'] })
    .then(tabs => {
      for (const tab of tabs) {
        if (!tab.id) continue
        // Skip unrelated Twitch tabs; keep all tabs for this login (multi-tab OK).
        if (!tabUrlMatchesPulseLogin(tab.url, login)) continue
        chrome.tabs.sendMessage(tab.id, message).catch(() => {})
      }
    })
    .catch(() => {})
}

/**
 * Local BFF only: coalesced watch registration + one coalesced initial refresh.
 * Does not start a recurring SW scheduler — content livePoll owns that.
 * Watch failure does not throw (Pulse fetch still runs); trackLogin only on watch OK.
 */
async function ensureTracked(login: string): Promise<void> {
  if (await hostedBackend()) {
    return
  }
  await ensureWatchCoalesced(
    login,
    {
      postWatch: postWatchChannel,
      onWatchSuccess: trackedLogin => {
        trackLogin(trackedLogin)
      },
    },
    watchCoord,
  )
  await handleGetPulse(
    { login, window: 'recent', allowWatch: false },
    { ...pulseFetchDeps(), ensureTracked: undefined },
    pulseCoord,
  )
}

async function syncWatchlistToBackend(force = false): Promise<string[]> {
  let channels: string[] | null = null
  try {
    channels = await getWatchlist()
  } catch {
    channels = null
  }

  if (channels == null) return []

  const hosted = await hostedBackend()
  const credential = hosted ? await getDeviceCredential() : null
  const state = await getProtectSyncState()
  await resetProtectPrincipalIfChanged(state, credential?.principalId, channels)

  if (hosted && !isDeviceCredentialLive(credential)) {
    state.serverConfirmed = []
    markProtectReadFailure(state, channels, state.tombstones, new Error('device_authorization_required'))
    await setProtectSyncState(state)
    return channels
  }

  let serverChannels: string[]
  try {
    serverChannels = hosted ? await fetchPulseWatchlist() : await fetchAlwaysTracked()
  } catch (error) {
    markProtectReadFailure(state, channels, state.tombstones, error)
    await setProtectSyncState(state)
    return channels
  }

  state.serverConfirmed = [...new Set(serverChannels)].sort()
  const plan = { trackTrue: [] as string[], trackFalse: [...state.tombstones] }
  for (const login of channels) {
    if (state.serverConfirmed.includes(login)) {
      setProtectChannelState(state, login, { state: 'protected' })
      state.tombstones = state.tombstones.filter(item => item !== login)
      continue
    }
    const existing = state.channels[login]
    if (existing?.state === 'protected') {
      setProtectChannelState(state, login, { state: 'pending', operation: 'add' })
    }
    if (shouldRetryProtectAdd(state.channels[login], force)) {
      plan.trackTrue.push(login)
    }
  }
  markProtectPlanPending(state, plan)
  const outcomes = await applyAlwaysTrackedPlan(plan)
  applyProtectOutcomes(state, outcomes)
  await setProtectSyncState(state)

  if (!hosted) {
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
  if (plan.trackTrue.length === 0 && plan.trackFalse.length === 0) return
  const state = await getProtectSyncState()
  const hosted = await hostedBackend()
  const credential = hosted ? await getDeviceCredential() : null
  await resetProtectPrincipalIfChanged(state, credential?.principalId, normalizeWatchlist(newValue))
  for (const login of plan.trackTrue) {
    state.tombstones = state.tombstones.filter(item => item !== login)
  }
  markProtectPlanPending(state, plan)
  const outcomes = await applyAlwaysTrackedPlan(plan)
  applyProtectOutcomes(state, outcomes)
  await setProtectSyncState(state)
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
  // autoUpdateEnabled is read by content livePoll; SW does not own recurring timers.
  if (areaName !== 'sync' || !changes.watchlist) return
  if (suppressWatchlistStorageSync) return
  void syncWatchlistStorageDelta(changes.watchlist.oldValue, changes.watchlist.newValue)
})

chrome.runtime.onMessage.addListener((rawMessage, sender, sendResponse) => {
  void (async () => {
    if (!sender.id || sender.id !== chrome.runtime.id) {
      sendResponse({ error: 'unauthorized_sender' })
      return
    }
    const message = parseBackgroundRequest(rawMessage)
    if (!message) {
      sendResponse({ error: 'invalid_message' })
      return
    }
    if (!isAuthorizedRuntimeSender(message, sender)) {
      sendResponse({ error: 'unauthorized_sender' })
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
          const result = await handleGetPulse(
            {
              login: message.login,
              window,
              streamId: message.streamId,
              allowWatch,
              explicitFull: window === 'full',
            },
            pulseFetchDeps(),
            pulseCoord,
          )
          sendResponse({
            type: 'PULSE_UPDATE',
            login: message.login,
            payload: result.payload,
            coverageTier: result.coverageTier,
            error: result.error,
            softStaleRefresh: result.staleRefreshWarning,
          } satisfies PulseUpdateMessage)
          return
        }
        case 'GET_PULSE_VOD': {
          try {
            const vodPulse = await fetchPulseVod(message.vodId, {
              streamId: message.streamId,
              window: message.window,
            })
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
            const channels = (await hostedBackend())
              ? await fetchPulseWatchlist()
              : await fetchAlwaysTracked()
            // Content pages only need the current channel's status. Do not expose
            // the complete local or principal-scoped watchlist to page content.
            sendResponse({
              type: 'ALWAYS_TRACKED',
              channels: channels.filter(channel => channel === message.login),
            } satisfies BackgroundResponse)
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
            const result = await discoverLiveVodIdFromGqlInTab(
              tabId,
              message.login,
              message.streamId,
            )
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
            await refreshPulse(message.login, 'full', true, message.streamId)
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
            await refreshPulse(message.login, 'full', true, message.streamId)
          }
          sendResponse({ type: 'PULSE_BACKFILL', job } satisfies BackgroundResponse)
          return
        }
        case 'GET_PULSE_BACKFILL_STATUS': {
          const job = await fetchPulseBackfillStatus(message.jobId)
          if (job.login !== message.login) {
            sendResponse({ type: 'PULSE_BACKFILL_STATUS', job: null, error: 'backfill_login_mismatch' } satisfies BackgroundResponse)
            return
          }
          if (job.status === 'done' || job.status === 'already_available') {
            await refreshPulse(message.login, 'full', true, job.streamId)
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
        case 'GET_DEVICE_AUTH_STATUS': {
          sendResponse({ type: 'DEVICE_AUTH', status: await getDeviceAuthStatus() } satisfies BackgroundResponse)
          return
        }
        case 'ENROLL_DEVICE': {
          await enrollDevice(message.betaKey)
          await syncWatchlistToBackend(true)
          sendResponse({ type: 'DEVICE_AUTH', status: await getDeviceAuthStatus() } satisfies BackgroundResponse)
          return
        }
        case 'ROTATE_DEVICE': {
          await rotateDevice()
          sendResponse({ type: 'DEVICE_AUTH', status: await getDeviceAuthStatus() } satisfies BackgroundResponse)
          return
        }
        case 'REVOKE_DEVICE': {
          await revokeDevice()
          const revokedChannels = await getWatchlist().catch(() => [])
          const revokedState = await getProtectSyncState()
          revokedState.serverConfirmed = []
          markProtectReadFailure(revokedState, revokedChannels, revokedState.tombstones, new Error('device_authorization_required'))
          await setProtectSyncState(revokedState)
          sendResponse({
            type: 'DEVICE_AUTH',
            status: { connected: false, state: 'unauthorized', error: 'device_revoked' },
          } satisfies BackgroundResponse)
          return
        }
        case 'REPORT_EXTENSION_DIAGNOSTIC': {
          // Validate extension-only sender (id + origin/URL). Never trust payload surface/release.
          if (!isTrustedDiagnosticsSender(sender)) {
            sendResponse({ ok: true })
            return
          }
          // Client kill + consent: hosted ingest remains inactive / default-off.
          if (!EXTENSION_DIAGNOSTICS_INGEST_ENABLED || !(await isDiagnosticsConsentEnabled())) {
            clearPendingDiagnosticsWork()
            sendResponse({ ok: true })
            return
          }
          const surface = deriveDiagnosticsSurface(sender)
          if (!surface) {
            sendResponse({ ok: true })
            return
          }
          const build = trustedDiagnosticsBuildMeta()
          const frames = sanitizeDiagnosticsFrames(message.frames)
          const payload = buildTrustedDiagnosticPayload({
            feature: message.feature,
            event: message.event,
            error: message.error,
            frames,
            surface,
            build,
          })
          const work = trackDiagnosticsWork()
          try {
            if (work.signal.aborted) {
              sendResponse({ ok: true })
              return
            }
            // Re-check consent immediately before one-shot send (withdrawal race).
            if (!(await isDiagnosticsConsentEnabled()) || !EXTENSION_DIAGNOSTICS_INGEST_ENABLED) {
              sendResponse({ ok: true })
              return
            }
            const backendUrl = await getBackendUrl()
            if (backendUrl.trim()) {
              // No retries, no durable queue, never pulseDebug.
              await postExtensionDiagnostic(payload, backendUrl, { signal: work.signal })
            }
          } catch {
            // Lossy by design — diagnostics must never affect Pulse UX.
          } finally {
            work.abort()
          }
          sendResponse({ ok: true })
          return
        }
        case 'EMIT_EXTENSION_ANALYTICS': {
          if (sender.id !== chrome.runtime.id) {
            sendResponse({ ok: true })
            return
          }
          const name = message.name as AnalyticsEmitEventName
          if (name === 'pulse_load_completed' || name === 'extension_error_shown') {
            void emitAnalyticsEvents([name])
          }
          sendResponse({ ok: true })
          return
        }
        case 'GET_PULSE_DEBUG_LOG': {
          sendResponse({ type: 'PULSE_DEBUG_LOG', entries: await getPulseDebugLog() } satisfies BackgroundResponse)
          return
        }
        case 'APPEND_PULSE_DEBUG': {
          if (await getPulseDebugEnabled()) {
            await appendPulseDebugEntryDirect(message.entry)
          }
          sendResponse({ ok: true } satisfies BackgroundResponse)
          return
        }
        case 'CLEAR_PULSE_DEBUG_LOG': {
          await clearPulseDebugLog()
          sendResponse({ ok: true } satisfies BackgroundResponse)
          return
        }
        case 'OPEN_OPTIONS': {
          chrome.runtime.openOptionsPage()
          sendResponse({ ok: true })
          return
        }
        case 'LIST_WATCHLIST': {
          const channels = await getWatchlist()
          const state = await getProtectSyncState()
          sendResponse({ type: 'WATCHLIST', channels, sync: statusFromStorageState(state, channels) } satisfies BackgroundResponse)
          return
        }
        case 'ADD_WATCHLIST': {
          const result = await withWatchlistMutationOwnership(async () => {
            const previous = await getWatchlist()
            const next = await addToWatchlist(message.login)
            await syncWatchlistStorageDelta(previous, next)
            return next
          })
          const state = await getProtectSyncState()
          sendResponse({ type: 'WATCHLIST', channels: result, sync: statusFromStorageState(state, result) } satisfies BackgroundResponse)
          return
        }
        case 'REMOVE_WATCHLIST': {
          const result = await withWatchlistMutationOwnership(async () => {
            const previous = await getWatchlist()
            const next = await removeFromWatchlist(message.login)
            await syncWatchlistStorageDelta(previous, next)
            return next
          })
          const state = await getProtectSyncState()
          sendResponse({ type: 'WATCHLIST', channels: result, sync: statusFromStorageState(state, result) } satisfies BackgroundResponse)
          return
        }
        case 'SYNC_WATCHLIST': {
          const channels = await syncWatchlistToBackend()
          const state = await getProtectSyncState()
          sendResponse({ type: 'SYNC_WATCHLIST', channels, sync: statusFromStorageState(state, channels) } satisfies BackgroundResponse)
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
          // Persist only — content livePoll reads this preference; no SW interval.
          await setAutoUpdateEnabled(message.enabled)
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
        case 'ENROLL_DEVICE':
        case 'GET_DEVICE_AUTH_STATUS':
        case 'ROTATE_DEVICE':
        case 'REVOKE_DEVICE':
          if (message.type !== 'ENROLL_DEVICE' && isDeviceCredentialInvalidatedError(err)) {
            await clearDeviceCredential()
            await markProtectCredentialUnavailable('device_authorization_required')
          }
          {
            const credential = await getDeviceCredential()
            const state = classifyDeviceAuthError(err)
            const connected = isDeviceCredentialLive(credential)
            const status: DeviceAuthStatus = {
              connected,
              state: connected ? state : state === 'cap' ? 'cap' : state === 'retry' ? 'retry' : 'unauthorized',
              ...(connected ? { deviceId: credential.deviceId, expiresAt: credential.expiresAt } : {}),
              error: safeDeviceAuthErrorMessage(err, 'device_operation_failed'),
            }
          sendResponse({
            type: 'DEVICE_AUTH',
            status,
          } satisfies BackgroundResponse)
          }
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
  void (async () => {
    const { restrictCredentialStorageAccess } = await import('../shared/storage.ts')
    await restrictCredentialStorageAccess()
    await syncWatchlistToBackend()
  })()
})

void (async () => {
  try {
    const { restrictCredentialStorageAccess } = await import('../shared/storage.ts')
    await restrictCredentialStorageAccess()
  } catch {
    // ignore
  }
})()

installBackgroundDiagnosticsEmitters()

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
