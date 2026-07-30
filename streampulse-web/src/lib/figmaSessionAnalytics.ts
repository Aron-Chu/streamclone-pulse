import { buildAnalyticsHref } from './analyticsLinks'
import { apiClient } from './apiClient'
import { absolutizeEmoteAssetUrl } from './emoteAssetUrl'
import type { HubFeaturedCoverageRow, HubFeaturedSession, PublicHub } from './publicHub'
import { formatStreamOffset } from './streamcloneAnalytics'
import { PORTAL_MINUTES_TIMEOUT_MS } from './timelineDownsample'

export type FigmaSessionState = 'loading' | 'empty' | 'ready'

export interface FigmaMomentRow {
  offsetSeconds: number
  /** Wall-clock peak time (unix ms) when known — used for cross-channel feed sort. */
  at?: number
  /** Backend-authored Pulse / reaction score only. Never invent from magnitude or chat counts. */
  score?: number
  label: string
  kind?: string
  source?: string
  chatPerMin?: number
  emotesPerMin?: number
  viewers?: number
  viewerDelta?: string
  topEmoteCode?: string
  topEmotes?: Array<{ name: string; provider?: string; count?: number; imageUrl?: string; sharePct?: number }>
  confidence?: number
  vodState?: string
  href?: string
  login?: string
  displayName?: string
  profileImageUrl?: string
  streamId?: string
  vodId?: string
  category?: string
  streamStartedAt?: number
  activityTag?: string
}

export interface FigmaChartPoint {
  offsetSeconds: number
  chatNorm: number
  viewersNorm: number
  emotesNorm: number
  heat: number
  /** Raw per-minute values when the chart came from the stream minutes endpoint. */
  chatCount?: number
  viewerCount?: number
  emoteCount?: number
}

export interface FigmaEmoteBurst {
  code: string
  provider?: string
  imageUrl?: string
  count: number
  deltaPct?: number
  peakOffset?: string
  peakOffsetSeconds?: number
  sharePct?: number
}

export interface FigmaSessionViewModel {
  state: FigmaSessionState
  /** True when rendering deterministic Make preview data (not backend truth). */
  demo?: boolean
  reason?: string
  login?: string
  displayName?: string
  streamId?: string
  category?: string
  startedAt?: string
  vodId?: string
  viewers?: number
  chatPerMin?: number
  chatMinPerMinute?: number
  chatMaxPerMinute?: number
  seventvPerMin?: number
  peakCount?: number
  dataCoveragePct?: number
  moments: FigmaMomentRow[]
  chartPoints: FigmaChartPoint[]
  bursts: FigmaEmoteBurst[]
  coverageTruth: HubFeaturedCoverageRow[]
  sessionHref?: string
  vodHref?: string
  sourceLabel?: string
}

export interface PortalPeak {
  offsetSeconds: number
  score: number
  reasons?: string[]
  reasonLabel: string
  dominantSignal: string
  chatCount: number
  emoteCount: number
  viewers?: number
  viewerDelta?: string
  confidence?: number
  vodState?: string
  topEmotes?: Array<{ name: string; count: number; provider?: string; imageUrl?: string }>
}

export interface PortalCoverageTruthResponse {
  streamId: string
  login: string
  coverage: {
    state: string
    message: string
    canBackfill?: boolean
    hasGaps?: boolean
    hasFullStreamCoverage?: boolean
  }
  coverageTruth: HubFeaturedCoverageRow[]
  dataCoveragePct?: number
  vodId?: string
  updatedAt: number
}

export interface PortalPeaksResponse {
  streamId: string
  login: string
  peaks: PortalPeak[]
  updatedAt: number
}

export interface ReplayHeatmapDetailResponse {
  streamId: string
  points: Array<{
    offsetSeconds: number
    score: number
    confidence?: number
    reason?: string
  }>
  confidence?: number
  updatedAt?: number
}

function portalPath(path: string): string {
  return `/v1/portal/analytics${path.startsWith('/') ? path : `/${path}`}`
}

function emptySession(reason: string): FigmaSessionViewModel {
  return {
    state: 'empty',
    reason,
    moments: [],
    chartPoints: [],
    bursts: [],
    coverageTruth: [],
  }
}

export function featuredSessionFromPublicHub(hub: PublicHub): FigmaSessionViewModel {
  const featured = hub.featuredSession
  if (!featured || featured.state !== 'ready') {
    return emptySession(featured?.reason ?? 'no_qualifying_session')
  }
  return mapFeaturedSession(featured)
}

