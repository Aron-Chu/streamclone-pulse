export type MessageType =
  | 'TRACK'
  | 'UNTRACK'
  | 'GET_PULSE'
  | 'GET_COVERAGE'
  | 'GET_ALWAYS_TRACKED'
  | 'GET_CLIP'
  | 'HEALTH'
  | 'OPEN_OPTIONS'
  | 'LIST_BOOKMARKS'
  | 'SAVE_BOOKMARK'
  | 'DELETE_BOOKMARK'
  | 'LIST_WATCHLIST'
  | 'ADD_WATCHLIST'
  | 'REMOVE_WATCHLIST'
  | 'SYNC_WATCHLIST'
  | 'SET_AUTO_UPDATE'
  | 'LIST_PAST_VODS'
  | 'FETCH_EMOTE_IMAGE'
  | 'HINT_VOD'
  | 'DISCOVER_LIVE_VOD'
  | 'GET_PULSE_VOD'
  | 'PULSE_UPDATE'
  | 'VOD_PULSE_UPDATE'

export interface TrackMessage {
  type: 'TRACK'
  login: string
}

export interface UntrackMessage {
  type: 'UNTRACK'
  login: string
}

export interface GetCoverageMessage {
  type: 'GET_COVERAGE'
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

export interface OpenOptionsMessage {
  type: 'OPEN_OPTIONS'
}

export interface ListBookmarksMessage {
  type: 'LIST_BOOKMARKS'
  login?: string
  streamId?: string
  vodId?: string
}

export interface SaveBookmarkMessage {
  type: 'SAVE_BOOKMARK'
  bookmark: CreatePulseBookmarkInput
}

export interface DeleteBookmarkMessage {
  type: 'DELETE_BOOKMARK'
  id: string
}

export type BackgroundRequest =
  | TrackMessage
  | UntrackMessage
  | GetPulseMessage
  | GetCoverageMessage
  | GetAlwaysTrackedMessage
  | GetClipMessage
  | HealthMessage
  | OpenOptionsMessage
  | ListBookmarksMessage
  | SaveBookmarkMessage
  | DeleteBookmarkMessage
  | ListWatchlistMessage
  | AddWatchlistMessage
  | RemoveWatchlistMessage
  | SyncWatchlistMessage
  | SetAutoUpdateMessage
  | ListPastVodsMessage
  | FetchEmoteImageMessage
  | HintVodMessage
  | DiscoverLiveVodMessage
  | GetPulseVodMessage
  | GetPulseDebugLogMessage
  | AppendPulseDebugMessage
  | ClearPulseDebugLogMessage
  | LoadMissedMomentsMessage
  | GetPulseBackfillStatusMessage

export interface ExtensionEmote {
  id?: string
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
  helixEnabled?: boolean
}

export interface PulseBookmark {
  id: string
  login: string
  streamId?: string
  vodId?: string
  offsetSeconds: number
  label: string
  notes: string
  score?: number
  source: 'web' | 'extension'
  createdAt: string
  updatedAt: string
}

export interface CreatePulseBookmarkInput {
  login?: string
  streamId?: string
  vodId?: string
  offsetSeconds: number
  label?: string
  notes?: string
  score?: number
  source: 'extension'
}

export interface PulseRecapEmote {
  code: string
  count: number
  provider?: string
  id?: string
  imageUrl?: string
}

export interface ExtensionGameSegment {
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

export interface GetPulseDebugLogMessage {
  type: 'GET_PULSE_DEBUG_LOG'
}

export interface AppendPulseDebugMessage {
  type: 'APPEND_PULSE_DEBUG'
  entry: import('./pulseDebug.ts').PulseDebugEntry
}

export interface ClearPulseDebugLogMessage {
  type: 'CLEAR_PULSE_DEBUG_LOG'
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
}

export interface DiscoverLiveVodMessage {
  type: 'DISCOVER_LIVE_VOD'
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

export interface VodPulseUpdateMessage {
  type: 'VOD_PULSE_UPDATE'
  vodId: string
  vodPulse: import('../types/vodPulseTypes.ts').ExtensionVodPulseResponse | null
  error?: string
}

export type BackgroundResponse =
  | PulseUpdateMessage
  | VodPulseUpdateMessage
  | { type: 'CLIP'; clip: ExtensionClip | null; error?: string }
  | { type: 'HEALTH'; ok: boolean; version?: string; helixEnabled?: boolean; error?: string }
  | { type: 'PULSE_DEBUG_LOG'; entries: import('./pulseDebug.ts').PulseDebugEntry[] }
  | { type: 'BOOKMARKS'; items: PulseBookmark[]; error?: string }
  | { type: 'BOOKMARK'; item: PulseBookmark; error?: string }
  | { type: 'DELETE_BOOKMARK'; ok: boolean; error?: string }
  | { type: 'WATCHLIST'; channels: string[]; error?: string }
  | { type: 'SYNC_WATCHLIST'; channels: string[]; error?: string }
  | { type: 'PAST_VODS'; items: PastVodRow[]; error?: string }
  | { type: 'EMOTE_IMAGE'; mimeType?: string; buffer?: ArrayBuffer; error?: string }
  | { type: 'PULSE_BACKFILL'; job: PulseBackfillJob | null; error?: string }
  | { type: 'PULSE_BACKFILL_STATUS'; job: PulseBackfillJob | null; error?: string }
  | { type: 'ALWAYS_TRACKED'; channels: string[]; error?: string }
  | { type: 'DISCOVER_LIVE_VOD'; result: import('./twitchVodGql.ts').GqlVodDiscoveryResult; error?: string }
  | { ok: boolean; error?: string }
