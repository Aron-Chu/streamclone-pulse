import { apiClient } from './apiClient'
import { absolutizeEmoteAssetUrl } from './emoteAssetUrl'
import {
  normalizeLiveWireMomentComparison,
  type LiveWireMomentComparison,
  type LiveWireMetricComparison,
} from './liveWire'
import type { HubEmote } from './publicHub'
import { buildVodTimestampUrl } from './figmaSessionAnalytics'

export const NEWSROOM_SCHEMA_VERSION = 1 as const

export type NewsroomWindow = 'live' | '24h' | '7d'
export type NewsroomStatus = 'ready' | 'empty' | 'stale' | 'unavailable'
export type NewsroomLifecycle = 'developing' | 'confirmed' | 'cooling' | 'resolved'
export type NewsroomResolvedReason = 'quiet_30m' | 'stream_ended' | 'administrative'
export type NewsroomSignal = 'chat' | 'emotes' | 'mixed'
export type NewsroomUpdateKind = 'signal' | 'lifecycle' | 'correction'
export type NewsroomRollupChatSource = 'live' | 'irc'
export type NewsroomRollupSourceConfidence = 'verified' | 'live'
export type NewsroomExternalSourceName = 'twitch_clip' | 'reddit' | 'x' | 'youtube' | 'news'

export interface NewsroomExternalSource {
  id: string
  source: NewsroomExternalSourceName
  kind: string
  url: string
  title?: string
  author?: string
  occurredAt?: string
  metrics: Record<string, number>
  matchConfidence?: number
  reliabilityWeight?: number
}

export interface NewsroomEvidence {
  ircBound: boolean
  eventRollupAvailable: boolean
  /** Omitted false values from the Go contract normalize to false. */
  streamIdentityMatched: boolean
  rollupChatSource?: NewsroomRollupChatSource
  rollupSourceConfidence?: NewsroomRollupSourceConfidence
  rollupSourceDetail?: string
  metadataStreamMatched: boolean
  /** Unix milliseconds. */
  metadataSampledAt?: number
  baselineMeasuredMinutes: number
  baselineExpectedMinutes: number
  baselineCoveragePct: number
}

export interface NewsroomMomentComparison extends Omit<LiveWireMomentComparison, 'evidence'> {
  evidence: NewsroomEvidence
}

export interface NewsroomMomentRef {
  publicMomentId: string
  streamId: string
  /** Unix milliseconds. */
  occurrenceAt: number
  offsetSeconds: number
}

export interface NewsroomSparkPoint {
  /** Unix milliseconds. */
  at: number
  currentPerMin: number
  baselinePerMin?: number
}

export interface NewsroomUpdate {
  id: string
  revision: number
  detectorEventKey: string
  updateKind: NewsroomUpdateKind
  occurredAt: string
  publishedAt: string
  signal: NewsroomSignal
  lifecycle: NewsroomLifecycle
  resolvedReason?: NewsroomResolvedReason
  resolvedAt?: string
  headline: string
  summary: string
  comparison: NewsroomMomentComparison
  /** Immutable copy of comparison evidence published with this update. */
  evidence: NewsroomEvidence
  topEmotes: HubEmote[]
  momentRef: NewsroomMomentRef
  notificationEligible: boolean
  isLate: boolean
  /** Backend-owned primary-signal samples. Gaps are omitted, never zero-filled. */
  sparkline?: NewsroomSparkPoint[]
  vodId?: string
}

export interface NewsroomStory {
  id: string
  login: string
  displayName?: string
  profileImageUrl?: string
  category?: string
  streamId: string
  lifecycle: NewsroomLifecycle
  resolvedReason?: NewsroomResolvedReason
  primarySignal: NewsroomSignal
  headline: string
  summary: string
  revision: number
  createdAt: string
  lastPublishedAt: string
  resolvedAt?: string
  leadUpdate: NewsroomUpdate
  /** Corroborating public coverage; never part of the StreamPulse reaction score. */
  sources: NewsroomExternalSource[]
}

