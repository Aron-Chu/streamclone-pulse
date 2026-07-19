import { normalizeLogin } from './login.ts'
import type { BackgroundRequest, CreatePulseBookmarkInput } from './messages.ts'

const KNOWN_MESSAGE_TYPES = new Set<string>([
  'TRACK',
  'UNTRACK',
  'GET_PULSE',
  'GET_COVERAGE',
  'GET_ALWAYS_TRACKED',
  'GET_CLIP',
  'HEALTH',
  'OPEN_OPTIONS',
  'LIST_BOOKMARKS',
  'SAVE_BOOKMARK',
  'DELETE_BOOKMARK',
  'LIST_WATCHLIST',
  'ADD_WATCHLIST',
  'REMOVE_WATCHLIST',
  'SYNC_WATCHLIST',
  'SET_AUTO_UPDATE',
  'LIST_PAST_VODS',
  'FETCH_EMOTE_IMAGE',
  'HINT_VOD',
  'DISCOVER_LIVE_VOD',
  'GET_PULSE_VOD',
  'LOAD_MISSED_MOMENTS',
  'GET_PULSE_BACKFILL_STATUS',
  'GET_PULSE_DEBUG_LOG',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function requireLogin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return normalizeLogin(value)
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function requireString(value: unknown): string | null {
  return optionalString(value) ?? null
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value == null) return undefined
  return typeof value === 'boolean' ? value : undefined
}

function optionalNonNegInt(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function parseBookmarkInput(raw: unknown): CreatePulseBookmarkInput | null {
  if (!isObject(raw)) return null
  const offsetSeconds = optionalNonNegInt(raw.offsetSeconds)
  if (offsetSeconds == null) return null
  if (raw.source !== 'extension') return null
  return {
    login: requireLogin(raw.login) ?? undefined,
    streamId: optionalString(raw.streamId),
    vodId: optionalString(raw.vodId),
    offsetSeconds,
    label: optionalString(raw.label),
    notes: optionalString(raw.notes),
    score: optionalNonNegInt(raw.score),
    source: 'extension',
  }
}

/**
 * Validate untrusted runtime messages before the service worker acts on them.
 * Returns null when the message must be ignored / rejected.
 */
export function parseBackgroundRequest(raw: unknown): BackgroundRequest | null {
  if (!isObject(raw)) return null
  const type = raw.type
  if (typeof type !== 'string' || !KNOWN_MESSAGE_TYPES.has(type)) return null

  switch (type) {
    case 'TRACK':
    case 'UNTRACK':
    case 'GET_COVERAGE':
    case 'DISCOVER_LIVE_VOD': {
      const login = requireLogin(raw.login)
      if (!login) return null
      return { type, login }
    }
    case 'GET_PULSE': {
      const login = requireLogin(raw.login)
      if (!login) return null
      const window = raw.window === 'full' || raw.window === 'recent' ? raw.window : undefined
      return {
        type,
        login,
        watch: optionalBoolean(raw.watch),
        window,
        streamId: optionalString(raw.streamId),
      }
    }
    case 'GET_CLIP': {
      const login = requireLogin(raw.login)
      if (!login) return null
      return {
        type,
        login,
        startedAt: optionalString(raw.startedAt),
        isLive: optionalBoolean(raw.isLive),
      }
    }
    case 'ADD_WATCHLIST':
    case 'REMOVE_WATCHLIST': {
      const login = requireLogin(raw.login)
      if (!login) return null
      return { type, login }
    }
    case 'LIST_PAST_VODS': {
      const login = requireLogin(raw.login)
      if (!login) return null
      return {
        type,
        login,
        liveStreamId: optionalString(raw.liveStreamId),
        isLive: optionalBoolean(raw.isLive),
      }
    }
    case 'FETCH_EMOTE_IMAGE': {
      if (typeof raw.url !== 'string' || !raw.url.trim()) return null
      return { type, url: raw.url.trim() }
    }
    case 'HINT_VOD': {
      const login = requireLogin(raw.login)
      const streamId = requireString(raw.streamId)
      const vodId = requireString(raw.vodId)
      if (!login || !streamId || !vodId) return null
      return { type, login, streamId, vodId }
    }
    case 'GET_PULSE_VOD': {
      const vodId = requireString(raw.vodId)
      if (!vodId) return null
      return { type, vodId }
    }
    case 'LOAD_MISSED_MOMENTS': {
      const login = requireLogin(raw.login)
      const streamId = requireString(raw.streamId)
      if (!login || !streamId) return null
      return {
        type,
        login,
        streamId,
        vodId: optionalString(raw.vodId),
        fromOffsetSeconds: optionalNonNegInt(raw.fromOffsetSeconds),
        toOffsetSeconds: optionalNonNegInt(raw.toOffsetSeconds),
      }
    }
    case 'GET_PULSE_BACKFILL_STATUS': {
      const jobId = requireString(raw.jobId)
      if (!jobId) return null
      return { type, jobId }
    }
    case 'LIST_BOOKMARKS': {
      return {
        type,
        login: optionalString(raw.login),
        streamId: optionalString(raw.streamId),
        vodId: optionalString(raw.vodId),
      }
    }
    case 'SAVE_BOOKMARK': {
      const bookmark = parseBookmarkInput(raw.bookmark)
      if (!bookmark) return null
      return { type, bookmark }
    }
    case 'DELETE_BOOKMARK': {
      const id = requireString(raw.id)
      if (!id) return null
      return { type, id }
    }
    case 'SET_AUTO_UPDATE': {
      if (typeof raw.enabled !== 'boolean') return null
      return { type, enabled: raw.enabled }
    }
    case 'HEALTH':
    case 'OPEN_OPTIONS':
    case 'LIST_WATCHLIST':
    case 'SYNC_WATCHLIST':
    case 'GET_ALWAYS_TRACKED':
    case 'GET_PULSE_DEBUG_LOG':
      return { type }
    default:
      return null
  }
}
