import type { ExtensionEmote, PulseStreamRecap } from '../shared/messages.ts'

export type VodCoverageStatus = 'ready' | 'partial' | 'syncing' | 'missing' | 'error'

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
  fullAnalyticsUrl?: string
  recap?: PulseStreamRecap
  timeline?: VodTimeline
  topMoments?: VodMoment[]
  topEmotes?: ExtensionEmote[]
  bestClipCandidate?: VodClipCandidate
}
