import {
  configureAnalyticsApi,
  configureEmoteAssetBase,
  minuteRollupSpanSeconds,
  HeatmapIntegrityError,
  SessionIdentityMismatchError,
  TimelineIntegrityError,
  isSessionDataError,
  type AnalyticsApi,
  type AnalyticsStreamOptions,
  type PulseBookmarkQuery,
  type SetupWelcome,
  type StartHistoricalSyncOptions,
} from '@streampulse/analytics-console'
import type {
  AnalyticsMinuteRollup,
  AnalyticsStreamDetail,
  AnalyticsStreamsResponse,
  AnalyticsTopEmote,
  GameSegment,
  PulseRecapEmote,
  PulseRecapMoment,
  PulseStreamRecap,
  SyncStatus,
} from '@streampulse/analytics-console'
import { apiClient, getBackendUrl, isApiError } from './apiClient'
import { resolveBackendSource } from './backendSource'
import { hasBetaKey } from './auth'
import { absolutizeEmoteAssetUrl } from './emoteAssetUrl'
import { downsampleTimeline, PORTAL_MINUTES_TIMEOUT_MS, rollupChartActivityScore } from './timelineDownsample'

/**
 * Portal analytics adapter — reshapes hosted `/v1/portal/analytics/*` for
 * `@streampulse/analytics-console`.
 *
 * - **Chart minutes:** `downsampleTimeline()` to ~240 points on hosted API (prod).
 *   Local `:8090` is opt-in only (`npm run dev:local`); channel emote catalog fetch is skipped on local.
 * - **Top emotes:** `mergePortalTopEmotes()` — stream summary totals win over
 *   per-minute bucket catalog counts; channel emote identity (`/channels/{login}/emotes`)
 *   fills imageUrl/id gaps for recap-only or low-usage emotes.
 * - **VOD links:** client resolves `detail.vodId ?? stream.vodId ?? recap.vodId`
 *   for Selected Moment “Open on Twitch”.
 * - **streamId identity:** request path may use alias/canonical id A; mapped
 *   `AnalyticsStreamDetail.stream.streamId` and recap `streamId` are whatever the
 *   portal JSON returns (including remapped B). Never rewrite response ids to the
 *   request id.
 */

export class PortalChannelEmotesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PortalChannelEmotesError'
  }
}

interface PortalStreamRecord {
  streamId: string
  login: string
  displayName?: string
  title?: string
  category?: string
  gamesSummary?: string
  startedAt: string
  endedAt?: string | null
  currentViewers?: number
  peakViewers?: number
  viewerSamples?: number
  chatMessages?: number
  vodId?: string
}

interface PortalSignalObservation {
  state: string
  observedAt: string
  coveragePct?: number
  source?: string
  value?: number
}

interface PortalSignalWatermark {
  state: string
  observedThrough: string
  coveragePct?: number
  source?: string
}

interface PortalPeakObservation {
  state: string
  observedAt: string
  confirmed?: boolean
  detector?: string
  value: number
}

type PortalSignalObservations = Record<string, PortalSignalObservation>
type PortalSignalWatermarks = Record<string, PortalSignalWatermark>

interface PortalCoverageGapRange {
  fromOffsetSeconds: number
  toOffsetSeconds: number
}

interface PortalSessionAvailability {
  version?: string
  chartUsable?: boolean
  chartState?: string
  coveragePct?: number
  missingRanges?: PortalCoverageGapRange[]
  coverageMessage?: string
  liveDvrState?: string
  vodState?: string
  vodId?: string
  vodMessage?: string
  backfillState?: string
  corpusState?: string
  corpusMessage?: string
}

interface PortalStreamDetail {
  channel: string
  state: string
  stream?: PortalStreamRecord
  sources?: Array<{ source: string; state: string; label?: string }>
  updatedAt: number
  vodId?: string
  vodAlignSeconds?: number
  syncPhase?: string
  chatCoveragePct?: number
  analyticsQuality?: string
  dataSourceBadges?: Array<{ source: string; state: string; label?: string }>
  viewerSource?: string
  signalWatermarks?: PortalSignalWatermarks
  availability?: PortalSessionAvailability
}

type PortalRequestOptions = { signal?: AbortSignal }

function markPortalPerformance(name: string): void {
  if (import.meta.env.DEV && typeof performance !== 'undefined') {
    performance.mark(`streampulse:portal:${name}`)
  }
}

interface PortalMinutePoint {
  offsetSeconds: number
  viewerAvg?: number
  viewerMax?: number
  viewerLatest?: number
  viewerSamples?: number
  chatCount?: number
  totalEmoteCount?: number
  seventvEmoteCount?: number
  missing?: boolean
  topEmotes?: Array<{ name: string; provider?: string; imageUrl?: string; count: number }>
  signalObservations?: PortalSignalObservations
}

interface PortalStreamMinutesResponse {
  streamId: string
  channel: string
  startedAt: string
  coverageStartOffsetSeconds?: number
  minutes: PortalMinutePoint[]
  updatedAt: number
  signalWatermarks?: PortalSignalWatermarks
}

export interface PortalStreamSummary {
  channel: string
  stream?: PortalStreamRecord
  metrics?: PortalStreamSummaryMetrics
  topEmotes?: AnalyticsTopEmote[]
  updatedAt: number
  analyticsQuality?: string
}

export interface PortalStreamSummaryMetrics {
  chat_per_min: number
  emotes_per_min: number
  seventv_per_min: number
  provider_share_pct?: number
  reaction_score_0_100?: number
  viewer_momentum_5m?: number
  data_coverage_pct?: number
  sync_health_state?: string
  minutesWithData?: number
  viewerSampleCount?: number
}

export interface PortalRecapMoment {
  offsetSeconds: number
  score: number
  reasons?: string[]
  chatCount?: number
  emoteCount?: number
  viewerCount?: number
  topEmotes?: Array<{ code: string; count: number; provider?: string }>
  peakObservation?: PortalPeakObservation
}

export interface PortalStreamRecapResponse {
  streamId: string
  login: string
  vodId?: string
  durationSeconds?: number
  totalMessages?: number
  peakChatPerMin?: number
  topMoments?: PortalRecapMoment[]
  topEmotes?: Array<{ code: string; count: number; provider?: string; id?: string; imageUrl?: string }>
  biggestChatSpike?: { offsetSeconds: number; chatPerMin: number }
  funniestEmoteBurst?: { offsetSeconds: number; code?: string; count: number; provider?: string }
  clipCandidates?: PortalRecapMoment[]
  emoteEnrichmentStatus?: 'complete' | 'partial' | 'missing' | string
}

