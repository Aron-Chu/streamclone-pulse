import type { ExtensionRollup } from '../shared/messages.ts'
import { rollupActivityScore } from './segmentedBarChart.ts'

export const EXTENSION_CHART_MAX_POINTS = 120

/**
 * Legacy normalized point shape. Viewer geometry is owned by
 * `buildViewerGeometry` in `@streampulse/pulse-charts`; nothing in the extension
 * builds these points any more.
 */
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

/**
 * Spike-preserving downsample: uniform stride flattens peaks on long sessions.
 *
 * The bucket representative is a REAL minute, returned unmodified. An earlier
 * version overrode `viewerCount` with the bucket maximum, which paired one
 * minute's chat with another minute's viewer sample and made the viewer line
 * spiky at long windows.
 */
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
    for (let i = start + 1; i < end; i += 1) {
      const rollup = rollups[i]!
      const score = rollupActivityScore(rollup)
      if (score > bestScore) {
        best = rollup
        bestScore = score
      }
    }
    out.push(best)
  }
  return out
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
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid]!.offsetSeconds < offsetSeconds) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 0
  const before = points[lo - 1]!
  const after = points[lo]!
  return offsetSeconds - before.offsetSeconds <= after.offsetSeconds - offsetSeconds
    ? lo - 1
    : lo
}

/**
 * Binary-search the nearest ordered rollup.  Chart hover uses this instead of
 * scanning every raw minute, so a long stream keeps pointer work bounded.
 */
export function nearestRollupIndex(
  rollups: readonly Pick<ExtensionRollup, 'offsetSeconds'>[],
  offsetSeconds: number,
): number {
  if (rollups.length === 0 || !Number.isFinite(offsetSeconds)) return -1
  let lo = 0
  let hi = rollups.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (rollups[mid]!.offsetSeconds < offsetSeconds) lo = mid + 1
    else hi = mid
  }
  if (lo === 0) return 0
  const before = rollups[lo - 1]!
  const after = rollups[lo]!
  return offsetSeconds - before.offsetSeconds <= after.offsetSeconds - offsetSeconds
    ? lo - 1
    : lo
}
