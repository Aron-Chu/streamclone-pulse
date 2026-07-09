import {
  configureAnalyticsApi,
  configureEmoteAssetBase,
  minuteRollupSpanSeconds,
  type AnalyticsApi,
  type AnalyticsStreamOptions,
  type PulseBookmarkQuery,
  type SetupWelcome,
  type StartHistoricalSyncOptions,
} from '@streamclone/analytics-console'
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
} from '@streamclone/analytics-console'
import { apiClient, getBackendUrl } from './apiClient'
import { resolveBackendSource } from './backendSource'
import { hasBetaKey } from './auth'
import { absolutizeEmoteAssetUrl } from './emoteAssetUrl'
import { downsampleTimeline, PORTAL_MINUTES_TIMEOUT_MS, rollupChartActivityScore } from './timelineDownsample'

/**
 * Portal analytics adapter — reshapes hosted `/v1/portal/analytics/*` for
 * `@streamclone/analytics-console`.
 *
 * - **Chart minutes:** `downsampleTimeline()` to ~240 points on hosted API (prod).
 *   Local `:8090` is opt-in only (`npm run dev:local`); channel emote catalog fetch is skipped on local.
 * - **Top emotes:** `mergePortalTopEmotes()` — stream summary totals win over
 *   per-minute bucket catalog counts; channel emote identity (`/channels/{login}/emotes`)
 *   fills imageUrl/id gaps for recap-only or low-usage emotes.
 * - **VOD links:** client resolves `detail.vodId ?? stream.vodId ?? recap.vodId`
 *   for Selected Moment “Open on Twitch”.
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
}

interface PortalMinutePoint {
  offsetSeconds: number
  viewerAvg?: number
  viewerMax?: number
  viewerLatest?: number
  chatCount?: number
  totalEmoteCount?: number
  seventvEmoteCount?: number
  missing?: boolean
  topEmotes?: Array<{ name: string; provider?: string; imageUrl?: string; count: number }>
}

interface PortalStreamMinutesResponse {
  streamId: string
  channel: string
  startedAt: string
  coverageStartOffsetSeconds?: number
  minutes: PortalMinutePoint[]
  updatedAt: number
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

/** Bookmarks require a beta-key principal — not available on public no-login /analytics. */
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

const PLACEHOLDER_CATEGORIES = /^(live|syncing\.{3}|syncing…)$/i

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

async function fetchPortalChannelEmotesCatalog(login: string): Promise<AnalyticsTopEmote[]> {
  const channel = login.trim()
  if (!channel) return []
  try {
    const { data } = await apiClient<{ topEmotes?: PortalChannelEmoteRow[] }>(
      portalPath(`/channels/${encodeURIComponent(channel)}/emotes?range=30d`),
    )
    return portalChannelEmotesToCatalog(data.topEmotes ?? [])
  } catch {
    return []
  }
}

function absolutizeRecapEmote(emote: PulseRecapEmote): PulseRecapEmote {
  return {
    ...emote,
    imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
  }
}

function absolutizeRecapMoment(moment: PulseRecapMoment): PulseRecapMoment {
  if (!moment.topEmotes?.length) return moment
  return {
    ...moment,
    topEmotes: moment.topEmotes.map(absolutizeRecapEmote),
  }
}

function normalizePulseStreamRecap(recap: PulseStreamRecap): PulseStreamRecap {
  return {
    ...recap,
    topEmotes: recap.topEmotes?.map(absolutizeRecapEmote),
    topMoments: recap.topMoments?.map(absolutizeRecapMoment),
    clipCandidates: recap.clipCandidates?.map(absolutizeRecapMoment),
  }
}

/**
 * Per-minute bucket emotes are sanitized server-side (name + provider + a
 * pre-resolved public CDN `imageUrl`, no raw provider id — see BucketEmote in
 * portal_analytics_api.go). The synthetic key below only needs to be stable
 * and unique per name+provider; the image renders straight from `imageUrl`
 * via `resolveEmoteImageUrl`'s imageUrl-first precedence, so no real provider
 * id is required for the emote thumbnail to load correctly on the portal.
 */
function portalMinutesToRollups(
  startedAt: string,
  minutes: PortalMinutePoint[],
): { rollups: AnalyticsMinuteRollup[]; catalog: AnalyticsTopEmote[] } {
  const startMs = Date.parse(startedAt)
  if (!Number.isFinite(startMs)) return { rollups: [], catalog: [] }
  const catalogByKey = new Map<string, AnalyticsTopEmote>()
  const rollups = minutes.map((minute) => {
    const minuteMs = startMs + Math.max(0, minute.offsetSeconds) * 1000
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
      viewerSamples: viewerLatest > 0 ? 1 : 0,
      chatCount: chat,
      totalEmoteCount,
      seventvEmoteCount: seventv,
      emotes,
      missing: minute.missing,
    }
  })
  return { rollups, catalog: Array.from(catalogByKey.values()) }
}

