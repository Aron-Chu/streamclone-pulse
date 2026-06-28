import { DEFAULT_PRODUCTION_BACKEND_URL } from './auth'
import { apiClient, getBackendUrl } from './apiClient'

/**
 * Mirrors PublicHubResponse from twitch-7tv-clone/internal/analytics/hub_overview.go.
 * The /v1/public/hub endpoint is unauthenticated and hosted-safe: it only ever
 * returns aggregate corpus counts and bounded per-minute activity, never raw
 * rollups, emote maps, or principals.
 */
export interface HubCorpus {
  streamsTracked: number
  momentsDetected: number
  chatMessagesProcessed: number
  emotesIndexed: number
  vodsAnalyzed: number
}

export interface HubCoverage {
  liveChannels: number
  trackingMax: number
  backfillActive: number
  backfillMax: number
  syncActive: number
  emotesIndexed: number
  databaseOk: boolean
  state: 'operational' | 'degraded' | 'critical' | string
}

/** Aggregate Top-500 roster metadata-tracker state counts (no per-channel rows). */
export interface HubRosterSummary {
  live: number
  collectorTracking: number
  expectedCollectorRows: number
  liveCollectorDeficitRows: number
  metadataOnly: number
  metadataStale: number
  admissionDisabled: number
  capacityBlocked: number
  warming: number
  collecting: number
  viewerOnly: number
  zeroChatAfterAge: number
}

/** Aggregate backfill job counts for a single corpus tier (Silver or Gold). */
export interface HubTierCounts {
  queued: number
  running: number
  done: number
  skipped: number
  failed: number
  total: number
  eligible: number
  oldestQueuedSeconds?: number | null
}

/**
 * Hosted-safe corpus pipeline: Top-500 roster tracker summary + Silver/Gold VOD
 * backfill tier counts. Aggregate counts only — never per-channel rows, logins,
 * stream IDs, admission messages, or job errors.
 */
export interface HubCorpusPipeline {
  generatedAt: string
  state: 'healthy' | 'degraded' | 'critical' | string
  topN: number
  collectorActive: number
  collectorMax: number
  roster: HubRosterSummary
  silver: HubTierCounts
  gold: HubTierCounts
}

export interface HubActivityPoint {
  t: number
  chat: number
  /** All-provider emote count for the minute (7TV + Twitch + FFZ + BTTV). */
  emotes?: number
  seventv: number
  viewers: number
}

export interface HubActivity {
  points: HubActivityPoint[]
  windowMinutes: number
  channelCount: number
}

export interface HubEmoteIntel {
  emotesPerMin: number
  topEmoteSharePct: number
  uniqueEmotes: number
  biggestPeakPerMin: number
  seventvSharePct: number
  providerShares: HubProviderShare[]
}

export interface HubProviderShare {
  provider: string
  count: number
  sharePct: number
}

export interface HubEmote {
  name: string
  provider?: string
  imageUrl?: string
  count: number
  sharePct: number
  zeroWidth?: boolean
  animated?: boolean
}

export interface HubMover {
  login: string
  displayName?: string
  category?: string
  profileImageUrl?: string
  viewers: number
  /** All-provider emote velocity (Twitch + 7TV + FFZ + BTTV) for the recent window. */
  emotesPerMin?: number
  /** 7TV subset retained for provider-mix context and legacy fallback. */
  seventvPerMin: number
  chatPerMin: number
  trendPct: number
}

export type HubCoverageState =
  | 'synced'
  | 'collecting'
  | 'warming'
  | 'chat_only'
  | 'viewer_only'
  | 'partial'
  | 'stats_only'
  | string

export interface HubLiveChannel {
  login: string
  displayName?: string
  category?: string
  profileImageUrl?: string
  viewers: number
  chatPerMin: number
  /** All-provider emote velocity (Twitch + 7TV + FFZ + BTTV) for the recent window. */
  emotesPerMin?: number
  /** 7TV subset retained for provider-mix context and legacy fallback. */
  seventvPerMin: number
  coverageState: HubCoverageState
  trendPct: number
}

