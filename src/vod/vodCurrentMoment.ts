import type { VodMoment, VodTimelinePoint } from '../types/vodPulseTypes.ts'

export interface CurrentMomentInsight {
  label: string
  detail?: string
}

export function findNearestTimelineBucket(
  points: VodTimelinePoint[],
  currentTimeSeconds: number,
): VodTimelinePoint | null {
  if (points.length === 0) return null
  let nearest = points[0]
  let bestDistance = Math.abs(points[0].offsetSeconds - currentTimeSeconds)
  for (const point of points) {
    const distance = Math.abs(point.offsetSeconds - currentTimeSeconds)
    if (distance < bestDistance) {
      bestDistance = distance
      nearest = point
    }
  }
  return nearest
}

export function findNearestMomentWithin(
  moments: VodMoment[],
  currentTimeSeconds: number,
  windowSeconds: number,
): VodMoment | null {
  if (moments.length === 0) return null
  let nearest: VodMoment | null = null
  let bestDistance = Infinity
  for (const moment of moments) {
    const distance = Math.abs(moment.offsetSeconds - currentTimeSeconds)
    if (distance <= windowSeconds && distance < bestDistance) {
      bestDistance = distance
      nearest = moment
    }
  }
  return nearest
}

export function classifyCurrentMoment(
  bucket: VodTimelinePoint | null,
  nearestMoment: VodMoment | null,
  currentTimeSeconds: number,
): CurrentMomentInsight {
  if (!bucket && !nearestMoment) {
    return { label: 'No data for this timestamp' }
  }
  if (nearestMoment && Math.abs(nearestMoment.offsetSeconds - currentTimeSeconds) <= 20) {
    return { label: 'At peak', detail: nearestMoment.label }
  }
  if (nearestMoment) {
    return { label: 'Near spike', detail: nearestMoment.label }
  }
  const chat = bucket?.chatPerMin ?? 0
  const emotes = bucket?.emotesPerMin ?? 0
  const score = bucket?.score ?? 0
  if (score >= 70) return { label: 'At peak' }
  if (emotes >= 120) return { label: 'Emote burst' }
  if (chat >= 500) return { label: 'Chat surge' }
  if (chat > 0 && chat < 20 && emotes < 10) return { label: 'Quiet segment' }
  if (chat > 0 || emotes > 0) return { label: 'Normal activity' }
  return { label: 'No data for this timestamp' }
}

export function timelineYValue(point: VodTimelinePoint): number {
  if (point.score != null && point.score > 0) return point.score
  return Math.max(0, point.chatPerMin ?? 0)
}

export function normalizeTimelineValues(points: VodTimelinePoint[]): number[] {
  const values = points.map(timelineYValue)
  const max = Math.max(1, ...values)
  return values.map(value => value / max)
}

export function seekOffsetFromGraphClick(
  clientX: number,
  rect: DOMRect,
  durationSeconds: number,
): number {
  if (rect.width <= 0 || durationSeconds <= 0) return 0
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  return Math.round(ratio * durationSeconds)
}
