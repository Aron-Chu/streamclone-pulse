import type {
  EmoteSyncSnapshot,
  ExtensionEmote,
  ExtensionGameSegment,
  ExtensionLanes,
  ExtensionPeak,
  ExtensionRollup,
  PulseCoverage,
  PulseStreamRecap,
} from '../shared/messages.ts'

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

interface ExtensionVodPulseCommon {
  login?: string
  channelLogin?: string
  channelDisplayName?: string
  title?: string
  startedAt?: string
  durationSeconds?: number
  coverageStatus?: VodCoverageStatus
  coverageMessage?: string
  fullAnalyticsUrl?: string
  recap?: PulseStreamRecap
  timeline?: VodTimeline
  topMoments?: VodMoment[]
  topEmotes?: ExtensionEmote[]
  games?: ExtensionGameSegment[]
  bestClipCandidate?: VodClipCandidate
}

export interface PermanentExtensionVodPulseResponse extends ExtensionVodPulseCommon {
  mode: 'vod'
  /** Null until the backend has validated the route candidate as an archive. */
  vodId: string | null
  streamId?: string
  coverageStatus: VodCoverageStatus
  provisional?: false
  resolutionState?: string
  retryable?: boolean
}

export interface LiveDvrExtensionVodPulseResponse extends ExtensionVodPulseCommon {
  mode: 'live_dvr'
  vodId: string | null
  provisional: boolean
  resolutionState: string
  retryable: boolean
  streamId: string
  login: string
  isLive: boolean
  tracking: boolean
  currentOffsetSeconds: number
  vodOriginDeltaSeconds?: number
  coverageStartOffsetSeconds?: number
  viewerStartOffsetSeconds?: number
  coverage?: PulseCoverage
  rollups: ExtensionRollup[]
  fullRollups?: ExtensionRollup[]
  lanes: ExtensionLanes
  peaks?: ExtensionPeak[]
  emoteSync?: EmoteSyncSnapshot
  helixEnabled?: boolean
  rosterEligible?: boolean
  top500Eligible?: boolean
  archiveValidation?: {
    source: string
    state: string
    type: string
    streamId: string
    broadcasterId: string
    persisted: boolean
    streamOpen: boolean
  }
}

export type ExtensionVodPulseResponse =
  | PermanentExtensionVodPulseResponse
  | LiveDvrExtensionVodPulseResponse
