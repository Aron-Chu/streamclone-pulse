import type {
  CreatePulseBookmarkInput,
  ExtensionClip,
  ExtensionCoverageTierResponse,
  ExtensionHealthResponse,
  ExtensionMeResponse,
  PastVodRow,
  PulseBackfillJob,
  PulseBookmark,
  PulsePayload,
} from '../shared/messages.ts'
import type { ExtensionDiagnosticPayload } from '../shared/diagnosticsConsent.ts'
import { clipWindowBounds, pickTopClip } from '../shared/clips.ts'
import {
  mergePastVodRows,
  type AnalyticsStreamListItem,
  type MetadataStreamHistoryItem,
} from '../shared/pastVods.ts'
import { getBackendUrl } from '../shared/storage.ts'
import { DEFAULT_BACKEND_URL } from '../shared/storage.ts'
import {
  getDeviceCredential,
  isDeviceCredential,
  isDeviceCredentialLive,
  setDeviceCredential,
  clearDeviceCredential,
  type DeviceCredential,
} from './deviceAuth.ts'
import { pulseDebug } from '../shared/pulseDebug.ts'
import { normalizeVodPulseHttpResponse } from '../vod/normalizeVodPulseFetch.ts'

/** Default bound for extension BFF requests (health/pulse/coverage/watchlist). */
export const EXTENSION_API_TIMEOUT_MS = 15_000
const DEFAULT_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
const LARGE_RESPONSE_MAX_BYTES = 8 * 1024 * 1024

type RequestContext = {
  controller: AbortController
  timer: ReturnType<typeof setTimeout>
  upstream?: AbortSignal
  onUpstreamAbort?: () => void
  timedOut: boolean
  cancelled: boolean
}

const responseContexts = new WeakMap<Response, RequestContext>()

function isCanonicalHostedUrl(root: string): boolean {
  try {
    const url = new URL(root)
    return url.protocol === 'https:' && url.origin === DEFAULT_BACKEND_URL
  } catch {
    return false
  }
}

/** Device credentials are sent only to the canonical hosted API origin. */
export function isDeviceTokenOriginAllowed(root: string): boolean {
  return isCanonicalHostedUrl(root)
}

function cleanupRequest(context: RequestContext): void {
  clearTimeout(context.timer)
  context.upstream?.removeEventListener('abort', context.onUpstreamAbort ?? (() => {}))
}

async function beginRequest(
  input: string,
  init?: RequestInit,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? EXTENSION_API_TIMEOUT_MS
  const fetchImpl = options?.fetchImpl ?? fetch
  const controller = new AbortController()
  const upstreamSignal = init?.signal ?? undefined
  const context = {} as RequestContext
  const timer = setTimeout(() => {
    context.timedOut = true
    controller.abort()
  }, timeoutMs)
  context.controller = controller
  context.timer = timer
  context.upstream = upstreamSignal
  context.timedOut = false
  context.cancelled = false
  const onUpstreamAbort = () => {
    context.cancelled = true
    controller.abort()
  }
  context.onUpstreamAbort = onUpstreamAbort
  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort()
    else upstreamSignal.addEventListener('abort', onUpstreamAbort, { once: true })
  }
  try {
    const response = await fetchImpl(input, { ...init, signal: controller.signal })
    responseContexts.set(response, context)
    return response
  } catch (err) {
    cleanupRequest(context)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(context.cancelled ? 'extension_api_cancelled' : 'extension_api_timeout')
    }
    throw err
  }
}

export async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<Response> {
  return beginRequest(input, init, options)
}

export async function readResponseText(response: Response, maxBytes = DEFAULT_RESPONSE_MAX_BYTES): Promise<string> {
  const contentLength = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const context = responseContexts.get(response)
    context?.controller.abort()
    if (context) cleanupRequest(context)
    responseContexts.delete(response)
    throw new Error('extension_api_response_too_large')
  }

  const context = responseContexts.get(response)
  if (!response.body) {
    try {
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > maxBytes) {
        throw new Error('extension_api_response_too_large')
      }
      return text
    } finally {
      if (context) {
        cleanupRequest(context)
        responseContexts.delete(response)
      }
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let tooLarge = false
  try {
    let text = ''
    while (true) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) {
        tooLarge = true
        context?.controller.abort()
        await reader.cancel().catch(() => {})
        throw new Error('extension_api_response_too_large')
      }
      text += decoder.decode(next.value, { stream: true })
    }
    text += decoder.decode()
    return text
  } catch (err) {
    if (tooLarge) throw err
    if (err instanceof Error && (err.name === 'AbortError' || context?.controller.signal.aborted)) {
      throw new Error(context?.cancelled ? 'extension_api_cancelled' : 'extension_api_timeout')
    }
    throw err
  } finally {
    reader.releaseLock()
    if (context) cleanupRequest(context)
    responseContexts.delete(response)
  }
}

