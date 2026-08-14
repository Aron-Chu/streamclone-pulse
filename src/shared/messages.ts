export type MessageType =
  | 'TRACK'
  | 'GET_PULSE'
  | 'GET_ALWAYS_TRACKED'
  | 'GET_CLIP'
  | 'HEALTH'
  | 'LIST_WATCHLIST'
  | 'ADD_WATCHLIST'
  | 'REMOVE_WATCHLIST'
  | 'SYNC_WATCHLIST'
  | 'SET_AUTO_UPDATE'
  | 'LIST_PAST_VODS'
  | 'FETCH_EMOTE_IMAGE'
  | 'HINT_VOD'
  | 'DISCOVER_LIVE_VOD'
  | 'GET_PULSE_ARCHIVE_CANDIDATE'
  | 'GET_PULSE_VOD'
  | 'GET_PULSE_STREAM'
  | 'PULSE_UPDATE'
  | 'VOD_PULSE_UPDATE'
  | 'PULSE_STREAM_UPDATE'

export interface TrackMessage {
  type: 'TRACK'
  login: string
}

export interface GetAlwaysTrackedMessage {
  type: 'GET_ALWAYS_TRACKED'
}

export interface GetPulseMessage {
  type: 'GET_PULSE'
  login: string
  /** When true, POST /watch and start polling. Default false — use TRACK for that. */
  watch?: boolean
  /** Bypass session cache when navigation or page state proves it may be stale. */
  forceRefresh?: boolean
  window?: 'recent' | 'full'
  /** Reject cached pulse when the viewer moved to a different live stream. */
  streamId?: string
}

export interface GetClipMessage {
  type: 'GET_CLIP'
  login: string
  startedAt?: string
  isLive?: boolean
}

export interface ExtensionClip {
  id: string
  title: string
  url: string
  thumbnailUrl?: string
  viewCount?: number
  durationSeconds?: number
  createdAt?: string
}

export interface ListWatchlistMessage {
  type: 'LIST_WATCHLIST'
}

export interface AddWatchlistMessage {
  type: 'ADD_WATCHLIST'
  login: string
}

export interface RemoveWatchlistMessage {
  type: 'REMOVE_WATCHLIST'
  login: string
}

export interface SyncWatchlistMessage {
  type: 'SYNC_WATCHLIST'
}

export interface SetAutoUpdateMessage {
  type: 'SET_AUTO_UPDATE'
  enabled: boolean
}

export interface ListPastVodsMessage {
  type: 'LIST_PAST_VODS'
  login: string
  liveStreamId?: string
  isLive?: boolean
}

export interface FetchEmoteImageMessage {
  type: 'FETCH_EMOTE_IMAGE'
  url: string
}

export type PastVodAnalyticsStatus =
  | 'current-live'
  | 'synced'
  | 'stats-only'
  | 'sync-interrupted'
  | 'unknown'

export interface PastVodRow {
  streamId: string
  videoId?: string
  title: string
  category?: string
  thumbnailUrl?: string
  startedAt?: string
  durationMinutes?: number
  avgViewers?: number
  peakViewers?: number
  analyticsStatus: PastVodAnalyticsStatus
}

export interface HealthMessage {
  type: 'HEALTH'
}

export type BackgroundRequest =
  | TrackMessage
  | GetPulseMessage
  | GetAlwaysTrackedMessage
  | GetClipMessage
  | HealthMessage
  | ListWatchlistMessage
  | AddWatchlistMessage
  | RemoveWatchlistMessage
  | SyncWatchlistMessage
  | SetAutoUpdateMessage
  | ListPastVodsMessage
  | FetchEmoteImageMessage
  | HintVodMessage
  | DiscoverLiveVodMessage
  | GetPulseArchiveCandidateMessage
  | GetPulseVodMessage
  | GetPulseStreamMessage
  | LoadMissedMomentsMessage
  | GetPulseBackfillStatusMessage

export interface ExtensionEmote {
  id?: string
  providerEmoteId?: string
  name: string
  imageUrl?: string
  count: number
  provider?: string
  zeroWidth?: boolean
  animated?: boolean
}

export type EmoteSyncState = 'ready' | 'syncing' | 'stale' | 'unavailable' | 'aggregate_only'

export interface EmoteSyncSnapshot {
  state: EmoteSyncState
  provider?: string
  lastSyncedAt?: string
  eventApiActive?: boolean
  source?: string
  message?: string
}

export interface ExtensionRollup {
  offsetSeconds: number
  chatCount: number
  sevenTvEmoteCount: number
  totalEmoteCount?: number
  viewerCount?: number
  keywordCount?: number
  topEmotes?: ExtensionEmote[]
  missing?: boolean
}

export interface ExtensionPeak {
  offsetSeconds: number
  score: number
  reasons: string[]
  reasonLabel?: string
  dominantSignal: string
  chatCount?: number
  emoteCount?: number
  topEmotes?: ExtensionEmote[]
}

