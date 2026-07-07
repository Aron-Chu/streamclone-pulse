import { peaksToLiveHeatPoints } from '@streamclone/pulse-core'
import type { LiveHeatPoint, LiveHeatReason } from '@streamclone/pulse-core'
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
const MOMENT_DEDUPE_TOLERANCE_SECONDS = 60

function momentHasReactionData(moment: PulseRecapMoment): boolean {
  return (moment.chatCount ?? 0) > 0 || (moment.emoteCount ?? 0) > 0
}

function streamHasReactionCoverageFromRollups(rollups: readonly ExtensionRollup[]): boolean {
  return rollups.some(rollup =>
    !rollup.missing && ((rollup.chatCount ?? 0) > 0 || rollupEmoteCount(rollup) > 0),
  )
}

function compareMomentRank(
  a: PulseRecapMoment,
  b: PulseRecapMoment,
  hasReactionCoverage: boolean,
): number {
  if (hasReactionCoverage) {
    const rankA = momentHasReactionData(a) ? 0 : 1
    const rankB = momentHasReactionData(b) ? 0 : 1
    if (rankA !== rankB) return rankA - rankB
  }
  if (a.score !== b.score) return b.score - a.score
  return a.offsetSeconds - b.offsetSeconds
}

function sortMomentsByRank(
  moments: PulseRecapMoment[],
  hasReactionCoverage: boolean,
): PulseRecapMoment[] {
  return [...moments].sort((a, b) => compareMomentRank(a, b, hasReactionCoverage))
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
  const hasReactionCoverage = streamHasReactionCoverageFromRollups(rollups)
  const candidates: PulseRecapMoment[] = []
  for (const moment of recap?.topMoments ?? []) {
    candidates.push(moment)
  }
  for (const moment of recap?.clipCandidates ?? []) {
    candidates.push(moment)
  }
  for (const peak of peaks ?? []) {
    candidates.push({
      offsetSeconds: peak.offsetSeconds,
      score: peak.score,
      reasons: peak.reasons,
      chatCount: peak.chatCount,
      emoteCount: peak.emoteCount,
      topEmotes: peak.topEmotes?.map(emote => ({
        code: emote.name,
        count: emote.count,
        provider: emote.provider,
      })),
    })
  }

  candidates.sort((a, b) => compareMomentRank(a, b, hasReactionCoverage))
  const merged: PulseRecapMoment[] = []
  for (const moment of candidates) {
    const duplicate = merged.find(
      existing => Math.abs(existing.offsetSeconds - moment.offsetSeconds) <= MOMENT_DEDUPE_TOLERANCE_SECONDS,
    )
    if (duplicate) {
      if (compareMomentRank(moment, duplicate, hasReactionCoverage) < 0) {
        const index = merged.indexOf(duplicate)
        merged[index] = moment
      }
      continue
    }
    merged.push(moment)
    if (merged.length >= limit) break
  }
  return sortMomentsByRank(merged, hasReactionCoverage)
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

/** Best-known stream length for full-timeline chart scaling (recap duration wins). */
export function recapStreamDurationSeconds(payload: PulsePayload): number {
  const recapDuration = payload.recap?.durationSeconds
  if (recapDuration != null && recapDuration > 0) return recapDuration
  if (payload.currentOffsetSeconds > 0) return payload.currentOffsetSeconds
  const rollups = pickRecapRollups(payload)
  if (rollups.length > 0) return rollups[rollups.length - 1]?.offsetSeconds ?? 0
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