export interface NewsroomNetworkBrief {
  currentStart: string
  currentEnd: string
  baselineStart: string
  baselineEnd: string
  comparableChannels: number
  coveragePct: number
  chatChangePct?: number
  emoteChangePct?: number
}

export interface NewsroomEnvelope {
  schemaVersion: typeof NEWSROOM_SCHEMA_VERSION
  status: NewsroomStatus
  generatedAt: string
  /** Writer watermark for the versioned envelope, including unavailable responses. */
  dataThrough: string
  snapshotAt: string
  window: NewsroomWindow
  leadStoryId?: string
  stories: NewsroomStory[]
  networkBrief?: NewsroomNetworkBrief
  nextCursor?: string
  reason?: string
  /** Detail endpoint only. */
  story?: NewsroomStory
  /** Detail endpoint only. */
  updates?: NewsroomUpdate[]
}

export interface FetchNewsroomOptions {
  window?: NewsroomWindow
  limit?: number
  cursor?: string
  storyId?: string
  signal?: AbortSignal
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

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(number) ? number : null
}

function nonNegative(value: unknown): number | null {
  const number = finite(value)
  return number != null && number >= 0 ? number : null
}

function integer(value: unknown): number | null {
  const number = nonNegative(value)
  return number != null && Number.isInteger(number) ? number : null
}

function timestamp(value: unknown): string | null {
  const valueText = text(value)
  if (!valueText) return null
  const parsed = Date.parse(valueText)
  return Number.isFinite(parsed) ? valueText : null
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === 'string' && values.includes(value as T) ? value as T : null
}

function normalizeEmote(value: unknown): HubEmote | null {
  const row = record(value)
  if (!row) return null
  const name = text(row.name)
  const count = nonNegative(row.count)
  const sharePct = nonNegative(row.sharePct)
  const provider = optionalText(row.provider)
  const imageUrl = optionalText(row.imageUrl)
  if (!name || count == null || sharePct == null || sharePct > 100 || provider === null || imageUrl === null) {
    return null
  }
  return {
    name,
    count,
    sharePct,
    provider,
    imageUrl: imageUrl ? absolutizeEmoteAssetUrl(imageUrl) : undefined,
    zeroWidth: typeof row.zeroWidth === 'boolean' ? row.zeroWidth : undefined,
    animated: typeof row.animated === 'boolean' ? row.animated : undefined,
  }
}

function normalizeSparkline(value: unknown): NewsroomSparkPoint[] | undefined | null {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length > 12) return null
  const points: NewsroomSparkPoint[] = []
  let previousAt = 0
  for (const item of value) {
    const row = record(item)
    const at = nonNegative(row?.at)
    const currentPerMin = nonNegative(row?.currentPerMin)
    const baselinePerMin = row && 'baselinePerMin' in row && row.baselinePerMin != null
      ? nonNegative(row.baselinePerMin)
      : undefined
    if (!row || at == null || at < 1_000_000_000_000 || currentPerMin == null || baselinePerMin === null) {
      return null
    }
    if (previousAt > 0 && at <= previousAt) return null
    previousAt = at
    points.push({ at, currentPerMin, baselinePerMin })
  }
  return points
}

function normalizeMomentRef(value: unknown): NewsroomMomentRef | null {
  const row = record(value)
  if (!row) return null
  const publicMomentId = text(row.publicMomentId)
  const streamId = text(row.streamId)
  const occurrenceAt = nonNegative(row.occurrenceAt)
  const offsetSeconds = nonNegative(row.offsetSeconds)
  if (
    !publicMomentId || !streamId || occurrenceAt == null || occurrenceAt < 1_000_000_000_000 ||
    offsetSeconds == null
  ) return null
  return { publicMomentId, streamId, occurrenceAt, offsetSeconds }
}

