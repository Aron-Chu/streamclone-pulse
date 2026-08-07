import type { ExtensionEmote, PulseStreamRecap } from '../shared/messages.ts'

export type VodCoverageStatus = 'ready' | 'partial' | 'syncing' | 'missing' | 'error'

export type VodResolutionState =
  | 'ready'
  | 'live_waiting_for_vod'
  | 'vod_unpublished'
  | 'vod_discovery_pending'
  | 'vod_found_indexing'
  | 'partial'
  | 'not_collected'
  | 'stream_not_collected'
  | 'persisted_exact'
  | 'helix_exact'
  | 'vod_not_found'
  | 'vod_deleted'
  | 'vod_unavailable'
  | 'lookup_disabled'
  | 'helix_unavailable'
  | 'resolution_timeout'
  | 'identity_mismatch'
  | 'terminal_error'
  | 'authentication_required'

export interface VodTimelinePoint {
  offsetSeconds: number
  chatPerMin?: number
  emotesPerMin?: number
  viewers?: number
  score?: number
  topEmotes?: ExtensionEmote[]
}

export interface VodTimeline {
  bucketSeconds: number
  points: VodTimelinePoint[]
}

export interface VodMoment {
  offsetSeconds: number
  label: string
  reason?: string
  score?: number
  chatPerMin?: number
  emotesPerMin?: number
  topEmotes?: ExtensionEmote[]
  thumbnailUrl?: string
}

export interface VodClipCandidate {
  offsetSeconds: number
  durationSeconds?: number
  label: string
  reason: string
  score?: number
  chatPerMin?: number
  emotesPerMin?: number
  topEmotes?: ExtensionEmote[]
  thumbnailUrl?: string
}

export interface ExtensionVodPulseResponse {
  mode: 'vod'
  vodId: string
  streamId?: string
  channelLogin?: string
  channelDisplayName?: string
  title?: string
  startedAt?: string
  durationSeconds?: number
  coverageStatus: VodCoverageStatus
  coverageMessage?: string
  resolutionState?: VodResolutionState
  retryable?: boolean
  fullAnalyticsUrl?: string
  recap?: PulseStreamRecap
  timeline?: VodTimeline
  topMoments?: VodMoment[]
  topEmotes?: ExtensionEmote[]
  bestClipCandidate?: VodClipCandidate
}