export interface ExtensionLanes {
  composite: number[]
  chat: number[]
  seventv: number[]
  viewers?: number[]
  keywords?: number[]
}

export interface ExtensionHealthResponse {
  ok: boolean
  version: string
  time: number
  hostedMode?: boolean
  helixEnabled?: boolean
  buildSha?: string
  buildId?: string
  imageDigest?: string
  serviceGeneration?: string
  identityComplete?: boolean
  degraded?: {
    runtimeIdentity?: boolean
    vodLookup?: boolean
    backfill?: boolean
    liveTracking?: boolean
    bffCache?: boolean
  }
  routes?: {
    archiveCandidate?: boolean
    vodHint?: boolean
    backfill?: boolean
  }
  capabilities?: {
    archiveCandidate?: boolean
    vodLookup?: boolean
    backfill?: boolean
  }
}

export interface PulseRecapEmote {
  code: string
  count: number
  provider?: string
  id?: string
  providerEmoteId?: string
  imageUrl?: string
}

export interface ExtensionGameSegment {
  /** Stable analytics category-segment id when the backend has one. */
  id?: number | string
  /** Stable Twitch category/game identity for artwork and revisits. */
  categoryId?: string
  gameName: string
  boxArtUrl?: string
  offsetSeconds: number
  durationSeconds: number
}

export interface PulseRecapMoment {
  offsetSeconds: number
  score: number
  reasons: string[]
  chatCount?: number
  emoteCount?: number
  viewerCount?: number
  topEmotes?: PulseRecapEmote[]
}

export interface PulseStreamRecap {
  streamId: string
  login: string
  vodId?: string
  durationSeconds: number
  totalMessages: number
  peakChatPerMin: number
  topMoments: PulseRecapMoment[]
  topEmotes: PulseRecapEmote[]
  biggestChatSpike?: {
    offsetSeconds: number
    chatPerMin: number
  }
  funniestEmoteBurst?: {
    offsetSeconds: number
    code?: string
    count: number
  }
  clipCandidates: PulseRecapMoment[]
  /** Backend emote catalog enrichment state for recap rows. */
  emoteEnrichmentStatus?: 'complete' | 'partial' | 'missing' | string
}

export interface HintVodMessage {
  type: 'HINT_VOD'
  login: string
  streamId: string
  vodId: string
}

export interface GetPulseVodMessage {
  type: 'GET_PULSE_VOD'
  vodId: string
  /** Stable channel context from /{login}/videos/{id}; pure VOD routes omit it. */
  channelLogin?: string
  /** Exact VOD-scoped bridge identity, never a page scrape. */
  streamId?: string
}

export interface GetPulseStreamMessage {
  type: 'GET_PULSE_STREAM'
  streamId: string
  broadcasterLogin: string
  allowLiveBridge?: boolean
  window?: 'recent' | 'full'
}

export interface DiscoverLiveVodMessage {
  type: 'DISCOVER_LIVE_VOD'
  login: string
}

export interface GetPulseArchiveCandidateMessage {
  type: 'GET_PULSE_ARCHIVE_CANDIDATE'
  streamId: string
  login: string
}

export interface LoadMissedMomentsMessage {
  type: 'LOAD_MISSED_MOMENTS'
  login: string
  streamId: string
  vodId?: string
  fromOffsetSeconds?: number
  toOffsetSeconds?: number
}

export interface GetPulseBackfillStatusMessage {
  type: 'GET_PULSE_BACKFILL_STATUS'
  jobId: string
}

export type PulseCoverageState =
  | 'full_stream_tracked'
  | 'partial_tracking'
  | 'missing_ranges_detected'
  | 'waiting_for_vod'
  | 'vod_unavailable'
  | 'backfill_running'
  | 'backfill_failed'

export interface PulseCoverageRange {
  fromOffsetSeconds: number
  toOffsetSeconds: number
}

export interface PulseCoverage {
  state: PulseCoverageState
  coverageStartOffsetSeconds: number
  coverageEndOffsetSeconds: number
  hasFullStreamCoverage: boolean
  /** True when IRC rollups begin within backend stream-start tolerance. */
  trackedFromStart?: boolean
  hasGaps: boolean
  missingRanges?: PulseCoverageRange[]
  canBackfill: boolean
  backfillReason?: string
  /** Backend VOD availability hint for backfill gating. */
  vodStatus?: string
  /** Whether the user may trigger a manual VOD retry from the extension. */
  manualRetryAllowed?: boolean
  /** Primary chat rollup source (irc, vod, etc.). */
  chatSource?: string
  chatSourceDetail?: string
  /** Stable copy id for UI — prefer with message over client derivation. */
  copyKey?: string
  message: string
}

export interface PulseBackfillJob {
  jobId: string
  streamId: string
  login: string
  status: string
  message: string
  progress?: {
    segmentsDone?: number
    segmentsTotal?: number
    percent?: number
  }
  range: PulseCoverageRange
  error?: string
  createdAt?: string
  updatedAt?: string
}