function normalizeNewsroomEvidence(value: unknown): NewsroomEvidence | null {
  const row = record(value)
  if (!row) return null
  const streamIdentityMatched = row.streamIdentityMatched == null ? false : row.streamIdentityMatched
  const rollupChatSource = row.rollupChatSource == null
    ? undefined
    : enumValue(row.rollupChatSource, ['live', 'irc'] as const)
  const rollupSourceConfidence = row.rollupSourceConfidence == null
    ? undefined
    : enumValue(row.rollupSourceConfidence, ['verified', 'live'] as const)
  const rollupSourceDetail = optionalText(row.rollupSourceDetail)
  const metadataSampledAt = row.metadataSampledAt == null ? undefined : nonNegative(row.metadataSampledAt)
  const baselineMeasuredMinutes = integer(row.baselineMeasuredMinutes)
  const baselineExpectedMinutes = integer(row.baselineExpectedMinutes)
  const baselineCoveragePct = nonNegative(row.baselineCoveragePct)
  if (
    typeof row.ircBound !== 'boolean' || typeof row.eventRollupAvailable !== 'boolean' ||
    typeof streamIdentityMatched !== 'boolean' || typeof row.metadataStreamMatched !== 'boolean' ||
    rollupChatSource === null || rollupSourceConfidence === null || rollupSourceDetail === null ||
    metadataSampledAt === null || (metadataSampledAt !== undefined && metadataSampledAt < 1_000_000_000_000) ||
    baselineMeasuredMinutes == null || baselineExpectedMinutes == null || baselineMeasuredMinutes > baselineExpectedMinutes ||
    baselineCoveragePct == null || baselineCoveragePct > 100 ||
    (row.eventRollupAvailable && (!rollupChatSource || !rollupSourceConfidence))
  ) return null
  return {
    ircBound: row.ircBound,
    eventRollupAvailable: row.eventRollupAvailable,
    streamIdentityMatched,
    rollupChatSource,
    rollupSourceConfidence,
    rollupSourceDetail,
    metadataStreamMatched: row.metadataStreamMatched,
    metadataSampledAt,
    baselineMeasuredMinutes,
    baselineExpectedMinutes,
    baselineCoveragePct,
  }
}

function sameNewsroomEvidence(left: NewsroomEvidence, right: NewsroomEvidence): boolean {
  return (
    left.ircBound === right.ircBound && left.eventRollupAvailable === right.eventRollupAvailable &&
    left.streamIdentityMatched === right.streamIdentityMatched && left.rollupChatSource === right.rollupChatSource &&
    left.rollupSourceConfidence === right.rollupSourceConfidence && left.rollupSourceDetail === right.rollupSourceDetail &&
    left.metadataStreamMatched === right.metadataStreamMatched && left.metadataSampledAt === right.metadataSampledAt &&
    left.baselineMeasuredMinutes === right.baselineMeasuredMinutes &&
    left.baselineExpectedMinutes === right.baselineExpectedMinutes &&
    left.baselineCoveragePct === right.baselineCoveragePct
  )
}

function normalizeNewsroomComparison(value: unknown): NewsroomMomentComparison | null {
  const row = record(value)
  const comparison = normalizeLiveWireMomentComparison(value)
  const evidence = normalizeNewsroomEvidence(row?.evidence)
  if (!comparison || !evidence) return null
  if (
    comparison.evidence.ircBound !== evidence.ircBound ||
    comparison.evidence.eventRollupAvailable !== evidence.eventRollupAvailable ||
    comparison.evidence.baselineMeasuredMinutes !== evidence.baselineMeasuredMinutes ||
    comparison.evidence.baselineExpectedMinutes !== evidence.baselineExpectedMinutes ||
    comparison.evidence.baselineCoveragePct !== evidence.baselineCoveragePct
  ) return null
  return { ...comparison, evidence }
}

