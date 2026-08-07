/**
 * Portal Live Activity — server-owned stream-session lifecycle feed.
 * GET /v1/portal/analytics/live-activity
 */

import { apiClient } from './apiClient'

export type LiveActivityKind = 'went_live' | 'went_offline'
export type LiveActivityKindFilter = 'all' | LiveActivityKind
export type LiveActivityMetadataState = 'current' | 'degraded' | 'stale' | 'unavailable'
export type LiveActivityTimestampPrecision =
  | 'twitch_started_at'
  | 'observed_after_confirmation'
export type LiveActivitySource = 'metadata_poll' | 'eventsub'

export interface LiveActivityChannel {
  id: string
  login: string
  displayName?: string
  avatarUrl?: string
}

export interface LiveActivityEvent {
  id: string
  kind: LiveActivityKind
  channel: LiveActivityChannel
  streamId: string
  occurredAt: string
  detectedAt: string
  lastSeenLiveAt: string | null
  timestampPrecision: LiveActivityTimestampPrecision
  title?: string
  category?: string
  source: LiveActivitySource
}

export interface LiveActivityMetadata {
  state: LiveActivityMetadataState
  lastSuccessfulPollAt?: string | null
  lastFullySuccessfulAt?: string | null
  pollCompletedAt?: string | null
  requestedCount?: number
  successfulCount?: number
  failedCount?: number
  complete?: boolean
}

export interface LiveActivityResponse {
  asOf: string
  window: string
  completeness: string
  metadata: LiveActivityMetadata
  events: LiveActivityEvent[]
}

export interface FetchLiveActivityOptions {
  window?: string
  limit?: number
  kind?: LiveActivityKindFilter
  signal?: AbortSignal
}

const METADATA_STATES = new Set<LiveActivityMetadataState>([
  'current',
  'degraded',
  'stale',
  'unavailable',
])

const EVENT_KINDS = new Set<LiveActivityKind>(['went_live', 'went_offline'])

const SOURCES = new Set<LiveActivitySource>(['metadata_poll', 'eventsub'])

const TIMESTAMP_PRECISIONS = new Set<LiveActivityTimestampPrecision>([
  'twitch_started_at',
  'observed_after_confirmation',
])

const REQUIRED_COMPLETENESS = 'tracked_channels_only'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`live_activity_invalid:${field}`)
  }
  return value.trim()
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value !== 'string') throw new Error('live_activity_invalid:string')
  const trimmed = value.trim()
  return trimmed || undefined
}

/** Optional ISO timestamp — null/invalid → null consistently. */
function optionalIsoOrNull(value: unknown): string | null {
  if (value == null) return null
  if (typeof value !== 'string' || !value.trim()) return null
  const ms = Date.parse(value.trim())
  if (!Number.isFinite(ms)) return null
  return new Date(ms).toISOString()
}

