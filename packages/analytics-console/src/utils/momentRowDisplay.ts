import {
  heatmapEmoteToRollupHit,
  normalizeMinuteBucket,
  topEmotesFromRollup,
  recapMomentAnalyticalOffset,
  type RollupEmoteHit,
} from '@streampulse/pulse-core'
import type {
  AnalyticsMinuteRollup,
  AnalyticsTopEmote,
  PulseRecapEmote,
  PulseRecapMoment,
} from '../apiTypes.ts'
import { viewerReadoutValue } from '@streampulse/pulse-charts'
import type { ReplayHeatmapPoint } from '../types/heatmap.ts'
import { minuteEmoteTotal } from '../components/analytics/chartRollupUtils.ts'
import { enrichRecapEmotesFromCatalog, resolveMomentEmotesForOffset } from './recapEmoteEnrich.ts'

export interface MomentRowStats {
  viewers: number | null
  chatPerMin: number | null
  emotesPerMin: number | null
}

export function recapEmoteToRollupHit(emote: PulseRecapEmote): RollupEmoteHit {
  const code = emote.code.trim()
  const provider = (emote.provider ?? 'unknown').trim().toLowerCase()
  const id = emote.id?.trim()
  const key = id ? `${provider}:${id}` : `${provider}:${code}`
  return {
    key,
    name: code,
    count: emote.count ?? 0,
    provider: emote.provider ?? provider,
    image_url: emote.imageUrl,
  }
}

export function recapEmotesToRollupHits(
  emotes: PulseRecapEmote[],
  catalog?: AnalyticsTopEmote[],
): RollupEmoteHit[] {
  return enrichRecapEmotesFromCatalog(emotes, catalog).map(recapEmoteToRollupHit)
}

/** Resolve only the exact analytical minute; never substitute a nearby minute. */
export function resolveMomentRowRollup(args: {
  moment?: PulseRecapMoment
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
}): AnalyticsMinuteRollup | null {
  const { moment, rollups, streamStartedAt } = args
  const start = streamStartedAt ? Date.parse(streamStartedAt) : NaN
  const exact = Number.isFinite(start) && moment && Number.isFinite(moment.offsetSeconds) && moment.offsetSeconds >= 0
    ? (rollups ?? []).filter(row => {
      const at = Date.parse(row.minuteTs)
      return Number.isFinite(at) && at >= Math.floor(start / 60_000) * 60_000
        && Math.max(0, Math.trunc((at - start) / 1000)) === recapMomentAnalyticalOffset(moment)
    }) : []
  return exact.length === 1 && !exact[0].missing ? exact[0] : null
}

/** Match the selected-minute inspector. A detection snapshot is fallback only. */
export function resolveMomentRowStats(args: {
  moment?: PulseRecapMoment
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
}): MomentRowStats {
  const { moment } = args
  const rollup = resolveMomentRowRollup(args)
  const measured = (value: number | undefined | null): number | null => value != null && Number.isFinite(value) && value >= 0 ? value : null
  const viewers = rollup ? measured(viewerReadoutValue(rollup)) : measured(moment?.viewerCount)
  const chatPerMin = rollup ? measured(rollup.chatCount) : measured(moment?.chatCount)
  // An absent emote map is not a measured zero. Explicit totals, including zero,
  // retain authority over fallback map values.
  const rollupEmotes = measured(rollup?.totalEmoteCount) ?? (rollup?.emotes ? measured(minuteEmoteTotal(rollup)) : null)
  const emotesPerMin = rollup ? rollupEmotes : measured(moment?.emoteCount)

  return { viewers, chatPerMin, emotesPerMin }
}

/** Rollup → heatmap point → recap topEmotes for display chips. */
export function resolveRollupDisplayEmotes(args: {
  rollup: AnalyticsMinuteRollup
  rollups?: AnalyticsMinuteRollup[]
  streamStartedAt?: string
  heatmapPoints?: ReplayHeatmapPoint[]
  recapMoment?: PulseRecapMoment | null
  topEmotesCatalog?: AnalyticsTopEmote[]
  limit?: number
}): RollupEmoteHit[] {
  const {
    rollup,
    rollups,
    streamStartedAt,
    heatmapPoints,
    recapMoment,
    topEmotesCatalog,
    limit = 3,
  } = args

  const fromRollup = topEmotesFromRollup(rollup, limit, topEmotesCatalog)
  if (fromRollup.length > 0) return fromRollup

  if (heatmapPoints?.length) {
    const bucket = normalizeMinuteBucket(rollup.minuteTs)
    const point = heatmapPoints.find(
      (entry) =>
        entry.minuteTs === rollup.minuteTs
        || normalizeMinuteBucket(entry.minuteTs) === bucket,
    )
    if (point?.topEmotes?.length) {
      const fromHeatmap = point.topEmotes
        .slice(0, limit)
        .map((emote) => heatmapEmoteToRollupHit(emote, topEmotesCatalog))
        .filter((emote): emote is RollupEmoteHit => Boolean(emote))
      if (fromHeatmap.length > 0) return fromHeatmap
    }
  }

  if (recapMoment?.topEmotes?.length) {
    return recapEmotesToRollupHits(recapMoment.topEmotes, topEmotesCatalog).slice(0, limit)
  }

  if (recapMoment && rollups?.length && streamStartedAt) {
    const fromOffset = resolveMomentEmotesForOffset({
      moment: recapMoment,
      rollups,
      streamStartedAt,
      heatmapPoints,
      topEmotesCatalog,
      limit,
    })
    if (fromOffset.length > 0) {
      return recapEmotesToRollupHits(fromOffset, topEmotesCatalog)
    }
  }

  return []
}
