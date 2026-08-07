import { mergeRecapMoments as mergeRecapMomentsCore, peaksToLiveHeatPoints } from '@streampulse/pulse-core'
import type { LiveHeatPoint, LiveHeatReason } from '@streampulse/pulse-core'
import type {
  ExtensionEmote,
  ExtensionPeak,
  ExtensionRollup,
  PulsePayload,
  PulseRecapMoment,
  PulseStreamRecap,
} from '../shared/messages.ts'
import { pickRecapRollups, recapMomentToLiveHeatPoint, rollupAtOffset, rollupEmoteCount } from './recapMomentMetrics.ts'
import { nearestMomentForOffset } from './chartRollupUtils.ts'

const MOMENT_SELECT_TOLERANCE_SECONDS = 90

function streamHasReactionCoverageFromRollups(rollups: readonly ExtensionRollup[]): boolean {
  return rollups.some(rollup =>
    !rollup.missing && ((rollup.chatCount ?? 0) > 0 || rollupEmoteCount(rollup) > 0),
  )
}

export function recapMomentSelectionKey(
  streamId: string | undefined,
  moment: PulseRecapMoment,
): string {
  return `${streamId ?? 'unknown'}:${moment.offsetSeconds}:${moment.score}`
}

export function resolveRecapSelectionFromOffset(args: {
  streamId: string | undefined
  offsetSeconds: number
  moments: PulseRecapMoment[]
  rollups: ExtensionRollup[]
  startedAt: string | undefined
  catalog: ExtensionEmote[]
  toleranceSeconds?: number
}): { selectedKey: string; overridePoint: LiveHeatPoint | null } {
  const tolerance = args.toleranceSeconds ?? MOMENT_SELECT_TOLERANCE_SECONDS
  const nearest = nearestMomentForOffset(args.moments, args.offsetSeconds)
  if (
    nearest &&
    Math.abs(nearest.offsetSeconds - args.offsetSeconds) < tolerance
  ) {
    return {
      selectedKey: recapMomentSelectionKey(args.streamId, nearest),
      overridePoint: null,
    }
  }

  const rollup = rollupAtOffset(args.rollups, args.offsetSeconds)
  const overridePoint = rollup
    ? rollupToRecapHeatPoint(rollup, args.startedAt, args.catalog)
    : {
        minuteTs: '',
        offsetSeconds: args.offsetSeconds,
        score: 0,
        reasonLabel: 'Stream moment',
        reason: 'chat_spike' as LiveHeatReason,
        chatCount: 0,
        emoteCount: 0,
        topEmotes: [],
        estimated: true,
        collecting: false,
      }

  return {
    selectedKey: `${args.streamId ?? 'unknown'}:${args.offsetSeconds}:${overridePoint.score}`,
    overridePoint,
  }
}

/** Map a clicked chart rollup to a heat point — moment only when within tolerance. */
export function resolveRecapPointFromRollup(args: {
  rollup: ExtensionRollup
  moments: PulseRecapMoment[]
  catalog: ExtensionEmote[]
  startedAt: string | undefined
  rollups: ExtensionRollup[]
  peaks?: ExtensionPeak[]
  toleranceSeconds?: number
}): LiveHeatPoint {
  const tolerance = args.toleranceSeconds ?? MOMENT_SELECT_TOLERANCE_SECONDS
  const nearest = nearestMomentForOffset(args.moments, args.rollup.offsetSeconds)
  if (
    nearest &&
    Math.abs(nearest.offsetSeconds - args.rollup.offsetSeconds) < tolerance
  ) {
    return recapMomentToLiveHeatPoint(
      nearest,
      args.catalog,
      args.startedAt,
      args.rollups,
      args.peaks,
    )
  }
  return rollupToRecapHeatPoint(args.rollup, args.startedAt, args.catalog)
}

/** Merge recap moments, clip candidates, and payload peaks into one ranked list (up to limit). */
export function mergeRecapMoments(
  recap:
    | {
        topMoments?: readonly PulseRecapMoment[]
        clipCandidates?: readonly PulseRecapMoment[]
      }
    | null
    | undefined,
  peaks: readonly ExtensionPeak[] | undefined,
  limit = 20,
  rollups: readonly ExtensionRollup[] = [],
): PulseRecapMoment[] {
  return mergeRecapMomentsCore(
    recap,
    peaks?.map(peak => ({
      offsetSeconds: peak.offsetSeconds,
      score: peak.score,
      reasons: peak.reasons,
      chatCount: peak.chatCount,
      emoteCount: peak.emoteCount,
      topEmotes: peak.topEmotes?.map(emote => ({
        name: emote.name,
        count: emote.count,
        provider: emote.provider,
        id: emote.id,
        providerEmoteId: emote.providerEmoteId,
      })),
    })),
    limit,
    streamHasReactionCoverageFromRollups(rollups),
  ) as PulseRecapMoment[]
}

