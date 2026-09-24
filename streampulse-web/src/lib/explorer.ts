import { apiClient } from './apiClient'
import {
  normalizeNewsroomExternalSource,
  normalizeNewsroomNetworkBrief,
  normalizeNewsroomUpdate,
  type NewsroomExternalSource,
  type NewsroomNetworkBrief,
  type NewsroomSignal,
  type NewsroomStatus,
  type NewsroomUpdate,
  type NewsroomWindow,
} from './newsroom'

export const EXPLORER_SCHEMA_VERSION = 1 as const

export type ExplorerState = 'all' | 'live' | 'ended'
export type ExplorerSort = 'strongest' | 'recent' | 'moments'
export type ExplorerSignal = 'all' | NewsroomSignal

export interface ExplorerQuery {
  window: NewsroomWindow
  signal: ExplorerSignal
  category?: string
  state: ExplorerState
  sort: ExplorerSort
  q?: string
}

export interface ExplorerSummary {
  broadcastCount: number
  momentCount: number
  categoryCount: number
}

export interface ExplorerFacetValue {
  value: string
  label: string
  count: number
}

export interface ExplorerFacets {
  signals: ExplorerFacetValue[]
  categories: ExplorerFacetValue[]
  states: ExplorerFacetValue[]
}

export interface ExplorerBroadcast {
  id: string
  login: string
  displayName?: string
  profileImageUrl?: string
  category?: string
  streamId: string
  state: 'live' | 'ended'
  primarySignal: NewsroomSignal
  momentCount: number
  strongestScore: number
  firstActivityAt: string
  lastActivityAt: string
  strongestMoment: NewsroomUpdate
  latestMoment: NewsroomUpdate
  sources: NewsroomExternalSource[]
}

export interface ExplorerEnvelope {
  schemaVersion: typeof EXPLORER_SCHEMA_VERSION
  status: NewsroomStatus
  generatedAt: string
  dataThrough: string
  window: NewsroomWindow
  query: ExplorerQuery
  summary: ExplorerSummary
  facets: ExplorerFacets
  broadcasts: ExplorerBroadcast[]
  networkContext?: NewsroomNetworkBrief
  nextCursor?: string
  reason?: string
  broadcast?: ExplorerBroadcast
  moments?: NewsroomUpdate[]
}

