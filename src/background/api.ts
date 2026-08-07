import type {
  ExtensionClip,
  ExtensionCoverageTierResponse,
  ExtensionHealthResponse,
  PastVodRow,
  PulseBackfillJob,
  PulseArchiveCandidate,
  PulsePayload,
} from '../shared/messages.ts'
import { clipWindowBounds, pickTopClip } from '../shared/clips.ts'
import {
  mergePastVodRows,
  type AnalyticsStreamListItem,
  type MetadataStreamHistoryItem,
} from '../shared/pastVods.ts'
import { getBackendUrl } from '../shared/storage.ts'
import { PulseRequestError } from '../shared/pulseError.ts'
import { pulseDebug } from '../shared/pulseDebug.ts'
import { normalizeVodPulseHttpResponse } from '../vod/normalizeVodPulseFetch.ts'

/** Bound every background API request so a network stall cannot leave the UI loading forever. */
export const PULSE_REQUEST_TIMEOUT_MS = 15_000
const ARCHIVE_VOD_ID_RE = /^\d{6,20}$/

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = PULSE_REQUEST_TIMEOUT_MS,
  operation = 'Pulse API',
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timer = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (timedOut || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new PulseRequestError('timeout', `${operation} request timed out`)
    }
    const detail = err instanceof Error ? err.message : String(err ?? 'network failure')
    throw new PulseRequestError('network', `${operation} request failed: ${detail}`)
  } finally {
    globalThis.clearTimeout(timer)
  }
}

function pulseHttpError(operation: string, status: number): PulseRequestError {
  return new PulseRequestError('http', `${operation} ${status}`, status)
}

function requirePulsePayload(value: unknown): PulsePayload {
  if (
    !value
    || typeof value !== 'object'
    || typeof (value as PulsePayload).login !== 'string'
    || typeof (value as PulsePayload).isLive !== 'boolean'
    || typeof (value as PulsePayload).tracking !== 'boolean'
    || !Array.isArray((value as PulsePayload).rollups)
    || !Array.isArray((value as PulsePayload).lanes?.composite)
    || !Array.isArray((value as PulsePayload).lanes?.chat)
    || !Array.isArray((value as PulsePayload).lanes?.seventv)
  ) {
    throw new PulseRequestError('invalid_response', 'pulse response envelope is invalid')
  }
  return value as PulsePayload
}

async function pulseRequestHeaders(contentJson = false): Promise<HeadersInit> {
  const headers: Record<string, string> = {}
  if (contentJson) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

function requirePulseArchiveCandidate(value: unknown, expectedStreamId: string): PulseArchiveCandidate {
  if (!value || typeof value !== 'object') {
    throw new PulseRequestError('invalid_response', 'archive candidate response is invalid')
  }
  const candidate = value as Partial<PulseArchiveCandidate>
  if (typeof candidate.streamId !== 'string' || candidate.streamId.trim() !== expectedStreamId) {
    throw new Error('pulse_archive_identity_mismatch')
  }
  if (
    typeof candidate.navigationValidated !== 'boolean'
    || typeof candidate.analyticsResolutionState !== 'string'
    || typeof candidate.analyticsAvailable !== 'boolean'
    || candidate.persisted !== false
  ) {
    throw new PulseRequestError('invalid_response', 'archive candidate response is invalid')
  }
  if (candidate.navigationValidated) {
    if (typeof candidate.navigationVodId !== 'string' || !ARCHIVE_VOD_ID_RE.test(candidate.navigationVodId.trim())) {
      throw new PulseRequestError('invalid_response', 'validated archive candidate is missing a numeric VOD id')
    }
  } else if (candidate.navigationVodId != null) {
    // An unvalidated candidate must never carry a VOD ID that a caller could
    // accidentally treat as trusted navigation state.
    throw new PulseRequestError('invalid_response', 'unvalidated archive candidate carried a VOD id')
  }
  return candidate as PulseArchiveCandidate
}

export async function fetchExtensionHealth(baseUrl?: string): Promise<ExtensionHealthResponse> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/health`, undefined, PULSE_REQUEST_TIMEOUT_MS, 'health')
  if (!res.ok) {
    throw pulseHttpError('health', res.status)
  }
  const health = await res.json() as ExtensionHealthResponse
  await pulseDebug('vod.helix.health', 'extension health', {
    ok: health.ok,
    helixEnabled: health.helixEnabled ?? null,
    version: health.version,
    identityComplete: health.identityComplete ?? null,
    buildSha: health.buildSha ?? null,
    imageDigest: health.imageDigest ?? null,
    serviceGeneration: health.serviceGeneration ?? null,
    archiveCandidate: health.capabilities?.archiveCandidate ?? health.routes?.archiveCandidate ?? null,
    vodLookup: health.capabilities?.vodLookup ?? null,
    backfill: health.capabilities?.backfill ?? null,
  })
  return health
}

export async function fetchPulseChannel(
  login: string,
  options?: { window?: 'recent' | 'full'; baseUrl?: string },
): Promise<PulsePayload> {
  const root = options?.baseUrl ?? await getBackendUrl()
  const qs = options?.window === 'full' ? '?window=full' : ''
  const res = await fetchWithTimeout(`${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}${qs}`, {
    headers: await pulseRequestHeaders(),
  }, PULSE_REQUEST_TIMEOUT_MS, 'pulse')
  if (!res.ok) {
    throw pulseHttpError('pulse', res.status)
  }
  const payload = requirePulsePayload(await res.json())
  const lastRollup = payload.rollups[payload.rollups.length - 1]
  await pulseDebug('vod.pulse.api', 'pulse payload received', {
    login,
    window: options?.window ?? 'recent',
    streamId: payload.streamId ?? null,
    vodId: payload.vodId ?? null,
    tracking: payload.tracking,
    coverageState: payload.coverage?.state ?? null,
    coverageStart: payload.coverageStartOffsetSeconds ?? null,
    helixEnabled: payload.helixEnabled ?? null,
    emoteSyncState: payload.emoteSync?.state ?? null,
    lastRollupSevenTv: lastRollup?.sevenTvEmoteCount ?? null,
    lastRollupTotal: lastRollup?.totalEmoteCount ?? null,
  })
  return payload
}

export async function fetchPulseVod(
  vodId: string,
  options?: { baseUrl?: string },
): Promise<import('../types/vodPulseTypes.ts').ExtensionVodPulseResponse> {
  const root = options?.baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/pulse/vods/${encodeURIComponent(vodId)}`, {
    headers: await pulseRequestHeaders(),
  })
  const payload = await normalizeVodPulseHttpResponse(vodId, res)
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

