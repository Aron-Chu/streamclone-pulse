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
      compositeScore: peak.compositeScore,
      reactionScore: peak.reactionScore,
      viewerMomentumScore: peak.viewerMomentumScore,
      reactionOnsetOffsetSeconds: peak.reactionOnsetOffsetSeconds,
      reactionApexOffsetSeconds: peak.reactionApexOffsetSeconds,
      seekOffsetSeconds: peak.seekOffsetSeconds,
      precisionSeconds: peak.precisionSeconds,
      refinementStatus: peak.refinementStatus,
      refinementConfidence: peak.refinementConfidence,
      reactionScoringVersion: peak.reactionScoringVersion,
      reasons: peak.reasons,
      chatCount: peak.chatCount,
      emoteCount: peak.emoteCount,
      topEmotes: peak.topEmotes?.map(emote => ({
        name: emote.name,
        count: emote.count,
        provider: emote.provider,
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

export function lastActiveRollupOffsetSeconds(rollups: readonly ExtensionRollup[]): number {
  let last = -1
  for (const rollup of rollups) {
    if (rollup.missing) continue
    const chat = rollup.chatCount ?? 0
    const emotes = rollupEmoteCount(rollup)
    const viewers = rollup.viewerCount ?? 0
    if (chat > 0 || emotes > 0 || viewers > 0) {
      if (rollup.offsetSeconds > last) {
        last = rollup.offsetSeconds
      }
    }
  }
  return last
}

/**
 * Best-known stream length for full-timeline chart scaling.
 *
 * A legacy backend could close an open stream at the time of the first offline
 * request, hours after the VOD and IRC data ended. When that same payload also
 * claims full coverage, cap the contradictory wall duration to the observed
 * coverage end instead of drawing fabricated zero-valued hours. Declared
 * missing-tail coverage keeps the real stream duration so the gap stays visible.
 */
export function recapStreamDurationSeconds(payload: PulsePayload): number {
  const recapDuration = payload.recap?.durationSeconds
  const rollups = pickRecapRollups(payload)
  const rollupEnd = rollups.length > 0
    ? (rollups[rollups.length - 1]?.offsetSeconds ?? 0) + 60
    : 0
  const coverageEnd = (payload.coverage?.coverageEndOffsetSeconds ?? 0) > 0
    ? (payload.coverage?.coverageEndOffsetSeconds ?? 0) + 60
    : 0
  const observedEnd = Math.max(rollupEnd, coverageEnd)
  const payloadDuration = payload.durationSeconds ?? 0
  const declaredDuration = recapDuration != null && recapDuration > 0
    ? recapDuration
    : payloadDuration > 0
      ? payloadDuration
      : payload.currentOffsetSeconds

  if (payload.isLive) {
    if (declaredDuration > 0) return declaredDuration
    if (rollupEnd > 0) return rollupEnd
    return 0
  }

  // If the backend declared a missing IRC tail, keep the declared duration so the gap stays visible.
  const hasMissingTail = Boolean(
    payload.coverage?.missingRanges?.some(range => range.toOffsetSeconds >= declaredDuration - 120)
    || (payload.coverage?.canBackfill === true && payload.coverage?.hasGaps === true),
  )

  if (!hasMissingTail) {
    // 1. Explicit full coverage contradicts late wall close.
    if (
      payload.coverage?.hasFullStreamCoverage === true
      && payload.coverage.hasGaps !== true
      && observedEnd > 0
      && declaredDuration > observedEnd + 120
    ) {
      return observedEnd
    }

    // 2. Trailing dead zone detection:
    // If we have rollups with active signal, check if the data has a sustained trailing dead zone
    // (>15 minutes of consecutive zeros) or if fullRollups was loaded and ended earlier.
    const lastActive = lastActiveRollupOffsetSeconds(rollups)
    if (lastActive >= 0) {
      const activeEnd = lastActive + 60
      const hasFullHistory = (payload.fullRollups?.length ?? 0) > 0
      const hasTrailingDeadTail = rollupEnd >= activeEnd + 15 * 60

      if (hasTrailingDeadTail) {
        return activeEnd
      }

      if (hasFullHistory && declaredDuration > activeEnd + 15 * 60) {
        return Math.max(activeEnd, rollupEnd)
      }
    }
  }

  if (declaredDuration > 0) return declaredDuration
  if (rollupEnd > 0) return rollupEnd
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
