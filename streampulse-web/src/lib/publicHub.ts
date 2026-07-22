import { DEFAULT_PRODUCTION_BACKEND_URL } from './auth'
import { apiClient, getBackendUrl, isApiError } from './apiClient'
import { absolutizeEmoteAssetUrl } from './emoteAssetUrl'
import { resolveBackendSource } from './backendSource'
import {
  normalizeHubChannelScreenerFields,
  type HubChannelScreenerFields,
} from './channelScreenerContract'
import {
  normalizeHubEmoteMarket,
  type HubEmoteMarket,
} from './emoteMarketContract'
import {
  normalizeHubPublicClips,
  type HubPublicClip,
} from './publicClipsContract'

/**
 * Mirrors PublicHubResponse from streampulse-backend/internal/analytics/hub_overview.go.
 * The /v1/public/hub endpoint is unauthenticated and hosted-safe: it only ever
 * returns aggregate corpus counts and bounded per-minute activity, never raw
 * rollups, emote maps, or principals.
 */
/** Matches hubMoversCap in streampulse-backend internal/analytics/hub_overview.go. */
export const HUB_TOP_MOVERS_CAP = 12

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
  admissionFeatureDisabled: number
  admissionDisabled: number
  capacityBlocked: number
  warming: number
  /** IRC-connected configured-roster rows aged past warming without chat. */
  connectedQuiet?: number
  collecting: number
  viewerOnly: number
  zeroChatAfterAge: number
  /** Configured-roster rows with confirmed chat/emote rollup signal. */
  configuredRosterConfirmed?: number
  /** IRC-active configured-roster rows still unresolved after canonical lookup. */
  configuredRosterUnresolved?: number
}

/**
 * Single semantic owner for configured-roster display totals.
 * Conservation: confirmed + unresolved == live (when live > 0 and payload is consistent).
 * Warming / connected-quiet are diagnostic subcategories — never folded into unresolved.
 */
export interface ConfiguredRosterDisplay {
  live: number
  confirmed: number
  unresolved: number
  warming: number
  connectedQuiet: number
  /** True when counts are finite, non-negative, and conserve against live. */
  consistent: boolean
  /** Present when the payload is impossible or overflows; UI should degrade visibly. */
  inconsistencyReason?: string
}

function sanitizeRosterCount(value: unknown): { count: number; invalid: boolean } {
  if (value == null || value === '') return { count: 0, invalid: false }
  const n = Number(value)
  if (!Number.isFinite(n)) return { count: 0, invalid: true }
  if (n < 0) return { count: 0, invalid: true }
  return { count: Math.floor(n), invalid: false }
}

/**
 * Resolve display totals for configured-roster confirmed/unresolved.
 * Does not invent healthy totals when the backend is inconsistent — keeps
 * server-owned unresolved (never warming+quiet) and marks `consistent=false`.
 * Legacy payloads without configuredRoster* fields skip conservation errors.
 */
export function resolveConfiguredRosterDisplay(
  roster: Pick<
    HubRosterSummary,
    | 'live'
    | 'collecting'
    | 'warming'
    | 'connectedQuiet'
    | 'configuredRosterConfirmed'
    | 'configuredRosterUnresolved'
  >,
): ConfiguredRosterDisplay {
  const liveParsed = sanitizeRosterCount(roster.live)
  const warmingParsed = sanitizeRosterCount(roster.warming)
  const quietParsed = sanitizeRosterCount(roster.connectedQuiet ?? 0)
  const hasExplicitConfirmed = roster.configuredRosterConfirmed != null
  const hasExplicitUnresolved = roster.configuredRosterUnresolved != null
  const confirmedSource = hasExplicitConfirmed
    ? roster.configuredRosterConfirmed
    : roster.collecting
  const confirmedParsed = sanitizeRosterCount(confirmedSource)

  let unresolvedParsed: { count: number; invalid: boolean }
  if (hasExplicitUnresolved) {
    unresolvedParsed = sanitizeRosterCount(roster.configuredRosterUnresolved)
  } else if (hasExplicitConfirmed && liveParsed.count > 0 && !confirmedParsed.invalid) {
    unresolvedParsed = {
      count: Math.max(0, liveParsed.count - confirmedParsed.count),
      invalid: false,
    }
  } else {
    unresolvedParsed = { count: 0, invalid: false }
  }

  const live = liveParsed.count
  const confirmed = confirmedParsed.count
  const unresolved = unresolvedParsed.count
  const warming = warmingParsed.count
  const connectedQuiet = quietParsed.count

  const invalidBits = [
    liveParsed.invalid ? 'live' : '',
    confirmedParsed.invalid ? 'confirmed' : '',
    unresolvedParsed.invalid ? 'unresolved' : '',
    warmingParsed.invalid ? 'warming' : '',
    quietParsed.invalid ? 'connectedQuiet' : '',
  ].filter(Boolean)

  let consistent = invalidBits.length === 0
  let inconsistencyReason: string | undefined
  const conservationApplicable = hasExplicitConfirmed || hasExplicitUnresolved

  if (invalidBits.length > 0) {
    inconsistencyReason = `Invalid roster counts: ${invalidBits.join(', ')}`
  } else if (conservationApplicable && live > 0 && confirmed + unresolved !== live) {
    consistent = false
    inconsistencyReason = `confirmed (${confirmed}) + unresolved (${unresolved}) != live (${live})`
  } else if (
    conservationApplicable &&
    live > 0 &&
    (warming > unresolved || connectedQuiet > unresolved)
  ) {
    // Subcategories may overlap each other but must not exceed the unresolved bucket.
    consistent = false
    inconsistencyReason = `warming/connectedQuiet overflow unresolved (${unresolved})`
  }

  return {
    live,
    confirmed,
    unresolved,
    warming,
    connectedQuiet,
    consistent,
    inconsistencyReason,
  }
}

