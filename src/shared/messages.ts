export type MessageType =
  | 'TRACK'
  | 'UNTRACK'
  | 'GET_PULSE'
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
  | 'PULSE_UPDATE'

export interface TrackMessage {
  type: 'TRACK'
  login: string
}

export interface UntrackMessage {
  type: 'UNTRACK'
  login: string
}

export interface GetPulseMessage {
  type: 'GET_PULSE'
  login: string
  /** When true, POST /watch and start polling. Default false — use TRACK for that. */
  watch?: boolean
  window?: 'recent' | 'full'
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
  | LoadMissedMomentsMessage
  | GetPulseBackfillStatusMessage

export interface ExtensionEmote {
  id?: string
  name: string
  imageUrl?: string
  count: number
  provider?: string
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
}

export interface PulseRecapMoment {
  offsetSeconds: number
  score: number
  reasons: string[]
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
}

export interface LoadMissedMomentsMessage {
  type: 'LOAD_MISSED_MOMENTS'
  login: string
  streamId: string
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
  hasGaps: boolean
  missingRanges?: PulseCoverageRange[]
  canBackfill: boolean
  backfillReason?: string
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
  currentOffsetSeconds: number
  coverageStartOffsetSeconds?: number
  coverage?: PulseCoverage
  topEmotes?: ExtensionEmote[]
  rollups: ExtensionRollup[]
  fullRollups?: ExtensionRollup[]
  lanes: ExtensionLanes
  peaks: ExtensionPeak[]
  recap: PulseStreamRecap | null
  emoteSync?: EmoteSyncSnapshot
}

export interface PulseUpdateMessage {
  type: 'PULSE_UPDATE'
  login: string
  payload: PulsePayload | null
  error?: string
}

export type BackgroundResponse =
  | PulseUpdateMessage
  | { type: 'CLIP'; clip: ExtensionClip | null; error?: string }
  | { type: 'HEALTH'; ok: boolean; version?: string; error?: string }
  | { type: 'BOOKMARKS'; items: PulseBookmark[]; error?: string }
  | { type: 'BOOKMARK'; item: PulseBookmark; error?: string }
  | { type: 'DELETE_BOOKMARK'; ok: boolean; error?: string }
  | { type: 'WATCHLIST'; channels: string[]; error?: string }
  | { type: 'SYNC_WATCHLIST'; channels: string[]; error?: string }
  | { type: 'PAST_VODS'; items: PastVodRow[]; error?: string }
  | { type: 'EMOTE_IMAGE'; mimeType?: string; buffer?: ArrayBuffer; error?: string }
  | { type: 'PULSE_BACKFILL'; job: PulseBackfillJob | null; error?: string }
  | { type: 'PULSE_BACKFILL_STATUS'; job: PulseBackfillJob | null; error?: string }
  | { ok: boolean; error?: string }
