import type { ExtensionRollup } from '../shared/messages.ts'
import type { EmoteOverlaySeries } from './chatActivityEmotes.ts'
import { CHART_THEME } from './chartTheme.ts'

/** Portal-aligned cap — spike-preserving downsample for long offline recaps. */
export const RECAP_CHART_MAX_POINTS = 240

export interface RecapChartPoint {
  offsetSeconds: number
  chatNorm: number
  emotesNorm: number
  heat: number
  chatCount: number
  emoteCount: number
}

export function rollupEmoteCountForChart(rollup: ExtensionRollup): number {
  return Math.max(0, rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0)
}

export function rollupChartActivityScore(rollup: ExtensionRollup): number {
  const chat = rollup.chatCount ?? 0
  const emotes = rollupEmoteCountForChart(rollup)
  return chat * 1000 + emotes * 100
}

function uniformDownsample<T>(items: T[], maxPoints: number): T[] {
  const step = Math.ceil(items.length / maxPoints)
  const out: T[] = []
  for (let i = 0; i < items.length; i += step) {
    out.push(items[i]!)
  }
  const last = items[items.length - 1]
  if (last != null && out[out.length - 1] !== last) {
    out.push(last)
  }
  return out
}

/** Spike-preserving downsample (ported from streampulse-web timelineDownsample). */
export function downsampleTimeline<T>(
  items: T[],
  maxPoints: number,
  activityScore?: (item: T) => number,
): T[] {
  if (items.length <= maxPoints) return items
  if (!activityScore) return uniformDownsample(items, maxPoints)

  const bucketCount = maxPoints
  const bucketSize = items.length / bucketCount
  const out: T[] = []
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(items.length, Math.floor((bucket + 1) * bucketSize))
    if (start >= end) continue
    let best = items[start]!
    let bestScore = activityScore(best)
    for (let i = start + 1; i < end; i += 1) {
      const score = activityScore(items[i]!)
      if (score > bestScore) {
        best = items[i]!
        bestScore = score
      }
    }
    out.push(best)
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (first != null && out[0] !== first) out.unshift(first)
  if (last != null && out[out.length - 1] !== last) out.push(last)
  return out.slice(0, maxPoints + 2)
}

export function normalizeChartValue(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)))
}

export function bucketRollupsToMinutes(rollups: ExtensionRollup[]): Map<number, ExtensionRollup> {
  const buckets = new Map<number, ExtensionRollup>()
  for (const rollup of rollups) {
    const bucketOffset = Math.floor(rollup.offsetSeconds / 60) * 60
    const existing = buckets.get(bucketOffset)
    if (!existing || rollupChartActivityScore(rollup) > rollupChartActivityScore(existing)) {
      buckets.set(bucketOffset, { ...rollup, offsetSeconds: bucketOffset })
    }
  }
  return buckets
}

export function zeroFillRollupsForRecap(
  rollups: ExtensionRollup[],
  fromOffset: number,
  toOffset: number,
): ExtensionRollup[] {
  if (toOffset <= fromOffset) return rollups
  const byOffset = bucketRollupsToMinutes(rollups)
  const step = 60
  const out: ExtensionRollup[] = []
  for (let off = fromOffset; off <= toOffset; off += step) {
    out.push(
      byOffset.get(off) ?? {
        offsetSeconds: off,
        chatCount: 0,
        sevenTvEmoteCount: 0,
      },
    )
  }
  return out
}

export function prepareRecapChartRollups(
  rollups: ExtensionRollup[],
  toOffsetSeconds: number,
  maxPoints = RECAP_CHART_MAX_POINTS,
): ExtensionRollup[] {
  if (rollups.length === 0) return []
  const lastOffset = rollups[rollups.length - 1]?.offsetSeconds ?? 0
  const toOffset = Math.max(toOffsetSeconds, lastOffset)
  if (toOffset <= 60) return rollups
  const filled = zeroFillRollupsForRecap(rollups, 0, toOffset)
  return downsampleTimeline(filled, maxPoints, rollupChartActivityScore)
}

export function buildRecapChartSeries(rollups: ExtensionRollup[]): RecapChartPoint[] {
  if (rollups.length === 0) return []
  const maxChat = Math.max(...rollups.map(rollup => rollup.chatCount ?? 0), 1)
  const maxEmotes = Math.max(...rollups.map(rollup => rollupEmoteCountForChart(rollup)), 1)
  return rollups.map(rollup => {
    const chatCount = rollup.chatCount ?? 0
    const emoteCount = rollupEmoteCountForChart(rollup)
    const chatNorm = normalizeChartValue(chatCount, maxChat)
    const emotesNorm = normalizeChartValue(emoteCount, maxEmotes)
    return {
      offsetSeconds: rollup.offsetSeconds,
      chatNorm,
      emotesNorm,
      heat: Math.min(100, Math.round(chatNorm * 0.35 + emotesNorm * 0.5)),
      chatCount,
      emoteCount,
    }
  })
}

export function buildNormalizedRecapOverlays(points: RecapChartPoint[]): EmoteOverlaySeries[] {
  const out: EmoteOverlaySeries[] = []
  if (points.some(point => point.emotesNorm > 0)) {
    out.push({
      key: 'recap-emotes-norm',
      label: 'Emotes',
      color: CHART_THEME.emote.color,
      values: points.map(point => point.emotesNorm),
    })
  }
  if (points.some(point => point.heat > 0)) {
    out.push({
      key: 'recap-heat',
      label: 'Heat',
      color: '#fbbf24',
      values: points.map(point => point.heat),
      dashed: true,
    })
  }
  return out
}