/** Aggregate backfill job counts for a corpus tier (hosted-safe). */
export interface HubTierCounts {
  queued: number
  running: number
  done: number
  skipped: number
  failed: number
  total: number
  eligible: number
  oldestQueuedSeconds?: number
}

/**
 * Ingest-core observability block from streampulse-backend hub_ingest.go.
 * activeCollectors alone is not proof chat rollups are writing — pair with
 * chatActive5m / roster.configuredRosterConfirmed.
 */
export interface HubIngest {
  tieringEnabled: boolean
  coreEnabled: boolean
  dualReadMode: boolean
  shadowMode: boolean
  desiredCollectors: number
  activeCollectors: number
  boundCollectors?: number
  /** Bound-stream proxy until ROOMSTATE join-ack is exposed. */
  joinAcknowledged?: number
  awaitingJoin?: number
  connectedQuiet?: number
  chatActive5m?: number
  chatActive15m?: number
  reconnecting?: number
  unexpectedParts?: number
  admitLagSeconds: number
  joinRate1m: number
  partRate1m: number
  state: 'operational' | 'admit_lag' | 'saturated' | 'legacy' | string
}

/**
 * Hosted-safe corpus pipeline: Top-N roster tracker + Silver/Gold tier counts.
 * Aggregate counts — never per-channel rows, logins, stream IDs, or job errors.
 */
export interface HubCorpusPipeline {
  generatedAt: string
  state: 'healthy' | 'degraded' | 'critical' | string
  topN: number
  liveAdmissionEnabled: boolean
  liveAdmissionTopN: number
  maxActiveIrcChannels: number
  collectorActive: number
  collectorMax: number
  metadataSampledAgoSeconds?: number
  roster: HubRosterSummary
  silver: HubTierCounts
  gold: HubTierCounts
}

export interface HubBucketEmote {
  name: string
  provider?: string
  imageUrl?: string
  count: number
}

export interface HubActivityPoint {
  t: number
  chat: number
  /** All-provider emote count for the minute (7TV + Twitch + FFZ + BTTV). */
  emotes?: number
  seventv: number
  twitch?: number
  bttv?: number
  ffz?: number
  viewers: number
  /**
   * Three-valued chat measurement contract:
   * true = measured (including a legitimate zero), false = known gap,
   * undefined = legacy payload with unknown measurement provenance.
   */
  hasChatRollup?: boolean
  hasViewerRollup?: boolean
  /** False when the bucket period has not ended yet (open/in-progress). */
  bucketComplete?: boolean
  /** Highest-count emotes for the bucket (top 10 for inspector; chart tooltip slices to 3). */
  topEmotes?: HubBucketEmote[]
}

export interface HubActivity {
  points: HubActivityPoint[]
  windowMinutes: number
  channelCount: number
  peakViewersAt?: number
  livePoolViewerSum?: number
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
  trendSignal?: boolean
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
  title?: string
  category?: string
  profileImageUrl?: string
  streamId?: string
  startedAt?: string
  viewers: number
  chatPerMin: number
  /** All-provider emote velocity (Twitch + 7TV + FFZ + BTTV) for the recent window. */
  emotesPerMin?: number
  /** 7TV subset retained for provider-mix context and legacy fallback. */
  seventvPerMin: number
  coverageState: HubCoverageState
  trendPct: number
  trendSignal?: boolean
  streamingTogether?: boolean
  hostLogin?: string
  togetherWith?: string[]
  /** Backend-owned screener fields — never invent from client poll history. */
  screener?: HubChannelScreenerFields
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
  streamId?: string
  label: string
  detail?: string
  magnitude?: number
  at: number
  topEmotes?: HubEmote[]
}