/** Wall-clock ms for a peak from stream start + offset. */
export function momentAtFromStreamStart(startedAt: string | undefined, offsetSeconds: number): number | undefined {
  if (!startedAt?.trim() || offsetSeconds < 0) return undefined
  const base = Date.parse(startedAt)
  if (!Number.isFinite(base)) return undefined
  return base + offsetSeconds * 1000
}

export function compareMomentsChronologically(a: FigmaMomentRow, b: FigmaMomentRow): number {
  const atA = a.at ?? 0
  const atB = b.at ?? 0
  if (atB !== atA) return atB - atA
  const scoreA = a.score ?? 0
  const scoreB = b.score ?? 0
  if (scoreB !== scoreA) return scoreB - scoreA
  return b.offsetSeconds - a.offsetSeconds
}

export function mapHubPulseMoment(moment: PublicHub['livePulseMoments'][number]): FigmaMomentRow {
  const login = moment.login?.trim() ?? ''
  const streamId = moment.streamId?.trim() ?? ''
  const sessionHref =
    login && streamId
      ? buildAnalyticsHref({ login, streamId, offsetSeconds: moment.offsetSeconds })
      : login
        ? buildAnalyticsHref({ login, offsetSeconds: moment.offsetSeconds })
        : undefined
  return {
    offsetSeconds: moment.offsetSeconds,
    score: moment.score,
    label: moment.label,
    kind: moment.kind,
    source: moment.source,
    chatPerMin: moment.chatPerMin,
    emotesPerMin: moment.emotesPerMin,
    viewers: moment.viewers,
    viewerDelta: moment.viewerDelta,
    topEmoteCode: moment.topEmoteCode,
    topEmotes: moment.topEmotes?.map((emote) => ({
      name: emote.name,
      provider: emote.provider,
      count: emote.count,
      imageUrl: emote.imageUrl,
      sharePct: emote.sharePct,
    })),
    confidence: moment.confidence,
    vodState: moment.vodState,
    login: moment.login,
    displayName: moment.displayName,
    profileImageUrl: moment.profileImageUrl,
    streamId: moment.streamId,
    vodId: moment.vodId,
    at: moment.at,
    category: moment.category,
    streamStartedAt: moment.streamStartedAt,
    activityTag: moment.activityTag,
    href:
      login && streamId
        ? buildAnalyticsHref({ login, streamId, offsetSeconds: moment.offsetSeconds })
        : sessionHref,
  }
}

/** Network-wide live IRC peaks for Pulse Moments Live (multi-channel). */
export type LivePulseMomentsSource = 'network' | 'featured_fallback' | 'legacy_fallback' | 'empty'

export interface LivePulseMomentsResult {
  moments: FigmaMomentRow[]
  source: LivePulseMomentsSource
  /** Short banner copy when the feed is not network-wide. */
  banner?: string
  status?: string
  reason?: string
}

function featuredFallbackBanner(hub: PublicHub): string {
  switch (hub.livePulseMomentsStatus) {
    case 'no_peaks':
      return 'No network IRC peaks in the tracking pool yet. Showing featured session fallback.'
    case 'fallback':
      return 'No IRC-eligible live channels for network peaks. Showing featured session fallback.'
    default:
      return 'Hosted API has not deployed network live moments yet. Showing featured session fallback.'
  }
}

function legacyFallbackBanner(hub: PublicHub): string {
  if (hub.livePulseMomentsStatus === 'no_peaks' || hub.livePulseMomentsStatus === 'fallback') {
    return 'Legacy hub moments fallback. Deploy latest analytics for network-wide live moments.'
  }
  return 'Legacy hub moments fallback. Deploy latest analytics for network-wide live moments.'
}

