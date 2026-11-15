/**
 * R1 (11-13, SESSION-MOMENTS-4): when the recap fails or comes back without moments, the Moments tab ranks
 * moments from the minute data (the heatmap's scored minutes, else the minutes themselves) and shows them in
 * today's rows. This builds a recap-shaped answer from those minutes so the same strip renders them; each
 * moment is minute-only (precisionSeconds 60), so its time reads 'about 0:59:00'.
 */
import {
  findRollupForMomentCandidate,
  heatmapPointsToMomentCandidates,
  rollupFallbackMomentCandidates,
} from '@streampulse/pulse-core'
import type { AnalyticsMinuteRollup, AnalyticsTopEmote, PulseRecapMoment, PulseStreamRecap } from '../apiTypes.ts'
import type { ReplayHeatmapPoint } from '../types/heatmap.ts'
import { minuteEmoteTotal } from '../components/analytics/chartRollupUtils.ts'

export function minuteDataRecap(args: {
  streamId: string
  rollups: AnalyticsMinuteRollup[]
  heatmapPoints?: ReplayHeatmapPoint[]
  streamStartedAt?: string
  topEmotesCatalog?: AnalyticsTopEmote[]
}): PulseStreamRecap | null {
  const { rollups, heatmapPoints, streamStartedAt, topEmotesCatalog } = args
  if (!rollups.length) return null
  const candidates = heatmapPoints?.length
    ? heatmapPointsToMomentCandidates(heatmapPoints, streamStartedAt, topEmotesCatalog)
    : rollupFallbackMomentCandidates(rollups, topEmotesCatalog, streamStartedAt)
  const topMoments: PulseRecapMoment[] = []
  for (const candidate of candidates) {
    const rollup = findRollupForMomentCandidate(rollups, candidate) as AnalyticsMinuteRollup | undefined
    if (!rollup) continue
    topMoments.push({
      offsetSeconds: candidate.offsetSeconds,
      score: candidate.score,
      reactionScore: candidate.score,
      precisionSeconds: 60,
      reasons: [candidate.reason],
      chatCount: rollup.chatCount,
      emoteCount: minuteEmoteTotal(rollup),
      viewerCount: rollup.viewerAvg ?? rollup.viewerLatest ?? undefined,
    })
  }
  return topMoments.length ? { streamId: args.streamId, topMoments } : null
}
