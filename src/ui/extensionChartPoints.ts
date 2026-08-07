import type { ExtensionRollup } from '../shared/messages.ts'
import { chartViewerValue, minuteEmoteTotal } from './chartRollupUtils.ts'
import { rollupActivityScore } from './segmentedBarChart.ts'

export const EXTENSION_CHART_MAX_POINTS = 120

export interface ExtensionChartPoint {
  offsetSeconds: number
  chatNorm: number
  viewersNorm: number
  emotesNorm: number
  heat: number
  chatCount: number
  emoteCount: number
  viewerCount: number
}

function normalizeChartValue(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)))
}

/** Bucket index ranges used by downsampleRollupsForChart (for emote trace aggregation). */
export function chartBucketRanges(
  rollups: ExtensionRollup[],
  maxPoints = EXTENSION_CHART_MAX_POINTS,
): Array<{ start: number; end: number }> {
  const n = rollups.length
  if (n === 0) return []
  if (maxPoints <= 0 || n <= maxPoints) {
    return rollups.map((_, index) => ({ start: index, end: index + 1 }))
  }
  const bucketSize = n / maxPoints
  const ranges: Array<{ start: number; end: number }> = []
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(n, Math.floor((bucket + 1) * bucketSize))
    if (end <= start) continue
    ranges.push({ start, end })
  }
  return ranges
}

/** Spike-preserving downsample: uniform stride flattens peaks on long sessions. */
export function downsampleRollupsForChart(
  rollups: ExtensionRollup[],
  maxPoints = EXTENSION_CHART_MAX_POINTS,
): ExtensionRollup[] {
  const n = rollups.length
  if (n === 0 || maxPoints <= 0 || n <= maxPoints) return rollups

  const bucketSize = n / maxPoints
  const out: ExtensionRollup[] = []
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(n, Math.floor((bucket + 1) * bucketSize))
    if (end <= start) continue

    let best = rollups[start]!
    let bestScore = rollupActivityScore(best)
    let peakViewers = chartViewerValue(best)
    for (let i = start + 1; i < end; i += 1) {
      const rollup = rollups[i]!
      const score = rollupActivityScore(rollup)
      if (score > bestScore) {
        best = rollup
        bestScore = score
      }
      peakViewers = Math.max(peakViewers, chartViewerValue(rollup))
    }
    if (peakViewers > chartViewerValue(best)) {
      out.push({ ...best, viewerCount: peakViewers })
    } else {
      out.push(best)
    }
  }

  // Pin chronological endpoints so "Now" is the real last minute, not an earlier spike peak.
  const first = rollups[0]
  const last = rollups[n - 1]
  if (first != null && out[0]?.offsetSeconds !== first.offsetSeconds) {
    out[0] = first
  }
  if (last != null && out[out.length - 1]?.offsetSeconds !== last.offsetSeconds) {
    out[out.length - 1] = last
  }
  return out
}

export function chartPointsFromExtensionRollups(
  rollups: ExtensionRollup[],
  options?: { maxPoints?: number },
): ExtensionChartPoint[] {
  const sampled = downsampleRollupsForChart(rollups, options?.maxPoints)
  if (sampled.length === 0) return []

  const maxChat = Math.max(...sampled.map(rollup => rollup.chatCount ?? 0), 1)
  const maxViewers = Math.max(...sampled.map(rollup => chartViewerValue(rollup)), 1)
  const maxEmotes = Math.max(...sampled.map(rollup => minuteEmoteTotal(rollup)), 1)

  return sampled.map(rollup => {
    const chatCount = rollup.chatCount ?? 0
    const emoteCount = minuteEmoteTotal(rollup)
    const viewerCount = chartViewerValue(rollup)
    const chatNorm = normalizeChartValue(chatCount, maxChat)
    const viewersNorm = normalizeChartValue(viewerCount, maxViewers)
    const emotesNorm = normalizeChartValue(emoteCount, maxEmotes)
    return {
      offsetSeconds: rollup.offsetSeconds,
      chatNorm,
      viewersNorm,
      emotesNorm,
      heat: Math.min(100, Math.round(chatNorm * 0.35 + emotesNorm * 0.5 + viewersNorm * 0.15)),
      chatCount,
      emoteCount,
      viewerCount,
    }
  })
}

export function nearestRollupForOffset(
  rollups: ExtensionRollup[],
  offsetSeconds: number,
): ExtensionRollup | undefined {
  if (!rollups.length || !Number.isFinite(offsetSeconds)) return undefined
  let best = rollups[0]!
  let bestDist = Math.abs(best.offsetSeconds - offsetSeconds)
  for (let i = 1; i < rollups.length; i += 1) {
    const rollup = rollups[i]!
    const dist = Math.abs(rollup.offsetSeconds - offsetSeconds)
    if (dist < bestDist || (dist === bestDist && rollup.offsetSeconds < best.offsetSeconds)) {
      best = rollup
      bestDist = dist
    }
  }
  return best
}

export function nearestChartPointIndex(
  points: ExtensionChartPoint[],
  offsetSeconds: number,
): number {
  if (points.length === 0 || !Number.isFinite(offsetSeconds)) return -1
  let best = 0
  let bestDist = Math.abs(points[0]!.offsetSeconds - offsetSeconds)
  for (let i = 1; i < points.length; i += 1) {
    const dist = Math.abs(points[i]!.offsetSeconds - offsetSeconds)
    if (dist < bestDist || (dist === bestDist && points[i]!.offsetSeconds < points[best]!.offsetSeconds)) {
      best = i
      bestDist = dist
    }
  }
  return best
}
