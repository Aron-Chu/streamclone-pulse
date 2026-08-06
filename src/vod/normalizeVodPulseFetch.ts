import type { ExtensionVodPulseResponse, VodCoverageStatus } from '../types/vodPulseTypes.ts'
import { normalizeStreamId, normalizeVodId } from '../shared/vodIdPatterns.ts'

const MISSING_MESSAGE = 'No replay analytics have been indexed for this VOD yet.'
const SYNCING_MESSAGE = 'Replay analytics are still syncing for this VOD.'
const ERROR_MESSAGE = 'Replay Pulse is temporarily unavailable.'
const ARCHIVE_NOT_VISIBLE_MESSAGE = 'Archive not verified yet. Twitch may still be publishing it.'
const ARCHIVE_PROVIDER_UNAVAILABLE_MESSAGE = 'Archive verification is temporarily unavailable. Live analytics are unaffected.'
const LIVE_STREAM_PENDING_MESSAGE = 'StreamPulse is still matching this archive to the live stream.'
const ARCHIVE_CONFLICT_MESSAGE = 'Archive identity could not be verified for this stream.'
const ARCHIVE_VALIDATION_ERROR_MESSAGE = 'Archive validation failed. Live analytics are unaffected.'

type CandidateResolutionState =
  | 'live_archive_not_visible'
  | 'live_archive_provider_unavailable'
  | 'live_stream_pending'
  | 'live_archive_conflict'
  | 'identity_mismatch'
  | 'terminal_error'

function isCandidateResolutionState(value: string): value is CandidateResolutionState {
  return value === 'live_archive_not_visible'
    || value === 'live_archive_provider_unavailable'
    || value === 'live_stream_pending'
    || value === 'live_archive_conflict'
    || value === 'identity_mismatch'
    || value === 'terminal_error'
}

function candidateResolutionMessage(state: CandidateResolutionState): string {
  switch (state) {
    case 'live_archive_not_visible':
      return ARCHIVE_NOT_VISIBLE_MESSAGE
    case 'live_archive_provider_unavailable':
      return ARCHIVE_PROVIDER_UNAVAILABLE_MESSAGE
    case 'live_stream_pending':
      return LIVE_STREAM_PENDING_MESSAGE
    case 'live_archive_conflict':
    case 'identity_mismatch':
      return ARCHIVE_CONFLICT_MESSAGE
    case 'terminal_error':
      return ARCHIVE_VALIDATION_ERROR_MESSAGE
  }
}

function candidateCoverageStatus(state: CandidateResolutionState): 'syncing' | 'error' {
  return state === 'live_archive_not_visible'
    || state === 'live_archive_provider_unavailable'
    || state === 'live_stream_pending'
    ? 'syncing'
    : 'error'
}

export type VodPulseState =
  | { status: 'loading' }
  | { status: 'ready'; data: ExtensionVodPulseResponse }
  | { status: 'partial'; data: ExtensionVodPulseResponse; reason?: string }
  | { status: 'live_dvr'; data: Extract<ExtensionVodPulseResponse, { mode: 'live_dvr' }> }
  | { status: 'syncing'; vodId: string; reason?: string; data?: ExtensionVodPulseResponse }
  | { status: 'missing'; vodId: string; reason?: string; channelLogin?: string }
  | { status: 'error'; message: string }

function isCoverageStatus(value: unknown): value is VodCoverageStatus {
  return (
    value === 'ready'
    || value === 'partial'
    || value === 'syncing'
    || value === 'missing'
    || value === 'error'
  )
}

