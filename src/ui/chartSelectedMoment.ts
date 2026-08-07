import type { LiveHeatEmote, LiveHeatPoint } from '@streampulse/pulse-core'
import type { ExtensionRollup } from '../shared/messages.ts'
import { minuteEmoteTotal } from './chartRollupUtils.ts'
import { EXTENSION_CHART_MAX_POINTS } from './extensionChartPoints.ts'
import { findHeatPointAtOffset, peakEmoteKey } from './mostReacted.ts'

const DEFAULT_PIN_PEAK_TOLERANCE_SECONDS = 90

/** Widen peak matching when Full stream downsamples many minutes into one chart bar. */
export function chartPinPeakToleranceSeconds(
  rollupCount: number,
  maxDisplayPoints = EXTENSION_CHART_MAX_POINTS,
): number {
  if (!Number.isFinite(rollupCount) || rollupCount <= 0) return DEFAULT_PIN_PEAK_TOLERANCE_SECONDS
  if (rollupCount <= maxDisplayPoints) return DEFAULT_PIN_PEAK_TOLERANCE_SECONDS
  const bucketSeconds = Math.ceil(rollupCount / maxDisplayPoints) * 60
  return Math.max(DEFAULT_PIN_PEAK_TOLERANCE_SECONDS, bucketSeconds)
}

export function resolvePinnedMomentPoint({
  pinOffsetSeconds,
  heatPoints,
  toleranceSeconds = DEFAULT_PIN_PEAK_TOLERANCE_SECONDS,
}: {
  pinOffsetSeconds: number | null | undefined
  heatPoints: LiveHeatPoint[]
  toleranceSeconds?: number
}): LiveHeatPoint | null {
  if (pinOffsetSeconds == null) return null
  // Only backend-provided heat points carry an authoritative Pulse score.
  // Raw chart rollups may still be inspected in the chart, but never become
  // locally scored moments.
  return findHeatPointAtOffset(heatPoints, pinOffsetSeconds, toleranceSeconds)
}

function rollupTopEmotesToHeatEmotes(
  topEmotes: ExtensionRollup['topEmotes'],
): LiveHeatEmote[] {
  return (topEmotes ?? [])
    .filter(emote => emote.name)
    .slice(0, 5)
    .map((emote, index) => ({
      key: peakEmoteKey(emote, index),
      name: emote.name,
      id: emote.id,
      providerEmoteId: emote.providerEmoteId,
      provider: emote.provider,
      imageUrl: emote.imageUrl,
      count: Math.max(0, emote.count ?? 0),
    }))
}

/** Honest chart-minute inspection — not a Pulse-scored moment. */
export function inspectionHeatPointFromRollup(
  rollup: ExtensionRollup,
  startedAt?: string,
): LiveHeatPoint {
  const offsetSeconds = Math.max(0, Math.floor(rollup.offsetSeconds))
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
  const minuteTs = Number.isFinite(startedMs)
    ? new Date(startedMs + offsetSeconds * 1000).toISOString()
    : new Date(0).toISOString()
  const viewerCount = Math.max(0, rollup.viewerCount ?? 0)

  return {
    minuteTs,
    offsetSeconds,
    score: 0,
    estimated: true,
    reason: 'manual',
    reasonLabel: 'Selected minute',
    chatCount: Math.max(0, rollup.chatCount ?? 0),
    emoteCount: minuteEmoteTotal(rollup),
    viewerCount: viewerCount > 0 ? viewerCount : undefined,
    topEmotes: rollupTopEmotesToHeatEmotes(rollup.topEmotes),
    collecting: false,
  }
}

function nearestRollupAtOffset(
  rollups: ExtensionRollup[],
  offsetSeconds: number,
): ExtensionRollup | null {
  if (!Number.isFinite(offsetSeconds) || rollups.length === 0) return null
  const exact = rollups.find(
    rollup => !rollup.missing && rollup.offsetSeconds === offsetSeconds,
  )
  if (exact) return exact

  let best: ExtensionRollup | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const rollup of rollups) {
    if (rollup.missing) continue
    const distance = Math.abs(rollup.offsetSeconds - offsetSeconds)
    if (distance < bestDistance) {
      bestDistance = distance
      best = rollup
    }
  }
  // Chart pins land on real display offsets; allow a small snap for poll jitter.
  return best != null && bestDistance <= 60 ? best : null
}

export type PinnedChartSelection =
  | { kind: 'peak'; point: LiveHeatPoint }
  | { kind: 'minute'; point: LiveHeatPoint }

/**
 * Resolve chart pin to a backend peak when possible; otherwise an honest minute
 * inspection from the rollup so clicking quiet buckets still shows something.
 */
export function resolvePinnedChartSelection({
  pinOffsetSeconds,
  heatPoints,
  rollups,
  startedAt,
  toleranceSeconds = DEFAULT_PIN_PEAK_TOLERANCE_SECONDS,
}: {
  pinOffsetSeconds: number | null | undefined
  heatPoints: LiveHeatPoint[]
  rollups: ExtensionRollup[]
  startedAt?: string
  toleranceSeconds?: number
}): PinnedChartSelection | null {
  if (pinOffsetSeconds == null) return null

  const peak = resolvePinnedMomentPoint({
    pinOffsetSeconds,
    heatPoints,
    toleranceSeconds,
  })
  if (peak) return { kind: 'peak', point: peak }

  const rollup = nearestRollupAtOffset(rollups, pinOffsetSeconds)
  if (!rollup) return null
  return { kind: 'minute', point: inspectionHeatPointFromRollup(rollup, startedAt) }
}