export interface FetchExplorerOptions extends Partial<ExplorerQuery> {
  broadcastId?: string
  cursor?: string
  limit?: number
  abortSignal?: AbortSignal
}

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalText(value: unknown): string | undefined | null {
  if (value == null) return undefined
  return text(value)
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function timestamp(value: unknown): string | null {
  const candidate = text(value)
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === 'string' && values.includes(value as T) ? value as T : null
}

function normalizeQuery(value: unknown): ExplorerQuery | null {
  const row = record(value)
  if (!row) return null
  const window = enumValue(row.window, ['live', '24h', '7d'] as const)
  const signal = enumValue(row.signal, ['all', 'chat', 'emotes', 'mixed'] as const)
  const category = optionalText(row.category)
  const state = enumValue(row.state, ['all', 'live', 'ended'] as const)
  const sort = enumValue(row.sort, ['strongest', 'recent', 'moments'] as const)
  const q = optionalText(row.q)
  if (!window || !signal || category === null || !state || !sort || q === null) return null
  return { window, signal, category, state, sort, q }
}

function normalizeSummary(value: unknown): ExplorerSummary | null {
  const row = record(value)
  if (!row) return null
  const broadcastCount = integer(row.broadcastCount)
  const momentCount = integer(row.momentCount)
  const categoryCount = integer(row.categoryCount)
  if (broadcastCount == null || momentCount == null || categoryCount == null) return null
  return { broadcastCount, momentCount, categoryCount }
}

function normalizeFacet(value: unknown): ExplorerFacetValue | null {
  const row = record(value)
  const facetValue = text(row?.value)
  const label = text(row?.label)
  const count = integer(row?.count)
  if (!row || !facetValue || !label || count == null) return null
  return { value: facetValue, label, count }
}

function normalizeFacets(value: unknown): ExplorerFacets | null {
  const row = record(value)
  if (!row || !Array.isArray(row.signals) || !Array.isArray(row.categories) || !Array.isArray(row.states)) return null
  const signals = row.signals.map(normalizeFacet)
  const categories = row.categories.map(normalizeFacet)
  const states = row.states.map(normalizeFacet)
  if ([...signals, ...categories, ...states].some((item) => item == null)) return null
  return {
    signals: signals as ExplorerFacetValue[],
    categories: categories as ExplorerFacetValue[],
    states: states as ExplorerFacetValue[],
  }
}

export function normalizeExplorerBroadcast(value: unknown): ExplorerBroadcast | null {
  const row = record(value)
  if (!row) return null
  const id = text(row.id)
  const login = text(row.login)
  const displayName = optionalText(row.displayName)
  const profileImageUrl = optionalText(row.profileImageUrl)
  const category = optionalText(row.category)
  const streamId = text(row.streamId)
  const state = enumValue(row.state, ['live', 'ended'] as const)
  const primarySignal = enumValue(row.primarySignal, ['chat', 'emotes', 'mixed'] as const)
  const momentCount = integer(row.momentCount)
  const strongestScore = integer(row.strongestScore)
  const firstActivityAt = timestamp(row.firstActivityAt)
  const lastActivityAt = timestamp(row.lastActivityAt)
  const strongestMoment = normalizeNewsroomUpdate(row.strongestMoment)
  const latestMoment = normalizeNewsroomUpdate(row.latestMoment)
  const rawSources = row.sources == null ? [] : row.sources
  if (!Array.isArray(rawSources) || rawSources.length > 4) return null
  const sources = rawSources.map(normalizeNewsroomExternalSource).filter((source) => source?.source !== 'x')
  if (
    !id || !login || displayName === null || profileImageUrl === null || category === null || !streamId || !state || !primarySignal ||
    momentCount == null || momentCount < 1 || strongestScore == null || strongestScore > 100 || !firstActivityAt || !lastActivityAt ||
    !strongestMoment || !latestMoment || sources.some((source) => source == null) ||
    strongestMoment.momentRef.streamId !== streamId || latestMoment.momentRef.streamId !== streamId ||
    strongestMoment.score !== strongestScore || Date.parse(firstActivityAt) > Date.parse(lastActivityAt)
  ) return null
  return {
    id,
    login,
    displayName,
    profileImageUrl,
    category,
    streamId,
    state,
    primarySignal,
    momentCount,
    strongestScore,
    firstActivityAt,
    lastActivityAt,
    strongestMoment,
    latestMoment,
    sources: sources as NewsroomExternalSource[],
  }
}

export function normalizeExplorerEnvelope(value: unknown): ExplorerEnvelope | null {
  const row = record(value)
  if (!row || row.schemaVersion !== EXPLORER_SCHEMA_VERSION) return null
  const status = enumValue(row.status, ['ready', 'empty', 'stale', 'unavailable'] as const)
  const generatedAt = timestamp(row.generatedAt)
  const dataThrough = timestamp(row.dataThrough)
  const window = enumValue(row.window, ['live', '24h', '7d'] as const)
  const query = normalizeQuery(row.query)
  const summary = normalizeSummary(row.summary)
  const facets = normalizeFacets(row.facets)
  const nextCursor = optionalText(row.nextCursor)
  const reason = optionalText(row.reason)
  const networkContext = normalizeNewsroomNetworkBrief(row.networkContext)
  if (
    !status || !generatedAt || !dataThrough || !window || !query || !summary || !facets || nextCursor === null || reason === null ||
    networkContext === null || !Array.isArray(row.broadcasts)
  ) return null
  const broadcasts = row.broadcasts.map(normalizeExplorerBroadcast)
  if (broadcasts.some((broadcast) => broadcast == null)) return null
  const broadcast = row.broadcast == null ? undefined : normalizeExplorerBroadcast(row.broadcast)
  if (row.broadcast != null && !broadcast) return null
  const moments = row.moments == null
    ? undefined
    : Array.isArray(row.moments)
      ? row.moments.map(normalizeNewsroomUpdate)
      : null
  if (moments === null || moments?.some((moment) => moment == null)) return null
  const normalizedMoments = moments as NewsroomUpdate[] | undefined
  if (
    (broadcast && normalizedMoments?.some((moment) => moment.momentRef.streamId !== broadcast.streamId)) ||
    status === 'ready' && broadcasts.length === 0 && !broadcast
  ) return null
  return {
    schemaVersion: EXPLORER_SCHEMA_VERSION,
    status,
    generatedAt,
    dataThrough,
    window,
    query,
    summary,
    facets,
    broadcasts: broadcasts as ExplorerBroadcast[],
    networkContext,
    nextCursor,
    reason,
    broadcast: broadcast ?? undefined,
    moments: normalizedMoments,
  }
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 25
  return Math.max(1, Math.min(50, Math.floor(value ?? 25)))
}

export async function fetchExplorer(options: FetchExplorerOptions = {}): Promise<ExplorerEnvelope> {
  const params = new URLSearchParams()
  params.set('window', options.window ?? '24h')
  params.set('signal', options.signal ?? 'all')
  params.set('state', options.state ?? 'all')
  params.set('sort', options.sort ?? 'strongest')
  params.set('limit', String(boundedLimit(options.limit)))
  if (options.category?.trim()) params.set('category', options.category.trim())
  if (options.q?.trim()) params.set('q', options.q.trim())
  if (options.cursor?.trim()) params.set('cursor', options.cursor.trim())
  const broadcastId = options.broadcastId?.trim()
  const path = broadcastId
    ? `/v1/public/explorer/${encodeURIComponent(broadcastId)}?${params}`
    : `/v1/public/explorer?${params}`
  const response = await apiClient<unknown>(path, { signal: options.abortSignal, timeoutMs: 8_000 })
  const envelope = normalizeExplorerEnvelope(response.data)
  if (!envelope) throw new Error('Malformed explorer response')
  return envelope
}

export function explorerReasonCopy(reason: string | undefined | null): string | undefined {
  const normalized = reason?.trim().toLowerCase()
  if (!normalized) return undefined
  const reasons: Record<string, string> = {
    reads_disabled: 'Pulse Explorer is not enabled for this API release yet.',
    no_material_broadcasts: 'No verified broadcasts match these filters.',
    store_unavailable: 'Historical activity storage is temporarily unavailable.',
    not_found: 'This broadcast is no longer available in the selected range.',
  }
  if (reasons[normalized]) return reasons[normalized]
  if (normalized.includes('malformed explorer')) return 'The Explorer response did not match the supported public contract.'
  if (normalized.includes('404') || normalized.includes('page not found')) return 'Pulse Explorer is not available from this API release yet.'
  if (/^[a-z0-9_]+$/.test(normalized)) return 'Verified activity is temporarily unavailable.'
  return reason?.trim()
}