function featuredFallbackMoments(hub: PublicHub): FigmaMomentRow[] {
  const featured = hub.featuredSession
  if (!featured || featured.state !== 'ready') return []
  const login = featured.login?.trim().toLowerCase() ?? ''
  const live = hub.liveChannels.find((ch) => ch.login.toLowerCase() === login)
  return (featured.topMoments ?? []).map((moment) => ({
    offsetSeconds: moment.offsetSeconds,
    at: momentAtFromStreamStart(featured.startedAt, moment.offsetSeconds),
    score: moment.score,
    label: moment.label,
    kind: moment.kind,
    source: moment.source,
    chatPerMin: moment.chatPerMin,
    emotesPerMin: moment.emotesPerMin,
    viewers: moment.viewers,
    viewerDelta: moment.viewerDelta,
    topEmoteCode: moment.topEmoteCode,
    topEmotes: moment.topEmotes?.map((emote) => ({
      name: emote.name,
      provider: emote.provider,
      count: emote.count,
      imageUrl: emote.imageUrl,
      sharePct: emote.sharePct,
    })),
    confidence: moment.confidence,
    vodState: moment.vodState,
    login: featured.login,
    displayName: featured.displayName ?? live?.displayName,
    profileImageUrl: live?.profileImageUrl,
    streamId: featured.streamId,
    vodId: featured.vodId,
    href:
      featured.login && featured.streamId
        ? buildAnalyticsHref({
            login: featured.login,
            streamId: featured.streamId,
            offsetSeconds: moment.offsetSeconds,
          })
        : undefined,
  }))
}

function hubMomentsFallback(hub: PublicHub): FigmaMomentRow[] {
  return (hub.moments ?? [])
    .filter((moment) => moment.kind === 'chat_spike' || moment.kind === 'emote_spike')
    .map((moment) => {
      const login = moment.login?.trim().toLowerCase() ?? ''
      const live = hub.liveChannels.find((ch) => ch.login.toLowerCase() === login)
      return {
        offsetSeconds: 0,
        at: moment.at,
        // Hub event-feed rows expose magnitude for ranking/display hints only —
        // never reinterpret magnitude as a Pulse / reaction score.
        label: moment.label,
        kind: moment.kind,
        login: moment.login,
        displayName: moment.displayName ?? live?.displayName,
        profileImageUrl: live?.profileImageUrl,
        streamId: moment.streamId,
        topEmotes: moment.topEmotes?.map((emote) => ({
          name: emote.name,
          provider: emote.provider,
          count: emote.count,
          imageUrl: emote.imageUrl,
          sharePct: emote.sharePct,
        })),
        href:
          login && moment.streamId
            ? buildAnalyticsHref({ login, streamId: moment.streamId, offsetSeconds: 0 })
            : login
              ? buildAnalyticsHref({ login })
              : undefined,
      } satisfies FigmaMomentRow
    })
}

export function resolveLivePulseMoments(hub: PublicHub): LivePulseMomentsResult {
  if (hub.livePulseMoments?.length) {
    return {
      moments: hub.livePulseMoments.map(mapHubPulseMoment),
      source: 'network',
      status: hub.livePulseMomentsStatus ?? 'ready',
      reason: hub.livePulseMomentsReason,
    }
  }
  const fallback = featuredFallbackMoments(hub)
  if (fallback.length) {
    return {
      moments: fallback,
      source: 'featured_fallback',
      banner: featuredFallbackBanner(hub),
      status: hub.livePulseMomentsStatus,
      reason: hub.livePulseMomentsReason,
    }
  }
  const legacy = hubMomentsFallback(hub)
  if (legacy.length) {
    return {
      moments: legacy,
      source: 'legacy_fallback',
      banner: legacyFallbackBanner(hub),
      status: hub.livePulseMomentsStatus,
      reason: hub.livePulseMomentsReason,
    }
  }
  return { moments: [], source: 'empty', status: hub.livePulseMomentsStatus, reason: hub.livePulseMomentsReason }
}

/** @deprecated Prefer resolveLivePulseMoments for source-aware UI. */
export function livePulseMomentsFromPublicHub(hub: PublicHub): FigmaMomentRow[] {
  return resolveLivePulseMoments(hub).moments
}

export function momentRowKey(moment: FigmaMomentRow): string {
  return `${moment.login ?? ''}:${moment.streamId ?? ''}:${moment.offsetSeconds}`
}