export function parseExtensionVodPulseResponse(raw: Record<string, unknown>): ExtensionVodPulseResponse {
  const rawMode = typeof raw.mode === 'string' ? raw.mode.trim() : ''
  const rawResolutionState = typeof raw.resolutionState === 'string'
    ? raw.resolutionState.trim()
    : ''
  const streamId = normalizeStreamId(raw.streamId)
  const vodId = normalizeVodId(raw.vodId)
  const channelLogin = typeof raw.channelLogin === 'string'
    ? raw.channelLogin.trim()
    : typeof raw.login === 'string'
      ? raw.login.trim()
      : ''
  const liveDvr =
    rawMode === 'live_dvr'
    || rawMode === 'live_stream_validated'
    || raw.provisional === true
    || rawResolutionState === 'live_stream_validated'

  if (liveDvr) {
    if (!streamId || !channelLogin || !Array.isArray(raw.rollups)) {
      throw new Error('vod_pulse_invalid_live_dvr_response')
    }
    return {
      ...raw,
      mode: 'live_dvr',
      vodId,
      provisional: typeof raw.provisional === 'boolean' ? raw.provisional : true,
      resolutionState: rawResolutionState || (rawMode === 'live_stream_validated' ? rawMode : 'live_stream_validated'),
      retryable: typeof raw.retryable === 'boolean' ? raw.retryable : true,
      streamId,
      login: channelLogin,
      channelLogin,
      isLive: typeof raw.isLive === 'boolean' ? raw.isLive : true,
      tracking: typeof raw.tracking === 'boolean' ? raw.tracking : true,
      currentOffsetSeconds:
        typeof raw.currentOffsetSeconds === 'number' && Number.isFinite(raw.currentOffsetSeconds)
          ? Math.max(0, raw.currentOffsetSeconds)
          : 0,
      lanes: raw.lanes && typeof raw.lanes === 'object' && !Array.isArray(raw.lanes)
        ? raw.lanes
        : { composite: [], chat: [], seventv: [] },
      recap: raw.recap as ExtensionVodPulseResponse['recap'],
      timeline: raw.timeline as ExtensionVodPulseResponse['timeline'],
      topMoments: raw.topMoments as ExtensionVodPulseResponse['topMoments'],
      topEmotes: raw.topEmotes as ExtensionVodPulseResponse['topEmotes'],
      games: Array.isArray(raw.games) ? raw.games as ExtensionVodPulseResponse['games'] : undefined,
      bestClipCandidate: raw.bestClipCandidate as ExtensionVodPulseResponse['bestClipCandidate'],
    } as ExtensionVodPulseResponse
  }

  const coverageStatus = isCoverageStatus(raw.coverageStatus) ? raw.coverageStatus : 'missing'
  const candidateResolutionState = isCandidateResolutionState(rawResolutionState)
  if (!vodId && coverageStatus !== 'missing' && coverageStatus !== 'error' && !candidateResolutionState) {
    throw new Error('vod_pulse_invalid_vod_id')
  }
  return {
    ...raw,
    mode: 'vod',
    vodId: vodId ?? null,
    provisional: false,
    streamId: streamId ?? undefined,
    login: channelLogin || undefined,
    channelLogin: channelLogin || undefined,
    channelDisplayName: typeof raw.channelDisplayName === 'string' ? raw.channelDisplayName : undefined,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : undefined,
    durationSeconds: typeof raw.durationSeconds === 'number' ? raw.durationSeconds : undefined,
    coverageStatus,
    coverageMessage: typeof raw.coverageMessage === 'string' ? raw.coverageMessage : undefined,
    fullAnalyticsUrl: typeof raw.fullAnalyticsUrl === 'string' ? raw.fullAnalyticsUrl : undefined,
    recap: raw.recap as ExtensionVodPulseResponse['recap'],
    timeline: raw.timeline as ExtensionVodPulseResponse['timeline'],
    topMoments: raw.topMoments as ExtensionVodPulseResponse['topMoments'],
    topEmotes: raw.topEmotes as ExtensionVodPulseResponse['topEmotes'],
    games: Array.isArray(raw.games) ? raw.games as ExtensionVodPulseResponse['games'] : undefined,
    bestClipCandidate: raw.bestClipCandidate as ExtensionVodPulseResponse['bestClipCandidate'],
  }
}

export function missingVodPulseResponse(vodId: string | null, message = MISSING_MESSAGE): ExtensionVodPulseResponse {
  const validatedVodId = vodId == null ? null : normalizeVodId(vodId)
  if (vodId != null && !validatedVodId) throw new Error('vod_pulse_invalid_vod_id')
  return {
    mode: 'vod',
    vodId: validatedVodId,
    provisional: false,
    retryable: true,
    coverageStatus: 'missing',
    coverageMessage: message,
  }
}

export function errorVodPulseResponse(vodId: string | null, message = ERROR_MESSAGE): ExtensionVodPulseResponse {
  const validatedVodId = vodId == null ? null : normalizeVodId(vodId)
  if (vodId != null && !validatedVodId) throw new Error('vod_pulse_invalid_vod_id')
  return {
    mode: 'vod',
    vodId: validatedVodId,
    provisional: false,
    retryable: true,
    coverageStatus: 'error',
    coverageMessage: message,
  }
}

