/**
 * Peak-preserving render-level reduction.
 *
 * Analytical rollups stay at their canonical one-minute resolution. These
 * buckets are only for deciding which points to draw when the stream has more
 * samples than available pixels. Every signal keeps its own source index and
 * timestamp; callers must not use another signal's peak as a substitute.
 */

export type RenderBucketRange = {
  bucketIndex: number
  startIndex: number
  endExclusive: number
}

export type RenderSignalPoint = {
  index: number
  value: number
}

export type RenderSignalBucket = RenderBucketRange & {
  first: RenderSignalPoint | null
  last: RenderSignalPoint | null
  peak: RenderSignalPoint | null
  minimum: RenderSignalPoint | null
  maximum: RenderSignalPoint | null
  sum: number
  count: number
  average: number | null
}

export type RenderBuckets = {
  ranges: RenderBucketRange[]
  signals: Record<string, RenderSignalBucket[]>
}

function finiteValue(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

/** Build contiguous, order-preserving source ranges for a render budget. */
export function buildRenderBucketRanges(sampleCount: number, maxBuckets: number): RenderBucketRange[] {
  const count = Math.max(0, Math.floor(sampleCount))
  const budget = Math.max(1, Math.floor(maxBuckets))
  if (count === 0) return []
  if (count <= budget) {
    return Array.from({ length: count }, (_, index) => ({
      bucketIndex: index,
      startIndex: index,
      endExclusive: index + 1,
    }))
  }

  const bucketSize = count / budget
  const ranges: RenderBucketRange[] = []
  for (let bucketIndex = 0; bucketIndex < budget; bucketIndex++) {
    const startIndex = Math.floor(bucketIndex * bucketSize)
    const endExclusive = Math.min(count, Math.floor((bucketIndex + 1) * bucketSize))
    if (endExclusive <= startIndex) continue
    ranges.push({ bucketIndex, startIndex, endExclusive })
  }
  return ranges
}

function buildSignalBucket(
  values: readonly (number | null | undefined)[],
  range: RenderBucketRange,
): RenderSignalBucket {
  const points: RenderSignalPoint[] = []
  for (let index = range.startIndex; index < range.endExclusive; index++) {
    const value = values[index]
    if (finiteValue(value)) points.push({ index, value })
  }

  if (points.length === 0) {
    return {
      ...range,
      first: null,
      last: null,
      peak: null,
      minimum: null,
      maximum: null,
      sum: 0,
      count: 0,
      average: null,
    }
  }

  let peak = points[0]!
  let minimum = points[0]!
  let maximum = points[0]!
  let sum = points[0]!.value
  for (const point of points.slice(1)) {
    sum += point.value
    // Stable ties keep the earliest source timestamp, avoiding visual jitter
    // when live data updates a flat bucket.
    if (point.value > peak.value) peak = point
    if (point.value < minimum.value) minimum = point
    if (point.value > maximum.value) maximum = point
  }
  return {
    ...range,
    first: points[0]!,
    last: points[points.length - 1]!,
    peak,
    minimum,
    maximum,
    sum,
    count: points.length,
    average: sum / points.length,
  }
}

/**
 * Build independent per-signal buckets over one shared source index range.
 * `signals` may have null gaps; gaps remain null rather than being converted
 * into an interpolated point.
 */
export function buildRenderBuckets(
  signals: Record<string, readonly (number | null | undefined)[]>,
  maxBuckets: number,
): RenderBuckets {
  const sampleCount = Object.values(signals).reduce((max, values) => Math.max(max, values.length), 0)
  const ranges = buildRenderBucketRanges(sampleCount, maxBuckets)
  const reducedSignals: Record<string, RenderSignalBucket[]> = {}
  for (const [key, values] of Object.entries(signals)) {
    reducedSignals[key] = ranges.map(range => buildSignalBucket(values, range))
  }
  return { ranges, signals: reducedSignals }
}