async function readJson<T>(response: Response, maxBytes = DEFAULT_RESPONSE_MAX_BYTES): Promise<T> {
  const text = await readResponseText(response, maxBytes)
  if (!text.trim()) throw new Error('extension_api_empty_response')
  const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType && !contentType.includes('json')) {
    throw new Error('extension_api_invalid_content_type')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('extension_api_invalid_json')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('extension_api_invalid_envelope')
  }
  return parsed as T
}

async function releaseResponse(response: Response): Promise<void> {
  try {
    await readResponseText(response, 64 * 1024)
  } catch {
    responseContexts.delete(response)
  }
}

async function pulseRequestHeaders(contentJson = false, root?: string): Promise<HeadersInit> {
  const headers: Record<string, string> = {}
  if (contentJson) {
    headers['Content-Type'] = 'application/json'
  }
  if (root && isDeviceTokenOriginAllowed(root)) {
    const credential = await getDeviceCredential()
    if (isDeviceCredentialLive(credential)) {
      headers.Authorization = `Bearer ${credential.token}`
    }
  }
  return headers
}

export async function fetchExtensionHealth(baseUrl?: string): Promise<ExtensionHealthResponse> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/health`, {
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`health ${res.status}`)
  }
  const health = await readJson<ExtensionHealthResponse>(res)
  await pulseDebug('vod.helix.health', 'extension health', {
    ok: health.ok,
    helixEnabled: health.helixEnabled ?? null,
    version: health.version,
  })
  return health
}

function parseDeviceCredential(raw: unknown): DeviceCredential {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('invalid_device_credential')
  }
  const record = raw as Record<string, unknown>
  if (!isDeviceCredential(record)) throw new Error('invalid_device_credential')
  if (!isDeviceCredentialLive(record)) throw new Error('invalid_device_credential')
  return record
}

export async function fetchExtensionMe(baseUrl?: string): Promise<ExtensionMeResponse> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/me`, {
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`extension_me ${res.status}`)
  }
  return parseExtensionMeResponse(await readJson<unknown>(res, 64 * 1024))
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** Strictly validate the `/v1/extension/me` JSON contract before identity use. */
export function parseExtensionMeResponse(raw: unknown): ExtensionMeResponse {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('extension_me_invalid_response')
  }
  const record = raw as Record<string, unknown>
  const principalId = typeof record.principalId === 'string' ? record.principalId.trim() : ''
  const principalKind = typeof record.principalKind === 'string' ? record.principalKind.trim() : ''
  if (!principalId || !['device', 'beta', 'guest'].includes(principalKind)) {
    throw new Error('extension_me_invalid_principal')
  }
  if (!isNonNegativeInteger(record.watchlistCount)) {
    throw new Error('extension_me_invalid_watchlist_count')
  }
  if (!record.caps || typeof record.caps !== 'object' || Array.isArray(record.caps)) {
    throw new Error('extension_me_invalid_caps')
  }
  const caps = record.caps as Record<string, unknown>
  const deviceId = typeof record.deviceId === 'string' ? record.deviceId.trim() : undefined
  if (principalKind === 'device' && (!deviceId || !/^dev_[a-f0-9]{32}$/.test(deviceId))) {
    throw new Error('extension_me_invalid_device_id')
  }
  const capKeys = [
    'maxActiveChannels',
    'maxChannelsPerPrincipal',
    'maxDevicesPerPrincipal',
    'deviceEnrollmentRatePerHour',
    'watchRatePerMin',
    'backfillRatePerHour',
  ] as const
  for (const key of capKeys) {
    if (!isNonNegativeInteger(caps[key])) throw new Error(`extension_me_invalid_cap_${key}`)
  }
  return {
    principalId,
    principalKind,
    ...(deviceId ? { deviceId } : {}),
    watchlistCount: record.watchlistCount as number,
    caps: {
      maxActiveChannels: caps.maxActiveChannels as number,
      maxChannelsPerPrincipal: caps.maxChannelsPerPrincipal as number,
      maxDevicesPerPrincipal: caps.maxDevicesPerPrincipal as number,
      deviceEnrollmentRatePerHour: caps.deviceEnrollmentRatePerHour as number,
      watchRatePerMin: caps.watchRatePerMin as number,
      backfillRatePerHour: caps.backfillRatePerHour as number,
    },
  }
}

