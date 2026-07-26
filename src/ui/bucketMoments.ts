import type { ChartSegmentBucket } from './segmentedBarChart.ts'

export interface BucketMomentPin {
  offsetSeconds: number
  score: number
  label: string
}

export interface BucketMomentSource {
  offsetSeconds: number
  score: number
  reasons?: readonly string[]
}

const DEDUPE_TOLERANCE_SECONDS = 60

function momentLabel(reasons?: readonly string[]): string {
  const code = reasons?.[0]?.trim()
  if (!code) return 'Moment'
  return code.replace(/_/g, ' ')
}

/** Top moments whose offset falls inside the bucket time range. */
export function momentsForBucket(
  bucket: ChartSegmentBucket,
  moments: readonly BucketMomentSource[],
  limit = 2,
): BucketMomentPin[] {
  const inRange = moments.filter(
    moment =>
      moment.offsetSeconds >= bucket.startOffset
      && moment.offsetSeconds < bucket.endOffset,
  )
  inRange.sort((a, b) => b.score - a.score || a.offsetSeconds - b.offsetSeconds)
  const picked: BucketMomentPin[] = []
  for (const moment of inRange) {
    const duplicate = picked.find(
      existing =>
        Math.abs(existing.offsetSeconds - moment.offsetSeconds) <= DEDUPE_TOLERANCE_SECONDS,
    )
    if (duplicate) continue
    picked.push({
      offsetSeconds: moment.offsetSeconds,
      score: moment.score,
      label: momentLabel(moment.reasons),
    })
    if (picked.length >= limit) break
  }
  return picked
}

export function assignMomentsToBuckets(
  buckets: readonly ChartSegmentBucket[],
  moments: readonly BucketMomentSource[],
  perBucketLimit = 1,
): Map<number, BucketMomentPin[]> {
  const sorted = [...moments].sort(
    (a, b) => b.score - a.score || a.offsetSeconds - b.offsetSeconds,
  )
  const map = new Map<number, BucketMomentPin[]>()
  for (const bucket of buckets) {
    map.set(bucket.bucketIndex, momentsForBucket(bucket, sorted, perBucketLimit))
  }
  return map
}