export async function fetchPulseStream(
  streamId: string,
  options: {
    broadcasterLogin: string
    allowLiveBridge?: boolean
    window?: 'recent' | 'full'
    baseUrl?: string
  },
): Promise<PulsePayload> {
  const normalizedStreamId = streamId.trim()
  const login = options.broadcasterLogin.trim().toLowerCase()
  if (!normalizedStreamId || !login) {
    throw new Error('pulse_stream_identity_required')
  }

  const root = options.baseUrl ?? await getBackendUrl()
  const params = new URLSearchParams({
    login,
    allowLiveBridge: String(options.allowLiveBridge !== false),
  })
  if (options.window === 'full') {
    params.set('window', 'full')
  }
  const res = await fetchWithTimeout(
    `${root}/v1/extension/pulse/streams/${encodeURIComponent(normalizedStreamId)}?${params.toString()}`,
    { headers: await pulseRequestHeaders() },
    PULSE_REQUEST_TIMEOUT_MS,
    'pulse_stream',
  )
  if (!res.ok) {
    throw pulseHttpError('pulse_stream', res.status)
  }

  const payload = await res.json() as PulsePayload
  if (payload.streamId && payload.streamId !== normalizedStreamId) {
    throw new Error('pulse_stream_identity_mismatch')
  }
  await pulseDebug('vod.live.bridge', 'provisional live stream payload received', {
    login,
    streamId: normalizedStreamId,
    mode: payload.mode ?? null,
    provisional: payload.provisional ?? false,
    resolutionState: payload.resolutionState ?? null,
    vodId: payload.vodId ?? null,
    rollups: payload.rollups.length,
  })
  return payload
}

/** Read-only bridge for a just-ended/live stream whose archive VOD is not in our row yet. */
export async function fetchPulseArchiveCandidate(
  streamId: string,
  login: string,
  baseUrl?: string,
): Promise<PulseArchiveCandidate> {
  const normalizedStreamId = streamId.trim()
  const normalizedLogin = login.trim().toLowerCase()
  if (!normalizedStreamId || !normalizedLogin) throw new Error('pulse_archive_identity_required')
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(
    `${root}/v1/extension/pulse/streams/${encodeURIComponent(normalizedStreamId)}/archive-candidate`,
    { headers: await pulseRequestHeaders() },
  )
  if (!res.ok) {
    if (res.status === 404) throw new Error('archive_candidate_unavailable')
    if (res.status === 401) throw new Error('archive_candidate_auth_required')
    throw pulseHttpError('pulse_archive_candidate', res.status)
  }
  const candidate = requirePulseArchiveCandidate(await res.json(), normalizedStreamId)
  await pulseDebug('vod.archive.candidate', 'archive candidate received', {
    login: normalizedLogin,
    streamId: normalizedStreamId,
    vodId: candidate.navigationVodId ?? null,
    navigationValidated: candidate.navigationValidated,
    analyticsResolutionState: candidate.analyticsResolutionState,
    analyticsAvailable: candidate.analyticsAvailable,
  })
  return candidate
}