export interface HubFeaturedMoment {
  offsetSeconds: number
  score: number
  label: string
  kind?: string
  source?: string
  chatPerMin?: number
  emotesPerMin?: number
  viewers?: number
  viewerDelta?: string
  topEmoteCode?: string
  topEmotes?: HubEmote[]
  confidence?: number
  vodState?: string
}

/** Network-wide live IRC peak row for Pulse Moments Live (multi-channel). */
export interface HubLivePulseMoment extends HubFeaturedMoment {
  login?: string
  displayName?: string
  profileImageUrl?: string
  streamId?: string
  vodId?: string
  /** Wall-clock peak time (unix ms). */
  at?: number
  category?: string
  streamStartedAt?: number
  activityTag?: string
}

export interface HubFeaturedChartPoint {
  offsetSeconds: number
  chatNorm: number
  viewersNorm: number
  emotesNorm: number
  heat: number
}

export interface HubFeaturedEmoteBurst {
  code: string
  provider?: string
  imageUrl?: string
  count: number
  deltaPct?: number
  peakOffset?: string
  peakOffsetSeconds?: number
  sharePct?: number
}

export interface HubFeaturedCoverageRow {
  label: string
  value: string
  ok: boolean
}

export interface HubFeaturedSession {
  state: 'empty' | 'ready' | string
  reason?: string
  login?: string
  displayName?: string
  streamId?: string
  category?: string
  startedAt?: string
  vodId?: string
  viewers?: number
  chatPerMin?: number
  seventvPerMin?: number
  peakCount?: number
  dataCoveragePct?: number
  topMoments?: HubFeaturedMoment[]
  chartPoints?: HubFeaturedChartPoint[]
  topEmoteBursts?: HubFeaturedEmoteBurst[]
  coverageTruth?: HubFeaturedCoverageRow[]
}

export type PublicHubInput = Omit<Partial<PublicHub>, 'corpusPipeline'> & {
  corpusPipeline?: HubCorpusPipelineInput
}

export interface PublicHub {
  generatedAt: string
  poolSize: number
  corpus: HubCorpus
  coverage: HubCoverage
  corpusPipeline: HubCorpusPipeline
  /** Present when analytics runs ingest-core; omit/legacy when unset. */
  ingest?: HubIngest
  activity: HubActivity
  emoteIntel: HubEmoteIntel
  topEmotes: HubEmote[]
  topMovers: HubMover[]
  liveChannels: HubLiveChannel[]
  moments: HubMoment[]
  livePulseMoments: HubLivePulseMoment[]
  livePulseMomentsStatus?: 'ready' | 'fallback' | 'no_peaks' | string
  livePulseMomentsReason?: string
  featuredSession: HubFeaturedSession
  /** Optional Emote Market breadth/rotation — gated until backend ships fields. */
  emoteMarket?: HubEmoteMarket | null
  /** Optional public published clips — never beta candidate queue. */
  publicClips?: HubPublicClip[]
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
  api?: string
  degraded?: boolean
  updatedAt?: string
  components?: {
    api?: string
    coverage?: string
    corpus?: string
  }
}

export type PublicHubActivityWindow = 'all' | '1y' | '6m' | '3m' | '1m' | '7d' | '24h' | '30m' | 'recent'

export type PublicHubLoadSource = 'full' | 'stats-fallback' | 'cache'

/** Sanitized corpus peaks for one activity-chart bucket. */
export interface PublicHubMomentsResponse {
  bucketT: number
  bucketStart: string
  bucketEnd: string
  hubGeneratedAt: string
  source: string
  status: 'ready' | 'empty' | string
  reason?: string
  activityWindowMinutes: number
  moments: HubLivePulseMoment[]
}

export interface FetchPublicHubResult {
  data: PublicHub
  loadSource: PublicHubLoadSource
  hubEndpointOk: boolean
  cache?: 'HIT' | 'MISS' | 'BYPASS'
  status: number
}

function publicHubPath(activityWindow?: PublicHubActivityWindow): string {
  if (!activityWindow) return '/v1/public/hub?activityWindow=24h'
  const params = new URLSearchParams({ activityWindow })
  return `/v1/public/hub?${params.toString()}`
}

function publicHubMomentsPath(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
  limit = 10,
): string {
  const params = new URLSearchParams({
    bucketT: String(bucketT),
    activityWindow,
    limit: String(limit),
  })
  return `/v1/public/hub/moments?${params.toString()}`
}

