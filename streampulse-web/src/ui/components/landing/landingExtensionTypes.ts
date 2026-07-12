export interface LandingPulsePayload {
  login: string
  isLive: boolean
  tracking: boolean
  streamId?: string
  startedAt?: string
  title?: string
  category?: string
  peakViewers?: number
  currentOffsetSeconds: number
  coverageStartOffsetSeconds?: number
  coverage?: {
    state?: string
    message?: string
    chatSourceDetail?: string
    coverageStartOffsetSeconds?: number
    coverageEndOffsetSeconds?: number
    hasFullStreamCoverage?: boolean
    trackedFromStart?: boolean
    hasGaps?: boolean
    canBackfill?: boolean
    chatSource?: string
    copyKey?: string
  }
  topEmotes?: Array<{ id?: string; name: string; provider?: string; count: number; imageUrl?: string }>
  rollups: Array<{
    offsetSeconds: number
    chatCount: number
    sevenTvEmoteCount: number
    totalEmoteCount?: number
    viewerCount?: number
    topEmotes?: Array<{ id?: string; name: string; provider?: string; count: number; imageUrl?: string }>
  }>
  lanes: { composite: number[]; chat: number[]; seventv: number[]; viewers?: number[] }
  peaks: Array<{
    offsetSeconds: number
    score: number
    reasons: string[]
    reasonLabel?: string
    dominantSignal: string
    chatCount?: number
    emoteCount?: number
    topEmotes?: Array<{ id?: string; name: string; provider?: string; count: number; imageUrl?: string }>
  }>
  recap: null
  games?: Array<{ gameName: string; offsetSeconds: number; durationSeconds: number }>
  emoteSync?: { state: string; provider?: string }
  rosterEligible?: boolean
  top500Eligible?: boolean
}

export interface LandingPastVodRow {
  streamId: string
  videoId?: string
  title: string
  category?: string
  startedAt?: string
  durationMinutes?: number
  thumbnailUrl?: string
  analyticsStatus: 'current-live' | 'synced' | 'stats-only' | 'sync-interrupted' | 'unknown'
}