async function fetchPortalStreamBundle(streamId: string, includeMinutes: boolean, channelLogin?: string) {
  const detailPromise = apiClient<PortalStreamDetail>(portalPath(`/streams/${encodeURIComponent(streamId)}`))
  let minutesFetchFailed = false
  const minutesPromise = includeMinutes
    ? apiClient<PortalStreamMinutesResponse>(portalPath(`/streams/${encodeURIComponent(streamId)}/minutes`), {
        timeoutMs: PORTAL_MINUTES_TIMEOUT_MS,
      })
        .then((res) => res)
        .catch(() => {
          minutesFetchFailed = true
          if (import.meta.env.DEV) {
            console.warn(`[streamcloneAnalytics] portal minutes unavailable for stream ${streamId}`)
          }
          return null
        })
    : Promise.resolve(null)
  const summaryPromise = apiClient<PortalStreamSummary>(
    portalPath(`/streams/${encodeURIComponent(streamId)}/summary`),
  ).catch(() => null)
  const channelEmotesPromise =
    channelLogin?.trim() && !usesLocalAnalyticsRoutes()
      ? fetchPortalChannelEmotesCatalog(channelLogin.trim())
      : null

  const [detailRes, minutesRes, summaryRes] = await Promise.all([
    detailPromise,
    minutesPromise,
    summaryPromise,
  ])

  let channelEmotes: AnalyticsTopEmote[] = []
  if (channelEmotesPromise) {
    channelEmotes = await channelEmotesPromise
  } else if (!usesLocalAnalyticsRoutes()) {
    const login =
      channelLogin?.trim()
      || detailRes.data.stream?.login?.trim()
      || detailRes.data.channel?.trim()
      || ''
    if (login) {
      channelEmotes = await fetchPortalChannelEmotesCatalog(login)
    }
  }

  return {
    detail: detailRes.data,
    minutes: minutesRes?.data ?? null,
    summary: summaryRes?.data ?? null,
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
    coverageStartOffsetSeconds: data.coverageStartOffsetSeconds,
  }
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
    vodAlignSeconds: detail.vodAlignSeconds ?? 0,
    syncPhase: detail.syncPhase,
    chatCoveragePct: detail.chatCoveragePct,
    timelineMinutes: rawMinuteCount > 0 ? rawMinuteCount : rollups.length,
    analyticsQuality: summary?.analyticsQuality ?? detail.analyticsQuality,
    viewerSource: detail.viewerSource,
    coverageStartOffsetSeconds: minutes?.coverageStartOffsetSeconds,
    minutesUnavailable,
  }
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
      try {
        const params = new URLSearchParams({ sparse: opts?.sparse === false ? 'false' : 'true' })
        if (opts?.channel) params.set('channel', opts.channel)
        const { data } = await apiClient<AnalyticsStreamDetail>(
          analyticsPath(`/streams/${encodeURIComponent(streamId)}?${params.toString()}`),
        )
        return data
      } catch {
        return null
      }
    }
    const includeMinutes = opts?.sparse !== true
    try {
      const bundle = await fetchPortalStreamBundle(streamId, includeMinutes, opts?.channel)
      return portalDetailToAnalytics(bundle.detail, bundle.minutes, bundle.summary, {
        includeMinutes,
        minutesFetchFailed: bundle.minutesFetchFailed,
        channelEmotes: bundle.channelEmotes,
      })
    } catch {
      return null
    }
  },

  async getAnalyticsStreams(login: string, limit = 20): Promise<AnalyticsStreamsResponse> {
    const path = usesLocalAnalyticsRoutes()
      ? analyticsPath(`/channels/${encodeURIComponent(login)}/streams?limit=${Math.max(1, limit)}`)
      : portalPath(`/channels/${encodeURIComponent(login)}/streams?limit=${Math.max(1, limit)}`)
    const { data } = await apiClient<AnalyticsStreamsResponse>(path)
    return data
  },

  async getAnalyticsLive(login: string): Promise<AnalyticsStreamDetail> {
    if (usesLocalAnalyticsRoutes()) {
      try {
        const params = new URLSearchParams({ sparse: 'false' })
        const { data } = await apiClient<AnalyticsStreamDetail>(
          analyticsPath(`/channels/${encodeURIComponent(login)}/live?${params.toString()}`),
        )
        return data
      } catch {
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
      const channelEmotesPromise = fetchPortalChannelEmotesCatalog(login)
      const { data } = await apiClient<PortalChannelLiveResponse>(
        portalPath(`/channels/${encodeURIComponent(login)}/live`),
      )
      const channelEmotes = await channelEmotesPromise
      return portalLiveResponseToAnalytics(data, channelEmotes)
    } catch {
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

  async getStreamSummary(streamId: string, channel?: string) {
    if (!streamId.trim()) return null
    if (usesLocalAnalyticsRoutes()) {
      try {
        const params = new URLSearchParams()
        if (channel) params.set('channel', channel)
        const suffix = params.toString() ? `?${params.toString()}` : ''
        const { data } = await apiClient<{
          metrics?: PortalStreamSummaryMetrics
          updatedAt?: number
        }>(analyticsPath(`/streams/${encodeURIComponent(streamId)}/summary${suffix}`))
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
    return fetchPortalStreamSummary(streamId)
  },

  async getPulseBookmarks(_params?: PulseBookmarkQuery) {
    if (!portalBookmarksSupported()) {
      return bookmarkUnavailableResponse()
    }
    return { items: [], supported: true as const }
  },

  async getPulseStreamRecap(streamId: string): Promise<PulseStreamRecap | null> {
    try {
      const { data } = await apiClient<PulseStreamRecap>(portalPath(`/streams/${encodeURIComponent(streamId)}/recap`))
      return normalizePulseStreamRecap(data)
    } catch {
      return null
    }
  },

  async getTimeseriesStatus() {
    return apiClient(analyticsPath('/timeseries/status')).then((res) => res.data)
  },

  async createPulseBookmark() {
    if (!portalBookmarksSupported()) {
      throw new Error('Saved moments are a private beta feature — public analytics is read-only.')
    }
    throw new Error('Bookmarks require a beta key — use the private dashboard.')
  },

  async deletePulseBookmark() {
    if (!portalBookmarksSupported()) {
      throw new Error('Saved moments are a private beta feature — public analytics is read-only.')
    }
    throw new Error('Bookmarks require a beta key — use the private dashboard.')
  },

  async prefetchAnalyticsTracker(streamId: string, channel: string) {
    try {
      await apiClient(analyticsPath(`/streams/${encodeURIComponent(streamId)}/prefetch-tracker`), {
        method: 'POST',
        body: { channel },
        gated: true,
      })
      return { status: 'ok' }
    } catch {
      return { status: 'skipped' }
    }
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

  async getSyncStatus(streamId: string): Promise<SyncStatus | null> {
    try {
      if (usesLocalAnalyticsRoutes()) {
        const { data } = await apiClient<SyncStatus & { phase?: string }>(
          analyticsPath(`/streams/${encodeURIComponent(streamId)}/sync/status`),
        )
        if (data.phase === 'idle') return null
        return { ...data, streamId }
      }
      const { data } = await apiClient<PortalSyncStatus>(
        portalPath(`/streams/${encodeURIComponent(streamId)}/sync/status`),
      )
      return {
        streamId,
        phase: data.phase,
        message: data.message,
        updatedAt: data.updatedAt ?? new Date().toISOString(),
        stale: data.stale,
      }
    } catch {
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

  async getStreamGameSegments(streamId: string): Promise<GameSegment[]> {
    try {
      const { data } = await apiClient<GameSegment[]>(gamesEndpoint(streamId))
      if (Array.isArray(data)) return data
    } catch {
      /* backend is source of truth; do not synthesize a misleading single-game span */
    }
    return []
  },

  async getReplayHeatmap(streamId: string, window = 60, channel?: string) {
    const params = new URLSearchParams({ window: String(window) })
    if (channel) params.set('channel', channel)
    try {
      return apiClient(
        portalPath(`/streams/${encodeURIComponent(streamId)}/replay-heatmap?${params.toString()}`),
      ).then((res) => res.data)
    } catch {
      return null
    }
  },

  async getReplayHeatmapDetail(streamId: string, window = 60, channel?: string) {
    const params = new URLSearchParams({ window: String(window), detail: 'true' })
    if (channel) params.set('channel', channel)
    try {
      return apiClient(
        portalPath(`/streams/${encodeURIComponent(streamId)}/replay-heatmap?${params.toString()}`),
      ).then((res) => res.data)
    } catch {
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

export async function fetchPortalStreamSummary(streamId: string): Promise<PortalStreamSummary | null> {
  if (!streamId.trim()) return null
  try {
    const { data } = await apiClient<PortalStreamSummary>(portalPath(`/streams/${encodeURIComponent(streamId)}/summary`))
    if (!data.topEmotes?.length) return data
    return {
      ...data,
      topEmotes: data.topEmotes.map((emote) => ({
        ...emote,
        imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
      })),
    }
  } catch {
    return null
  }
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