export type HubMomentKind =
  | 'live_attach'
  | 'chat_spike'
  | 'emote_spike'
  | 'backfill_queued'
  | 'backfill_done'
  | string

export interface HubMoment {
  kind: HubMomentKind
  login?: string
  displayName?: string
  label: string
  detail?: string
  magnitude?: number
  at: number
}

export interface PublicHub {
  generatedAt: string
  poolSize: number
  corpus: HubCorpus
  coverage: HubCoverage
  corpusPipeline: HubCorpusPipeline
  activity: HubActivity
  emoteIntel: HubEmoteIntel
  topEmotes: HubEmote[]
  topMovers: HubMover[]
  liveChannels: HubLiveChannel[]
  moments: HubMoment[]
}

interface PublicStatsSnapshot {
  streamsTracked?: number
  momentsDetected?: number
  chatMessagesProcessed?: number
  emotesIndexed?: number
  vodsAnalyzed?: number
  updatedAt?: string
}

interface PublicStatusSnapshot {
  status?: string
  degraded?: boolean
  updatedAt?: string
}

interface Top500ReadinessSummarySnapshot {
  liveRows?: number
  collectorTrackingRows?: number
  expectedCollectorRows?: number
  liveCollectorDeficitRows?: number
  metadataOnlyRows?: number
  metadataStaleRows?: number
  admissionDisabledRows?: number
  capacityBlockedRows?: number
  warmingRows?: number
  collectingRows?: number
  viewerOnlyRows?: number
  zeroChatAfterAgeRows?: number
}

interface Top500ReadinessRowSnapshot {
  login?: string
  isLive?: boolean
  metadataStale?: boolean
  viewerCount?: number | null
  categoryName?: string
  collectorTracking?: boolean
  rollupCount?: number
  latestChatCount?: number
  latestTotalEmoteCount?: number
  latestSevenTvCount?: number
  viewerOnlyRecent?: boolean
  readinessState?: string
}

interface Top500ReadinessSnapshot {
  generatedAt?: string
  topN?: number
  admissionEnabled?: boolean
  collectorActive?: number
  collectorMax?: number
  summary?: Top500ReadinessSummarySnapshot
  rows?: Top500ReadinessRowSnapshot[]
}

const TOP500_TARGET_N = 500
/** ALLOWLIST: aggregate ops readiness only — not stream timelines (see portalAnalytics.ts). */
const TOP500_READINESS_PATHS = [
  `/v1/analytics/top100/readiness?topN=${TOP500_TARGET_N}`,
  `/v1/analytics/top-roster/readiness?topN=${TOP500_TARGET_N}`,
]

export type PublicHubActivityWindow = 'all' | '1y' | '3m' | '1m' | '7d' | '24h' | '30m'

export type PublicHubLoadSource = 'full' | 'readiness-fallback'

export interface FetchPublicHubResult {
  data: PublicHub
  loadSource: PublicHubLoadSource
  hubEndpointOk: boolean
  cache?: 'HIT' | 'MISS' | 'BYPASS'
  status: number
}

function publicHubPath(activityWindow?: PublicHubActivityWindow): string {
  if (!activityWindow) return '/v1/public/hub'
  const params = new URLSearchParams({ activityWindow })
  return `/v1/public/hub?${params.toString()}`
}

