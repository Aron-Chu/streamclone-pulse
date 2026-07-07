import {
  buildMomentScoreModel,
  computeMomentScore100,
  computeStreamBaselines,
  detectPickReason,
  heatmapEmotesFromRollup,
  topEmotesFromRollup,
  type LiveHeatPoint,
  type LiveHeatReason,
} from '@streamclone/pulse-core'
import type { ExtensionEmote, ExtensionRollup } from '../shared/messages.ts'
import { emoteSelectionKey } from './chatActivityEmotes.ts'
import { nearestRollupForOffset } from './extensionChartPoints.ts'
import { findHeatPointAtOffset } from './mostReacted.ts'
import { rollupEmoteCount, viewerDeltaAtOffset } from './recapMomentMetrics.ts'

const LIVE_HEAT_REASONS: LiveHeatReason[] = [
  'chat_spike',
  'emote_spike',
  'seventv_spike',
  'twitch_emote_spike',
  'ffz_spike',
  'viewer_spike',
  'manual',
]

function toLiveHeatReason(reason: string): LiveHeatReason {
  const normalized = reason.trim().toLowerCase()
  if (LIVE_HEAT_REASONS.includes(normalized as LiveHeatReason)) {
    return normalized as LiveHeatReason
  }
  return 'manual'
}

function extensionCatalogToTopEmotes(catalog: ExtensionEmote[]) {
  return catalog.map(emote => ({
    key: emoteSelectionKey(emote),
    name: emote.name,
    id: emote.id,
    provider: emote.provider,
    imageUrl: emote.imageUrl,
    count: emote.count,
  }))
}

function extensionRollupToScoringRollup(rollup: ExtensionRollup, startedAt?: string) {
  const emotes: Record<string, number> = {}
  for (const emote of rollup.topEmotes ?? []) {
    if (!emote.name?.trim()) continue
    emotes[emoteSelectionKey(emote)] = emote.count
  }
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
  const minuteTs =
    Number.isFinite(startedMs)
      ? new Date(startedMs + Math.max(0, rollup.offsetSeconds) * 1000).toISOString()
      : undefined
  return {
    minuteTs,
    chatCount: rollup.chatCount,
    totalEmoteCount: rollupEmoteCount(rollup),
    seventvEmoteCount: rollup.sevenTvEmoteCount,
    viewerLatest: rollup.viewerCount,
    viewerSamples: (rollup.viewerCount ?? 0) > 0 ? 1 : 0,
    emotes: Object.keys(emotes).length > 0 ? emotes : undefined,
    missing: rollup.missing,
  }
}

function resolveChartTopEmotes(
  rollup: ExtensionRollup,
  scoringRollup: ReturnType<typeof extensionRollupToScoringRollup>,
  catalog: ExtensionEmote[],
  limit = 3,
) {
  const fromRollup = [...(rollup.topEmotes ?? [])]
    .filter(emote => emote.name?.trim())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
  if (fromRollup.length > 0) {
    return fromRollup.map(emote => ({
      key: emoteSelectionKey(emote),
      name: emote.name,
      id: emote.id,
      provider: emote.provider,
      imageUrl: emote.imageUrl,
      count: emote.count,
    }))
  }
  const catalogTop = extensionCatalogToTopEmotes(catalog)
  return topEmotesFromRollup(scoringRollup, limit, catalogTop).map(emote => ({
    key: emote.key,
    name: emote.name,
    provider: emote.provider,
    imageUrl: emote.image_url,
    count: emote.count,
  }))
}

export function chartRollupToLiveHeatPoint({
  rollup,
  rollups,
  startedAt,
  catalog = [],
}: {
  rollup: ExtensionRollup
  rollups: ExtensionRollup[]
  startedAt?: string
  catalog?: ExtensionEmote[]
}): LiveHeatPoint {
  const scoringRollups = rollups.map(r => extensionRollupToScoringRollup(r, startedAt))
  const scoringRollup = extensionRollupToScoringRollup(rollup, startedAt)
  const catalogTop = extensionCatalogToTopEmotes(catalog)
  const baselines = computeStreamBaselines(scoringRollups)
  const fallbackReason = detectPickReason(scoringRollup, baselines, catalogTop)
  const scoreModel = buildMomentScoreModel({
    fallbackScore100: computeMomentScore100(scoringRollup, baselines, scoringRollups),
    fallbackReason,
    fallbackTopEmotes: heatmapEmotesFromRollup(scoringRollup, 5, catalogTop),
  })
  const reason = toLiveHeatReason(scoreModel.reason)
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
  const minuteTs =
    scoringRollup.minuteTs
    ?? (Number.isFinite(startedMs)
      ? new Date(startedMs + Math.max(0, rollup.offsetSeconds) * 1000).toISOString()
      : '')

  return {
    minuteTs,
    offsetSeconds: Math.max(0, rollup.offsetSeconds),
    score: Math.round(scoreModel.score),
    estimated: scoreModel.estimated,
    reason,
    reasonLabel: scoreModel.reasonLabel,
    chatCount: rollup.chatCount ?? 0,
    emoteCount: rollupEmoteCount(rollup),
    topEmotes: resolveChartTopEmotes(rollup, scoringRollup, catalog),
    collecting: false,
    viewerCount: rollup.viewerCount,
    viewerDelta: viewerDeltaAtOffset(rollups, rollup.offsetSeconds),
  }
}

export function resolvePinnedMomentPoint({
  pinOffsetSeconds,
  heatPoints,
  rollups,
  chartRollups,
  startedAt,
  catalog = [],
}: {
  pinOffsetSeconds: number | null | undefined
  heatPoints: LiveHeatPoint[]
  rollups: ExtensionRollup[]
  chartRollups: ExtensionRollup[]
  startedAt?: string
  catalog?: ExtensionEmote[]
}): LiveHeatPoint | null {
  if (pinOffsetSeconds == null) return null
  const heatPoint = findHeatPointAtOffset(heatPoints, pinOffsetSeconds)
  if (heatPoint) return heatPoint
  const pinnedRollup = nearestRollupForOffset(chartRollups, pinOffsetSeconds)
  if (!pinnedRollup || pinnedRollup.missing) return null
  return chartRollupToLiveHeatPoint({
    rollup: pinnedRollup,
    rollups,
    startedAt,
    catalog,
  })
}