export function normalizePublicHubMoments(
  input: Partial<PublicHubMomentsResponse> | null | undefined,
): PublicHubMomentsResponse {
  const moments = (input?.moments ?? []).map((moment) => ({
    ...moment,
    topEmotes: (moment.topEmotes ?? []).map((emote) => ({
      ...emote,
      imageUrl: absolutizeEmoteAssetUrl(emote.imageUrl),
    })),
  }))
  return {
    bucketT: input?.bucketT ?? 0,
    bucketStart: input?.bucketStart ?? '',
    bucketEnd: input?.bucketEnd ?? '',
    hubGeneratedAt: input?.hubGeneratedAt ?? '',
    source: input?.source ?? 'corpus_historical',
    status: input?.status ?? 'empty',
    reason: input?.reason,
    activityWindowMinutes: input?.activityWindowMinutes ?? 0,
    moments,
  }
}

/** Fetch bounded corpus peaks for a chart bucket click. */
export async function fetchHistoricalHubMoments(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
  signal?: AbortSignal,
  limit = 10,
): Promise<PublicHubMomentsResponse> {
  const response = await apiClient<PublicHubMomentsResponse>(
    publicHubMomentsPath(bucketT, activityWindow, limit),
    { signal },
  )
  return normalizePublicHubMoments(response.data)
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Primary hub fetch only — no Top-500 readiness fan-out. */
export async function fetchPublicHubBase(
  signal?: AbortSignal,
  activityWindow?: PublicHubActivityWindow,
): Promise<FetchPublicHubResult> {
  try {
    const primary = await apiClient<PublicHub>(publicHubPath(activityWindow), { signal })
    return {
      data: normalizePublicHub(primary.data),
      loadSource: 'full',
      hubEndpointOk: true,
      cache: primary.cache,
      status: primary.status,
    }
  } catch (error) {
    // Preserve typed API errors (esp. 429 + Retry-After) for the poll hook.
    if (isApiError(error)) throw error
    return {
      data: normalizePublicHub(null),
      loadSource: 'full',
      hubEndpointOk: false,
      status: 0,
    }
  }
}

/**
 * Stats/status fallback only — never re-fetches `/v1/public/hub`.
 * Use after `fetchPublicHubBase` reports the hub endpoint unhealthy.
 */
export async function fetchPublicHubStatsFallback(
  signal?: AbortSignal,
): Promise<FetchPublicHubResult> {
  const [stats, status] = await Promise.all([
    fetchOptionalFromBackendCandidates<PublicStatsSnapshot>('/v1/public/stats', signal),
    fetchOptionalFromBackendCandidates<PublicStatusSnapshot>('/v1/public/status', signal),
  ])

  if (stats || status) {
    return {
      data: normalizePublicHub({
        generatedAt: stats?.updatedAt ?? status?.updatedAt ?? new Date().toISOString(),
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
          liveChannels: 0,
          trackingMax: 0,
          backfillActive: 0,
          backfillMax: 0,
          syncActive: 0,
          emotesIndexed: stats?.emotesIndexed ?? 0,
          // Overall public status may be degraded for coverage/corpus while the
          // API/DB host is still up — never map that to databaseOk=false.
          databaseOk:
            status?.components?.api != null
              ? status.components.api === 'up'
              : status?.api != null
                ? status.api === 'up'
                : true,
          state:
            status?.components?.coverage ??
            (status?.degraded ? 'degraded' : (status?.status ?? 'operational')),
        },
      }),
      loadSource: 'stats-fallback',
      hubEndpointOk: false,
      status: 200,
    }
  }

  throw new Error(
    resolveBackendSource() === 'local'
      ? 'Local /v1/public/hub unavailable — rebuild analytics and restart local-proxy, or switch to hosted API.'
      : 'Public hub unavailable',
  )
}

export async function fetchPublicHub(signal?: AbortSignal, activityWindow?: PublicHubActivityWindow): Promise<FetchPublicHubResult> {
  const baseResult = await fetchPublicHubBase(signal, activityWindow)
  if (baseResult.hubEndpointOk) {
    return baseResult
  }
  return fetchPublicHubStatsFallback(signal)
}

function backendCandidates(): string[] {
  const primary = normalizeUrl(getBackendUrl())
  if (resolveBackendSource(primary) === 'local') {
    return [primary]
  }
  const candidates = [primary, DEFAULT_PRODUCTION_BACKEND_URL]
    .map((value) => normalizeUrl(value))
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
  return absolutizeEmoteAssetUrl(url)
}

function absolutizeEmotes(emotes: HubEmote[] | undefined): HubEmote[] {
  if (!emotes) return []
  return emotes.map((emote) => ({ ...emote, imageUrl: absoluteAssetUrl(emote.imageUrl) }))
}