export async function fetchPublicHub(signal?: AbortSignal, activityWindow?: PublicHubActivityWindow): Promise<FetchPublicHubResult> {
  let primary: Awaited<ReturnType<typeof apiClient<PublicHub>>> | null = null
  let primaryError: unknown = null

  try {
    primary = await apiClient<PublicHub>(publicHubPath(activityWindow), { signal })
  } catch (error) {
    primaryError = error
  }

  const hubEndpointOk = primary != null
  const baseHub = primary ? normalizePublicHub(primary.data) : null
  const hasAggregatePipelineHealth = baseHub
    ? baseHub.corpusPipeline.state !== 'healthy'
      || baseHub.corpusPipeline.roster.expectedCollectorRows > 0
      || baseHub.corpusPipeline.roster.liveCollectorDeficitRows > 0
      || baseHub.corpusPipeline.roster.metadataStale > 0
      || baseHub.corpusPipeline.roster.admissionDisabled > 0
    : false
  const needsTop500Snapshot = !baseHub
    || baseHub.corpusPipeline.topN < TOP500_TARGET_N
    || (!hasAggregatePipelineHealth && baseHub.liveChannels.length < baseHub.corpusPipeline.roster.live)

  if (!needsTop500Snapshot) {
    return {
      data: baseHub!,
      loadSource: 'full',
      hubEndpointOk,
      cache: primary?.cache,
      status: primary?.status ?? 200,
    }
  }

  const [readiness, stats, status] = await Promise.all([
    fetchBestTop500Readiness(signal),
    baseHub ? Promise.resolve(null) : fetchOptionalFromBackendCandidates<PublicStatsSnapshot>('/v1/public/stats', signal),
    baseHub ? Promise.resolve(null) : fetchOptionalFromBackendCandidates<PublicStatusSnapshot>('/v1/public/status', signal),
  ])

  if (readiness) {
    const fallbackHub = baseHub ?? buildPublicHubFallback(readiness, stats, status)
    return {
      data: mergeTop500Readiness(fallbackHub, readiness),
      loadSource: hubEndpointOk ? 'full' : 'readiness-fallback',
      hubEndpointOk,
      cache: primary?.cache,
      status: primary?.status ?? 200,
    }
  }

  if (baseHub && primary) {
    return {
      data: baseHub,
      loadSource: 'full',
      hubEndpointOk,
      cache: primary.cache,
      status: primary.status,
    }
  }

  throw primaryError
}

function backendCandidates(): string[] {
  const candidates = [getBackendUrl(), DEFAULT_PRODUCTION_BACKEND_URL]
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  return Array.from(new Set(candidates))
}