interface PortalSyncStatus {
  phase: string
  message?: string
  updatedAt?: string
  stale?: boolean
}

interface PortalChannelLiveResponse {
  channel: string
  state: string
  stream?: PortalStreamRecord
  rollups?: PortalMinutePoint[]
  topEmotes?: AnalyticsTopEmote[]
  sources?: Array<{ source: string; state: string; label?: string }>
  updatedAt: number
  vodId?: string
  syncPhase?: string
  coverageStartOffsetSeconds?: number
  viewerSource?: string
  signalWatermarks?: PortalSignalWatermarks
  analyticsQuality?: string
  chatCoveragePct?: number
  availability?: PortalSessionAvailability
}

interface PortalChannelEmoteRow {
  provider: string
  providerEmoteId?: string
  name: string
  imageUrl?: string
  useCount?: number
}

export function usesLocalAnalyticsBackend(): boolean {
  return resolveBackendSource(getBackendUrl()) === 'local'
}

/** Bookmarks require a beta-key principal ΓÇö not available on public no-login /analytics. */
export function portalBookmarksSupported(): boolean {
  return hasBetaKey()
}

function bookmarkUnavailableResponse() {
  return {
    items: [] as unknown[],
    supported: false as const,
    reason: 'private_beta' as const,
  }
}

function usesLocalAnalyticsRoutes(): boolean {
  return usesLocalAnalyticsBackend()
}

const PLACEHOLDER_CATEGORIES = /^(live|syncing\.{3}|syncingΓÇª)$/i

/** Synthesize one chart segment from stream category + rollup span when games API is empty. */
export function deriveClientGameSegments(
  streamId: string,
  detail: Pick<AnalyticsStreamDetail, 'stream' | 'rollups' | 'momentRollups'> | null | undefined,
): GameSegment[] {
  const category = detail?.stream?.category?.trim() ?? ''
  if (!category || PLACEHOLDER_CATEGORIES.test(category)) return []
  const timeline = detail?.momentRollups?.length ? detail.momentRollups : detail?.rollups ?? []
  const durationSeconds = minuteRollupSpanSeconds(timeline)
  if (durationSeconds <= 0) return []
  return [
    {
      id: 0,
      streamId,
      gameName: category,
      boxArtUrl: '',
      offsetSeconds: 0,
      durationSeconds,
      createdAt: new Date(0).toISOString(),
    },
  ]
}

function gamesEndpoint(streamId: string): string {
  if (usesLocalAnalyticsRoutes()) {
    return analyticsPath(`/streams/${encodeURIComponent(streamId)}/games`)
  }
  return portalPath(`/streams/${encodeURIComponent(streamId)}/games`)
}

function portalPath(path: string): string {
  return `/v1/portal/analytics${path.startsWith('/') ? path : `/${path}`}`
}

function analyticsPath(path: string): string {
  return `/v1/analytics${path.startsWith('/') ? path : `/${path}`}`
}

function portalEmoteLookupKey(emote: { name: string; provider?: string }): string {
  const name = emote.name.trim().toLowerCase()
  if (!name) return ''
  return `${(emote.provider ?? 'unknown').toLowerCase()}:${name}`
}

/** Re-key minute emote buckets to match stream-level topEmote keys (provider:id:name). */
export function alignRollupEmoteKeys(
  rollups: AnalyticsMinuteRollup[],
  topEmotes: AnalyticsTopEmote[],
): AnalyticsMinuteRollup[] {
  if (!topEmotes.length) return rollups
  const keyByLookup = new Map<string, string>()
  for (const emote of topEmotes) {
    const np = portalEmoteLookupKey(emote)
    if (np && emote.key) keyByLookup.set(np, emote.key)
  }
  let anyChanged = false
  const alignedRollups = rollups.map((rollup) => {
    if (!rollup.emotes || Object.keys(rollup.emotes).length === 0) return rollup
    const aligned: Record<string, number> = {}
    let rollupChanged = false
    for (const [rollupKey, count] of Object.entries(rollup.emotes)) {
      if (count <= 0) continue
      const parts = rollupKey.split(':')
      const provider = (parts[0] ?? 'unknown').toLowerCase()
      const name = (parts.length >= 3 ? parts.slice(2).join(':') : rollupKey).trim().toLowerCase()
      const targetKey = keyByLookup.get(`${provider}:${name}`) ?? rollupKey
      aligned[targetKey] = (aligned[targetKey] ?? 0) + count
      if (targetKey !== rollupKey) rollupChanged = true
    }
    if (!rollupChanged) return rollup
    anyChanged = true
    return { ...rollup, emotes: aligned }
  })
  return anyChanged ? alignedRollups : rollups
}

function portalBucketEmoteKey(emote: { name: string; provider?: string }): string {
  const provider = (emote.provider ?? 'other').toLowerCase()
  const name = emote.name.trim()
  if (!name) return ''
  return `${provider}:${name}:${name}`
}