export function normalizeNewsroomUpdate(value: unknown): NewsroomUpdate | null {
  const row = record(value)
  if (!row) return null
  const id = text(row.id)
  const revision = integer(row.revision)
  const detectorEventKey = text(row.detectorEventKey)
  const updateKind = enumValue(row.updateKind, ['signal', 'lifecycle', 'correction'] as const)
  const occurredAt = timestamp(row.occurredAt)
  const publishedAt = timestamp(row.publishedAt)
  const signal = enumValue(row.signal, ['chat', 'emotes', 'mixed'] as const)
  const lifecycle = enumValue(row.lifecycle, ['developing', 'confirmed', 'cooling', 'resolved'] as const)
  const resolvedReason = row.resolvedReason == null
    ? undefined
    : enumValue(row.resolvedReason, ['quiet_30m', 'stream_ended', 'administrative'] as const)
  const resolvedAt = row.resolvedAt == null ? undefined : timestamp(row.resolvedAt)
  const headline = text(row.headline)
  const summary = text(row.summary)
  const comparison = normalizeNewsroomComparison(row.comparison)
  const evidence = normalizeNewsroomEvidence(row.evidence)
  const momentRef = normalizeMomentRef(row.momentRef)
  const sparkline = normalizeSparkline(row.sparkline)
  const vodId = optionalText(row.vodId)
  if (
    !id || revision == null || revision < 1 || !detectorEventKey || !updateKind || !occurredAt || !publishedAt || !signal || !lifecycle ||
    resolvedReason === null || resolvedAt === null || !headline || !summary ||
    !comparison || !evidence || !sameNewsroomEvidence(comparison.evidence, evidence) || !momentRef ||
    typeof row.notificationEligible !== 'boolean' || typeof row.isLate !== 'boolean' ||
    sparkline === null || vodId === null || (vodId !== undefined && !/^\d+$/.test(vodId)) ||
    comparison?.eventAt !== momentRef?.occurrenceAt
  ) return null
  if (Date.parse(publishedAt) < Date.parse(occurredAt) && !row.isLate) return null
  const rawEmotes = row.topEmotes == null ? [] : row.topEmotes
  if (!Array.isArray(rawEmotes)) return null
  const topEmotes = rawEmotes.map(normalizeEmote)
  if (topEmotes.some((emote) => emote == null)) return null
  return {
    id,
    revision,
    detectorEventKey,
    updateKind,
    occurredAt,
    publishedAt,
    signal,
    lifecycle,
    resolvedReason,
    resolvedAt,
    headline,
    summary,
    comparison,
    evidence,
    topEmotes: topEmotes as HubEmote[],
    momentRef,
    notificationEligible: row.notificationEligible,
    isLate: row.isLate,
    sparkline,
    vodId,
  }
}

const NEWSROOM_SOURCE_NAMES = ['twitch_clip', 'reddit', 'x', 'youtube', 'news'] as const
const NEWSROOM_SOURCE_METRICS = new Set(['views', 'score', 'likes', 'comments', 'reposts'])

function newsroomSourceUrl(source: NewsroomExternalSourceName, value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
    const hostIs = (...domains: string[]) => domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
    const allowed = source === 'twitch_clip'
      ? hostIs('clips.twitch.tv', 'twitch.tv')
      : source === 'reddit'
        ? hostIs('reddit.com', 'redd.it')
        : source === 'x'
          ? hostIs('x.com', 'twitter.com')
          : source === 'youtube'
            ? hostIs('youtube.com', 'youtu.be')
            : host.length > 0
    return allowed ? parsed.toString() : null
  } catch {
    return null
  }
}

function normalizeNewsroomSourceMetrics(value: unknown): Record<string, number> | null {
  if (value == null) return {}
  const row = record(value)
  if (!row) return null
  const metrics: Record<string, number> = {}
  for (const [key, candidate] of Object.entries(row)) {
    const normalizedKey = key.trim().toLowerCase()
    if (!NEWSROOM_SOURCE_METRICS.has(normalizedKey) || typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) continue
    metrics[normalizedKey] = candidate
  }
  return metrics
}

