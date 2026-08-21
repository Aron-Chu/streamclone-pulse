/**
 * Runtime narrowing for `chrome.runtime.onMessage` payloads.
 *
 * `BackgroundRequest` is a compile-time type only — it is erased at runtime, so
 * the worker previously read `message.login` / `message.url` straight off an
 * unvalidated object. Content scripts run in a page the extension does not
 * control, so every string that reaches a privileged fetch is normalized here
 * first. Unknown shapes are rejected rather than partially trusted.
 */

import type { BackgroundRequest } from './messages.ts'
import { normalizeLogin } from './login.ts'

/** Twitch numeric ids (stream, VOD, job) — same bound as the discovery regexes. */
const NUMERIC_ID_RE = /^\d{6,20}$/
/** Backfill job ids are backend-issued opaque tokens, not Twitch numerics. */
const JOB_ID_RE = /^[A-Za-z0-9_-]{6,128}$/

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function login(value: unknown): string | null {
  return typeof value === 'string' ? normalizeLogin(value) : null
}

function numericId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return NUMERIC_ID_RE.test(trimmed) ? trimmed : null
}

function optionalNumericId(value: unknown): { ok: boolean; value?: string } {
  if (value === undefined || value === null) return { ok: true }
  const id = numericId(value)
  return id ? { ok: true, value: id } : { ok: false }
}

function optionalBool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function optionalOffset(value: unknown): { ok: boolean; value?: number } {
  if (value === undefined || value === null) return { ok: true }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return { ok: false }
  }
  return { ok: true, value: Math.floor(value) }
}

function pulseWindow(value: unknown): 'recent' | 'full' | undefined {
  return value === 'full' ? 'full' : value === 'recent' ? 'recent' : undefined
}

/**
 * Returns a normalized request, or `null` when the payload is malformed.
 * Normalization is intentionally lossy: only fields the worker acts on survive.
 */
export function narrowBackgroundRequest(raw: unknown): BackgroundRequest | null {
  const message = asRecord(raw)
  if (!message || typeof message.type !== 'string') return null

  switch (message.type) {
    case 'HEALTH':
    case 'LIST_WATCHLIST':
    case 'SYNC_WATCHLIST':
      return { type: message.type } as BackgroundRequest

    case 'TRACK':
    case 'UNTRACK':
    case 'GET_COVERAGE':
    case 'ADD_WATCHLIST':
    case 'REMOVE_WATCHLIST': {
      const normalized = login(message.login)
      return normalized
        ? ({ type: message.type, login: normalized } as BackgroundRequest)
        : null
    }

    case 'GET_ALWAYS_TRACKED': {
      const normalized = login(message.login)
      return normalized ? { type: 'GET_ALWAYS_TRACKED', login: normalized } : null
    }

    case 'DISCOVER_LIVE_VOD': {
      const normalized = login(message.login)
      if (!normalized) return null
      const streamId = optionalNumericId(message.streamId)
      if (!streamId.ok) return null
      return { type: 'DISCOVER_LIVE_VOD', login: normalized, streamId: streamId.value }
    }

    case 'GET_PULSE': {
      const normalized = login(message.login)
      if (!normalized) return null
      const streamId = optionalNumericId(message.streamId)
      if (!streamId.ok) return null
      return {
        type: 'GET_PULSE',
        login: normalized,
        watch: optionalBool(message.watch),
        window: pulseWindow(message.window),
        streamId: streamId.value,
      }
    }

    case 'GET_CLIP': {
      const normalized = login(message.login)
      if (!normalized) return null
      return {
        type: 'GET_CLIP',
        login: normalized,
        startedAt: typeof message.startedAt === 'string' ? message.startedAt : undefined,
        isLive: optionalBool(message.isLive),
      }
    }

    case 'SET_AUTO_UPDATE':
      return typeof message.enabled === 'boolean'
        ? { type: 'SET_AUTO_UPDATE', enabled: message.enabled }
        : null

    case 'LIST_PAST_VODS': {
      const normalized = login(message.login)
      if (!normalized) return null
      const liveStreamId = optionalNumericId(message.liveStreamId)
      if (!liveStreamId.ok) return null
      return {
        type: 'LIST_PAST_VODS',
        login: normalized,
        liveStreamId: liveStreamId.value,
        isLive: optionalBool(message.isLive),
      }
    }

    case 'HINT_VOD': {
      const normalized = login(message.login)
      const streamId = numericId(message.streamId)
      const vodId = numericId(message.vodId)
      if (!normalized || !streamId || !vodId) return null
      return { type: 'HINT_VOD', login: normalized, streamId, vodId }
    }

    case 'GET_PULSE_VOD': {
      const vodId = numericId(message.vodId)
      if (!vodId) return null
      const streamId = optionalNumericId(message.streamId)
      if (!streamId.ok) return null
      return {
        type: 'GET_PULSE_VOD',
        vodId,
        streamId: streamId.value,
        window: pulseWindow(message.window),
      }
    }

    case 'LOAD_MISSED_MOMENTS': {
      const normalized = login(message.login)
      const streamId = numericId(message.streamId)
      if (!normalized || !streamId) return null
      const vodId = optionalNumericId(message.vodId)
      if (!vodId.ok) return null
      const from = optionalOffset(message.fromOffsetSeconds)
      const to = optionalOffset(message.toOffsetSeconds)
      if (!from.ok || !to.ok) return null
      return {
        type: 'LOAD_MISSED_MOMENTS',
        login: normalized,
        streamId,
        vodId: vodId.value,
        fromOffsetSeconds: from.value,
        toOffsetSeconds: to.value,
      }
    }

    case 'GET_PULSE_BACKFILL_STATUS': {
      const jobId = typeof message.jobId === 'string' ? message.jobId.trim() : ''
      const normalized = login(message.login)
      return JOB_ID_RE.test(jobId) && normalized
        ? { type: 'GET_PULSE_BACKFILL_STATUS', jobId, login: normalized }
        : null
    }

    default:
      return null
  }
}