function absolutizeMovers(movers: HubMover[] | undefined): HubMover[] {
  if (!movers) return []
  return movers.map((mover) => ({ ...mover, profileImageUrl: absoluteAssetUrl(mover.profileImageUrl) }))
}

/** Join mover rows with avatars from the live-channel rail when the hub omits profileImageUrl on movers. */
export function enrichTopMoversWithAvatars(
  movers: HubMover[],
  liveChannels: HubLiveChannel[],
): HubMover[] {
  const imageByLogin = new Map<string, string>()
  for (const channel of liveChannels) {
    if (channel.profileImageUrl) {
      imageByLogin.set(channel.login.toLowerCase(), channel.profileImageUrl)
    }
  }
  return movers.map((mover) =>
    mover.profileImageUrl
      ? mover
      : { ...mover, profileImageUrl: imageByLogin.get(mover.login.toLowerCase()) },
  )
}

function compareMoverVelocity(a: HubMover | HubLiveChannel, b: HubMover | HubLiveChannel): number {
  const aEmotes = a.emotesPerMin ?? 0
  const bEmotes = b.emotesPerMin ?? 0
  if (aEmotes !== bEmotes) return bEmotes - aEmotes
  if (a.seventvPerMin !== b.seventvPerMin) return b.seventvPerMin - a.seventvPerMin
  return b.chatPerMin - a.chatPerMin
}

function liveChannelToMover(channel: HubLiveChannel): HubMover {
  return {
    login: channel.login,
    displayName: channel.displayName,
    category: channel.category,
    profileImageUrl: channel.profileImageUrl,
    viewers: channel.viewers,
    emotesPerMin: channel.emotesPerMin,
    seventvPerMin: channel.seventvPerMin,
    chatPerMin: channel.chatPerMin,
    trendPct: channel.trendPct,
    trendSignal: channel.trendSignal,
  }
}

/** Rank live hub channels by emote velocity (matches backend topMovers ordering). */
export function buildTopMoversFromLiveChannels(
  liveChannels: HubLiveChannel[],
  cap = HUB_TOP_MOVERS_CAP,
): HubMover[] {
  return liveChannels
    .filter((channel) => (channel.emotesPerMin ?? 0) > 0 || channel.chatPerMin > 0)
    .sort(compareMoverVelocity)
    .slice(0, cap)
    .map(liveChannelToMover)
}

/**
 * Prefer live-channel velocity rows so the portal can show the full cap even when
 * hosted `/v1/public/hub` still returns a legacy 8-row topMovers payload.
 */
export function resolveHubTopMovers(
  apiMovers: HubMover[],
  liveChannels: HubLiveChannel[],
  cap = HUB_TOP_MOVERS_CAP,
): HubMover[] {
  const fromLive = buildTopMoversFromLiveChannels(liveChannels, cap)
  if (fromLive.length > 0) {
    return enrichTopMoversWithAvatars(fromLive, liveChannels)
  }
  return enrichTopMoversWithAvatars(apiMovers, liveChannels).slice(0, cap)
}

function absolutizeLiveChannels(channels: HubLiveChannel[] | undefined): HubLiveChannel[] {
  if (!channels) return []
  return channels.map((channel) => {
    const screener = normalizeHubChannelScreenerFields(channel.screener)
    return {
      ...channel,
      profileImageUrl: absoluteAssetUrl(channel.profileImageUrl),
      screener: screener ?? undefined,
    }
  })
}

function absolutizeMoments(moments: HubMoment[] | undefined): HubMoment[] {
  if (!moments) return []
  return moments.map((moment) => ({ ...moment, topEmotes: absolutizeEmotes(moment.topEmotes) }))
}

/**
 * Defensive normaliser: the endpoint is additive and may evolve, so coerce
 * arrays/objects to safe defaults before the UI consumes them.
 */