export async function fetchExtensionCoverage(
  login: string,
  baseUrl?: string,
): Promise<ExtensionCoverageTierResponse> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(
    `${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}/coverage`,
    { headers: await pulseRequestHeaders() },
  )
  if (!res.ok) {
    throw new Error(`coverage ${res.status}`)
  }
  return await res.json() as ExtensionCoverageTierResponse
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
    headers: await pulseRequestHeaders(true),
    body: JSON.stringify({ mode: 'missed', ...body }),
  })
  if (!res.ok) {
    if (res.status === 401) {
      await pulseDebug('vod.backfill.start', 'backfill requires an authenticated extension session', {
        login,
        streamId: body.streamId,
        vodId: body.vodId ?? null,
        status: res.status,
        authRequired: true,
      }, 'info')
      throw new Error('backfill_auth_required')
    }
    let detail = `Backfill failed (${res.status})`
    try {
      const body = await res.json() as { error?: string }
      if (body.error?.trim()) {
        detail = body.error.trim()
      }
    } catch {
      // ignore non-JSON bodies
    }
    await pulseDebug('vod.backfill.start', detail, { login, streamId: body.streamId, vodId: body.vodId ?? null }, 'error')
    throw new Error(detail)
  }
  const job = await res.json() as PulseBackfillJob
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
    headers: await pulseRequestHeaders(),
  })
  if (!res.ok) {
    throw new Error(`backfill_status ${res.status}`)
  }
  return res.json() as Promise<PulseBackfillJob>
}

export async function postVodHint(
  login: string,
  body: { streamId: string; vodId: string },
  baseUrl?: string,
): Promise<{ ok: boolean; vodId?: string; status?: number; error?: string }> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/extension/pulse/channels/${encodeURIComponent(login)}/vod-hint`, {
    method: 'POST',
    headers: await pulseRequestHeaders(true),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    // Hosted deployments may require a device/user session for writes while
    // keeping discovery and pulse reads public. A VOD found in Twitch is still
    // useful to the player; do not turn this optional persistence step into an
    // exception/retry loop or make the overlay look like discovery failed.
    if (res.status === 401) {
      await pulseDebug(
        'vod.hint.api',
        'vod-hint requires an authenticated extension session; local VOD discovery remains usable',
        { login, streamId: body.streamId, vodId: body.vodId, status: res.status, authRequired: true },
        'info',
      )
      return { ok: false, status: res.status, error: 'vod_hint_auth_required' }
    }
    await pulseDebug(
      'vod.hint.api',
      `vod-hint HTTP ${res.status}`,
      { login, streamId: body.streamId, vodId: body.vodId, status: res.status },
      res.status === 404 ? 'warn' : 'error',
    )
    throw new Error(`vod_hint ${res.status}`)
  }
  const result = await res.json() as { ok: boolean; vodId?: string }
  await pulseDebug('vod.hint.api', 'vod-hint accepted', { login, ...body, ok: result.ok })
  return result
}

export async function postWatchChannel(login: string, baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/analytics/channels/${encodeURIComponent(login)}/watch`, {
    method: 'POST',
    headers: await pulseRequestHeaders(),
  })
  if (!res.ok && res.status !== 202) {
    throw new Error(`watch ${res.status}`)
  }
}

export async function fetchAlwaysTracked(baseUrl?: string): Promise<string[]> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/analytics/always-tracked`, {
    headers: await pulseRequestHeaders(),
  })
  if (!res.ok) {
    throw new Error(`always_tracked ${res.status}`)
  }
  const body = await res.json() as { channels?: string[] }
  return body.channels ?? []
}

export async function setAlwaysTracked(login: string, track: boolean, baseUrl?: string): Promise<void> {
  const root = baseUrl ?? await getBackendUrl()
  const res = await fetchWithTimeout(`${root}/v1/analytics/always-tracked`, {
    method: 'POST',
    headers: await pulseRequestHeaders(true),
    body: JSON.stringify({ channel: login, track }),
  })
  if (!res.ok) {
    throw pulseHttpError('always_tracked_set', res.status)
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
  )
  if (!res.ok) {
    throw new Error(`stream_history ${res.status}`)
  }
  const body = await res.json() as StreamHistoryResponseBody
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
  )
  if (!res.ok) {
    throw new Error(`analytics_streams ${res.status}`)
  }
  const body = await res.json() as AnalyticsStreamsResponseBody
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
    const res = await fetchWithTimeout(`${root}/v1/channels/${encodeURIComponent(login)}/clips?${qs}`)
    if (!res.ok) return null
    const body = await res.json() as ClipsResponseBody
    return pickTopClip(body.items ?? [])
  } catch {
    return null
  }
}