export function normalizeNewsroomExternalSource(value: unknown): NewsroomExternalSource | null {
  const row = record(value)
  if (!row) return null
  const id = text(row.id)
  const source = enumValue(row.source, NEWSROOM_SOURCE_NAMES)
  const kind = text(row.kind)
  const url = source ? newsroomSourceUrl(source, row.url) : null
  const title = optionalText(row.title)
  const author = optionalText(row.author)
  const occurredAt = row.occurredAt == null ? undefined : timestamp(row.occurredAt)
  const metrics = normalizeNewsroomSourceMetrics(row.metrics)
  const matchConfidence = row.matchConfidence == null ? undefined : nonNegative(row.matchConfidence)
  const reliabilityWeight = row.reliabilityWeight == null ? undefined : nonNegative(row.reliabilityWeight)
  if (
    !id || !source || !kind || !url || title === null || author === null || occurredAt === null || !metrics ||
    matchConfidence === null || reliabilityWeight === null ||
    (matchConfidence !== undefined && matchConfidence > 1) ||
    (reliabilityWeight !== undefined && reliabilityWeight > 1)
  ) return null
  return { id, source, kind, url, title, author, occurredAt, metrics, matchConfidence, reliabilityWeight }
}

export function normalizeNewsroomStory(value: unknown): NewsroomStory | null {
  const row = record(value)
  if (!row) return null
  const id = text(row.id)
  const login = text(row.login)
  const displayName = optionalText(row.displayName)
  const profileImageUrl = optionalText(row.profileImageUrl)
  const category = optionalText(row.category)
  const streamId = text(row.streamId)
  const lifecycle = enumValue(row.lifecycle, ['developing', 'confirmed', 'cooling', 'resolved'] as const)
  const resolvedReason = row.resolvedReason == null
    ? undefined
    : enumValue(row.resolvedReason, ['quiet_30m', 'stream_ended', 'administrative'] as const)
  const primarySignal = enumValue(row.primarySignal, ['chat', 'emotes', 'mixed'] as const)
  const headline = text(row.headline)
  const summary = text(row.summary)
  const revision = integer(row.revision)
  const createdAt = timestamp(row.createdAt)
  const lastPublishedAt = timestamp(row.lastPublishedAt)
  const resolvedAt = row.resolvedAt == null ? undefined : timestamp(row.resolvedAt)
  const leadUpdate = normalizeNewsroomUpdate(row.leadUpdate)
  const rawSources = row.sources == null ? [] : row.sources
  if (!Array.isArray(rawSources) || rawSources.length > 4) return null
  const sources = rawSources.map(normalizeNewsroomExternalSource)
  if (
    !id || !login || displayName === null || profileImageUrl === null || category === null || !streamId || !lifecycle ||
    resolvedReason === null || !primarySignal || !headline || !summary || revision == null || !createdAt ||
    !lastPublishedAt || resolvedAt === null || !leadUpdate || sources.some((source) => source == null) || leadUpdate.momentRef.streamId !== streamId ||
    leadUpdate.lifecycle !== lifecycle || leadUpdate.revision > revision
  ) return null
  if (lifecycle === 'resolved' && !resolvedReason) return null
  if (lifecycle !== 'resolved' && (resolvedReason || resolvedAt)) return null
  return {
    id,
    login,
    displayName,
    profileImageUrl,
    category,
    streamId,
    lifecycle,
    resolvedReason,
    primarySignal,
    headline,
    summary,
    revision,
    createdAt,
    lastPublishedAt,
    resolvedAt,
    leadUpdate,
    sources: sources as NewsroomExternalSource[],
  }
}