export function normalizePublicHub(raw: PublicHubInput | null | undefined): PublicHub {
  const corpusPipeline = normalizeCorpusPipeline(raw?.corpusPipeline, raw?.generatedAt)
  const hasAuthoritativeRosterLive = raw?.corpusPipeline?.roster?.live != null
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
      // Older hub payloads used coverage.liveChannels for pool capacity. Once
      // roster.live is present it is the authoritative count of channels that
      // are actually live; do not present the tracked pool size as liveness.
      liveChannels: hasAuthoritativeRosterLive
        ? corpusPipeline.roster.live
        : (raw?.coverage?.liveChannels ?? 0),
      trackingMax: raw?.coverage?.trackingMax ?? 0,
      backfillActive: raw?.coverage?.backfillActive ?? 0,
      backfillMax: raw?.coverage?.backfillMax ?? 0,
      syncActive: raw?.coverage?.syncActive ?? 0,
      emotesIndexed: raw?.coverage?.emotesIndexed ?? 0,
      databaseOk: raw?.coverage?.databaseOk ?? true,
      state: coverageStateWithPipeline(raw?.coverage?.state ?? 'operational', corpusPipeline.state),
    },
    corpusPipeline,
    ingest: normalizeIngest(raw?.ingest),
    activity: {
      points: normalizeActivityPoints(raw?.activity?.points),
      windowMinutes: raw?.activity?.windowMinutes ?? 7 * 24 * 60,
      channelCount: raw?.activity?.channelCount ?? 0,
      peakViewersAt: raw?.activity?.peakViewersAt,
      livePoolViewerSum: raw?.activity?.livePoolViewerSum,
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
    moments: absolutizeMoments(raw?.moments),
    livePulseMoments: normalizeLivePulseMoments(raw?.livePulseMoments),
    livePulseMomentsStatus: raw?.livePulseMomentsStatus,
    livePulseMomentsReason: raw?.livePulseMomentsReason,
    featuredSession: normalizeFeaturedSession(raw?.featuredSession),
    emoteMarket: normalizeHubEmoteMarket(raw?.emoteMarket),
    publicClips: normalizeHubPublicClips(raw?.publicClips),
  }
}

function normalizeIngest(raw: Partial<HubIngest> | undefined): HubIngest | undefined {
  if (!raw) return undefined
  const active = raw.activeCollectors ?? 0
  const chat5m = raw.chatActive5m ?? 0
  return {
    tieringEnabled: Boolean(raw.tieringEnabled),
    coreEnabled: Boolean(raw.coreEnabled),
    dualReadMode: Boolean(raw.dualReadMode),
    shadowMode: Boolean(raw.shadowMode),
    desiredCollectors: raw.desiredCollectors ?? 0,
    activeCollectors: active,
    boundCollectors: raw.boundCollectors ?? 0,
    joinAcknowledged: raw.joinAcknowledged ?? raw.boundCollectors ?? active,
    awaitingJoin: raw.awaitingJoin ?? Math.max(0, (raw.desiredCollectors ?? 0) - active),
    connectedQuiet: raw.connectedQuiet ?? Math.max(0, active - chat5m),
    chatActive5m: chat5m,
    chatActive15m: raw.chatActive15m ?? 0,
    reconnecting: raw.reconnecting ?? 0,
    unexpectedParts: raw.unexpectedParts ?? 0,
    admitLagSeconds: raw.admitLagSeconds ?? 0,
    joinRate1m: raw.joinRate1m ?? 0,
    partRate1m: raw.partRate1m ?? 0,
    state: raw.state ?? 'legacy',
  }
}

function normalizeLivePulseMoments(raw: HubLivePulseMoment[] | undefined): HubLivePulseMoment[] {
  if (!raw?.length) return []
  return raw.map((moment) => ({
    ...moment,
    topEmotes: absolutizeEmotes(moment.topEmotes),
  }))
}

function normalizeFeaturedSession(raw: Partial<HubFeaturedSession> | undefined): HubFeaturedSession {
  if (!raw) return { state: 'empty', reason: 'no_qualifying_session' }
  return {
    state: raw.state ?? 'empty',
    reason: raw.reason,
    login: raw.login,
    displayName: raw.displayName,
    streamId: raw.streamId,
    category: raw.category,
    startedAt: raw.startedAt,
    vodId: raw.vodId,
    viewers: raw.viewers,
    chatPerMin: raw.chatPerMin,
    seventvPerMin: raw.seventvPerMin,
    peakCount: raw.peakCount,
    dataCoveragePct: raw.dataCoveragePct,
    topMoments: (raw.topMoments ?? []).map((moment) => ({
      ...moment,
      topEmotes: absolutizeEmotes(moment.topEmotes),
    })),
    chartPoints: raw.chartPoints ?? [],
    topEmoteBursts: (raw.topEmoteBursts ?? []).map((burst) => ({
      ...burst,
      imageUrl: absoluteAssetUrl(burst.imageUrl),
      peakOffsetSeconds: burst.peakOffsetSeconds,
    })),
    coverageTruth: raw.coverageTruth ?? [],
  }
}