export function mapFeaturedSession(featured: HubFeaturedSession): FigmaSessionViewModel {
  const login = featured.login ?? ''
  const streamId = featured.streamId ?? ''
  const sessionHref =
    login && streamId ? buildAnalyticsHref({ login, streamId }) : login ? buildAnalyticsHref({ login }) : undefined
  const vodHref = featured.vodId ? `https://www.twitch.tv/videos/${featured.vodId}` : undefined
  return {
    state: 'ready',
    reason: featured.reason,
    login,
    displayName: featured.displayName,
    streamId,
    category: featured.category,
    startedAt: featured.startedAt,
    vodId: featured.vodId,
    viewers: featured.viewers,
    chatPerMin: featured.chatPerMin,
    seventvPerMin: featured.seventvPerMin,
    peakCount: featured.peakCount,
    dataCoveragePct: featured.dataCoveragePct,
    moments: (featured.topMoments ?? []).map((moment) => ({
      offsetSeconds: moment.offsetSeconds,
      score: moment.score,
      label: moment.label,
      kind: moment.kind,
      source: moment.source,
      chatPerMin: moment.chatPerMin,
      viewers: moment.viewers,
      viewerDelta: moment.viewerDelta,
      topEmoteCode: moment.topEmoteCode,
      topEmotes: moment.topEmotes?.map((emote) => ({
        name: emote.name,
        provider: emote.provider,
        count: emote.count,
        imageUrl: emote.imageUrl,
        sharePct: emote.sharePct,
      })),
      confidence: moment.confidence,
      vodState: moment.vodState,
      href:
        login && streamId
          ? buildAnalyticsHref({ login, streamId, offsetSeconds: moment.offsetSeconds })
          : sessionHref,
    })),
    chartPoints: (featured.chartPoints ?? []).map((point) => ({
      offsetSeconds: point.offsetSeconds,
      chatNorm: point.chatNorm,
      viewersNorm: point.viewersNorm,
      emotesNorm: point.emotesNorm,
      heat: point.heat,
    })),
    bursts: (featured.topEmoteBursts ?? []).map((burst) => ({
      code: burst.code,
      provider: burst.provider,
      imageUrl: burst.imageUrl,
      count: burst.count,
      deltaPct: burst.deltaPct,
      peakOffset: burst.peakOffset,
      peakOffsetSeconds: burst.peakOffsetSeconds,
      sharePct: burst.sharePct,
    })),
    coverageTruth: featured.coverageTruth ?? [],
    sessionHref,
    vodHref,
  }
}

export async function fetchPortalStreamMinutes(streamId: string): Promise<PortalStreamMinutesResponse | null> {
  if (!streamId.trim()) return null
  try {
    const { data } = await apiClient<PortalStreamMinutesResponse>(
      portalPath(`/streams/${encodeURIComponent(streamId)}/minutes`),
      { timeoutMs: PORTAL_MINUTES_TIMEOUT_MS },
    )
    return data
  } catch {
    return null
  }
}

export interface PortalStreamMinutesResponse {
  streamId: string
  channel: string
  startedAt: string
  minutes: Array<{
    offsetSeconds: number
    viewerAvg?: number
    viewerMax?: number
    viewerLatest?: number
    chatCount?: number
    seventvEmoteCount?: number
    missing?: boolean
  }>
  updatedAt: number
}

function normalizeChartValue(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)))
}

import { downsampleTimeline, rollupChartActivityScore } from './timelineDownsample'

export function chatPerMinuteRange(
  minutes: PortalStreamMinutesResponse['minutes'],
): { min: number; max: number } | null {
  const values = minutes
    .filter((minute) => !minute.missing)
    .map((minute) => minute.chatCount)
    .filter((value): value is number => value != null && Number.isFinite(value) && value >= 0)
  if (!values.length) return null
  return {
    min: Math.min(...values),
    max: Math.max(...values),
  }
}

export function chartPointsFromMinutes(
  minutes: PortalStreamMinutesResponse['minutes'],
): FigmaChartPoint[] {
  if (!minutes.length) return []
  const maxChat = Math.max(...minutes.map((m) => m.chatCount ?? 0), 1)
  const maxViewers = Math.max(...minutes.map((m) => m.viewerLatest ?? m.viewerMax ?? m.viewerAvg ?? 0), 1)
  const maxEmotes = Math.max(...minutes.map((m) => m.seventvEmoteCount ?? 0), 1)
  // Spike-preserving downsample: uniform stride flattens chat/emote peaks on long sessions.
  return downsampleTimeline(minutes, undefined, rollupChartActivityScore).map((minute) => {
    const chat = minute.chatCount ?? 0
    const viewers = minute.viewerLatest ?? minute.viewerMax ?? minute.viewerAvg ?? 0
    const emotes = minute.seventvEmoteCount ?? 0
    const chatNorm = normalizeChartValue(chat, maxChat)
    const viewersNorm = normalizeChartValue(viewers, maxViewers)
    const emotesNorm = normalizeChartValue(emotes, maxEmotes)
    return {
      offsetSeconds: minute.offsetSeconds,
      chatNorm,
      viewersNorm,
      emotesNorm,
      heat: Math.min(100, Math.round(chatNorm * 0.35 + emotesNorm * 0.5 + viewersNorm * 0.15)),
      chatCount: chat,
      viewerCount: viewers,
      emoteCount: emotes,
    }
  })
}