/** Strip transport-layer debug strings so they never reach product UI. */
export function sanitizeVodTransportError(error?: string | null): string | null {
  const trimmed = error?.trim()
  if (!trimmed) return null
  if (/^vod_pulse(?:_\w+)?(?: \d+)?$/i.test(trimmed)) return null
  if (trimmed === 'vod_pulse_failed' || trimmed === 'vod_hydration_failed') return null
  if (/^extension_background_/.test(trimmed)) return null
  return ERROR_MESSAGE
}

export function resolveVodPulseState(
  data: ExtensionVodPulseResponse | null,
  error?: string | null,
  loading = false,
  vodIdHint?: string,
): VodPulseState {
  if (loading) return { status: 'loading' }

  const transportError = sanitizeVodTransportError(error)
  if (transportError && !data) {
    return { status: 'error', message: transportError }
  }

  if (!data) {
    const vodId = vodIdHint?.trim() || 'unknown'
    return {
      status: 'missing',
      vodId,
      reason: MISSING_MESSAGE,
    }
  }

  if (data.mode === 'live_dvr') {
    return { status: 'live_dvr', data }
  }

  if (data.coverageStatus === 'error') {
    return {
      status: 'error',
      message: data.coverageMessage?.trim() || ERROR_MESSAGE,
    }
  }

  if (data.coverageStatus === 'missing') {
    const stateVodId = data.vodId ?? vodIdHint?.trim() ?? 'unknown'
    return {
      status: 'missing',
      vodId: stateVodId || 'unknown',
      reason: data.coverageMessage?.trim() || MISSING_MESSAGE,
      channelLogin: data.channelLogin,
    }
  }

  if (data.coverageStatus === 'syncing') {
    const stateVodId = data.vodId ?? vodIdHint?.trim() ?? 'unknown'
    return {
      status: 'syncing',
      vodId: stateVodId || 'unknown',
      reason: data.coverageMessage?.trim() || SYNCING_MESSAGE,
      data,
    }
  }

  if (data.coverageStatus === 'partial') {
    return {
      status: 'partial',
      data,
      reason: data.coverageMessage?.trim() || 'Replay analytics are partially available.',
    }
  }

  return { status: 'ready', data }
}

export async function normalizeVodPulseHttpResponse(
  vodId: string,
  res: Response,
): Promise<ExtensionVodPulseResponse> {
  const text = await res.text().catch(() => '')
  let body: unknown = null
  if (text.trim()) {
    try {
      body = JSON.parse(text)
    } catch {
      if (res.ok) {
        return errorVodPulseResponse(vodId)
      }
    }
  }

  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const record = body as Record<string, unknown>
    const mode = typeof record.mode === 'string' ? record.mode : ''
    const resolutionState = typeof record.resolutionState === 'string' ? record.resolutionState : ''
    const isLiveResponse =
      mode === 'live_dvr'
      || mode === 'live_stream_validated'
      || resolutionState === 'live_stream_validated'
      || record.provisional === true
      || (record.vodId === null && Boolean(normalizeStreamId(record.streamId)) && Array.isArray(record.rollups))
    if (isLiveResponse) {
      // Do not inject the candidate VOD id into a provisional live response.
      return parseExtensionVodPulseResponse(record)
    }
    if (isCandidateResolutionState(resolutionState)) {
      // The route VOD is still only a candidate. Preserve the backend state
      // without promoting it to a validated identity.
      return parseExtensionVodPulseResponse({
        ...record,
        mode: 'vod',
        vodId: null,
        coverageStatus: candidateCoverageStatus(resolutionState),
        coverageMessage: candidateResolutionMessage(resolutionState),
        retryable: record.retryable !== false,
      })
    }
    if (mode === 'vod' || record.coverageStatus || record.vodId) {
      const coverageStatus = isCoverageStatus(record.coverageStatus) ? record.coverageStatus : 'missing'
      const shouldUseRouteCandidate = record.vodId == null
        && coverageStatus !== 'missing'
        && coverageStatus !== 'error'
      return parseExtensionVodPulseResponse(
        shouldUseRouteCandidate ? { ...record, vodId } : record,
      )
    }
  }

  if (res.status === 404) {
    return missingVodPulseResponse(null)
  }

  if (res.status >= 500) {
    return errorVodPulseResponse(null)
  }

  if (!res.ok) {
    return errorVodPulseResponse(null)
  }

  return missingVodPulseResponse(null)
}