function normalizeActivityPoints(points: HubActivityPoint[] | undefined): HubActivityPoint[] {
  if (!points) return []
  return points.map((point) => ({
    ...point,
    emotes: Math.max(point.emotes ?? 0, point.seventv ?? 0, point.twitch ?? 0, point.bttv ?? 0, point.ffz ?? 0),
    twitch: point.twitch ?? 0,
    bttv: point.bttv ?? 0,
    ffz: point.ffz ?? 0,
    hasChatRollup: point.hasChatRollup,
    hasViewerRollup: point.hasViewerRollup,
    bucketComplete: point.bucketComplete,
    topEmotes: Array.isArray(point.topEmotes)
      ? point.topEmotes
          .filter((e) => e && typeof e.name === 'string' && e.name.length > 0)
          .slice(0, 10)
          .map((e) => ({
            name: e.name,
            provider: e.provider,
            imageUrl: absolutizeEmoteAssetUrl(e.imageUrl),
            count: Number(e.count) || 0,
          }))
      : undefined,
  }))
}

function emptyTierCounts(): HubTierCounts {
  return { queued: 0, running: 0, skipped: 0, done: 0, failed: 0, total: 0, eligible: 0 }
}

/** Test/fixture default for Silver/Gold tier counts on hub pipeline mocks. */
export const EMPTY_HUB_TIER_COUNTS: HubTierCounts = emptyTierCounts()

function normalizeTierCounts(raw: Partial<HubTierCounts> | undefined): HubTierCounts {
  return {
    queued: raw?.queued ?? 0,
    running: raw?.running ?? 0,
    done: raw?.done ?? 0,
    skipped: raw?.skipped ?? 0,
    failed: raw?.failed ?? 0,
    total: raw?.total ?? 0,
    eligible: raw?.eligible ?? 0,
    oldestQueuedSeconds: raw?.oldestQueuedSeconds,
  }
}

export type HubCorpusPipelineInput = Partial<
  Omit<HubCorpusPipeline, 'roster' | 'silver' | 'gold'>
> & {
  roster?: Partial<HubRosterSummary>
  silver?: Partial<HubTierCounts>
  gold?: Partial<HubTierCounts>
}

/** Build a normalized corpus pipeline block for tests and story fixtures. */
export function hubCorpusPipelineFixture(
  partial: HubCorpusPipelineInput = {},
): HubCorpusPipeline {
  return normalizeCorpusPipeline(partial, partial.generatedAt)
}

function normalizeCorpusPipeline(
  raw: HubCorpusPipelineInput | Partial<HubCorpusPipeline> | null | undefined,
  generatedAt: string | undefined,
): HubCorpusPipeline {
  return {
    generatedAt: raw?.generatedAt ?? generatedAt ?? new Date().toISOString(),
    state: raw?.state ?? 'healthy',
    topN: raw?.topN ?? 500,
    liveAdmissionEnabled: raw?.liveAdmissionEnabled ?? false,
    liveAdmissionTopN: raw?.liveAdmissionTopN ?? raw?.topN ?? 500,
    maxActiveIrcChannels: raw?.maxActiveIrcChannels ?? raw?.collectorMax ?? 0,
    collectorActive: raw?.collectorActive ?? 0,
    collectorMax: raw?.collectorMax ?? 0,
    metadataSampledAgoSeconds: raw?.metadataSampledAgoSeconds,
    roster: {
      live: raw?.roster?.live ?? 0,
      collectorTracking: raw?.roster?.collectorTracking ?? 0,
      expectedCollectorRows: raw?.roster?.expectedCollectorRows ?? 0,
      liveCollectorDeficitRows: raw?.roster?.liveCollectorDeficitRows ?? 0,
      metadataOnly: raw?.roster?.metadataOnly ?? 0,
      metadataStale: raw?.roster?.metadataStale ?? 0,
      admissionFeatureDisabled: raw?.roster?.admissionFeatureDisabled ?? raw?.roster?.admissionDisabled ?? 0,
      admissionDisabled: raw?.roster?.admissionDisabled ?? 0,
      capacityBlocked: raw?.roster?.capacityBlocked ?? 0,
      warming: raw?.roster?.warming ?? 0,
      connectedQuiet: raw?.roster?.connectedQuiet ?? 0,
      collecting: raw?.roster?.collecting ?? 0,
      viewerOnly: raw?.roster?.viewerOnly ?? 0,
      zeroChatAfterAge: raw?.roster?.zeroChatAfterAge ?? 0,
      configuredRosterConfirmed: raw?.roster?.configuredRosterConfirmed,
      configuredRosterUnresolved: raw?.roster?.configuredRosterUnresolved,
    },
    silver: normalizeTierCounts(raw?.silver ?? emptyTierCounts()),
    gold: normalizeTierCounts(raw?.gold ?? emptyTierCounts()),
  }
}

export type HubValidationSeverity = 'warn' | 'error'

export interface HubValidationIssue {
  code: string
  message: string
  severity: HubValidationSeverity
}