export async function enrollDevice(betaKey: string, baseUrl?: string): Promise<DeviceCredential> {
  const root = baseUrl ?? await getBackendUrl()
  if (!isDeviceTokenOriginAllowed(root)) throw new Error('device_auth_hosted_only')
  const key = betaKey.trim()
  if (key.length < 8 || key.length > 256) throw new Error('invalid_beta_key')
  const res = await fetchWithTimeout(`${root}/v1/extension/auth/device`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Streamclone-Beta-Key': key,
    },
    body: JSON.stringify({ label: 'StreamPulse browser' }),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`device_enroll ${res.status}`)
  }
  const credential = parseDeviceCredential(await readJson(res, 64 * 1024))
  await setDeviceCredential(credential)
  return credential
}

export async function rotateDevice(baseUrl?: string): Promise<DeviceCredential> {
  const root = baseUrl ?? await getBackendUrl()
  if (!isDeviceTokenOriginAllowed(root)) throw new Error('device_auth_hosted_only')
  const res = await fetchWithTimeout(`${root}/v1/extension/auth/device/rotate`, {
    method: 'POST',
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`device_rotate ${res.status}`)
  }
  const credential = parseDeviceCredential(await readJson(res, 64 * 1024))
  await setDeviceCredential(credential)
  return credential
}

export async function revokeDevice(baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  if (!isDeviceTokenOriginAllowed(root)) throw new Error('device_auth_hosted_only')
  const res = await fetchWithTimeout(`${root}/v1/extension/auth/device`, {
    method: 'DELETE',
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`device_revoke ${res.status}`)
  }
  await releaseResponse(res)
  await clearDeviceCredential()
}