export interface FigmaSessionStripItem {
  streamId: string
  label: string
  category?: string
  startedAt?: string
  endedAt?: string | null
  live: boolean
  sourceLabel: string
  href: string
}

const SOURCE_LABELS: Record<string, string> = {
  live: 'Live',
  gql: 'Imported VOD',
  ivr: 'Legacy',
  mixed: 'Mixed',
  analytics_db: 'Tracked',
}

/** Human label for a source row, honest about live vs imported vs tracked history. */
export function sourceLabelFromDetail(
  sources?: Array<{ source: string; state: string; label?: string }>,
  dataSourceBadges?: Array<{ source: string; state: string; label?: string }>,
): string {
  for (const badge of dataSourceBadges ?? []) {
    const label = badge.label?.trim() ?? ''
    if (label.startsWith('Live IRC')) return SOURCE_LABELS.live
    if (label.startsWith('GQL Gold')) return SOURCE_LABELS.gql
    if (label.startsWith('IVR')) return SOURCE_LABELS.ivr
    if (label.startsWith('Mixed')) return SOURCE_LABELS.mixed
  }
  if (!sources?.length) return 'Tracked'
  const live = sources.find((s) => s.source === 'live' && s.state !== 'missing')
  if (live) return SOURCE_LABELS.live
  const gql = sources.find((s) => s.source === 'gql')
  if (gql) return SOURCE_LABELS.gql
  const ivr = sources.find((s) => s.source === 'ivr')
  if (ivr) return SOURCE_LABELS.ivr
  const first = sources[0]
  return SOURCE_LABELS[first?.source ?? ''] ?? first?.label ?? 'Tracked'
}

export async function fetchPortalStreamPeaks(streamId: string): Promise<PortalPeaksResponse | null> {
  if (!streamId.trim()) return null
  try {
    const { data } = await apiClient<PortalPeaksResponse>(portalPath(`/streams/${encodeURIComponent(streamId)}/peaks`))
    return data
  } catch {
    return null
  }
}

export async function fetchPortalStreamCoverageTruth(streamId: string): Promise<PortalCoverageTruthResponse | null> {
  if (!streamId.trim()) return null
  try {
    const { data } = await apiClient<PortalCoverageTruthResponse>(
      portalPath(`/streams/${encodeURIComponent(streamId)}/coverage-truth`),
    )
    return data
  } catch {
    return null
  }
}

export async function fetchReplayHeatmapDetail(streamId: string, window = 60): Promise<ReplayHeatmapDetailResponse | null> {
  if (!streamId.trim()) return null
  const params = new URLSearchParams({ window: String(window), detail: 'true' })
  try {
    const { data } = await apiClient<ReplayHeatmapDetailResponse>(
      portalPath(`/streams/${encodeURIComponent(streamId)}/replay-heatmap?${params.toString()}`),
    )
    return data
  } catch {
    return null
  }
}