function optionalNonNegInt(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function parseIsoRequired(value: unknown, field: string): string {
  const raw = requireNonEmptyString(value, field)
  const ms = Date.parse(raw)
  if (!Number.isFinite(ms)) throw new Error(`live_activity_invalid:${field}`)
  return new Date(ms).toISOString()
}

function normalizeChannel(raw: unknown): LiveActivityChannel {
  if (!isRecord(raw)) throw new Error('live_activity_invalid:channel')
  const login = requireNonEmptyString(raw.login, 'channel.login').toLowerCase()
  return {
    id: requireNonEmptyString(raw.id, 'channel.id'),
    login,
    displayName: optionalString(raw.displayName) || login,
    avatarUrl: optionalString(raw.avatarUrl),
  }
}

function normalizeEvent(raw: unknown): LiveActivityEvent {
  if (!isRecord(raw)) throw new Error('live_activity_invalid:event')
  const kindRaw = requireNonEmptyString(raw.kind, 'kind')
  if (!EVENT_KINDS.has(kindRaw as LiveActivityKind)) {
    throw new Error('live_activity_invalid:kind')
  }
  const sourceRaw = requireNonEmptyString(raw.source, 'source')
  if (!SOURCES.has(sourceRaw as LiveActivitySource)) {
    throw new Error('live_activity_invalid:source')
  }
  const precisionRaw = requireNonEmptyString(raw.timestampPrecision, 'timestampPrecision')
  if (!TIMESTAMP_PRECISIONS.has(precisionRaw as LiveActivityTimestampPrecision)) {
    throw new Error('live_activity_invalid:timestampPrecision')
  }
  return {
    id: requireNonEmptyString(raw.id, 'id'),
    kind: kindRaw as LiveActivityKind,
    channel: normalizeChannel(raw.channel),
    streamId: requireNonEmptyString(raw.streamId, 'streamId'),
    occurredAt: parseIsoRequired(raw.occurredAt, 'occurredAt'),
    detectedAt: parseIsoRequired(raw.detectedAt, 'detectedAt'),
    lastSeenLiveAt: optionalIsoOrNull(raw.lastSeenLiveAt),
    timestampPrecision: precisionRaw as LiveActivityTimestampPrecision,
    title: optionalString(raw.title),
    category: optionalString(raw.category),
    source: sourceRaw as LiveActivitySource,
  }
}

/** Validate and normalize a portal live-activity payload. Empty events[] is valid. */
export function normalizeLiveActivityResponse(raw: unknown): LiveActivityResponse {
  if (!isRecord(raw)) throw new Error('live_activity_invalid:response')
  const asOf = parseIsoRequired(raw.asOf, 'asOf')
  const window = requireNonEmptyString(raw.window, 'window')
  const completeness = requireNonEmptyString(raw.completeness, 'completeness')
  if (completeness !== REQUIRED_COMPLETENESS) {
    throw new Error('live_activity_invalid:completeness')
  }
  if (!isRecord(raw.metadata)) throw new Error('live_activity_invalid:metadata')
  const stateRaw = requireNonEmptyString(raw.metadata.state, 'metadata.state')
  if (!METADATA_STATES.has(stateRaw as LiveActivityMetadataState)) {
    throw new Error('live_activity_invalid:metadata.state')
  }
  const lastSuccessfulPollAt = optionalIsoOrNull(raw.metadata.lastSuccessfulPollAt)
  const lastFullySuccessfulAt = optionalIsoOrNull(raw.metadata.lastFullySuccessfulAt)
  const pollCompletedAt = optionalIsoOrNull(raw.metadata.pollCompletedAt)
  if (!Array.isArray(raw.events)) throw new Error('live_activity_invalid:events')
  const events = raw.events.map(normalizeEvent)
  return {
    asOf,
    window,
    completeness,
    metadata: {
      state: stateRaw as LiveActivityMetadataState,
      lastSuccessfulPollAt: lastSuccessfulPollAt ?? undefined,
      lastFullySuccessfulAt: lastFullySuccessfulAt ?? undefined,
      pollCompletedAt: pollCompletedAt ?? undefined,
      requestedCount: optionalNonNegInt(raw.metadata.requestedCount),
      successfulCount: optionalNonNegInt(raw.metadata.successfulCount),
      failedCount: optionalNonNegInt(raw.metadata.failedCount),
      complete: typeof raw.metadata.complete === 'boolean' ? raw.metadata.complete : undefined,
    },
    events,
  }
}

export async function fetchLiveActivity(
  options: FetchLiveActivityOptions = {},
): Promise<LiveActivityResponse> {
  const params = new URLSearchParams()
  params.set('window', options.window?.trim() || '6h')
  params.set('limit', String(options.limit ?? 20))
  params.set('kind', options.kind ?? 'all')
  const { data } = await apiClient<unknown>(`/v1/portal/analytics/live-activity?${params}`, {
    signal: options.signal,
    timeoutMs: 8_000,
  })
  return normalizeLiveActivityResponse(data)
}

export function liveActivityKindLabel(kind: LiveActivityKind): string {
  switch (kind) {
    case 'went_live':
      return 'Went live'
    case 'went_offline':
      return 'Went offline'
  }
}

/** Precision copy — Confirmed start vs Observed offline. Never invent exact stop times. */
export function liveActivityPrecisionLabel(
  precision: LiveActivityTimestampPrecision,
  kind?: LiveActivityKind,
): string {
  if (precision === 'twitch_started_at' || kind === 'went_live') {
    return 'Confirmed start'
  }
  if (precision === 'observed_after_confirmation' || kind === 'went_offline') {
    return 'Observed offline'
  }
  return kind === 'went_offline' ? 'Observed offline' : 'Confirmed start'
}

export function liveActivitySourceLabel(source: LiveActivitySource): string {
  switch (source) {
    case 'eventsub':
      return 'EventSub'
    case 'metadata_poll':
      return 'Metadata'
  }
}

export function formatLiveActivityRelativeTime(
  iso: string | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (!iso) return ''
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return ''
  const deltaSec = Math.max(0, Math.round((nowMs - at) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const min = Math.round(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

export function filterLiveActivityEvents(
  events: LiveActivityEvent[],
  kind: LiveActivityKindFilter,
): LiveActivityEvent[] {
  if (kind === 'all') return events
  return events.filter((event) => event.kind === kind)
}

/**
 * Seed baseline IDs from the first successful response.
 * Call once; subsequent polls use {@link diffNewLiveActivityIds}.
 */
export function seedLiveActivityBaseline(eventIds: Iterable<string>): Set<string> {
  return new Set([...eventIds].filter(Boolean))
}

/** IDs present in `eventIds` but not in the baseline — never marks the initial seed as New. */
export function diffNewLiveActivityIds(
  baseline: Set<string> | null,
  eventIds: Iterable<string>,
): Set<string> {
  if (baseline == null) return new Set()
  const fresh = new Set<string>()
  for (const id of eventIds) {
    if (id && !baseline.has(id)) fresh.add(id)
  }
  return fresh
}

/**
 * Coverage diagnostic metadata label honesty.
 * Use server metadata.state only when the live-activity request is ready/empty/degraded/stale.
 * When unavailable/error/loading (no trustworthy request), show `unavailable` — never claim `current`.
 */
export function resolveCoverageMetadataLabel(
  requestStatus: string | null | undefined,
  serverMetadataState: LiveActivityMetadataState | string | null | undefined,
): string {
  if (
    requestStatus === 'unavailable' ||
    requestStatus === 'error' ||
    requestStatus === 'loading'
  ) {
    return 'unavailable'
  }
  if (
    requestStatus === 'ready' ||
    requestStatus === 'empty' ||
    requestStatus === 'degraded' ||
    requestStatus === 'stale'
  ) {
    const state = (serverMetadataState ?? 'unavailable').trim() || 'unavailable'
    return state
  }
  // No live-activity request context — trust the provided metadata label.
  return (serverMetadataState ?? 'unavailable').trim() || 'unavailable'
}

export function formatCoverageDiagnostic(
  trackedCount: number,
  metadataState: LiveActivityMetadataState | string | undefined,
): string {
  const state = (metadataState ?? 'unavailable').trim() || 'unavailable'
  return `${trackedCount} tracked channels · metadata ${state}`
}

/** Dev/e2e session override for portal-read promotion (never invents lifecycle rows). */
export const LIVE_ACTIVITY_PORTAL_READ_SESSION_KEY = 'sp.liveActivityPortalRead'

function liveActivitySessionOverrideAllowed(
  env: { PROD?: boolean; MODE?: string; DEV?: boolean } = import.meta.env,
): boolean {
  // Production builds must rely on the authorized build flag only.
  if (env.PROD === true) return false
  // Allow intentional opt-in in Vite dev / vitest / explicit non-prod modes.
  if (env.DEV === true) return true
  if (env.MODE === 'test' || env.MODE === 'development') return true
  return false
}

/** Portal read promotion gate — default OFF until Stage 3 promotion. */
export function isLiveActivityPortalReadEnabled(
  env: {
    VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED?: string
    PROD?: boolean
    MODE?: string
    DEV?: boolean
  } = import.meta.env,
): boolean {
  if (liveActivitySessionOverrideAllowed(env) && typeof window !== 'undefined') {
    try {
      const override = window.sessionStorage.getItem(LIVE_ACTIVITY_PORTAL_READ_SESSION_KEY)?.trim()
      if (override === 'true') return true
      if (override === 'false') return false
    } catch {
      // Ignore storage access failures; fall through to build env.
    }
  }
  return env.VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED === 'true'
}