export interface PulsePayload {
  login: string
  /** `live_dvr` is provisional live analytics, never a permanent VOD identity. */
  mode?: string
  provisional?: boolean
  resolutionState?: string
  retryable?: boolean
  isLive: boolean
  tracking: boolean
  streamId?: string
  vodId?: string | null
  startedAt?: string
  endedAt?: string
  /** Legacy alias when backend sends latest stream end without endedAt. */
  latestEndedAt?: string
  title?: string
  category?: string
  peakViewers?: number
  peakEmotePerMin?: number
  durationSeconds?: number
  currentOffsetSeconds: number
  coverageStartOffsetSeconds?: number
  viewerStartOffsetSeconds?: number
  coverage?: PulseCoverage
  topEmotes?: ExtensionEmote[]
  rollups: ExtensionRollup[]
  fullRollups?: ExtensionRollup[]
  lanes: ExtensionLanes
  peaks?: ExtensionPeak[]
  recap: PulseStreamRecap | null
  games?: ExtensionGameSegment[]
  emoteSync?: EmoteSyncSnapshot
  helixEnabled?: boolean
  /** Hosted extension gate — false when login is outside the Pulse roster / cap tier. */
  rosterEligible?: boolean
  /** @deprecated Read rosterEligible; kept for one release of dual-emit from hosted BFF. */
  top500Eligible?: boolean
}

export interface ExtensionHostedCapStatus {
  activeLimit: number
  activeCount: number | null
  activeAvailable: boolean
  backfillLimit?: number | null
  backfillActive?: number | null
}

export interface ExtensionCoverageTierResponse {
  login: string
  channelId?: string | null
  displayName?: string | null
  coverageTier: string
  hostedCap: ExtensionHostedCapStatus
  liveMetadata?: {
    available?: boolean
    source?: string
    isLive?: boolean | null
    streamId?: string | null
    title?: string | null
    category?: string | null
    startedAt?: string | null
    viewerCount?: number | null
    language?: string | null
    tags?: string[]
    snapshotTime?: string | null
    freshnessSeconds?: number | null
  }
  reasonCodes?: string[]
}

export interface PulseUpdateMessage {
  type: 'PULSE_UPDATE'
  login: string
  payload: PulsePayload | null
  error?: string
  coverageTier?: ExtensionCoverageTierResponse | null
}

export interface PulseStreamUpdateMessage {
  type: 'PULSE_STREAM_UPDATE'
  streamId: string
  login: string
  payload: PulsePayload | null
  error?: string
}

export interface PulseArchiveCandidate {
  streamId: string
  navigationVodId?: string
  navigationValidated: boolean
  analyticsResolutionState: string
  analyticsAvailable: boolean
  originDeltaSeconds?: number
  persisted: boolean
  retryable?: boolean
}

export interface VodPulseUpdateMessage {
  type: 'VOD_PULSE_UPDATE'
  vodId: string
  vodPulse: import('../types/vodPulseTypes.ts').ExtensionVodPulseResponse | null
  provisionalPulse?: PulsePayload | null
  error?: string
}

export type BackgroundResponse =
  | PulseUpdateMessage
  | PulseStreamUpdateMessage
  | VodPulseUpdateMessage
  | { type: 'CLIP'; clip: ExtensionClip | null; error?: string }
  | {
      type: 'HEALTH'
      ok: boolean
      version?: string
      helixEnabled?: boolean
      buildSha?: string
      buildId?: string
      imageDigest?: string
      serviceGeneration?: string
      identityComplete?: boolean
      hostedMode?: boolean
      degraded?: ExtensionHealthResponse['degraded']
      routes?: ExtensionHealthResponse['routes']
      capabilities?: ExtensionHealthResponse['capabilities']
      error?: string
    }
  | { type: 'WATCHLIST'; channels: string[]; error?: string }
  | { type: 'SYNC_WATCHLIST'; channels: string[]; error?: string }
  | { type: 'PAST_VODS'; items: PastVodRow[]; error?: string }
  | { type: 'EMOTE_IMAGE'; mimeType?: string; buffer?: ArrayBuffer; error?: string }
  | { type: 'PULSE_BACKFILL'; job: PulseBackfillJob | null; error?: string }
  | { type: 'PULSE_BACKFILL_STATUS'; job: PulseBackfillJob | null; error?: string }
  | { type: 'ALWAYS_TRACKED'; channels: string[]; error?: string }
  | { type: 'DISCOVER_LIVE_VOD'; result: import('./twitchVodGql.ts').GqlVodDiscoveryResult; error?: string }
  | { type: 'PULSE_ARCHIVE_CANDIDATE'; streamId: string; candidate: PulseArchiveCandidate | null; error?: string }
  | { ok: boolean; error?: string }
