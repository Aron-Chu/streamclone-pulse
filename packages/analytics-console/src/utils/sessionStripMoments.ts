/**
 * The Pulse Moments strip's moment list, shared with the session chart pins.
 *
 * `stripHasReactionCoverage` and `sessionStripMoments` are exactly the strip's
 * hasReactionCoverage memo and its merge plus enrich (SessionRecapMomentsStrip
 * at 4cdf70aa), so pin N and strip row N are the same moment. The strip calls
 * them with identical arguments; pins take the first five.
 *
 * `stripMomentEmotes` is the strip row's emote resolution (the measured minute
 * when it exists, the recap snapshot otherwise). The pin hover store lets a pin
 * light its strip row without the two sharing a parent.
 */
import { useSyncExternalStore } from 'react'
import {
  mergeRecapMoments,
  OPENING_STREAM_EDGE,
  streamEdgesFor,
  type StreamEdges,
} from '@streampulse/pulse-core'
import type {
  AnalyticsMinuteRollup,
  AnalyticsTopEmote,
  PulseRecapMoment,
  PulseStreamRecap,
} from '../apiTypes.ts'
import type { ReplayHeatmapPoint } from '../types/heatmap.ts'
import { resolveMomentEmotesForOffset } from './recapEmoteEnrich.ts'
import { resolveMomentRowRollup, resolveRollupDisplayEmotes } from './momentRowDisplay.ts'
import {
  enrichRecapMomentsFromHeatmap,
  MOMENTS_INITIAL_VISIBLE,
  MOMENTS_MAX_VISIBLE,
} from './momentListDisplay.tsx'

/** Pins on the chart: the strip's first five moments. */
export const SESSION_PIN_COUNT = 5

/** The strip's hasReactionCoverage memo. */
export function stripHasReactionCoverage(recap: PulseStreamRecap): boolean {
  const moments = [
    ...(recap.topMoments ?? []),
    ...(recap.clipCandidates ?? []),
  ]
  return (
    moments.some(
      (moment) => (moment.chatCount ?? 0) > 0 || (moment.emoteCount ?? 0) > 0,
    ) || (recap.totalMessages ?? 0) > 0
  )
}

/**
 * The session's stream edges: hello / goodbye spam there ranks after every
 * other moment. The closing edge counts back from the last minute with chat or
 * emotes, as the backend's does, and only applies once the stream has ended.
 * Worked out once per session and handed to the strip, its pins and the chart
 * markers, so they rank alike.
 */
export function sessionStreamEdges(args: {
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
  streamEnded: boolean
}): StreamEdges {
  const startMs = args.streamStartedAt ? Date.parse(args.streamStartedAt) : NaN
  if (!args.streamEnded || !Number.isFinite(startMs)) return OPENING_STREAM_EDGE
  let last = -1
  for (const rollup of args.rollups ?? []) {
    if (rollup.missing) continue
    const emotes = (rollup.totalEmoteCount ?? 0) > 0 ? (rollup.totalEmoteCount ?? 0) : (rollup.seventvEmoteCount ?? 0)
    if ((rollup.chatCount ?? 0) <= 0 && emotes <= 0) continue
    const at = Date.parse(rollup.minuteTs)
    if (Number.isFinite(at)) last = Math.max(last, Math.floor((at - startMs) / 1000))
  }
  return streamEdgesFor(last, true)
}

/** The strip's merged and enriched moment list, in strip rank order. */
export function sessionStripMoments(args: {
  recap: PulseStreamRecap
  hasReactionCoverage: boolean
  heatmapPoints?: ReplayHeatmapPoint[]
  streamStartedAt?: string
  topEmotesCatalog?: AnalyticsTopEmote[]
  /** sessionStreamEdges; the opening edge alone when omitted. */
  streamEdges?: StreamEdges
}): PulseRecapMoment[] {
  const edges = args.streamEdges ?? OPENING_STREAM_EDGE
  const merged = mergeRecapMoments(
    args.recap,
    undefined,
    MOMENTS_MAX_VISIBLE,
    args.hasReactionCoverage,
    edges,
  )
  return enrichRecapMomentsFromHeatmap(
    merged,
    args.heatmapPoints,
    args.streamStartedAt,
    args.topEmotesCatalog,
    MOMENTS_MAX_VISIBLE,
    MOMENTS_INITIAL_VISIBLE,
    edges,
  )
}

export interface StripMomentEmote {
  name: string
  count: number
  provider?: string
  id?: string
  imageUrl?: string
  key?: string
}

/** The strip row's emotes: the measured minute when it exists, else the recap snapshot. */
export function stripMomentEmotes(args: {
  moment: PulseRecapMoment
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
  topEmotesCatalog?: AnalyticsTopEmote[]
}): { exact: boolean; emotes: StripMomentEmote[] } {
  const { moment, rollups, streamStartedAt, topEmotesCatalog } = args
  const exactRollup = resolveMomentRowRollup({ moment, rollups, streamStartedAt })
  if (exactRollup) {
    return {
      exact: true,
      emotes: resolveRollupDisplayEmotes({ rollup: exactRollup, topEmotesCatalog }).map(
        (emote) => ({
          name: emote.name,
          count: emote.count,
          provider: emote.provider,
          imageUrl: emote.image_url,
          key: emote.key,
        }),
      ),
    }
  }
  return {
    exact: false,
    emotes: resolveMomentEmotesForOffset({
      moment,
      rollups: [],
      streamStartedAt,
      topEmotesCatalog,
      limit: 3,
    }).map((emote) => ({
      name: emote.code,
      count: emote.count,
      provider: emote.provider,
      id: emote.id,
      imageUrl: emote.imageUrl,
    })),
  }
}

// ---- pin hover: the analytical offset of the pin under the pointer ----

let pinHover: number | null = null
const pinHoverListeners = new Set<() => void>()

export function setStripPinHover(offsetSeconds: number | null): void {
  if (pinHover === offsetSeconds) return
  pinHover = offsetSeconds
  pinHoverListeners.forEach((listener) => listener())
}

export function getStripPinHover(): number | null {
  return pinHover
}

export function subscribeStripPinHover(listener: () => void): () => void {
  pinHoverListeners.add(listener)
  return () => {
    pinHoverListeners.delete(listener)
  }
}

export function useStripPinHover(): number | null {
  return useSyncExternalStore(subscribeStripPinHover, getStripPinHover, getStripPinHover)
}