function apiPath(base: string, path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

async function fetchOptionalFromBackendCandidates<T>(path: string, signal?: AbortSignal): Promise<T | null> {
  for (const base of backendCandidates()) {
    try {
      const result = await apiClient<T>(apiPath(base, path), { signal, timeoutMs: 5_000 })
      return result.data
    } catch {
      // Best-effort fallback path; the primary public hub error remains authoritative.
    }
  }
  return null
}

function betterReadiness(next: Top500ReadinessSnapshot, current: Top500ReadinessSnapshot | null): boolean {
  if (!current) return true
  const nextTopN = next.topN ?? 0
  const currentTopN = current.topN ?? 0
  if (nextTopN !== currentTopN) return nextTopN > currentTopN

  const nextLive = next.summary?.liveRows ?? next.rows?.length ?? 0
  const currentLive = current.summary?.liveRows ?? current.rows?.length ?? 0
  if (nextLive !== currentLive) return nextLive > currentLive

  return Date.parse(next.generatedAt ?? '') > Date.parse(current.generatedAt ?? '')
}

async function fetchBestTop500Readiness(signal?: AbortSignal): Promise<Top500ReadinessSnapshot | null> {
  let best: Top500ReadinessSnapshot | null = null
  for (const base of backendCandidates()) {
    for (const path of TOP500_READINESS_PATHS) {
      try {
        const result = await apiClient<Top500ReadinessSnapshot>(apiPath(base, path), {
          signal,
          timeoutMs: 5_000,
        })
        if (betterReadiness(result.data, best)) best = result.data
        if ((result.data.topN ?? 0) >= TOP500_TARGET_N && (result.data.summary?.liveRows ?? 0) > 0) break
      } catch {
        // Keep trying candidates; not every local backend has the Top-500 tracker route or data.
      }
    }
    if ((best?.topN ?? 0) >= TOP500_TARGET_N && (best?.summary?.liveRows ?? 0) > 0) {
      break
    }
  }
  return best
}

function buildPublicHubFallback(
  readiness: Top500ReadinessSnapshot,
  stats: PublicStatsSnapshot | null,
  status: PublicStatusSnapshot | null,
): PublicHub {
  return normalizePublicHub({
    generatedAt: readiness.generatedAt ?? stats?.updatedAt ?? status?.updatedAt ?? new Date().toISOString(),
    corpus: stats
      ? {
          streamsTracked: stats.streamsTracked ?? 0,
          momentsDetected: stats.momentsDetected ?? 0,
          chatMessagesProcessed: stats.chatMessagesProcessed ?? 0,
          emotesIndexed: stats.emotesIndexed ?? 0,
          vodsAnalyzed: stats.vodsAnalyzed ?? 0,
        }
      : undefined,
    coverage: {
      liveChannels: readiness.summary?.liveRows ?? readiness.rows?.length ?? 0,
      trackingMax: readiness.collectorMax ?? 0,
      backfillActive: 0,
      backfillMax: 0,
      syncActive: 0,
      emotesIndexed: stats?.emotesIndexed ?? 0,
      databaseOk: status?.degraded !== true,
      state: status?.status ?? 'operational',
    },
  })
}

function readinessCoverageState(row: Top500ReadinessRowSnapshot): HubCoverageState {
  const chat = row.latestChatCount ?? 0
  const emotes = Math.max(row.latestTotalEmoteCount ?? 0, row.latestSevenTvCount ?? 0)
  if (chat > 0 && emotes > 0) return 'synced'
  if (chat > 0) return 'chat_only'
  if (row.viewerOnlyRecent || row.readinessState === 'viewer_only') return 'viewer_only'
  if (row.readinessState === 'warming' || (row.collectorTracking && (row.rollupCount ?? 0) === 0)) return 'warming'
  if (row.readinessState === 'collecting' || row.collectorTracking || (row.rollupCount ?? 0) > 0) return 'collecting'
  return 'stats_only'
}

/** Last-minute rollup snapshot when full hub window rates are unavailable. */
function readinessMinuteRates(row: Top500ReadinessRowSnapshot): Pick<HubLiveChannel, 'chatPerMin' | 'emotesPerMin' | 'seventvPerMin'> {
  const chatPerMin = row.latestChatCount ?? 0
  const seventvPerMin = row.latestSevenTvCount ?? 0
  const emotesPerMin = Math.max(row.latestTotalEmoteCount ?? 0, seventvPerMin)
  return { chatPerMin, emotesPerMin, seventvPerMin }
}

function readinessLiveChannels(readiness: Top500ReadinessSnapshot): HubLiveChannel[] {
  return (readiness.rows ?? [])
    .filter((row) => row.isLive && row.login?.trim())
    .map((row) => ({
      login: row.login?.trim().toLowerCase() ?? '',
      category: row.categoryName ?? '',
      viewers: row.viewerCount ?? 0,
      ...readinessMinuteRates(row),
      coverageState: readinessCoverageState(row),
      trendPct: 0,
    }))
}

function mergeLiveChannels(base: HubLiveChannel[], readiness: HubLiveChannel[]): HubLiveChannel[] {
  const byLogin = new Map<string, HubLiveChannel>()
  for (const channel of readiness) byLogin.set(channel.login.toLowerCase(), channel)
  for (const channel of base) {
    const key = channel.login.toLowerCase()
    const existing = byLogin.get(key)
    byLogin.set(key, existing ? { ...existing, ...channel, viewers: Math.max(existing.viewers, channel.viewers) } : channel)
  }
  return Array.from(byLogin.values())
    .sort((a, b) => b.viewers - a.viewers)
    .slice(0, 100)
}

function mergeTop500Readiness(base: PublicHub, readiness: Top500ReadinessSnapshot): PublicHub {
  const summary = derivedReadinessSummary(readiness)
  const liveChannels = mergeLiveChannels(base.liveChannels, readinessLiveChannels(readiness))
  const pipelineState = pipelineStateFromReadiness(readiness)

  return {
    ...base,
    generatedAt: readiness.generatedAt ?? base.generatedAt,
    poolSize: Math.max(base.poolSize, summary.liveRows ?? 0, liveChannels.length),
    coverage: {
      ...base.coverage,
      liveChannels: Math.max(base.coverage.liveChannels, summary.liveRows ?? 0, liveChannels.length),
      trackingMax: Math.max(base.coverage.trackingMax, readiness.collectorMax ?? 0),
      state: coverageStateWithPipeline(base.coverage.state, pipelineState),
    },
    corpusPipeline: {
      ...base.corpusPipeline,
      generatedAt: readiness.generatedAt ?? base.corpusPipeline.generatedAt,
      state: pipelineState,
      topN: Math.max(base.corpusPipeline.topN, readiness.topN ?? 0),
      collectorActive: readiness.collectorActive ?? base.corpusPipeline.collectorActive,
      collectorMax: readiness.collectorMax ?? base.corpusPipeline.collectorMax,
      roster: {
        live: summary.liveRows ?? base.corpusPipeline.roster.live,
        collectorTracking: summary.collectorTrackingRows ?? base.corpusPipeline.roster.collectorTracking,
        expectedCollectorRows: summary.expectedCollectorRows ?? base.corpusPipeline.roster.expectedCollectorRows,
        liveCollectorDeficitRows: summary.liveCollectorDeficitRows ?? base.corpusPipeline.roster.liveCollectorDeficitRows,
        metadataOnly: summary.metadataOnlyRows ?? base.corpusPipeline.roster.metadataOnly,
        metadataStale: summary.metadataStaleRows ?? base.corpusPipeline.roster.metadataStale,
        admissionDisabled: summary.admissionDisabledRows ?? base.corpusPipeline.roster.admissionDisabled,
        capacityBlocked: summary.capacityBlockedRows ?? base.corpusPipeline.roster.capacityBlocked,
        warming: summary.warmingRows ?? base.corpusPipeline.roster.warming,
        collecting: summary.collectingRows ?? base.corpusPipeline.roster.collecting,
        viewerOnly: summary.viewerOnlyRows ?? base.corpusPipeline.roster.viewerOnly,
        zeroChatAfterAge: summary.zeroChatAfterAgeRows ?? base.corpusPipeline.roster.zeroChatAfterAge,
      },
    },
    liveChannels,
  }
}

function pipelineStateFromReadiness(readiness: Top500ReadinessSnapshot): HubCorpusPipeline['state'] {
  const summary = derivedReadinessSummary(readiness)
  const live = summary.liveRows ?? 0
  const collectorTracking = summary.collectorTrackingRows ?? 0
  const collectorMax = readiness.collectorMax ?? 0
  const deficit = summary.liveCollectorDeficitRows ?? 0
  if (live <= 0) return 'degraded'
  if ((summary.metadataStaleRows ?? 0) > 0) return 'critical'
  if ((summary.admissionDisabledRows ?? 0) > 0 || readiness.admissionEnabled === false) return 'critical'
  if (collectorMax <= 0 || collectorTracking <= 0) return 'critical'
  if (deficit > 0 || (summary.capacityBlockedRows ?? 0) > 0 || (summary.zeroChatAfterAgeRows ?? 0) > 0) return 'degraded'
  return 'healthy'
}

function derivedReadinessSummary(readiness: Top500ReadinessSnapshot): Top500ReadinessSummarySnapshot {
  const summary = readiness.summary ?? {}
  const rows = readiness.rows ?? []
  const liveRows = summary.liveRows ?? rows.filter((row) => row.isLive).length
  const collectorTrackingRows = summary.collectorTrackingRows ?? rows.filter((row) => row.isLive && row.collectorTracking).length
  const expectedCollectorRows =
    summary.expectedCollectorRows ?? Math.min(liveRows, readiness.collectorMax && readiness.collectorMax > 0 ? readiness.collectorMax : liveRows)
  const liveCollectorDeficitRows = summary.liveCollectorDeficitRows ?? Math.max(0, expectedCollectorRows - collectorTrackingRows)
  const metadataStaleRows = summary.metadataStaleRows ?? rows.filter((row) => row.isLive && row.metadataStale).length
  const admissionDisabledRows = summary.admissionDisabledRows ?? (readiness.admissionEnabled === false && liveRows > 0 ? liveRows : 0)
  return {
    ...summary,
    liveRows,
    collectorTrackingRows,
    expectedCollectorRows,
    liveCollectorDeficitRows,
    metadataStaleRows,
    admissionDisabledRows,
  }
}

function coverageStateWithPipeline(
  current: HubCoverage['state'] | undefined,
  pipelineState: HubCorpusPipeline['state'] | undefined,
): HubCoverage['state'] {
  const base = current ?? 'operational'
  if (pipelineState === 'critical') return 'critical'
  if (pipelineState === 'degraded' && base === 'operational') return 'degraded'
  return base
}

/**
 * Resolve a backend-relative asset path (e.g. "/emotes/<id>/1x.webp" or a
 * "/v1/..." avatar proxy) to an absolute URL against the configured backend.
 * The hub is served from the portal origin (5173 in dev, streampulse.stream in
 * prod) but emote/avatar assets live on the backend (8090 / api.streampulse.stream),
 * so relative paths would otherwise 404 against the portal and fall back to text.
 */
function absoluteAssetUrl(url: string | undefined): string | undefined {
  if (!url) return url
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  if (!url.startsWith('/')) return url
  return `${getBackendUrl()}${url}`
}

function absolutizeEmotes(emotes: HubEmote[] | undefined): HubEmote[] {
  if (!emotes) return []
  return emotes.map((emote) => ({ ...emote, imageUrl: absoluteAssetUrl(emote.imageUrl) }))
}

function absolutizeMovers(movers: HubMover[] | undefined): HubMover[] {
  if (!movers) return []
  return movers.map((mover) => ({ ...mover, profileImageUrl: absoluteAssetUrl(mover.profileImageUrl) }))
}

function absolutizeLiveChannels(channels: HubLiveChannel[] | undefined): HubLiveChannel[] {
  if (!channels) return []
  return channels.map((channel) => ({ ...channel, profileImageUrl: absoluteAssetUrl(channel.profileImageUrl) }))
}

/**
 * Defensive normaliser: the endpoint is additive and may evolve, so coerce
 * arrays/objects to safe defaults before the UI consumes them.
 */
export function normalizePublicHub(raw: Partial<PublicHub> | null | undefined): PublicHub {
  const corpusPipeline = normalizeCorpusPipeline(raw?.corpusPipeline, raw?.generatedAt)
  return {
    generatedAt: raw?.generatedAt ?? new Date().toISOString(),
    poolSize: raw?.poolSize ?? 0,
    corpus: {
      streamsTracked: raw?.corpus?.streamsTracked ?? 0,
      momentsDetected: raw?.corpus?.momentsDetected ?? 0,
      chatMessagesProcessed: raw?.corpus?.chatMessagesProcessed ?? 0,
      emotesIndexed: raw?.corpus?.emotesIndexed ?? 0,
      vodsAnalyzed: raw?.corpus?.vodsAnalyzed ?? 0,
    },
    coverage: {
      liveChannels: Math.max(raw?.coverage?.liveChannels ?? 0, corpusPipeline.roster.live),
      trackingMax: raw?.coverage?.trackingMax ?? 0,
      backfillActive: raw?.coverage?.backfillActive ?? 0,
      backfillMax: raw?.coverage?.backfillMax ?? 0,
      syncActive: raw?.coverage?.syncActive ?? 0,
      emotesIndexed: raw?.coverage?.emotesIndexed ?? 0,
      databaseOk: raw?.coverage?.databaseOk ?? true,
      state: coverageStateWithPipeline(raw?.coverage?.state ?? 'operational', corpusPipeline.state),
    },
    corpusPipeline,
    activity: {
      points: normalizeActivityPoints(raw?.activity?.points),
      windowMinutes: raw?.activity?.windowMinutes ?? 30,
      channelCount: raw?.activity?.channelCount ?? 0,
    },
    emoteIntel: {
      emotesPerMin: raw?.emoteIntel?.emotesPerMin ?? 0,
      topEmoteSharePct: raw?.emoteIntel?.topEmoteSharePct ?? 0,
      uniqueEmotes: raw?.emoteIntel?.uniqueEmotes ?? 0,
      biggestPeakPerMin: raw?.emoteIntel?.biggestPeakPerMin ?? 0,
      seventvSharePct: raw?.emoteIntel?.seventvSharePct ?? 0,
      providerShares: raw?.emoteIntel?.providerShares ?? [],
    },
    topEmotes: absolutizeEmotes(raw?.topEmotes),
    topMovers: absolutizeMovers(raw?.topMovers),
    liveChannels: absolutizeLiveChannels(raw?.liveChannels),
    moments: raw?.moments ?? [],
  }
}

function normalizeActivityPoints(points: HubActivityPoint[] | undefined): HubActivityPoint[] {
  if (!points) return []
  return points.map((point) => ({
    ...point,
    emotes: Math.max(point.emotes ?? 0, point.seventv ?? 0),
  }))
}

function normalizeTierCounts(raw: Partial<HubTierCounts> | null | undefined): HubTierCounts {
  return {
    queued: raw?.queued ?? 0,
    running: raw?.running ?? 0,
    done: raw?.done ?? 0,
    skipped: raw?.skipped ?? 0,
    failed: raw?.failed ?? 0,
    total: raw?.total ?? 0,
    eligible: raw?.eligible ?? 0,
    oldestQueuedSeconds: raw?.oldestQueuedSeconds ?? null,
  }
}

function normalizeCorpusPipeline(
  raw: Partial<HubCorpusPipeline> | null | undefined,
  generatedAt: string | undefined,
): HubCorpusPipeline {
  return {
    generatedAt: raw?.generatedAt ?? generatedAt ?? new Date().toISOString(),
    state: raw?.state ?? 'healthy',
    topN: raw?.topN ?? 100, // Legacy public hubs fall below TOP500_TARGET_N and trigger readiness fallback.
    collectorActive: raw?.collectorActive ?? 0,
    collectorMax: raw?.collectorMax ?? 0,
    roster: {
      live: raw?.roster?.live ?? 0,
      collectorTracking: raw?.roster?.collectorTracking ?? 0,
      expectedCollectorRows: raw?.roster?.expectedCollectorRows ?? 0,
      liveCollectorDeficitRows: raw?.roster?.liveCollectorDeficitRows ?? 0,
      metadataOnly: raw?.roster?.metadataOnly ?? 0,
      metadataStale: raw?.roster?.metadataStale ?? 0,
      admissionDisabled: raw?.roster?.admissionDisabled ?? 0,
      capacityBlocked: raw?.roster?.capacityBlocked ?? 0,
      warming: raw?.roster?.warming ?? 0,
      collecting: raw?.roster?.collecting ?? 0,
      viewerOnly: raw?.roster?.viewerOnly ?? 0,
      zeroChatAfterAge: raw?.roster?.zeroChatAfterAge ?? 0,
    },
    silver: normalizeTierCounts(raw?.silver),
    gold: normalizeTierCounts(raw?.gold),
  }
}
