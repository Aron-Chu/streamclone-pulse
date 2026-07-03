import {
  configureAnalyticsApi,
  configureEmoteAssetBase,
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
  PulseStreamRecap,
  SyncStatus,
} from '@streamclone/analytics-console'
import { apiClient, getBackendUrl } from './apiClient'
import { resolveBackendSource } from './backendSource'
import { absolutizeEmoteAssetUrl } from './emoteAssetUrl'
import { downsampleTimeline, PORTAL_MINUTES_TIMEOUT_MS, rollupChartActivityScore } from './timelineDownsample'

/**
 * Portal analytics adapter — reshapes hosted `/v1/portal/analytics/*` for
 * `@streamclone/analytics-console`.
 *
 * - **Chart minutes:** `downsampleTimeline()` to ~240 points on hosted API (prod).
 *   For literal `:8090` visual QA, point `VITE_BACKEND_URL` at `http://localhost:8090`.
 * - **Top emotes:** `mergePortalTopEmotes()` — stream summary totals win over
 *   per-minute bucket catalog counts.
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
  startedAt: string
  endedAt?: string | null
  currentViewers?: number
  peakViewers?: number
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
  dataSourceBadges?: Array<{ source: string; state: string; label?: string }>
}

interface PortalMinutePoint {
  offsetSeconds: number
  viewerAvg?: number
  viewerMax?: number
  viewerLatest?: number
  chatCount?: number
  seventvEmoteCount?: number
  missing?: boolean
  topEmotes?: Array<{ name: string; provider?: string; imageUrl?: string; count: number }>
}

interface PortalStreamMinutesResponse {
  streamId: string
  channel: string
  startedAt: string
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
  topEmotes?: Array<{ code: string; count: number; provider?: string }>
}

export interface PortalStreamRecapResponse {
  streamId: string
  login: string
  vodId?: string
  durationSeconds?: number
  peakChatPerMin?: number
  topMoments?: PortalRecapMoment[]
  funniestEmoteBurst?: { offsetSeconds: number; code?: string; count: number }
}

interface PortalSyncStatus {
  phase: string
  message?: string
  updatedAt?: string
  stale?: boolean
}

function usesLocalAnalyticsRoutes(): boolean {
  return resolveBackendSource(getBackendUrl()) === 'local'
}

const PLACEHOLDER_CATEGORIES = /^(live|syncing\.{3}|syncing…)$/i

/** Synthesize one chart segment from stream category + rollup span when games API is empty. */
export function deriveClientGameSegments(
  streamId: string,
  detail: Pick<AnalyticsStreamDetail, 'stream' | 'rollups'> | null | undefined,
): GameSegment[] {
  const category = detail?.stream?.category?.trim() ?? ''
  if (!category || PLACEHOLDER_CATEGORIES.test(category)) return []
  const rollupCount = detail?.rollups?.length ?? 0
  if (rollupCount <= 0) return []
  return [
    {
      id: 0,
      streamId,
      gameName: category,
      boxArtUrl: '',
      offsetSeconds: 0,
      durationSeconds: rollupCount * 60,
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

function portalBucketEmoteKey(emote: { name: string; provider?: string }): string {
  const provider = (emote.provider ?? 'other').toLowerCase()
  const name = emote.name.trim()
  if (!name) return ''
  return `${provider}:${name}:${name}`
}

/** Stream-level top emotes from `/summary` win over per-minute bucket totals. */
export function mergePortalTopEmotes(
  catalog: AnalyticsTopEmote[],
  summaryEmotes: AnalyticsTopEmote[] | null | undefined,
): AnalyticsTopEmote[] {
  const catalogByNameProvider = new Map<string, AnalyticsTopEmote>()
  for (const emote of catalog) {
    const name = emote.name.trim().toLowerCase()
    if (!name) continue
    const np = `${(emote.provider ?? 'unknown').toLowerCase()}:${name}`
    catalogByNameProvider.set(np, emote)
  }

  if (summaryEmotes?.length) {
    return summaryEmotes
      .map((emote) => {
        const name = emote.name.trim().toLowerCase()
        const np = `${(emote.provider ?? 'unknown').toLowerCase()}:${name}`
        const catalogMatch = catalogByNameProvider.get(np)
        const imageUrl = absolutizeEmoteAssetUrl(
          emote.imageUrl ?? catalogMatch?.imageUrl,
        )
        if (catalogMatch?.imageUrl && !emote.imageUrl) {
          return { ...emote, imageUrl }
        }
        return imageUrl && imageUrl !== emote.imageUrl ? { ...emote, imageUrl } : emote
      })
      .sort((a, b) => b.count - a.count)
  }

  return [...catalog].sort((a, b) => b.count - a.count)
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
    // The portal minutes endpoint only exposes the authoritative 7TV count plus
    // the top few bucket emotes. Total = known 7TV usage + any non-7TV top
    // emotes (7TV tops are already inside `seventv`, so don't double-count).
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
    const totalEmoteCount = seventv + nonSeventvTop
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

async function fetchPortalStreamBundle(streamId: string, includeMinutes: boolean) {
  const detailPromise = apiClient<PortalStreamDetail>(portalPath(`/streams/${encodeURIComponent(streamId)}`))
  // Minutes are the timeline source but are optional: on backends where the
  // route is gated (401) or not yet deployed (404) we still render the console
  // from detail + summary instead of blanking the whole channel.
  const minutesPromise = includeMinutes
    ? apiClient<PortalStreamMinutesResponse>(portalPath(`/streams/${encodeURIComponent(streamId)}/minutes`), {
        timeoutMs: PORTAL_MINUTES_TIMEOUT_MS,
      }).catch(() => null)
    : Promise.resolve(null)
  const summaryPromise = apiClient<PortalStreamSummary>(
    portalPath(`/streams/${encodeURIComponent(streamId)}/summary`),
  ).catch(() => null)

  const [detailRes, minutesRes, summaryRes] = await Promise.all([detailPromise, minutesPromise, summaryPromise])
  return {
    detail: detailRes.data,
    minutes: minutesRes?.data ?? null,
    summary: summaryRes?.data ?? null,
  }
}

function mergePortalSourceRows(
  sources?: Array<{ source: string; state: string; label?: string }>,
  badges?: Array<{ source: string; state: string; label?: string }>,
): Array<{ source: string; state: string; label?: string }> {
  const out = [...(sources ?? [])]
  for (const badge of badges ?? []) {
    if (!out.some((row) => row.source === badge.source && row.label === badge.label)) {
      out.push(badge)
    }
  }
  return out
}

function portalDetailToAnalytics(
  detail: PortalStreamDetail,
  minutes: PortalStreamMinutesResponse | null,
  summary: PortalStreamSummary | null,
): AnalyticsStreamDetail {
  const stream = detail.stream
  const minutesResult =
    minutes && stream?.startedAt ? portalMinutesToRollups(stream.startedAt, minutes.minutes ?? []) : null
  const rawMinuteCount = minutes?.minutes?.length ?? minutesResult?.rollups.length ?? 0
  const rollups = minutesResult ? downsampleTimeline(minutesResult.rollups, undefined, rollupChartActivityScore) : []
  const mergedTopEmotes = mergePortalTopEmotes(minutesResult?.catalog ?? [], summary?.topEmotes)
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
          vodId: stream.vodId ?? detail.vodId,
        }
      : undefined,
    rollups,
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
    analyticsQuality: summary?.analyticsQuality,
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
      const bundle = await fetchPortalStreamBundle(streamId, includeMinutes)
      return portalDetailToAnalytics(bundle.detail, bundle.minutes, bundle.summary)
    } catch {
      return null
    }
  },

  async getAnalyticsStreams(login: string, limit = 20): Promise<AnalyticsStreamsResponse> {
    const { data } = await apiClient<AnalyticsStreamsResponse>(
      analyticsPath(`/channels/${encodeURIComponent(login)}/streams?limit=${Math.max(1, limit)}`),
    )
    return data
  },

  async getAnalyticsLive(login: string): Promise<AnalyticsStreamDetail> {
    const streams = (await portalAnalyticsApi.getAnalyticsStreams(login, 10)) as AnalyticsStreamsResponse
    const live =
      streams.items.find((item) => !item.endedAt) ??
      streams.items[0]
    if (!live?.streamId) {
      return {
        channel: login,
        state: 'not_collected',
        rollups: [],
        topEmotes: [],
        sources: streams.sources ?? [],
        updatedAt: streams.updatedAt ?? Date.now(),
      }
    }
    const detail = (await portalAnalyticsApi.getAnalyticsStream(live.streamId, {
      sparse: false,
      channel: login,
    })) as AnalyticsStreamDetail | null
    return (
      detail ?? {
        channel: login,
        state: 'not_collected',
        rollups: [],
        topEmotes: [],
        sources: streams.sources ?? [],
        updatedAt: Date.now(),
      }
    )
  },

  async getPulseBookmarks(_params?: PulseBookmarkQuery) {
    return { items: [] }
  },

  async getPulseStreamRecap(streamId: string): Promise<PulseStreamRecap | null> {
    try {
      const { data } = await apiClient<PulseStreamRecap>(portalPath(`/streams/${encodeURIComponent(streamId)}/recap`))
      return data
    } catch {
      return null
    }
  },

  async getTimeseriesStatus() {
    return apiClient(analyticsPath('/timeseries/status')).then((res) => res.data)
  },

  async createPulseBookmark() {
    throw new Error('Bookmarks require a beta key — sign in to save moments.')
  },

  async deletePulseBookmark() {
    throw new Error('Bookmarks require a beta key — sign in to remove saved moments.')
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
    const suffix = period ? `?period=${encodeURIComponent(period)}` : ''
    return apiClient(analyticsPath(`/channels/${encodeURIComponent(login)}/streams/ranked${suffix}`)).then(
      (res) => res.data,
    )
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

  async startHistoricalSync(streamId: string, login?: string, _options?: StartHistoricalSyncOptions) {
    return apiClient(analyticsPath(`/streams/${encodeURIComponent(streamId)}/sync`), {
      method: 'POST',
      body: login ? { login } : {},
      gated: true,
    }).then((res) => res.data)
  },

  async getStreamGameSegments(streamId: string): Promise<GameSegment[]> {
    try {
      const { data } = await apiClient<GameSegment[]>(gamesEndpoint(streamId))
      if (Array.isArray(data) && data.length > 0) return data
    } catch {
      /* fall through to client fallback */
    }
    try {
      const detail = (await portalAnalyticsApi.getAnalyticsStream(streamId, { sparse: false })) as AnalyticsStreamDetail | null
      return deriveClientGameSegments(streamId, detail)
    } catch {
      return []
    }
  },

  async getReplayHeatmap(streamId: string, window = 60, channel?: string) {
    const params = new URLSearchParams({ window: String(window) })
    if (channel) params.set('channel', channel)
    try {
      return apiClient(
        portalPath(`/streams/${encodeURIComponent(streamId)}/replay-heatmap?${params.toString()}`),
        { gated: true },
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
    return data
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