/** Stream-level top emotes from `/summary` win counts; minute + channel catalogs fill imageUrl gaps. */
export function mergePortalTopEmotes(
  catalog: AnalyticsTopEmote[],
  summaryEmotes: AnalyticsTopEmote[] | null | undefined,
  channelEmotes?: AnalyticsTopEmote[] | null,
): AnalyticsTopEmote[] {
  const merged = new Map<string, AnalyticsTopEmote>()

  for (const emote of catalog) {
    const np = portalEmoteLookupKey(emote)
    if (!np) continue
    merged.set(np, {
      ...emote,
      imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
    })
  }

  for (const emote of summaryEmotes ?? []) {
    const np = portalEmoteLookupKey(emote)
    if (!np) continue
    const minuteMatch = merged.get(np)
    const imageUrl = absolutizeEmoteAssetUrl(emote.imageUrl ?? minuteMatch?.imageUrl)
    merged.set(np, {
      ...(minuteMatch ?? emote),
      ...emote,
      key: emote.key || minuteMatch?.key || np,
      imageUrl,
    })
  }

  for (const emote of channelEmotes ?? []) {
    const np = portalEmoteLookupKey(emote)
    if (!np) continue
    const existing = merged.get(np)
    const imageUrl = absolutizeEmoteAssetUrl(
      existing?.imageUrl ?? emote.imageUrl,
    )
    const id = existing?.id?.trim() || emote.id?.trim() || undefined
    if (existing) {
      merged.set(np, {
        ...existing,
        id: id ?? existing.id,
        imageUrl: imageUrl || existing.imageUrl,
        key: existing.key || emote.key,
      })
    } else {
      merged.set(np, {
        ...emote,
        key: emote.key || `${np}:${emote.name}`,
        imageUrl,
        count: emote.count ?? 0,
      })
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.count - a.count)
}

function portalChannelEmotesToCatalog(emotes: PortalChannelEmoteRow[]): AnalyticsTopEmote[] {
  const out: AnalyticsTopEmote[] = []
  for (const emote of emotes) {
    const name = emote.name.trim()
    if (!name) continue
    const provider = (emote.provider ?? 'unknown').toLowerCase()
    const id = emote.providerEmoteId?.trim() || undefined
    out.push({
      key: id ? `${provider}:${id}:${name}` : portalBucketEmoteKey({ name, provider }),
      name,
      id,
      provider,
      imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
      count: emote.useCount ?? 0,
    })
  }
  return out
}

/** Session-scoped: full timeline enrich once; live tails must not re-hit 30d catalog. */
const portalChannelEmotesCatalogInflight = new Map<string, Promise<AnalyticsTopEmote[]>>()

async function fetchPortalChannelEmotesCatalog(login: string): Promise<AnalyticsTopEmote[]> {
  const channel = login.trim()
  if (!channel) return []
  const key = channel.toLowerCase()
  const existing = portalChannelEmotesCatalogInflight.get(key)
  if (existing) return existing
  const pending = (async () => {
    try {
      const { data } = await apiClient<{ topEmotes?: PortalChannelEmoteRow[] }>(
        portalPath(`/channels/${encodeURIComponent(channel)}/emotes?range=30d`),
      )
      return portalChannelEmotesToCatalog(data.topEmotes ?? [])
    } catch {
      // Allow a later retry after a hard failure.
      portalChannelEmotesCatalogInflight.delete(key)
      return []
    }
  })()
  portalChannelEmotesCatalogInflight.set(key, pending)
  return pending
}

function absolutizeRecapEmote(emote: PulseRecapEmote): PulseRecapEmote {
  return {
    ...emote,
    imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
  }
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function isValidProvenanceNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validSignalObservations(
  observations: PortalSignalObservations | undefined,
): PortalSignalObservations | undefined {
  if (!observations || typeof observations !== 'object') return undefined
  const valid = Object.fromEntries(
    Object.entries(observations).filter(([, observation]) =>
      typeof observation.state === 'string'
      && observation.state.length > 0
      && isValidTimestamp(observation.observedAt)
      && (observation.coveragePct == null || (
        isValidProvenanceNumber(observation.coveragePct)
        && observation.coveragePct >= 0
        && observation.coveragePct <= 100
      ))
      && (observation.source == null || typeof observation.source === 'string')
      && (observation.value == null || isValidProvenanceNumber(observation.value)),
    ),
  )
  return Object.keys(valid).length > 0 ? valid : undefined
}

function validSignalWatermarks(
  watermarks: PortalSignalWatermarks | undefined,
): PortalSignalWatermarks | undefined {
  if (!watermarks || typeof watermarks !== 'object') return undefined
  const valid = Object.fromEntries(
    Object.entries(watermarks).filter(([, watermark]) =>
      typeof watermark.state === 'string'
      && watermark.state.length > 0
      && isValidTimestamp(watermark.observedThrough)
      && (watermark.coveragePct == null || (
        isValidProvenanceNumber(watermark.coveragePct)
        && watermark.coveragePct >= 0
        && watermark.coveragePct <= 100
      ))
      && (watermark.source == null || typeof watermark.source === 'string'),
    ),
  )
  return Object.keys(valid).length > 0 ? valid : undefined
}

function validPeakObservation(
  peakObservation: PortalPeakObservation | undefined,
): PortalPeakObservation | undefined {
  if (
    !peakObservation
    || typeof peakObservation.state !== 'string'
    || !peakObservation.state
    || !isValidTimestamp(peakObservation.observedAt)
    || !isValidProvenanceNumber(peakObservation.value)
    || (peakObservation.confirmed != null && typeof peakObservation.confirmed !== 'boolean')
    || (peakObservation.detector != null && typeof peakObservation.detector !== 'string')
  ) {
    return undefined
  }
  return peakObservation
}

export function assertPortalMinutesIntegrity(
  requestedStreamId: string,
  detail: { stream?: { streamId?: string; startedAt?: string; endedAt?: string | null } },
  minutes: PortalStreamMinutesResponse,
  nowMs = Date.now(),
): void {
  const requested = requestedStreamId.trim()
  const returned = minutes.streamId?.trim()
  const detailStreamId = detail.stream?.streamId?.trim()
  const startedAt = detail.stream?.startedAt
  const startedMs = Date.parse(startedAt ?? '')
  const responseStartedMs = Date.parse(minutes.startedAt ?? '')
  if (
    (!returned && !minutes.startedAt && (minutes.minutes?.length ?? 0) === 0)
  ) {
    return
  }
  if (
    !requested
    || !returned
    || returned !== requested
    || (detailStreamId && detailStreamId !== requested)
    || !Number.isFinite(startedMs)
    || !Number.isFinite(responseStartedMs)
    || Math.abs(startedMs - responseStartedMs) > 60_000
  ) {
    throw new SessionIdentityMismatchError({
      requestedStreamId: requested,
      returnedStreamId: returned,
      requestedStartedAt: startedAt,
      returnedStartedAt: minutes.startedAt,
    })
  }

  const endMs = detail.stream?.endedAt
    ? Date.parse(detail.stream.endedAt)
    : nowMs
  const effectiveEndMs = Number.isFinite(endMs) ? endMs : nowMs
  const maxOffsetSeconds = Math.max(
    0,
    Math.floor((effectiveEndMs - startedMs) / 1000),
  ) + 300
  const seen = new Set<number>()
  let duplicateOffsetCount = 0
  let outOfWindowCount = 0
  let invalidPointCount = 0
  let previousOffset = -1

  for (const point of minutes.minutes ?? []) {
    const offset = point.offsetSeconds
    if (!Number.isFinite(offset) || offset < 0 || !Number.isInteger(offset)) {
      invalidPointCount += 1
      continue
    }
    if (seen.has(offset)) duplicateOffsetCount += 1
    seen.add(offset)
    if (offset < previousOffset) invalidPointCount += 1
    previousOffset = offset
    if (offset > maxOffsetSeconds) outOfWindowCount += 1
  }

  if (duplicateOffsetCount || outOfWindowCount || invalidPointCount) {
    throw new TimelineIntegrityError({
      requestedStreamId: requested,
      returnedStreamId: returned,
      duplicateOffsetCount,
      outOfWindowCount,
      invalidPointCount,
      message: 'Timeline data is being repaired because minute buckets are not unique and session-scoped.',
    })
  }
}

export function assertPortalHeatmapIntegrity(
  requestedStreamId: string,
  response: { streamId?: string; points?: Array<{ streamId?: string; minuteTs?: string; offsetSeconds?: number }> },
  stream: { streamId?: string; startedAt?: string; endedAt?: string | null },
  nowMs = Date.now(),
): void {
  const requested = requestedStreamId.trim()
  const returned = response.streamId?.trim()
  const startedMs = Date.parse(stream.startedAt ?? '')
  const endedMs = stream.endedAt ? Date.parse(stream.endedAt) : nowMs
  let invalidPointCount = 0
  for (const point of response.points ?? []) {
    const pointMs = Date.parse(point.minuteTs ?? '')
    const pointStreamId = point.streamId?.trim()
    if (
      (pointStreamId && pointStreamId !== requested)
      || !Number.isFinite(pointMs)
      || (Number.isFinite(startedMs) && pointMs < startedMs - 60_000)
      || (Number.isFinite(endedMs) && pointMs > endedMs + 300_000)
      || (point.offsetSeconds != null && (!Number.isFinite(point.offsetSeconds) || point.offsetSeconds < 0))
    ) {
      invalidPointCount += 1
    }
  }
  if (!requested || returned !== requested || invalidPointCount > 0) {
    throw new HeatmapIntegrityError({
      requestedStreamId: requested,
      returnedStreamId: returned,
      invalidPointCount,
      message: 'Moment ranking is temporarily unavailable because the server returned cross-session data.',
    })
  }
}

function absolutizeRecapMoment(moment: PortalRecapMoment): PulseRecapMoment {
  const { peakObservation, ...rest } = moment
  const normalized = {
    ...rest,
    topEmotes: moment.topEmotes?.map(absolutizeRecapEmote),
    ...(validPeakObservation(peakObservation)
      ? { peakObservation }
      : {}),
  }
  return normalized as PulseRecapMoment
}

function normalizePulseStreamRecap(recap: PortalStreamRecapResponse): PulseStreamRecap {
  return {
    ...recap,
    topEmotes: recap.topEmotes?.map(absolutizeRecapEmote),
    topMoments: recap.topMoments?.map(absolutizeRecapMoment),
    clipCandidates: recap.clipCandidates?.map(absolutizeRecapMoment),
  }
}

/**
 * Per-minute bucket emotes are sanitized server-side (name + provider + a
 * pre-resolved public CDN `imageUrl`, no raw provider id ΓÇö see BucketEmote in
 * portal_analytics_api.go). The synthetic key below only needs to be stable
 * and unique per name+provider; the image renders straight from `imageUrl`
 * via `resolveEmoteImageUrl`'s imageUrl-first precedence, so no real provider
 * id is required for the emote thumbnail to load correctly on the portal.
 */
/** @internal exported for unit tests — rebuilds chart rollups from portal /minutes. */
export function portalMinutesToRollups(
  startedAt: string,
  minutes: PortalMinutePoint[],
): { rollups: AnalyticsMinuteRollup[]; catalog: AnalyticsTopEmote[] } {
  const startMs = Date.parse(startedAt)
  if (!Number.isFinite(startMs)) return { rollups: [], catalog: [] }
  const catalogByKey = new Map<string, AnalyticsTopEmote>()
  const rollups = minutes.map((minute) => {
    const minuteMs = startMs + minute.offsetSeconds * 1000
    const seventv = minute.seventvEmoteCount ?? 0
    const chat = minute.chatCount ?? 0
    const viewerLatest = minute.viewerLatest ?? minute.viewerMax ?? minute.viewerAvg ?? 0
    const emotes: Record<string, number> = {}
    // Prefer authoritative totalEmoteCount from portal minutes when present.
    // Fallback: seventv + non-7TV top emotes only (legacy API without total field).
    let nonSeventvTop = 0
    for (const emote of minute.topEmotes ?? []) {
      const key = portalBucketEmoteKey(emote)
      if (!key) continue
      emotes[key] = emote.count
      if ((emote.provider ?? '').toLowerCase() !== 'seventv') {
        nonSeventvTop += emote.count
      }
      const existing = catalogByKey.get(key)
      catalogByKey.set(key, {
        key,
        name: emote.name.trim(),
        provider: emote.provider,
        imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
        count: (existing?.count ?? 0) + emote.count,
      })
    }
    const totalEmoteCount =
      minute.totalEmoteCount != null && minute.totalEmoteCount > 0
        ? minute.totalEmoteCount
        : seventv + nonSeventvTop
    return {
      minuteTs: new Date(minuteMs).toISOString(),
      viewerAvg: minute.viewerAvg ?? 0,
      viewerMax: minute.viewerMax ?? 0,
      viewerLatest,
      ...(isValidProvenanceNumber(minute.viewerSamples) && minute.viewerSamples >= 0
        ? { viewerSamples: minute.viewerSamples }
        : {}),
      chatCount: chat,
      totalEmoteCount,
      seventvEmoteCount: seventv,
      emotes,
      missing: minute.missing,
      ...(validSignalObservations(minute.signalObservations)
        ? { signalObservations: minute.signalObservations }
        : {}),
    }
  })
  return { rollups, catalog: Array.from(catalogByKey.values()) }
}

async function fetchPortalStreamBundle(
  streamId: string,
  includeMinutes: boolean,
  channelLogin?: string,
  opts?: { enrichChannelEmotes?: boolean; includeSummary?: boolean },
  requestOptions?: PortalRequestOptions,
) {
  markPortalPerformance('session-detail-start')
  const enrichEmotes = opts?.enrichChannelEmotes === true
  const includeSummary = opts?.includeSummary !== false && includeMinutes
  const { data: detail } = await apiClient<PortalStreamDetail>(
    portalPath(`/streams/${encodeURIComponent(streamId)}`),
    { signal: requestOptions?.signal },
  )
  markPortalPerformance('session-detail-complete')
  const returnedStreamId = detail.stream?.streamId?.trim()
  if (!returnedStreamId || returnedStreamId !== streamId.trim()) {
    if (import.meta.env.DEV) {
      console.warn('[streamcloneAnalytics] session identity mismatch', {
        requestedStreamId: streamId.trim(),
        returnedStreamId,
      })
    }
    throw new SessionIdentityMismatchError({
      requestedStreamId: streamId.trim(),
      returnedStreamId,
      requestedStartedAt: undefined,
      returnedStartedAt: detail.stream?.startedAt,
    })
  }

  let minutesFetchFailed = false
  const minutesPromise = includeMinutes
    ? apiClient<PortalStreamMinutesResponse>(
        portalPath(`/streams/${encodeURIComponent(streamId)}/minutes`),
        {
          timeoutMs: PORTAL_MINUTES_TIMEOUT_MS,
          signal: requestOptions?.signal,
        },
      )
        .then((res) => {
          assertPortalMinutesIntegrity(streamId, detail, res.data)
          markPortalPerformance('minutes-complete')
          return res
        })
        .then((res) => res)
        .catch((error) => {
          if (isSessionDataError(error) || (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout'))) {
            throw error
          }
          minutesFetchFailed = true
          if (import.meta.env.DEV) {
            console.warn(`[streamcloneAnalytics] portal minutes unavailable for stream ${streamId}`)
          }
          return null
        })
    : Promise.resolve(null)
  const summaryPromise = includeSummary
    ? fetchPortalStreamSummary(streamId, requestOptions)
    : Promise.resolve(null)

  const [minutesRes, summaryRes] = await Promise.all([
    minutesPromise,
    summaryPromise,
  ])

  // summaryRes is PortalStreamSummary | null (already unwrapped)
  const summaryData = summaryRes

  let channelEmotes: AnalyticsTopEmote[] = []
  // Lightweight sparse/status polls must not pull the 30-day channel catalog.
  if (enrichEmotes && !usesLocalAnalyticsRoutes()) {
    const login =
      channelLogin?.trim()
      || detail.stream?.login?.trim()
      || detail.channel?.trim()
      || ''
    if (login) {
      channelEmotes = await fetchPortalChannelEmotesCatalog(login)
    }
  }

  return {
    detail,
    minutes: minutesRes?.data ?? null,
    summary: summaryData,
    channelEmotes,
    minutesFetchFailed,
    includeMinutes,
  }
}

function mergePortalSourceRows(
  sources?: Array<{ source: string; state: string; label?: string }>,
  badges?: Array<{ source: string; state: string; label?: string }>,
): Array<{ source: string; state: string; label?: string }> {
  const bySource = new Map<string, { source: string; state: string; label?: string }>()
  for (const row of sources ?? []) {
    bySource.set(row.source, row)
  }
  for (const badge of badges ?? []) {
    const existing = bySource.get(badge.source)
    if (!existing || (badge.label?.trim() && !existing.label?.trim())) {
      bySource.set(badge.source, badge)
    }
  }
  return Array.from(bySource.values())
}

function portalLiveResponseToAnalytics(
  data: PortalChannelLiveResponse,
  channelEmotes?: AnalyticsTopEmote[],
): AnalyticsStreamDetail {
  const stream = data.stream
  const minutesResult =
    stream?.startedAt && data.rollups?.length
      ? portalMinutesToRollups(stream.startedAt, data.rollups)
      : null
  const topEmotes = mergePortalTopEmotes(
    minutesResult?.catalog ?? data.topEmotes ?? [],
    data.topEmotes,
    channelEmotes,
  )
  const rollups = alignRollupEmoteKeys(minutesResult?.rollups ?? [], topEmotes)
  const chartRollups = rollups.length > 240
    ? downsampleTimeline(rollups, undefined, rollupChartActivityScore)
    : rollups
  return {
    channel: data.channel,
    state: data.state,
    stream: stream
      ? {
          streamId: stream.streamId,
          login: stream.login,
          displayName: stream.displayName,
          title: stream.title,
          category: stream.category,
          startedAt: stream.startedAt,
          endedAt: stream.endedAt,
          currentViewers: stream.currentViewers,
          peakViewers: stream.peakViewers,
          viewerSamples: stream.viewerSamples,
          chatMessages: stream.chatMessages,
          vodId: stream.vodId ?? data.vodId,
        }
      : undefined,
    rollups: chartRollups,
    momentRollups: rollups.length > 0 ? rollups : undefined,
    topEmotes,
    sources: (data.sources ?? []).map((source) => ({
      source: source.source,
      state: source.state,
      label: source.label,
    })),
    updatedAt: data.updatedAt,
    vodId: data.vodId ?? stream?.vodId,
    syncPhase: data.syncPhase,
    viewerSource: data.viewerSource,
    coverageStartOffsetSeconds:
      data.coverageStartOffsetSeconds
      ?? data.availability?.missingRanges?.[0]?.toOffsetSeconds,
    analyticsQuality: data.analyticsQuality,
    chatCoveragePct: data.chatCoveragePct ?? data.availability?.coveragePct,
    availability: data.availability
      ? {
          version: data.availability.version,
          chartUsable: data.availability.chartUsable,
          chartState: data.availability.chartState,
          coveragePct: data.availability.coveragePct ?? data.chatCoveragePct,
          missingRanges: data.availability.missingRanges,
          coverageMessage: data.availability.coverageMessage,
          liveDvrState: data.availability.liveDvrState,
          vodState: data.availability.vodState,
          vodId: data.availability.vodId ?? data.vodId ?? stream?.vodId,
          vodMessage: data.availability.vodMessage,
          backfillState: data.availability.backfillState,
          corpusState: data.availability.corpusState,
          corpusMessage: data.availability.corpusMessage,
        }
      : undefined,
    ...(validSignalWatermarks(data.signalWatermarks)
      ? { signalWatermarks: data.signalWatermarks }
      : {}),
  } as AnalyticsStreamDetail
}
function portalDetailToAnalytics(
  detail: PortalStreamDetail,
  minutes: PortalStreamMinutesResponse | null,
  summary: PortalStreamSummary | null,
  opts?: { includeMinutes?: boolean; minutesFetchFailed?: boolean; channelEmotes?: AnalyticsTopEmote[] },
): AnalyticsStreamDetail {
  const stream = detail.stream
  const minutesResult =
    minutes && stream?.startedAt ? portalMinutesToRollups(stream.startedAt, minutes.minutes ?? []) : null
  const rawMinuteCount = minutes?.minutes?.length ?? minutesResult?.rollups.length ?? 0
  const momentRollups = minutesResult?.rollups ?? []
  const mergedTopEmotes = mergePortalTopEmotes(
    minutesResult?.catalog ?? [],
    summary?.topEmotes,
    opts?.channelEmotes,
  )
  const alignedMomentRollups = alignRollupEmoteKeys(momentRollups, mergedTopEmotes)
  const rollups = minutesResult
    ? downsampleTimeline(alignedMomentRollups, undefined, rollupChartActivityScore)
    : []
  const minutesUnavailable = Boolean(
    opts?.includeMinutes
    && (opts.minutesFetchFailed || !minutes || rawMinuteCount === 0),
  )
  return {
    channel: detail.channel,
    state: detail.state,
    stream: stream
      ? {
          streamId: stream.streamId,
          login: stream.login,
          displayName: stream.displayName,
          title: stream.title,
          category: stream.category,
          startedAt: stream.startedAt,
          endedAt: stream.endedAt,
          currentViewers: stream.currentViewers,
          peakViewers: stream.peakViewers,
          viewerSamples: stream.viewerSamples,
          chatMessages: stream.chatMessages,
          vodId: stream.vodId ?? detail.vodId,
        }
      : undefined,
    rollups,
    momentRollups: alignedMomentRollups.length > 0 ? alignedMomentRollups : undefined,
    topEmotes: mergedTopEmotes,
    sources: mergePortalSourceRows(detail.sources, detail.dataSourceBadges).map((source) => ({
      source: source.source,
      state: source.state,
      label: source.label,
    })),
    updatedAt: detail.updatedAt,
    vodId: detail.vodId ?? stream?.vodId,
    vodAlignSeconds: typeof detail.vodAlignSeconds === 'number' && Number.isFinite(detail.vodAlignSeconds)
      ? detail.vodAlignSeconds
      : undefined,
    syncPhase: detail.syncPhase,
    chatCoveragePct: detail.chatCoveragePct,
    timelineMinutes: rawMinuteCount > 0 ? rawMinuteCount : rollups.length,
    analyticsQuality: summary?.analyticsQuality ?? detail.analyticsQuality,
    viewerSource: detail.viewerSource,
    coverageStartOffsetSeconds:
      minutes?.coverageStartOffsetSeconds
      ?? detail.availability?.missingRanges?.[0]?.toOffsetSeconds,
    minutesUnavailable,
    availability: detail.availability
      ? {
          version: detail.availability.version,
          chartUsable: detail.availability.chartUsable,
          chartState: detail.availability.chartState,
          coveragePct: detail.availability.coveragePct ?? detail.chatCoveragePct,
          missingRanges: detail.availability.missingRanges,
          coverageMessage: detail.availability.coverageMessage,
          liveDvrState: detail.availability.liveDvrState,
          vodState: detail.availability.vodState,
          vodId: detail.availability.vodId ?? detail.vodId ?? stream?.vodId,
          vodMessage: detail.availability.vodMessage,
          backfillState: detail.availability.backfillState,
          corpusState: detail.availability.corpusState,
          corpusMessage: detail.availability.corpusMessage,
        }
      : undefined,
    ...(validSignalWatermarks(detail.signalWatermarks ?? minutes?.signalWatermarks)
      ? { signalWatermarks: detail.signalWatermarks ?? minutes?.signalWatermarks }
      : {}),
  } as AnalyticsStreamDetail
}

export const portalAnalyticsApi: AnalyticsApi = {
  async ensureChannelEmotes(login: string, twitchId: string, providers?: string[]) {
    return apiClient(portalPath(`/channels/${encodeURIComponent(login)}/emotes`), {
      // Channel emote intel is public aggregate data on hosted.
    }).then((res) => res.data)
  },

  async getAnalyticsStream(streamId: string, opts?: AnalyticsStreamOptions) {
    if (!streamId) return null
    if (usesLocalAnalyticsRoutes()) {
      const params = new URLSearchParams({ sparse: opts?.sparse === false ? 'false' : 'true' })
      if (opts?.channel) params.set('channel', opts.channel)
      const { data } = await apiClient<AnalyticsStreamDetail>(
        analyticsPath(`/streams/${encodeURIComponent(streamId)}?${params.toString()}`),
        { signal: opts?.signal },
      )
      if (data.stream?.streamId?.trim() !== streamId.trim()) {
        throw new SessionIdentityMismatchError({
          requestedStreamId: streamId.trim(),
          returnedStreamId: data.stream?.streamId,
          returnedStartedAt: data.stream?.startedAt,
        })
      }
      return data
    }
    const includeMinutes = opts?.sparse !== true
    const bundle = await fetchPortalStreamBundle(streamId, includeMinutes, opts?.channel, {
      // Summary and channel emotes are staged after the first chart paint.
      enrichChannelEmotes: false,
      includeSummary: false,
    }, { signal: opts?.signal })
    return portalDetailToAnalytics(bundle.detail, bundle.minutes, bundle.summary, {
      includeMinutes,
      minutesFetchFailed: bundle.minutesFetchFailed,
      channelEmotes: bundle.channelEmotes,
    })
  },

  async getStreamStatus(streamId: string, options?: PortalRequestOptions) {
    if (!streamId) return null
    if (usesLocalAnalyticsRoutes()) return null
    const { data } = await apiClient<{
      channel?: string
      state?: string
      syncPhase?: string
      streamId?: string
      vodId?: string
      analyticsQuality?: string
      dataCoveragePct?: number
      chatCoveragePct?: number
      updatedAt?: number
      availability?: PortalSessionAvailability
      }>(portalPath(`/streams/${encodeURIComponent(streamId)}/status`), { signal: options?.signal })
    return data
  },

  async getStreamMinutesTail(streamId: string, afterOffset: number, options?: PortalRequestOptions) {
    if (!streamId || !Number.isFinite(afterOffset) || afterOffset < 0) return null
    if (usesLocalAnalyticsRoutes()) return null
    const params = new URLSearchParams({ afterOffset: String(Math.floor(afterOffset)) })
    const { data } = await apiClient<PortalStreamMinutesResponse>(
      portalPath(`/streams/${encodeURIComponent(streamId)}/minutes?${params.toString()}`),
      { timeoutMs: PORTAL_MINUTES_TIMEOUT_MS, signal: options?.signal },
    )
    if (!data?.minutes?.length || !data.startedAt) {
      return { channel: data?.channel ?? '', state: 'live', rollups: [], topEmotes: [], sources: [], updatedAt: data?.updatedAt ?? Date.now() }
    }
    assertPortalMinutesIntegrity(streamId, {
      stream: { streamId: data.streamId, startedAt: data.startedAt },
    }, data)
    const converted = portalMinutesToRollups(data.startedAt, data.minutes)
    return {
      channel: data.channel,
      state: 'live',
      rollups: converted.rollups,
      topEmotes: converted.catalog,
      sources: [],
      updatedAt: data.updatedAt,
    } as AnalyticsStreamDetail
  },

  async getAnalyticsStreams(login: string, limit = 20, options?: PortalRequestOptions): Promise<AnalyticsStreamsResponse> {
    const path = usesLocalAnalyticsRoutes()
      ? analyticsPath(`/channels/${encodeURIComponent(login)}/streams?limit=${Math.max(1, limit)}`)
      : portalPath(`/channels/${encodeURIComponent(login)}/streams?limit=${Math.max(1, limit)}`)
    const { data } = await apiClient<AnalyticsStreamsResponse>(path, { signal: options?.signal })
    return data
  },

  async getAnalyticsLive(login: string, options?: PortalRequestOptions): Promise<AnalyticsStreamDetail> {
    if (usesLocalAnalyticsRoutes()) {
      try {
        // Sparse live status — full minute timelines are loaded via session detail, not polled.
        const params = new URLSearchParams({ sparse: 'true' })
        const { data } = await apiClient<AnalyticsStreamDetail>(
          analyticsPath(`/channels/${encodeURIComponent(login)}/live?${params.toString()}`),
          { signal: options?.signal },
        )
        return data
      } catch (error) {
        if (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout')) throw error
        return {
          channel: login,
          state: 'not_collected',
          rollups: [],
          topEmotes: [],
          sources: [],
          updatedAt: Date.now(),
        }
      }
    }
    try {
      const { data } = await apiClient<PortalChannelLiveResponse>(
        portalPath(`/channels/${encodeURIComponent(login)}/live`),
        { signal: options?.signal },
      )
      if (!data.stream?.streamId?.trim()) {
        return portalLiveResponseToAnalytics(data)
      }
      if (data.rollups?.length) {
        assertPortalMinutesIntegrity(data.stream.streamId, {
          stream: data.stream,
        }, {
          streamId: data.stream.streamId,
          channel: data.channel,
          startedAt: data.stream.startedAt,
          minutes: data.rollups,
          updatedAt: data.updatedAt,
        })
      }
      return portalLiveResponseToAnalytics(data)
    } catch (error) {
      if (isSessionDataError(error) || (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout'))) {
        throw error
      }
      return {
        channel: login,
        state: 'not_collected',
        rollups: [],
        topEmotes: [],
        sources: [],
        updatedAt: Date.now(),
      }
    }
  },

  async getStreamSummary(streamId: string, channel?: string, options?: PortalRequestOptions) {
    if (!streamId.trim()) return null
    if (usesLocalAnalyticsRoutes()) {
      try {
        const params = new URLSearchParams()
        if (channel) params.set('channel', channel)
        const suffix = params.toString() ? `?${params.toString()}` : ''
        const { data } = await apiClient<{
          metrics?: PortalStreamSummaryMetrics
          stream?: PortalStreamRecord
          updatedAt?: number
        }>(analyticsPath(`/streams/${encodeURIComponent(streamId)}/summary${suffix}`), { signal: options?.signal })
        if (data.stream?.streamId && data.stream.streamId !== streamId.trim()) {
          throw new SessionIdentityMismatchError({
            requestedStreamId: streamId.trim(),
            returnedStreamId: data.stream.streamId,
            returnedStartedAt: data.stream.startedAt,
          })
        }
        const metrics = data.metrics
        let analyticsQuality: string | undefined
        if (metrics?.sync_health_state === 'synced' && (metrics.data_coverage_pct ?? 0) >= 80) {
          analyticsQuality = 'full_pulse'
        } else if ((metrics?.minutesWithData ?? 0) > 0) {
          analyticsQuality = 'partial_pulse'
        } else if (metrics?.sync_health_state === 'syncing') {
          analyticsQuality = 'syncing'
        } else {
          analyticsQuality = 'limited'
        }
        return { metrics, analyticsQuality, updatedAt: data.updatedAt }
      } catch {
        return null
      }
    }
    return fetchPortalStreamSummary(streamId, options)
  },

  async getPulseBookmarks(_params?: PulseBookmarkQuery) {
    if (!portalBookmarksSupported()) {
      return bookmarkUnavailableResponse()
    }
    return { items: [], supported: true as const }
  },

  async getPulseStreamRecap(streamId: string, options?: PortalRequestOptions): Promise<PulseStreamRecap | null> {
    try {
      const { data } = await apiClient<PortalStreamRecapResponse>(
        portalPath(`/streams/${encodeURIComponent(streamId)}/recap`),
        { signal: options?.signal },
      )
      return normalizePulseStreamRecap(data)
    } catch (error) {
      if (isSessionDataError(error) || (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout'))) {
        throw error
      }
      return null
    }
  },

  async getTimeseriesStatus() {
    return apiClient(analyticsPath('/timeseries/status')).then((res) => res.data)
  },

  async createPulseBookmark() {
    if (!portalBookmarksSupported()) {
      throw new Error('Saved moments are a private beta feature ΓÇö public analytics is read-only.')
    }
    throw new Error('Bookmarks require a beta key ΓÇö use the private dashboard.')
  },

  async deletePulseBookmark() {
    if (!portalBookmarksSupported()) {
      throw new Error('Saved moments are a private beta feature ΓÇö public analytics is read-only.')
    }
    throw new Error('Bookmarks require a beta key ΓÇö use the private dashboard.')
  },

  /**
   * Soft-beta portal does not hold operator credentials. Prefetch-tracker is
   * operator-only (Access JWT / archive token) — do not POST with a beta key
   * and silently map 401/403 to "skipped".
   */
  async prefetchAnalyticsTracker(_streamId: string, _channel: string) {
    return { status: 'skipped' as const, reason: 'operator_only' as const }
  },

  async getChannel(login: string) {
    return apiClient(analyticsPath(`/channels/${encodeURIComponent(login)}`)).then((res) => res.data)
  },

  async getChannelStreamHistory(login: string, period?: string) {
    if (usesLocalAnalyticsRoutes()) {
      const suffix = period ? `?period=${encodeURIComponent(period)}` : ''
      return apiClient(analyticsPath(`/channels/${encodeURIComponent(login)}/streams/ranked${suffix}`)).then(
        (res) => res.data,
      )
    }
    const limit = period === 'all' ? 100 : 50
    const { data } = await apiClient<{
      channel: string
      items: PortalStreamRecord[]
      updatedAt: number
    }>(portalPath(`/channels/${encodeURIComponent(login)}/streams?limit=${limit}`))
    return {
      channel: data.channel,
      items: (data.items ?? []).map((item) => ({
        streamId: item.streamId,
        id: item.streamId,
        displayName: item.displayName ?? item.login,
        title: item.title,
        category: item.category,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        peakViewers: item.peakViewers,
        viewerSamples: item.viewerSamples,
        chatMessages: item.chatMessages,
        vodId: item.vodId,
      })),
      updatedAt: data.updatedAt,
    }
  },

  async watchAnalyticsChannel(login: string) {
    try {
      await apiClient(analyticsPath(`/channels/${encodeURIComponent(login)}/watch`), {
        method: 'POST',
        gated: true,
      })
    } catch {
      // Public portal reads do not require watch registration.
    }
    return { ok: true }
  },

  async getSyncStatus(streamId: string, options?: PortalRequestOptions): Promise<SyncStatus | null> {
    try {
      if (usesLocalAnalyticsRoutes()) {
        const { data } = await apiClient<SyncStatus & { phase?: string }>(
          analyticsPath(`/streams/${encodeURIComponent(streamId)}/sync/status`),
          { signal: options?.signal },
        )
        if (data.phase === 'idle') return null
        return { ...data, streamId }
      }
      const { data } = await apiClient<PortalSyncStatus>(
        portalPath(`/streams/${encodeURIComponent(streamId)}/sync/status`),
        { signal: options?.signal },
      )
      return {
        streamId,
        phase: data.phase,
        message: data.message,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
        stale: data.stale,
      }
    } catch (error) {
      if (isSessionDataError(error) || (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout'))) {
        throw error
      }
      return null
    }
  },

  async startHistoricalSync(streamId: string, login?: string, options?: StartHistoricalSyncOptions) {
    if (!usesLocalAnalyticsRoutes()) {
      throw new Error('Operator sync is not available on the public StreamPulse portal.')
    }
    const params = new URLSearchParams()
    if (login) params.set('channel', login)
    if (options?.viewersOnly) params.set('viewers_only', 'true')
    if (options?.forceChat) params.set('force_chat', 'true')
    if (options?.vodId) params.set('vod_id', options.vodId)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    return apiClient(analyticsPath(`/streams/${encodeURIComponent(streamId)}/sync${suffix}`), {
      method: 'POST',
      gated: true,
    }).then((res) => res.data)
  },

  async getStreamGameSegments(streamId: string, options?: PortalRequestOptions): Promise<GameSegment[]> {
    try {
      const { data } = await apiClient<GameSegment[]>(gamesEndpoint(streamId), { signal: options?.signal })
      if (Array.isArray(data)) {
        const wrong = data.find((segment) => segment.streamId && segment.streamId !== streamId)
        if (wrong) {
          throw new SessionIdentityMismatchError({
            requestedStreamId: streamId,
            returnedStreamId: wrong.streamId,
          })
        }
        return data
      }
    } catch (error) {
      if (isSessionDataError(error) || (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout'))) {
        throw error
      }
      /* backend is source of truth; do not synthesize a misleading single-game span */
    }
    return []
  },

  async getReplayHeatmap(streamId: string, window = 60, channel?: string, options?: PortalRequestOptions) {
    const params = new URLSearchParams({ window: String(window) })
    if (channel) params.set('channel', channel)
    try {
      const { data } = await apiClient<{
        streamId: string
        points: Array<{ streamId?: string; minuteTs?: string; offsetSeconds?: number }>
        [key: string]: unknown
      }>(
        portalPath(`/streams/${encodeURIComponent(streamId)}/replay-heatmap?${params.toString()}`),
        { signal: options?.signal },
      )
      assertPortalHeatmapIntegrity(streamId, data, { streamId })
      return data
    } catch (error) {
      if (isSessionDataError(error) || (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout'))) {
        throw error
      }
      return null
    }
  },

  async getReplayHeatmapDetail(streamId: string, window = 60, channel?: string, options?: PortalRequestOptions) {
    const params = new URLSearchParams({ window: String(window), detail: 'true' })
    if (channel) params.set('channel', channel)
    try {
      return apiClient(
        portalPath(`/streams/${encodeURIComponent(streamId)}/replay-heatmap?${params.toString()}`),
        { signal: options?.signal },
      ).then((res) => res.data)
    } catch (error) {
      if (isSessionDataError(error) || (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout'))) {
        throw error
      }
      return null
    }
  },

  async getVodStoryboardThumb(_vodId: string, _offsetSec: number) {
    return null
  },

  async getTwitchDayClips(login: string, startedAt: string, endedAt: string) {
    if (!login.trim() || !startedAt || !endedAt) return { items: [] }
    const params = new URLSearchParams({ startedAt, endedAt })
    try {
      const { data } = await apiClient<{ items?: Array<{ id: string; url: string; title: string; thumbnailUrl?: string; durationSeconds?: number; viewCount?: number; creatorName?: string }> }>(
        `/v1/channels/${encodeURIComponent(login)}/clips?${params.toString()}`,
      )
      return { items: data?.items ?? [] }
    } catch {
      return { items: [] }
    }
  },

  async getSetupWelcome(): Promise<SetupWelcome> {
    return {
      profile: 'portal',
      services: {},
      incomplete: false,
      showWelcome: false,
    }
  },
}

let configured = false

/** Session-scoped: avoid re-hitting /summary when detail+summaryQuery overlap on live ticks. */
const portalStreamSummaryInflight = new Map<string, Promise<PortalStreamSummary | null>>()

export async function fetchPortalStreamSummary(
  streamId: string,
  options?: PortalRequestOptions,
): Promise<PortalStreamSummary | null> {
  if (!streamId.trim()) return null
  const key = streamId.trim()
  const existing = portalStreamSummaryInflight.get(key)
  if (existing) return existing
  const pending = (async () => {
    try {
      const { data } = await apiClient<PortalStreamSummary>(
        portalPath(`/streams/${encodeURIComponent(streamId)}/summary`),
        { signal: options?.signal },
      )
      if (data.stream?.streamId && data.stream.streamId !== streamId.trim()) {
        throw new SessionIdentityMismatchError({
          requestedStreamId: streamId.trim(),
          returnedStreamId: data.stream.streamId,
          returnedStartedAt: data.stream.startedAt,
        })
      }
      if (!data.topEmotes?.length) return data
      return {
        ...data,
        topEmotes: data.topEmotes.map((emote) => ({
          ...emote,
          imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
        })),
      }
    } catch (error) {
      portalStreamSummaryInflight.delete(key)
      if (isSessionDataError(error) || (isApiError(error) && (error.kind === 'aborted' || error.kind === 'timeout'))) {
        throw error
      }
      return null
    }
  })()
  portalStreamSummaryInflight.set(key, pending)
  return pending
}

export async function fetchPortalStreamRecap(streamId: string): Promise<PortalStreamRecapResponse | null> {
  if (!streamId.trim()) return null
  try {
    const { data } = await apiClient<PortalStreamRecapResponse>(portalPath(`/streams/${encodeURIComponent(streamId)}/recap`))
    return data
  } catch {
    return null
  }
}

export function formatStreamOffset(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function setupStreamcloneAnalyticsApi(): void {
  if (configured) return
  configureAnalyticsApi(portalAnalyticsApi)
  configureEmoteAssetBase(() => getBackendUrl())
  configured = true
}