export async function fetchPulseWatchlist(baseUrl?: string): Promise<string[]> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/pulse/watchlist`, {
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`watchlist ${res.status}`)
  }
  const body = await readJson<{ items?: Array<{ login?: unknown; alwaysTrack?: unknown }> }>(res, 256 * 1024)
  return Array.isArray(body.items)
    ? body.items
        .filter(item => item?.alwaysTrack === true)
        .map(item => typeof item?.login === 'string' ? item.login.trim().toLowerCase() : '')
        .filter(Boolean)
    : []
}

export async function addPulseWatchlist(login: string, baseUrl?: string): Promise<AlwaysTrackedWriteResult> {
  return writePulseWatchlist(login, true, baseUrl)
}

export async function deletePulseWatchlist(login: string, baseUrl?: string): Promise<AlwaysTrackedWriteResult> {
  return writePulseWatchlist(login, false, baseUrl)
}

async function writePulseWatchlist(
  login: string,
  track: boolean,
  baseUrl?: string,
): Promise<AlwaysTrackedWriteResult> {
  const root = baseUrl ?? await getBackendUrl()
  const endpoint = track
    ? `${root}/v1/pulse/watchlist`
    : `${root}/v1/pulse/watchlist/${encodeURIComponent(login)}`
  const res = await fetchWithTimeout(endpoint, {
    method: track ? 'POST' : 'DELETE',
    headers: await pulseRequestHeaders(track, root),
    ...(track ? { body: JSON.stringify({ login, alwaysTrack: true }) } : {}),
  })
  if (res.ok) {
    await releaseResponse(res)
    return { ok: true }
  }
  await releaseResponse(res)
  return {
    ok: false,
    status: res.status,
    unauthorized: isUnauthorizedStatus(res.status),
  }
}

export async function fetchPulseChannel(
  login: string,
  options?: { window?: 'recent' | 'full'; baseUrl?: string; streamId?: string },
): Promise<PulsePayload> {
  const root = options?.baseUrl ?? await getBackendUrl()
  const streamId = options?.streamId?.trim()
  const exactStream = options?.window === 'full'
    && streamId
    && /^[A-Za-z0-9_-]{1,64}$/.test(streamId)
  const url = exactStream
    ? `${root}/v1/extension/pulse/streams/${encodeURIComponent(streamId)}?login=${encodeURIComponent(login)}&allowLiveBridge=true&window=full`
    : `${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}${options?.window === 'full' ? '?window=full' : ''}`
  const res = await fetchWithTimeout(url, {
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`pulse ${res.status}`)
  }
  const payload = await readJson<unknown>(res, LARGE_RESPONSE_MAX_BYTES)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('extension_api_invalid_pulse_payload')
  }
  const pulse = payload as Record<string, unknown>
  if (typeof pulse.login !== 'string') {
    throw new Error('extension_api_invalid_pulse_payload')
  }
  if (pulse.login.trim().toLowerCase() !== login.trim().toLowerCase()) {
    throw new Error('pulse_login_mismatch')
  }
  if (!Array.isArray(pulse.rollups)) {
    throw new Error('extension_api_invalid_pulse_payload')
  }
  if (exactStream && String(pulse.streamId ?? '').trim() !== streamId) {
    throw new Error('pulse_stream_mismatch')
  }
  const typedPayload = pulse as unknown as PulsePayload
  const lastRollup = typedPayload.rollups[typedPayload.rollups.length - 1]
  await pulseDebug('vod.pulse.api', 'pulse payload received', {
    login,
    window: options?.window ?? 'recent',
    exactStream: Boolean(exactStream),
    streamId: typedPayload.streamId ?? null,
    vodId: typedPayload.vodId ?? null,
    tracking: typedPayload.tracking,
    coverageState: typedPayload.coverage?.state ?? null,
    coverageStart: typedPayload.coverageStartOffsetSeconds ?? null,
    helixEnabled: typedPayload.helixEnabled ?? null,
    emoteSyncState: typedPayload.emoteSync?.state ?? null,
    lastRollupSevenTv: lastRollup?.sevenTvEmoteCount ?? null,
    lastRollupTotal: lastRollup?.totalEmoteCount ?? null,
  })
  return typedPayload
}

export async function fetchPulseVod(
  vodId: string,
  options?: { baseUrl?: string },
): Promise<import('../types/vodPulseTypes.ts').ExtensionVodPulseResponse> {
  const root = options?.baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/pulse/vods/${encodeURIComponent(vodId)}`, {
    headers: await pulseRequestHeaders(false, root),
  })
  const body = await readResponseText(res, LARGE_RESPONSE_MAX_BYTES)
  const payload = await normalizeVodPulseHttpResponse(vodId, new Response(body, {
    status: res.status,
    headers: res.headers,
  }))
  await pulseDebug('vod.pulse.api', 'vod pulse payload received', {
    vodId,
    streamId: payload.streamId ?? null,
    channelLogin: payload.channelLogin ?? null,
    coverageStatus: payload.coverageStatus,
    timelinePoints: payload.timeline?.points.length ?? 0,
    topMoments: payload.topMoments?.length ?? 0,
  })
  return payload
}

export async function fetchExtensionCoverage(
  login: string,
  baseUrl?: string,
): Promise<ExtensionCoverageTierResponse> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(
    `${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}/coverage`,
    { headers: await pulseRequestHeaders(false, root) },
  )
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`coverage ${res.status}`)
  }
  return await readJson<ExtensionCoverageTierResponse>(res)
}

export interface PulseBackfillRequest {
  streamId: string
  vodId?: string
  mode?: 'missed'
  fromOffsetSeconds?: number
  toOffsetSeconds?: number
}

