import type { PulseRecapMoment } from '../apiTypes.ts'
import type { ReplayHeatmapPoint } from '../types/heatmap.ts'
import { rollupOffsetSeconds } from './momentSelection.ts'
import type { AnalyticsMinuteRollup } from '../apiTypes.ts'

/** Match Pulse Moments row highlight / Selected Moment within this window. */
export const SELECTED_MOMENT_MATCH_TOLERANCE_SECONDS = 90

export function findNearestRecapMoment(
  moments: readonly PulseRecapMoment[] | undefined,
  offsetSeconds: number,
  toleranceSeconds = SELECTED_MOMENT_MATCH_TOLERANCE_SECONDS,
): PulseRecapMoment | null {
  if (!moments?.length || !Number.isFinite(offsetSeconds)) return null
  let best: PulseRecapMoment | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const moment of moments) {
    const delta = Math.abs(moment.offsetSeconds - offsetSeconds)
    if (delta < bestDelta) {
      best = moment
      bestDelta = delta
    }
  }
  return best && bestDelta <= toleranceSeconds ? best : null
}

export function findNearestHeatmapPoint(
  points: readonly ReplayHeatmapPoint[] | undefined,
  offsetSeconds: number,
  toleranceSeconds = SELECTED_MOMENT_MATCH_TOLERANCE_SECONDS,
): ReplayHeatmapPoint | null {
  if (!points?.length || !Number.isFinite(offsetSeconds)) return null
  let best: ReplayHeatmapPoint | null = null
  let bestDelta = Number.POSITIVE_INFINITY
  for (const point of points) {
    const pointOffset = Number.isFinite(point.offsetSeconds)
      ? point.offsetSeconds
      : Number.NaN
    if (!Number.isFinite(pointOffset)) continue
    const delta = Math.abs(pointOffset - offsetSeconds)
    if (delta < bestDelta) {
      best = point
      bestDelta = delta
    }
  }
  return best && bestDelta <= toleranceSeconds ? best : null
}

export function selectedRollupOffsetSeconds(
  rollup: AnalyticsMinuteRollup | null | undefined,
  startedAt: string | undefined,
): number | null {
  if (!rollup || !startedAt) return null
  return rollupOffsetSeconds(rollup, startedAt)
}
