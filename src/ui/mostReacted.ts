import {
  deriveLiveHeat,
  displayMomentReasonLabel,
  extensionRollupsForDerivation,
  extensionSupportsPeaks,
  isEmoteSpikeReason,
  isViewerSpikeReason,
  LIVE_HEAT_MAX_EMOTES,
  peaksToLiveHeatPoints,
  toLiveHeatInputFromExtension,
  LIVE_HEAT_SUBTITLE,
  type LiveHeatEmote,
  type LiveHeatPoint,
  type LiveHeatResult,
} from '@streampulse/pulse-core'
import type { ExtensionEmote, ExtensionPeak, ExtensionRollup, PulsePayload } from '../shared/messages.ts'

export function peakReasonLabel(peak: ExtensionPeak): string {
  return displayMomentReasonLabel(peak.reasons[0] ?? '', peak.reasonLabel)
}

export function peakChatCount(peak: ExtensionPeak): number {
  return peak.chatCount ?? 0
}

export function peakEmoteCount(peak: ExtensionPeak): number {
  return peak.emoteCount ?? 0
}

export function peakEmoteKey(emote: ExtensionEmote, index: number): string {
  return emote.id ?? `${emote.name}-${emote.provider ?? 'unknown'}-${index}`
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', {
    notation: value >= 10_000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

export function selectedMomentKey(
  streamId: string | undefined,
  point: LiveHeatPoint,
): string {
  return `${streamId ?? 'unknown'}:${point.offsetSeconds}:${point.reason}`
}

const MOMENT_OFFSET_MATCH_SECONDS = 90

export function heatPointMatchesOffset(
  point: LiveHeatPoint,
  offsetSeconds: number,
  toleranceSeconds = MOMENT_OFFSET_MATCH_SECONDS,
): boolean {
  if (!Number.isFinite(offsetSeconds)) return false
  return Math.abs(point.offsetSeconds - offsetSeconds) <= toleranceSeconds
}

export function findHeatPointAtOffset(
  points: LiveHeatPoint[],
  offsetSeconds: number,
  toleranceSeconds = MOMENT_OFFSET_MATCH_SECONDS,
): LiveHeatPoint | null {
  if (!Number.isFinite(offsetSeconds) || points.length === 0) return null
  let best: LiveHeatPoint | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const point of points) {
    const distance = Math.abs(point.offsetSeconds - offsetSeconds)
    if (distance <= toleranceSeconds && distance < bestDistance) {
      bestDistance = distance
      best = point
    }
  }
  return best
}

function completedRollupCount(payload: PulsePayload): number {
  const input = toLiveHeatInputFromExtension(payload)
  return input.rollups.filter(
    r =>
      !r.missing
      && ((r.chatCount ?? 0) > 0 || (r.totalEmoteCount ?? 0) > 0 || (r.viewerSamples ?? 0) > 0),
  ).length
}

function rollupEmoteTotal(rollup: ExtensionRollup): number {
  const total = rollup.totalEmoteCount ?? 0
  if (total > 0) return total
  return rollup.sevenTvEmoteCount ?? 0
}

function findRollupNearOffset(
  rollups: ExtensionRollup[],
  offsetSeconds: number,
  toleranceSeconds = 90,
): ExtensionRollup | undefined {
  if (!Number.isFinite(offsetSeconds) || rollups.length === 0) return undefined
  let best: ExtensionRollup | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const rollup of rollups) {
    const distance = Math.abs(rollup.offsetSeconds - offsetSeconds)
    if (distance < bestDistance) {
      bestDistance = distance
      best = rollup
    }
  }
  return bestDistance <= toleranceSeconds ? best : undefined
}

function rollupTopEmotesToHeatEmotes(topEmotes: ExtensionEmote[] | undefined): LiveHeatEmote[] {
  return (topEmotes ?? [])
    .filter(emote => emote.name)
    .slice(0, LIVE_HEAT_MAX_EMOTES)
    .map((emote, index) => ({
      key: peakEmoteKey(emote, index),
      name: emote.name,
      provider: emote.provider,
      imageUrl: emote.imageUrl,
      count: Math.max(0, emote.count ?? 0),
    }))
}