/** Client-side sanity checks — surfaces contract drift without mutating payload. */
export function validatePublicHubInvariants(hub: PublicHub): HubValidationIssue[] {
  const issues: HubValidationIssue[] = []

  if (hub.corpusPipeline.roster.live > hub.liveChannels.length + 2) {
    issues.push({
      code: 'live_roster_vs_hub_rows',
      severity: 'warn',
      message: `Top-N roster reports ${hub.corpusPipeline.roster.live} live but hub returns ${hub.liveChannels.length} channel rows (bounded payload).`,
    })
  }

  if (hub.corpusPipeline.roster.collectorTracking > hub.corpusPipeline.roster.live) {
    issues.push({
      code: 'collector_tracking_gt_live',
      severity: 'error',
      message: 'collectorTracking exceeds roster live count.',
    })
  }

  if (hub.corpusPipeline.roster.liveCollectorDeficitRows > hub.corpusPipeline.roster.expectedCollectorRows) {
    issues.push({
      code: 'deficit_gt_expected',
      severity: 'error',
      message: 'liveCollectorDeficitRows exceeds expectedCollectorRows.',
    })
  }

  for (let i = 1; i < hub.activity.points.length; i += 1) {
    const prev = hub.activity.points[i - 1]?.t ?? 0
    const next = hub.activity.points[i]?.t ?? 0
    if (next <= prev) {
      issues.push({
        code: 'activity_points_unsorted',
        severity: 'error',
        message: `Activity points not strictly increasing at index ${i}.`,
      })
      break
    }
  }

  hub.activity.points.forEach((point, index) => {
    const emotes = point.emotes ?? 0
    const seventv = point.seventv ?? 0
    if (emotes > 0 && emotes < seventv) {
      issues.push({
        code: 'emotes_lt_seventv',
        severity: 'warn',
        message: `Activity point ${index}: emotes (${emotes}) below seventv (${seventv}).`,
      })
    }
    if (point.chat < 0 || emotes < 0 || (point.viewers ?? 0) < 0) {
      issues.push({
        code: 'negative_activity_metric',
        severity: 'error',
        message: `Activity point ${index} has negative metrics.`,
      })
    }
  })

  if (hub.activity.channelCount > 0 && hub.poolSize > 0 && hub.activity.channelCount > hub.poolSize * 2) {
    issues.push({
      code: 'activity_channel_count_high',
      severity: 'warn',
      message: `activity.channelCount (${hub.activity.channelCount}) looks high vs poolSize (${hub.poolSize}).`,
    })
  }

  if (
    hub.activity.windowMinutes > 30 &&
    hub.liveChannels.length >= 2 &&
    hub.activity.points.length > 0
  ) {
    const livePoolViewers = hub.liveChannels.reduce((sum, ch) => sum + (ch.viewers ?? 0), 0)
    const peakActivityViewers = hub.activity.points.reduce(
      (max, point) => Math.max(max, point.viewers ?? 0),
      0,
    )
    if (livePoolViewers > 0 && peakActivityViewers > 0 && peakActivityViewers < livePoolViewers * 0.75) {
      issues.push({
        code: 'activity_viewers_below_live_pool',
        severity: 'warn',
        message: `Long-window activity peak viewers (${peakActivityViewers}) is below the live pool sum (${livePoolViewers}); chart may be single-channel not global.`,
      })
    }
  }

  const activeCollectors = hub.ingest?.activeCollectors ?? 0
  const collecting = hub.corpusPipeline.roster.collecting
  if (activeCollectors > 0 && collecting === 0) {
    issues.push({
      code: 'irc_collectors_without_chat_rollups',
      severity: 'error',
      message: `ingest.activeCollectors=${activeCollectors} but roster.collecting=0 — IRC joined without live chat rollups (check BindStream / ingest flush).`,
    })
  }

  const chatNz = hub.activity.points.filter((p) => (p.chat ?? 0) > 0).length
  if (activeCollectors > 0 && hub.activity.points.length >= 2 && chatNz === 0) {
    issues.push({
      code: 'irc_active_but_activity_chat_empty',
      severity: 'warn',
      message: 'IRC collectors are active but activity.points have no chat>0 buckets (viewer-only / drought).',
    })
  }

  const rosterDisplay = resolveConfiguredRosterDisplay(hub.corpusPipeline.roster)
  if (!rosterDisplay.consistent) {
    issues.push({
      code: 'configured_roster_conservation',
      severity: 'error',
      message:
        rosterDisplay.inconsistencyReason ??
        'configuredRosterConfirmed + configuredRosterUnresolved must equal roster.live',
    })
  }

  return issues
}