/** Peak dart offsets for recap chart — recap moments first, then payload peaks. */
export function resolveRecapChartPeakOffsets(
  topMoments: readonly PulseRecapMoment[] | undefined,
  peaks: readonly ExtensionPeak[] | undefined,
  limit = 8,
): number[] {
  if (topMoments && topMoments.length > 0) {
    return [...topMoments]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(moment => moment.offsetSeconds)
  }
  return [...(peaks ?? [])]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(peak => peak.offsetSeconds)
}

const RECAP_EMPTY_TAIL_GRACE_SECONDS = 5 * 60

function lastRecapActivityOffsetSeconds(rollups: ExtensionRollup[]): number {
  let last = -1
  for (const rollup of rollups) {
    const chat = rollup.chatCount ?? 0
    const emotes = rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0
    if (chat <= 0 && emotes <= 0) continue
    if (rollup.offsetSeconds > last) last = rollup.offsetSeconds
  }
  if (last >= 0) return last
  if (rollups.length === 0) return -1
  return rollups[rollups.length - 1]?.offsetSeconds ?? -1
}

/**
 * Best-known stream length for full-timeline chart scaling.
 * Prefer Pulse activity end when wall/recap duration invents a long empty tail
 * (late EndedAt / zombie-live Helix open after chat stopped).
 */
export function recapStreamDurationSeconds(payload: PulsePayload): number {
  const rollups = pickRecapRollups(payload)
  const activityEnd = lastRecapActivityOffsetSeconds(rollups)
  const wallCandidates = [payload.recap?.durationSeconds ?? 0, payload.currentOffsetSeconds]
  const wall = Math.max(0, ...wallCandidates)
  if (activityEnd >= 0) {
    if (wall <= 0) return activityEnd + 60
    if (wall > activityEnd + RECAP_EMPTY_TAIL_GRACE_SECONDS) return activityEnd + 60
    return wall
  }
  if (wall > 0) return wall
  return 0
}

export function recapChatSpikeToHeatPoint(
  spike: NonNullable<PulseStreamRecap['biggestChatSpike']>,
  catalog: ExtensionEmote[],
  startedAt: string | undefined,
  rollups: ExtensionRollup[],
  peaks?: ExtensionPeak[],
): LiveHeatPoint {
  return recapMomentToLiveHeatPoint(
    {
      offsetSeconds: spike.offsetSeconds,
      score: spike.chatPerMin,
      reasons: ['chat_spike'],
      chatCount: spike.chatPerMin,
    },
    catalog,
    startedAt,
    rollups,
    peaks,
  )
}

export function recapEmoteBurstToHeatPoint(
  burst: NonNullable<PulseStreamRecap['funniestEmoteBurst']>,
  catalog: ExtensionEmote[],
  startedAt: string | undefined,
  rollups: ExtensionRollup[],
  peaks?: ExtensionPeak[],
): LiveHeatPoint {
  return recapMomentToLiveHeatPoint(
    {
      offsetSeconds: burst.offsetSeconds,
      score: burst.count,
      reasons: ['emote_spike'],
      emoteCount: burst.count,
      topEmotes: burst.code ? [{ code: burst.code, count: burst.count }] : [],
    },
    catalog,
    startedAt,
    rollups,
    peaks,
  )
}

export function rollupToRecapHeatPoint(
  rollup: ExtensionRollup,
  startedAt: string | undefined,
  catalog: ExtensionEmote[],
): LiveHeatPoint {
  const synthetic: ExtensionPeak = {
    offsetSeconds: rollup.offsetSeconds,
    score: rollup.chatCount ?? 0,
    reasons: ['chat_spike'],
    dominantSignal: 'chat',
    chatCount: rollup.chatCount,
    emoteCount: rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount,
    topEmotes: rollup.topEmotes,
  }
  return peaksToLiveHeatPoints([synthetic], startedAt, catalog)[0]!
}