function normalizeNetworkBrief(value: unknown): NewsroomNetworkBrief | undefined | null {
  if (value == null) return undefined
  const row = record(value)
  if (!row) return null
  const currentStart = timestamp(row.currentStart)
  const currentEnd = timestamp(row.currentEnd)
  const baselineStart = timestamp(row.baselineStart)
  const baselineEnd = timestamp(row.baselineEnd)
  const comparableChannels = integer(row.comparableChannels)
  const coveragePct = nonNegative(row.coveragePct)
  const chatChangePct = row.chatChangePct == null ? undefined : finite(row.chatChangePct)
  const emoteChangePct = row.emoteChangePct == null ? undefined : finite(row.emoteChangePct)
  if (
    !currentStart || !currentEnd || !baselineStart || !baselineEnd || comparableChannels == null || coveragePct == null ||
    coveragePct > 100 || chatChangePct === null || emoteChangePct === null ||
    Date.parse(currentStart) >= Date.parse(currentEnd) || Date.parse(baselineStart) >= Date.parse(baselineEnd) ||
    Date.parse(baselineEnd) > Date.parse(currentStart)
  ) return null
  return {
    currentStart,
    currentEnd,
    baselineStart,
    baselineEnd,
    comparableChannels,
    coveragePct,
    chatChangePct,
    emoteChangePct,
  }
}

/** Strict public-contract decoder. Any malformed published field fails the whole envelope closed. */
export function normalizeNewsroomEnvelope(value: unknown): NewsroomEnvelope | null {
  const row = record(value)
  if (!row || row.schemaVersion !== NEWSROOM_SCHEMA_VERSION) return null
  const status = enumValue(row.status, ['ready', 'empty', 'stale', 'unavailable'] as const)
  const generatedAt = timestamp(row.generatedAt)
  const dataThrough = row.dataThrough == null ? undefined : timestamp(row.dataThrough)
  const snapshotAt = timestamp(row.snapshotAt)
  const window = enumValue(row.window, ['live', '24h', '7d'] as const)
  const leadStoryId = optionalText(row.leadStoryId)
  const nextCursor = optionalText(row.nextCursor)
  const reason = optionalText(row.reason)
  const networkBrief = normalizeNetworkBrief(row.networkBrief)
  if (
    !status || !generatedAt || dataThrough === null || !snapshotAt || !window || leadStoryId === null || nextCursor === null ||
    reason === null || networkBrief === null || !Array.isArray(row.stories)
  ) return null
  if (dataThrough === undefined) return null
  const stories = row.stories.map(normalizeNewsroomStory)
  if (stories.some((story) => story == null)) return null
  const normalizedStories = stories as NewsroomStory[]
  for (let index = 1; index < normalizedStories.length; index += 1) {
    const previous = normalizedStories[index - 1]
    const current = normalizedStories[index]
    if (
      Date.parse(previous.lastPublishedAt) < Date.parse(current.lastPublishedAt) ||
      (previous.lastPublishedAt === current.lastPublishedAt && previous.id < current.id)
    ) return null
  }
  if (status === 'ready' && normalizedStories.length === 0 && row.story == null) return null
  if (status === 'empty' && normalizedStories.length > 0) return null
  const story = row.story == null ? undefined : normalizeNewsroomStory(row.story)
  if (row.story != null && !story) return null
  const normalizedStory = story ?? undefined
  if (
    leadStoryId &&
    !normalizedStories.some((candidate) => candidate.id === leadStoryId) &&
    normalizedStory?.id !== leadStoryId
  ) return null
  const updates = row.updates == null
    ? undefined
    : Array.isArray(row.updates)
      ? row.updates.map(normalizeNewsroomUpdate)
      : null
  if (updates === null || updates?.some((update) => update == null)) return null
  const normalizedUpdates = updates as NewsroomUpdate[] | undefined
  if (
    normalizedStory && normalizedUpdates?.some(
      (update) => update.momentRef.streamId !== normalizedStory.streamId || update.revision > normalizedStory.revision,
    )
  ) return null
  return {
    schemaVersion: NEWSROOM_SCHEMA_VERSION,
    status,
    generatedAt,
    dataThrough,
    snapshotAt,
    window,
    leadStoryId,
    stories: normalizedStories,
    networkBrief,
    nextCursor,
    reason,
    story: normalizedStory,
    updates: normalizedUpdates,
  }
}

function clampedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 20
  return Math.max(1, Math.min(50, Math.floor(value ?? 20)))
}