export async function postPulseBackfill(
  login: string,
  body: PulseBackfillRequest,
  baseUrl?: string,
): Promise<PulseBackfillJob> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}/backfill`, {
    method: 'POST',
    headers: await pulseRequestHeaders(true, root),
    body: JSON.stringify({ mode: 'missed', ...body }),
  })
  if (!res.ok) {
    let detail = `Backfill failed (${res.status})`
    try {
      const body = await readJson<{ error?: string }>(res, 64 * 1024)
      if (body.error?.trim()) {
        detail = body.error.trim()
      }
    } catch {
      // ignore non-JSON bodies
    }
    await pulseDebug('vod.backfill.start', detail, { login, streamId: body.streamId, vodId: body.vodId ?? null }, 'error')
    throw new Error(detail)
  }
  const job = await readJson<PulseBackfillJob>(res)
  await pulseDebug('vod.backfill.result', `backfill ${job.status}`, {
    login,
    streamId: body.streamId,
    vodId: body.vodId ?? null,
    status: job.status,
    message: job.message ?? null,
    error: job.error ?? null,
  }, job.status === 'failed' ? 'error' : 'info')
  return job
}

export async function fetchPulseBackfillStatus(jobId: string, baseUrl?: string): Promise<PulseBackfillJob> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/pulse/backfill/${encodeURIComponent(jobId)}`, {
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`backfill_status ${res.status}`)
  }
  return readJson<PulseBackfillJob>(res)
}

export async function postVodHint(
  login: string,
  body: { streamId: string; vodId: string },
  baseUrl?: string,
): Promise<{ ok: boolean; vodId?: string }> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}/vod-hint`, {
    method: 'POST',
    headers: await pulseRequestHeaders(true, root),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await releaseResponse(res)
    await pulseDebug(
      'vod.hint.api',
      `vod-hint HTTP ${res.status}`,
      { login, streamId: body.streamId, vodId: body.vodId, status: res.status },
      res.status === 404 ? 'warn' : 'error',
    )
    throw new Error(`vod_hint ${res.status}`)
  }
  const result = await readJson<{ ok: boolean; vodId?: string }>(res)
  await pulseDebug('vod.hint.api', 'vod-hint accepted', { login, ...body, ok: result.ok })
  return result
}

export async function postWatchChannel(login: string, baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/analytics/channels/${encodeURIComponent(login)}/watch`, {
    method: 'POST',
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok && res.status !== 202) {
    await releaseResponse(res)
    throw new Error(`watch ${res.status}`)
  }
  await releaseResponse(res)
}

export async function fetchPulseBookmarks(
  params: { login?: string; streamId?: string; vodId?: string },
  baseUrl?: string,
): Promise<PulseBookmark[]> {
  const root = baseUrl ?? await getBackendUrl()
  const qs = new URLSearchParams()
  if (params.login) qs.set('login', params.login)
  if (params.streamId) qs.set('streamId', params.streamId)
  if (params.vodId) qs.set('vodId', params.vodId)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  const res = await fetchWithTimeout(`${root}/v1/pulse/bookmarks${suffix}`, {
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`bookmarks ${res.status}`)
  }
  const body = await readJson<{ items?: PulseBookmark[] }>(res)
  return body.items ?? []
}

export async function createPulseBookmark(
  bookmark: CreatePulseBookmarkInput,
  baseUrl?: string,
): Promise<PulseBookmark> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/pulse/bookmarks`, {
    method: 'POST',
    headers: await pulseRequestHeaders(true, root),
    body: JSON.stringify(bookmark),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`bookmark ${res.status}`)
  }
  return readJson<PulseBookmark>(res)
}

export async function deletePulseBookmark(id: string, baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/pulse/bookmarks/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`delete_bookmark ${res.status}`)
  }
  await releaseResponse(res)
}

export type AlwaysTrackedWriteResult =
  | { ok: true }
  | { ok: false; status: number; unauthorized: boolean }

function isUnauthorizedStatus(status: number): boolean {
  return status === 401 || status === 403
}

export async function fetchAlwaysTracked(baseUrl?: string): Promise<string[]> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/analytics/always-tracked`, {
    headers: await pulseRequestHeaders(false, root),
  })
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`always_tracked ${res.status}`)
  }
  const body = await readJson<{ channels?: string[] }>(res)
  return body.channels ?? []
}

/**
 * Best-effort Protect write. Unauthorized responses are soft-failures so the
 * public extension can keep a browser-sync watchlist without inventing credentials.
 */
