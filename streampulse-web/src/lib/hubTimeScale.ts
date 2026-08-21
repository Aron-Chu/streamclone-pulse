export interface HubTimeDomain {
  start: number
  endExclusive: number
  bucketDurationMs: number
}

/** Shared time domain for hub lines (bucket centers), bars, and exact moment markers. */
export function hubTimeDomain(
  points: Array<{ t: number }>,
  bucketDurationMs: number,
): HubTimeDomain | null {
  if (points.length === 0 || !(bucketDurationMs > 0)) return null
  const start = points[0].t
  const lastStart = points[points.length - 1]?.t ?? start
  return {
    start,
    endExclusive: lastStart + bucketDurationMs,
    bucketDurationMs,
  }
}

/** Percent x for an exact timestamp. Null when `at` is outside [start, endExclusive). */
export function hubTimeXPercent(at: number, domain: HubTimeDomain): number | null {
  if (at < domain.start || at >= domain.endExclusive) return null
  const span = domain.endExclusive - domain.start
  if (!(span > 0)) return null
  return ((at - domain.start) / span) * 100
}

/** Aggregate points plot at the bucket center. */
export function hubBucketCenterX(bucketStart: number, domain: HubTimeDomain): number | null {
  return hubTimeXPercent(bucketStart + domain.bucketDurationMs / 2, domain)
}

/** Bar occupies [bucketStart, bucketStart + bucketDuration). */
export function hubBucketBarRect(
  bucketStart: number,
  domain: HubTimeDomain,
): { left: number; width: number } | null {
  const left = hubTimeXPercent(bucketStart, domain)
  if (left == null) return null
  const span = domain.endExclusive - domain.start
  if (!(span > 0)) return null
  return {
    left,
    width: (domain.bucketDurationMs / span) * 100,
  }
}
