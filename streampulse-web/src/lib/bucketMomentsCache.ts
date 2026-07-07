import type { FigmaMomentRow } from './figmaSessionAnalytics'
import type { PublicHubActivityWindow } from './publicHub'

const cache = new Map<string, FigmaMomentRow[]>()

export function bucketMomentsCacheKey(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
): string {
  return `${activityWindow}:${bucketT}`
}

export function readBucketMomentsCache(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
): FigmaMomentRow[] | undefined {
  return cache.get(bucketMomentsCacheKey(bucketT, activityWindow))
}

export function writeBucketMomentsCache(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
  moments: FigmaMomentRow[],
): void {
  cache.set(bucketMomentsCacheKey(bucketT, activityWindow), moments)
}

/** Test-only */
export function clearBucketMomentsCache(): void {
  cache.clear()
}