export async function fetchPortalSessionViewModel(streamId: string, login?: string): Promise<FigmaSessionViewModel> {
  if (!streamId.trim()) return emptySession('missing_stream_id')
  const [peaksRes, coverageRes, minutesRes, detailRes] = await Promise.all([
    fetchPortalStreamPeaks(streamId),
    fetchPortalStreamCoverageTruth(streamId),
    fetchPortalStreamMinutes(streamId),
    apiClient<{
      channel: string
      state: string
      stream?: {
        streamId: string
        login: string
        displayName?: string
        category?: string
        startedAt: string
        endedAt?: string | null
        currentViewers?: number
        peakViewers?: number
        vodId?: string
      }
      sources?: Array<{ source: string; state: string; label?: string }>
      dataSourceBadges?: Array<{ source: string; state: string; label?: string }>
    }>(portalPath(`/streams/${encodeURIComponent(streamId)}`)).catch(() => null),
  ])
  if (!peaksRes && !coverageRes && !detailRes) {
    return emptySession('portal_unavailable')
  }
  const detail = detailRes?.data
  const resolvedLogin = login ?? peaksRes?.login ?? coverageRes?.login ?? detail?.stream?.login ?? detail?.channel ?? ''
  const vodId = coverageRes?.vodId ?? detail?.stream?.vodId
  const sessionHref = resolvedLogin ? buildAnalyticsHref({ login: resolvedLogin, streamId }) : undefined
  const peaks = peaksRes?.peaks ?? []
  const chartFromMinutes = minutesRes?.minutes?.length ? chartPointsFromMinutes(minutesRes.minutes) : []
  const chatRange = minutesRes?.minutes?.length ? chatPerMinuteRange(minutesRes.minutes) : null
  const sourceLabel = sourceLabelFromDetail(detail?.sources, detail?.dataSourceBadges)
  return {
    state: peaks.length > 0 || chartFromMinutes.length > 0 || detail?.stream ? 'ready' : 'empty',
    reason: peaks.length === 0 && chartFromMinutes.length === 0 ? 'insufficient_data' : undefined,
    login: resolvedLogin,
    displayName: detail?.stream?.displayName,
    streamId,
    category: detail?.stream?.category,
    startedAt: detail?.stream?.startedAt ?? minutesRes?.startedAt,
    vodId,
    viewers: detail?.stream?.currentViewers ?? detail?.stream?.peakViewers,
    chatMinPerMinute: chatRange?.min,
    chatMaxPerMinute: chatRange?.max,
    dataCoveragePct: coverageRes?.dataCoveragePct,
    peakCount: peaks.length,
    moments: peaks.map((peak) => ({
      offsetSeconds: peak.offsetSeconds,
      score: peak.score,
      label: peak.reasonLabel,
      chatPerMin: peak.chatCount,
      viewers: peak.viewers,
      viewerDelta: peak.viewerDelta,
      topEmoteCode: peak.topEmotes?.[0]?.name,
      topEmotes: peak.topEmotes?.map((emote) => ({
        name: emote.name,
        provider: emote.provider,
        count: emote.count,
        imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
      })),
      confidence: peak.confidence,
      vodState: peak.vodState,
      href: resolvedLogin
        ? buildAnalyticsHref({ login: resolvedLogin, streamId, offsetSeconds: peak.offsetSeconds })
        : sessionHref,
    })),
    chartPoints: chartFromMinutes,
    bursts: peaks.flatMap((peak) =>
      (peak.topEmotes ?? []).slice(0, 1).map((emote) => ({
        code: emote.name,
        provider: emote.provider,
        imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
        count: emote.count,
        peakOffset: formatStreamOffset(peak.offsetSeconds),
        peakOffsetSeconds: peak.offsetSeconds,
      })),
    ),
    coverageTruth: coverageRes?.coverageTruth ?? [],
    sessionHref,
    vodHref: vodId ? `https://www.twitch.tv/videos/${vodId}` : undefined,
    sourceLabel,
  }
}

/** True when backend supplied a finite peak anchor (including stream start at 0). */
export function isValidPeakOffsetSeconds(value: number | undefined): value is number {
  return value != null && Number.isFinite(value)
}

/** Map a chart or burst offset to the closest backend peak row (ties → earlier moment). */
export function nearestMomentForOffset(
  moments: FigmaMomentRow[],
  offsetSeconds: number,
): FigmaMomentRow | null {
  if (!moments.length || !Number.isFinite(offsetSeconds)) return null
  let best = moments[0]
  let bestDist = Math.abs(moments[0].offsetSeconds - offsetSeconds)
  for (let i = 1; i < moments.length; i++) {
    const moment = moments[i]
    const dist = Math.abs(moment.offsetSeconds - offsetSeconds)
    if (dist < bestDist || (dist === bestDist && moment.offsetSeconds < best.offsetSeconds)) {
      best = moment
      bestDist = dist
    }
  }
  return best
}

export function formatOffsetLabel(seconds: number): string {
  return formatStreamOffset(seconds)
}

export function buildVodTimestampUrl(vodId: string, offsetSeconds: number): string {
  const base = `https://www.twitch.tv/videos/${vodId}`
  if (offsetSeconds <= 0) return base
  return `${base}?t=${Math.max(0, Math.floor(offsetSeconds))}s`
}