export async function fetchNewsroom(options: FetchNewsroomOptions = {}): Promise<NewsroomEnvelope> {
  const params = new URLSearchParams()
  params.set('limit', String(clampedLimit(options.limit)))
  if (options.cursor?.trim()) params.set('cursor', options.cursor.trim())
  const storyId = options.storyId?.trim()
  let path: string
  if (storyId) {
    path = `/v1/public/newsroom/${encodeURIComponent(storyId)}?${params}`
  } else {
    params.set('window', options.window ?? 'live')
    path = `/v1/public/newsroom?${params}`
  }
  const response = await apiClient<unknown>(path, { signal: options.signal, timeoutMs: 8_000 })
  const envelope = normalizeNewsroomEnvelope(response.data)
  if (!envelope) throw new Error('Malformed newsroom response')
  return envelope
}

export function newsroomMetricForSignal(
  comparison: LiveWireMomentComparison,
  signal: NewsroomSignal,
): LiveWireMetricComparison | null {
  if (signal === 'chat') return comparison.chat
  if (signal === 'emotes') return comparison.emotes
  const candidates = [comparison.chat, comparison.emotes].filter(
    (metric) => metric.state === 'ready' || metric.state === 'new_activity',
  )
  return candidates.sort((a, b) => (b.multiplier ?? 0) - (a.multiplier ?? 0))[0] ?? null
}

export function newsroomDataThroughAge(dataThrough: string | undefined, now = Date.now()): string | null {
  if (!dataThrough) return null
  const parsed = Date.parse(dataThrough)
  if (!Number.isFinite(parsed)) return null
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000))
  if (minutes < 1) return 'Data through less than a minute ago.'
  if (minutes < 60) return `Data through ${minutes}m ago.`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Data through ${hours}h ago.`
  return `Data through ${Math.floor(hours / 24)}d ago.`
}

const NEWSROOM_REASON_COPY: Record<string, string> = {
  reads_disabled: 'Pulse Newsroom is not enabled for this API release yet.',
  refresh_not_ready: 'Verified story history is still being prepared.',
  no_material_stories: 'No verified stream story is developing in this window.',
  refresh_unavailable: 'Fresh story data could not be reached. The last verified stories are preserved.',
  query_unavailable: 'Verified stories are temporarily unavailable.',
  store_unavailable: 'Verified story storage is temporarily unavailable.',
  not_found: 'Pulse Newsroom is not available from this API release.',
}

export function newsroomReasonCopy(reason: string | undefined | null): string | undefined {
  const value = reason?.trim()
  if (!value) return undefined
  const normalized = value.toLowerCase()
  if (NEWSROOM_REASON_COPY[normalized]) return NEWSROOM_REASON_COPY[normalized]
  if (normalized === 'malformed newsroom response' || normalized.includes('malformed newsroom')) {
    return 'The Newsroom response did not match the supported public contract.'
  }
  if (normalized.includes('404') || normalized.includes('page not found')) {
    return NEWSROOM_REASON_COPY.not_found
  }
  if (/^[a-z0-9_]+$/.test(normalized)) return 'Verified stories are temporarily unavailable.'
  return value
}

export interface NewsroomWatchAction {
  href: string
  label: 'Watch live' | 'Watch VOD'
}

/** Derive only allowlisted Twitch destinations from server-owned identifiers. */
export function newsroomWatchAction(story: NewsroomStory): NewsroomWatchAction | null {
  if (story.lifecycle !== 'resolved' || story.resolvedReason === 'quiet_30m') {
    return {
      href: `https://www.twitch.tv/${encodeURIComponent(story.login)}`,
      label: 'Watch live',
    }
  }
  if (story.resolvedReason === 'stream_ended' && story.leadUpdate.vodId) {
    return {
      href: buildVodTimestampUrl(story.leadUpdate.vodId, story.leadUpdate.momentRef.offsetSeconds),
      label: 'Watch VOD',
    }
  }
  return null
}