function enrichHeatPointFromRollups(
  point: LiveHeatPoint,
  rollups: ExtensionRollup[],
): LiveHeatPoint {
  const rollup = findRollupNearOffset(rollups, point.offsetSeconds)
  if (!rollup) return point

  const chatCount =
    point.chatCount > 0 ? point.chatCount : Math.max(0, rollup.chatCount ?? 0)
  const emoteCount =
    point.emoteCount > 0 ? point.emoteCount : rollupEmoteTotal(rollup)
  const topEmotes =
    point.topEmotes.length > 0
      ? point.topEmotes
      : rollupTopEmotesToHeatEmotes(rollup.topEmotes)
  const viewerCount =
    (point.viewerCount ?? 0) > 0
      ? point.viewerCount
      : Math.max(0, rollup.viewerCount ?? 0) || undefined

  return { ...point, chatCount, emoteCount, topEmotes, viewerCount }
}

/** Most Reacted is chat/emote spikes only — never viewer spikes, even when rollups add counts. */
function isMostReactedMoment(point: LiveHeatPoint): boolean {
  if (isViewerSpikeReason(point.reason) || isViewerSpikeReason(point.reasonLabel ?? '')) {
    return false
  }
  return point.chatCount > 0 || point.emoteCount > 0
}

export const MOST_REACTED_VISIBLE_COUNT = 5

function finalizeMostReactedPoints(points: LiveHeatPoint[], rollups: ExtensionRollup[]): LiveHeatPoint[] {
  return points
    .map(point => enrichHeatPointFromRollups(point, rollups))
    .filter(isMostReactedMoment)
}

/** Prefer backend peaks; fall back to deriveLiveHeat only when peaks field is absent. */
export function resolveMostReactedHeat(payload: PulsePayload): LiveHeatResult {
  const rollups = extensionRollupsForDerivation(payload) as ExtensionRollup[]

  if (extensionSupportsPeaks(payload)) {
    if ((payload.peaks?.length ?? 0) === 0) {
      return {
        visible: false,
        completedRollupCount: completedRollupCount(payload),
        points: [],
        collectingPoint: null,
        subtitle: LIVE_HEAT_SUBTITLE,
      }
    }
    const points = finalizeMostReactedPoints(
      peaksToLiveHeatPoints(payload.peaks ?? [], payload.startedAt, payload.topEmotes),
      rollups,
    )
    return {
      visible: points.length > 0,
      completedRollupCount: completedRollupCount(payload),
      points,
      collectingPoint: null,
      subtitle: LIVE_HEAT_SUBTITLE,
    }
  }
  const derived = deriveLiveHeat(toLiveHeatInputFromExtension(payload))
  const points = finalizeMostReactedPoints(derived.points, rollups)
  return {
    ...derived,
    visible: points.length > 0,
    points,
  }
}

export function resolveSelectedMomentKey(
  streamId: string | undefined,
  points: LiveHeatPoint[],
  priorKey: string | null,
): string | null {
  if (points.length === 0 || !priorKey) return null
  if (points.some(point => selectedMomentKey(streamId, point) === priorKey)) {
    return priorKey
  }
  return null
}

export type MomentSortMode = 'reaction' | 'chat' | 'emotes'

function isChatSpikeReason(reason: string, reasonLabel?: string): boolean {
  const normalized = reason.trim().toLowerCase()
  if (normalized === 'chat_spike') return true
  const label = (reasonLabel ?? '').trim().toLowerCase()
  return label.includes('chat') && label.includes('spike')
}

/** Rank by the spike's dominant signal — chat spikes by chat, emote spikes by emotes. */
export function reactionRankValue(point: LiveHeatPoint): number {
  if (isChatSpikeReason(point.reason, point.reasonLabel)) {
    return point.chatCount
  }
  if (isEmoteSpikeReason(point.reason) || isEmoteSpikeReason(point.reasonLabel ?? '')) {
    return point.emoteCount
  }
  return point.chatCount + point.emoteCount
}

export function sortLiveHeatPoints(points: LiveHeatPoint[], mode: MomentSortMode): LiveHeatPoint[] {
  const copy = [...points]
  if (mode === 'chat') {
    copy.sort(
      (a, b) =>
        b.chatCount - a.chatCount
        || reactionRankValue(b) - reactionRankValue(a)
        || a.offsetSeconds - b.offsetSeconds,
    )
  } else if (mode === 'emotes') {
    copy.sort(
      (a, b) =>
        b.emoteCount - a.emoteCount
        || reactionRankValue(b) - reactionRankValue(a)
        || a.offsetSeconds - b.offsetSeconds,
    )
  } else {
    copy.sort(
      (a, b) =>
        reactionRankValue(b) - reactionRankValue(a)
        || b.score - a.score
        || a.offsetSeconds - b.offsetSeconds,
    )
  }
  return copy
}