export async function setAlwaysTracked(
  login: string,
  track: boolean,
  baseUrl?: string,
): Promise<AlwaysTrackedWriteResult> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/analytics/always-tracked`, {
    method: 'POST',
    headers: await pulseRequestHeaders(true, root),
    body: JSON.stringify({ channel: login, track }),
  })
  if (res.ok) {
    await releaseResponse(res)
    return { ok: true }
  }
  await releaseResponse(res)
  return {
    ok: false,
    status: res.status,
    unauthorized: isUnauthorizedStatus(res.status),
  }
}

interface ClipsResponseBody {
  items?: ExtensionClip[]
}

interface StreamHistoryResponseBody {
  items?: MetadataStreamHistoryItem[]
}

interface AnalyticsStreamsResponseBody {
  items?: AnalyticsStreamListItem[]
}

export async function fetchChannelStreamHistory(
  login: string,
  period: '30d' | 'all' = '30d',
  baseUrl?: string,
): Promise<MetadataStreamHistoryItem[]> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(
    `${root}/v1/channels/${encodeURIComponent(login)}/streams/history?period=${encodeURIComponent(period)}`,
    { headers: await pulseRequestHeaders(false, root) },
  )
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`stream_history ${res.status}`)
  }
  const body = await readJson<StreamHistoryResponseBody>(res)
  return body.items ?? []
}

export async function fetchAnalyticsStreams(
  login: string,
  limit = 20,
  baseUrl?: string,
): Promise<AnalyticsStreamListItem[]> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(
    `${root}/v1/analytics/channels/${encodeURIComponent(login)}/streams?limit=${encodeURIComponent(limit)}`,
    { headers: await pulseRequestHeaders(false, root) },
  )
  if (!res.ok) {
    await releaseResponse(res)
    throw new Error(`analytics_streams ${res.status}`)
  }
  const body = await readJson<AnalyticsStreamsResponseBody>(res)
  return body.items ?? []
}

/** Best-effort merge of metadata history + analytics streams (never throws). */
export async function fetchPastVodRows(
  login: string,
  options?: { liveStreamId?: string | null; isLive?: boolean },
  baseUrl?: string,
): Promise<PastVodRow[]> {
  const [historyResult, analyticsResult] = await Promise.allSettled([
    fetchChannelStreamHistory(login, '30d', baseUrl),
    fetchAnalyticsStreams(login, 20, baseUrl),
  ])
  const history = historyResult.status === 'fulfilled' ? historyResult.value : undefined
  const analytics = analyticsResult.status === 'fulfilled' ? analyticsResult.value : undefined
  return mergePastVodRows(history, analytics, options)
}

/** Best-effort top clip by viewCount from metadata /clips (never throws). */
export async function fetchTopClip(
  login: string,
  options?: { startedAt?: string; isLive?: boolean },
  baseUrl?: string,
): Promise<ExtensionClip | null> {
  try {
    const root = baseUrl ?? await getBackendUrl()
    const { startedAt, endedAt } = clipWindowBounds(options?.startedAt, options?.isLive)
    const qs = new URLSearchParams({ startedAt, endedAt, cursor: '' })
     const res = await fetchWithTimeout(`${root}/v1/channels/${encodeURIComponent(login)}/clips?${qs}`, {
       headers: await pulseRequestHeaders(false, root),
     })
      if (!res.ok) {
        await releaseResponse(res)
        return null
      }
      const body = await readJson<ClipsResponseBody>(res)
    return pickTopClip(body.items ?? [])
  } catch {
    return null
  }
}

/**
 * RPR-3 diagnostics upload. Hosted ingest is inactive until ops activation
 * (`PULSE_EXTENSION_DIAGNOSTICS_ENABLED`); callers should also honor the client
 * kill switch. Never retries; never uploads pulseDebug.
 */
export async function postExtensionDiagnostic(
  payload: ExtensionDiagnosticPayload,
  baseUrl?: string,
  options?: { signal?: AbortSignal },
): Promise<void> {
  if (options?.signal?.aborted) return
  const root = (baseUrl ?? await getBackendUrl()).replace(/\/+$/, '')
  if (!root) return
  const res = await fetchWithTimeout(`${root}/v1/extension/diagnostics/errors`, {
    method: 'POST',
    headers: await pulseRequestHeaders(true, root),
    body: JSON.stringify(payload),
    signal: options?.signal,
  })
  // Failures are intentional no-ops for product UX (fail closed / lossy).
  await releaseResponse(res)
}
