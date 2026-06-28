import type { HubActivityPoint } from './publicHub'

/** Mirrors hubActivityMaxPoints in streamclone internal/analytics/hub_overview.go */
export const HUB_ACTIVITY_MAX_POINTS = 240

/**
 * Expected bucket width in minutes for a hub activity window.
 * Matches hubActivityBucketMinutes on the backend.
 */
export function bucketMinutes(windowMinutes: number): number {
  if (windowMinutes <= HUB_ACTIVITY_MAX_POINTS) return 1
  const bucket = Math.ceil(windowMinutes / HUB_ACTIVITY_MAX_POINTS)
  return bucket < 1 ? 1 : bucket
}

function expectedBucketMs(windowMinutes: number): number {
  return Math.max(60_000, Math.ceil(Math.max(1, windowMinutes) / HUB_ACTIVITY_MAX_POINTS) * 60_000)
}

/** Max gap between adjacent points before the chart breaks the line (aligned with HubActivityChart). */
export function maxConnectedGapMs(windowMinutes: number): number {
  return Math.max(5 * 60_000, expectedBucketMs(windowMinutes) * 2.5)
}

/** Count corpus gaps where stored rollups are missing between adjacent buckets. */
export function internalGapCount(points: Pick<HubActivityPoint, 't'>[], windowMinutes: number): number {
  if (points.length < 2) return 0
  const maxGap = maxConnectedGapMs(windowMinutes)
  let gaps = 0
  for (let i = 1; i < points.length; i += 1) {
    if ((points[i]?.t ?? 0) - (points[i - 1]?.t ?? 0) > maxGap) gaps += 1
  }
  return gaps
}

function activePoint(point: HubActivityPoint): boolean {
  return point.chat > 0 || point.seventv > 0 || Math.max(point.emotes ?? 0, point.seventv ?? 0) > 0
}

export function formatActivityWindowLabel(minutes: number): string {
  if (minutes >= 60 * 24 * 365) return `${Math.round(minutes / (60 * 24 * 365))} year`
  if (minutes >= 60 * 24 * 30) return `${Math.round(minutes / (60 * 24 * 30))} month`
  if (minutes >= 60 * 24) return `${Math.round(minutes / (60 * 24))} day`
  if (minutes >= 60) return `${Math.round(minutes / 60)} hour`
  return `${minutes} minute`
}

export interface ActivitySummary {
  pointCount: number
  nonZeroCount: number
  gapCount: number
  bucketMinutes: number
  windowLabel: string
  footnote: string
}

export function summarizeActivity(
  points: HubActivityPoint[],
  windowMinutes: number,
  channelCount: number,
  updatedAgo?: string,
): ActivitySummary {
  const pointCount = points.length
  const nonZeroCount = points.filter(activePoint).length
  const gapCount = internalGapCount(points, windowMinutes)
  const bucket = bucketMinutes(windowMinutes)
  const windowLabel = formatActivityWindowLabel(windowMinutes)
  const updatedSuffix = updatedAgo ? ` · updated ${updatedAgo}` : ''
  const footnote = `${pointCount} buckets · ~${bucket} min each · ${channelCount} channels in pool${updatedSuffix}`

  return {
    pointCount,
    nonZeroCount,
    gapCount,
    bucketMinutes: bucket,
    windowLabel,
    footnote,
  }
}
