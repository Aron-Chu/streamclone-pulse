export interface ChartMinuteRollup {
  minuteTs: string
  finalized?: boolean
  viewerAvg?: number
  viewerMax?: number
  viewerLatest?: number
  viewerSamples?: number
  chatCount?: number
  totalEmoteCount?: number
  seventvEmoteCount?: number
  emotes?: Record<string, number>
  missing?: boolean
}

export interface ChartGameSegment {
  id?: number | string
  gameName: string
  /** Stable Twitch category identity; enables deterministic box-art fallback. */
  categoryId?: string
  boxArtUrl?: string
  offsetSeconds: number
  durationSeconds: number
  /** Response-only honesty: e.g. snapshot, stored, category_fallback */
  source?: string
}

export interface ChartPlayhead {
  streamId: string
  offsetSeconds: number
  isPlaying: boolean
}

/**
 * Backend-authored reaction window used by the chart's intensity lane.
 *
 * This is deliberately separate from `ChartMinuteRollup`: a reaction window
 * can be refined to an exact second and may not line up with a minute rollup.
 * The renderer must never use this visual layer to change ranking or seek
 * semantics; it is only a truthful display of the backend result.
 */
/** Shared portal/extension reaction contract. */
export type ChartReactionPoint = ReactionMoment
import type { ReactionMoment } from '@streampulse/pulse-core'
