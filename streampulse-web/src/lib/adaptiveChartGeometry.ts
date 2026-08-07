export interface AdaptiveLinePoint {
  x: number
  y: number
}

/** Render a full-resolution series without inventing intermediate values. */
export function buildLinearLine(points: readonly AdaptiveLinePoint[]): string {
  if (points.length < 2) return ''
  return points
    .map((point, index) => {
      const command = index === 0 ? 'M' : 'L'
      return `${command} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
    })
    .join(' ')
}

/**
 * Reduce a calm/rest path while retaining endpoints and the strongest local
 * deviation in each bucket. Detail paths use the original points instead.
 */
export function decimateLinePoints(
  points: readonly AdaptiveLinePoint[],
  maxPoints = 72,
): AdaptiveLinePoint[] {
  if (points.length <= maxPoints || maxPoints < 3) return [...points]

  const interiorCount = maxPoints - 2
  const bucketSize = (points.length - 2) / interiorCount
  const reduced: AdaptiveLinePoint[] = [points[0]]

  for (let bucket = 0; bucket < interiorCount; bucket += 1) {
    const start = Math.floor(1 + bucket * bucketSize)
    const end = Math.min(points.length - 1, Math.floor(1 + (bucket + 1) * bucketSize))
    const left = points[Math.max(0, start - 1)]
    const right = points[Math.min(points.length - 1, end)]
    const baseline = ((left?.y ?? 0) + (right?.y ?? 0)) / 2

    let candidate = points[start]
    let deviation = Math.abs((candidate?.y ?? baseline) - baseline)
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index]
      const nextDeviation = Math.abs(point.y - baseline)
      if (nextDeviation > deviation) {
        candidate = point
        deviation = nextDeviation
      }
    }
    if (candidate && reduced[reduced.length - 1] !== candidate) reduced.push(candidate)
  }

  const last = points[points.length - 1]
  if (reduced[reduced.length - 1] !== last) reduced.push(last)
  return reduced
}
