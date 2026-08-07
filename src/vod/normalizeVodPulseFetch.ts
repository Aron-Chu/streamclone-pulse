import type {
  ExtensionVodPulseResponse,
  VodCoverageStatus,
  VodResolutionState,
} from '../types/vodPulseTypes.ts'

const MISSING_MESSAGE = 'No replay analytics have been indexed for this VOD yet.'
const SYNCING_MESSAGE = 'Replay analytics are still syncing for this VOD.'
const ERROR_MESSAGE = 'Replay Pulse is temporarily unavailable.'

export type VodPulseState =
  | { status: 'loading' }
  | { status: 'ready'; data: ExtensionVodPulseResponse }
  | { status: 'partial'; data: ExtensionVodPulseResponse; reason?: string }
  | { status: 'syncing'; vodId: string; reason?: string; data?: ExtensionVodPulseResponse }
  | { status: 'missing'; vodId: string; reason?: string; channelLogin?: string }
  | { status: 'untracked_actionable'; vodId: string; reason?: string; channelLogin?: string }
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

function isResolutionState(value: unknown): value is VodResolutionState {
  return typeof value === 'string' && [
    'ready',
    'live_waiting_for_vod',
    'vod_unpublished',
    'vod_discovery_pending',
    'vod_found_indexing',
    'partial',
    'not_collected',
    'stream_not_collected',
    'persisted_exact',
    'helix_exact',
    'vod_not_found',
    'vod_deleted',
    'vod_unavailable',
    'lookup_disabled',
    'helix_unavailable',
    'resolution_timeout',
    'identity_mismatch',
    'terminal_error',
    'authentication_required',
  ].includes(value)
}

export function parseExtensionVodPulseResponse(raw: Record<string, unknown>): ExtensionVodPulseResponse {
  const vodId = String(raw.vodId ?? '').trim()
  const coverageStatus = isCoverageStatus(raw.coverageStatus) ? raw.coverageStatus : 'missing'
  const resolutionState = isResolutionState(raw.resolutionState) ? raw.resolutionState : undefined
  return {
    mode: 'vod',
    vodId,
    streamId: typeof raw.streamId === 'string' ? raw.streamId : undefined,
    channelLogin: typeof raw.channelLogin === 'string' ? raw.channelLogin : undefined,
    channelDisplayName: typeof raw.channelDisplayName === 'string' ? raw.channelDisplayName : undefined,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : undefined,
    durationSeconds: typeof raw.durationSeconds === 'number' ? raw.durationSeconds : undefined,
    coverageStatus,
    coverageMessage: typeof raw.coverageMessage === 'string' ? raw.coverageMessage : undefined,
    resolutionState,
    retryable: typeof raw.retryable === 'boolean' ? raw.retryable : undefined,
    fullAnalyticsUrl: typeof raw.fullAnalyticsUrl === 'string' ? raw.fullAnalyticsUrl : undefined,
    recap: raw.recap as ExtensionVodPulseResponse['recap'],
    timeline: raw.timeline as ExtensionVodPulseResponse['timeline'],
    topMoments: raw.topMoments as ExtensionVodPulseResponse['topMoments'],
    topEmotes: raw.topEmotes as ExtensionVodPulseResponse['topEmotes'],
    bestClipCandidate: raw.bestClipCandidate as ExtensionVodPulseResponse['bestClipCandidate'],
  }
}

export function missingVodPulseResponse(vodId: string, message = MISSING_MESSAGE): ExtensionVodPulseResponse {
  return {
    mode: 'vod',
    vodId,
    coverageStatus: 'missing',
    coverageMessage: message,
    resolutionState: 'vod_discovery_pending',
    retryable: true,
  }
}

export function errorVodPulseResponse(vodId: string, message = ERROR_MESSAGE): ExtensionVodPulseResponse {
  return {
    mode: 'vod',
    vodId,
    coverageStatus: 'error',
    coverageMessage: message,
    resolutionState: 'terminal_error',
    retryable: false,
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

  if (data.coverageStatus === 'error') {
    return {
      status: 'error',
      message: data.coverageMessage?.trim() || ERROR_MESSAGE,
    }
  }

  if (data.coverageStatus === 'missing') {
    if (data.resolutionState === 'stream_not_collected') {
      return {
        status: 'untracked_actionable',
        vodId: data.vodId,
        reason: data.coverageMessage?.trim() || 'Pulse hasn’t indexed this VOD yet.',
        channelLogin: data.channelLogin,
      }
    }
    return {
      status: 'missing',
      vodId: data.vodId,
      reason: data.coverageMessage?.trim() || MISSING_MESSAGE,
      channelLogin: data.channelLogin,
    }
  }

  if (data.coverageStatus === 'syncing') {
    return {
      status: 'syncing',
      vodId: data.vodId,
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

export function vodPulseStateAllowsRetry(
  data: ExtensionVodPulseResponse | null,
  error?: string | null,
): boolean {
  if (error?.trim()) return false
  const state = resolveVodPulseState(data, error)
  return state.status === 'missing' || state.status === 'syncing' || state.status === 'partial'
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
    if (record.mode === 'vod' || record.coverageStatus || record.vodId) {
      return parseExtensionVodPulseResponse({ vodId, ...record })
    }
  }

  if (res.status === 404) {
    return missingVodPulseResponse(vodId)
  }

  if (res.status >= 500) {
    return errorVodPulseResponse(vodId)
  }

  if (!res.ok) {
    return errorVodPulseResponse(vodId)
  }

  return missingVodPulseResponse(vodId)
}
