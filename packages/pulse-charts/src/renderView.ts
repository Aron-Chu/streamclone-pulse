import {
  buildRenderBuckets,
  type RenderBucketRange,
  type RenderSignalBucket,
  type RenderSignalPoint,
} from './renderBuckets.ts'

export type ContiguousSegment = {
  startIndex: number
  endExclusive: number
  points: RenderSignalPoint[]
}

export type RenderViewSignalBucket = RenderSignalBucket & {
  hasInternalGap: boolean
  rangeLength: number
  observedRatio: number
  fullyObserved: boolean
  segments: ContiguousSegment[]
  /** Ordered path points for drawing — one list per segment; null gap between segments. */
  pathSegments: RenderSignalPoint[][]
}

export type ComposedRenderView = {
  ranges: RenderBucketRange[]
  signals: Record<string, RenderViewSignalBucket[]>
}

function isFiniteValue(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

export function contiguousSegmentsForRange(
  values: readonly (number | null | undefined)[],
  range: { startIndex: number; endExclusive: number },
): ContiguousSegment[] {
  const segments: ContiguousSegment[] = []
  let activeStart = -1
  let activePoints: RenderSignalPoint[] = []

  const closeActiveSegment = (endExclusive: number) => {
    if (activeStart < 0) return
    segments.push({
      startIndex: activeStart,
      endExclusive,
      points: activePoints,
    })
    activeStart = -1
    activePoints = []
  }

  for (let index = range.startIndex; index < range.endExclusive; index++) {
    const value = values[index]
    if (!isFiniteValue(value)) {
      closeActiveSegment(index)
      continue
    }
    if (activeStart < 0) activeStart = index
    activePoints.push({ index, value })
  }
  closeActiveSegment(range.endExclusive)

  return segments
}

function representativePathPoints(points: readonly RenderSignalPoint[]): RenderSignalPoint[] {
  if (points.length <= 4) return [...points]
  let minimum = points[0]!
  let maximum = points[0]!
  for (const point of points) {
    if (point.value < minimum.value) minimum = point
    if (point.value > maximum.value) maximum = point
  }
  const byIndex = new Map<number, RenderSignalPoint>()
  for (const point of [points[0]!, minimum, maximum, points[points.length - 1]!]) {
    byIndex.set(point.index, point)
  }
  return [...byIndex.values()].sort((a, b) => a.index - b.index)
}

/**
 * Merge pathSegments across adjacent render buckets into contiguous observed
 * runs. A new run starts only when source indices are non-contiguous (true gap).
 */
export function contiguousPathRunsAcrossBuckets(
  buckets: readonly Pick<RenderViewSignalBucket, 'pathSegments'>[],
): RenderSignalPoint[][] {
  const runs: RenderSignalPoint[][] = []
  let current: RenderSignalPoint[] = []
  let lastIndex = Number.NEGATIVE_INFINITY

  for (const bucket of buckets) {
    for (const segment of bucket.pathSegments) {
      if (segment.length === 0) continue
      const firstIndex = segment[0]!.index
      if (current.length > 0 && firstIndex === lastIndex + 1) {
        current.push(...segment)
      } else {
        if (current.length > 0) runs.push(current)
        current = [...segment]
      }
      lastIndex = segment[segment.length - 1]!.index
    }
  }
  if (current.length > 0) runs.push(current)
  return runs
}

export function composeRenderView(
  signals: Record<string, readonly (number | null | undefined)[]>,
  maxBuckets: number,
): ComposedRenderView {
  const buckets = buildRenderBuckets(signals, maxBuckets)
  const composedSignals: Record<string, RenderViewSignalBucket[]> = {}

  for (const [key, signalBuckets] of Object.entries(buckets.signals)) {
    const values = signals[key] ?? []
    composedSignals[key] = signalBuckets.map((bucket) => {
      const segments = contiguousSegmentsForRange(values, bucket)
      const rangeLength = bucket.endExclusive - bucket.startIndex
      const firstObservedIndex = segments[0]?.startIndex
      const lastSegment = segments[segments.length - 1]
      const lastObservedEnd = lastSegment?.endExclusive
      const hasMissingBetweenObserved = firstObservedIndex != null
        && lastObservedEnd != null
        && bucket.count < lastObservedEnd - firstObservedIndex
      const hasInternalGap = segments.length > 1 || hasMissingBetweenObserved

      return {
        ...bucket,
        hasInternalGap,
        rangeLength,
        observedRatio: rangeLength > 0 ? bucket.count / rangeLength : 0,
        fullyObserved: rangeLength > 0 && bucket.count === rangeLength,
        segments,
        pathSegments: segments.map(segment => representativePathPoints(segment.points)),
      }
    })
  }

  return {
    ranges: buckets.ranges,
    signals: composedSignals,
  }
}

/**
 * Keep every selected pin whose canonical source minute starts in the
 * inclusive render interval. Pins may have second-level precision, so each pin
 * is associated with the latest source offset at or before it.
 */
export function pinsAddressableInRange(
  offsets: readonly number[],
  rangeStartOffset: number,
  rangeEndOffset: number,
  sourceOffsets: readonly number[],
): number[] {
  if (rangeEndOffset < rangeStartOffset || sourceOffsets.length === 0) return []

  return offsets.filter((offset) => {
    let sourceMinuteOffset: number | undefined
    for (const sourceOffset of sourceOffsets) {
      if (!Number.isFinite(sourceOffset)) continue
      if (sourceOffset > offset) break
      sourceMinuteOffset = sourceOffset
    }
    return sourceMinuteOffset != null
      && sourceMinuteOffset >= rangeStartOffset
      && sourceMinuteOffset <= rangeEndOffset
  })
}
