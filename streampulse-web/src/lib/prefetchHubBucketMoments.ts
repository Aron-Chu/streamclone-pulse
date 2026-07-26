import { mapHubPulseMoment } from './figmaSessionAnalytics'
import { getBackendUrl } from './apiClient'
import {
  bucketMomentsCacheKey,
  hasBucketMomentsCache,
  readBucketMomentsCache,
  writeBucketMomentsCache,
} from './bucketMomentsCache'
import { activityBucketMs } from './hubActivitySummary'
import {
  fetchHistoricalHubMoments,
  type PublicHubActivityWindow,
  type PublicHubMomentsResponse,
} from './publicHub'

export interface RequestHubBucketMomentsOptions {
  bucketT: number
  activityWindow: PublicHubActivityWindow
  /** Window width in minutes — required for adjacent prefetch. */
  activityWindowMinutes: number
  signal?: AbortSignal
  /** Prefetch ±1 bucket neighbors (fire-and-forget). */
  includeAdjacent?: boolean
}

const inFlight = new Map<string, Promise<PublicHubMomentsResponse>>()

function dedupeKey(bucketT: number, activityWindow: PublicHubActivityWindow): string {
  return bucketMomentsCacheKey(bucketT, activityWindow, getBackendUrl())
}

export function adjacentBucketTs(
  bucketT: number,
  activityWindowMinutes: number,
  delta: -1 | 1,
): number {
  const bucketMs = activityBucketMs(activityWindowMinutes)
  return bucketT + delta * bucketMs
}

async function fetchOneBucket(
  bucketT: number,
  activityWindow: PublicHubActivityWindow,
  signal?: AbortSignal,
): Promise<PublicHubMomentsResponse> {
  const key = dedupeKey(bucketT, activityWindow)
  const pending = inFlight.get(key)
  if (pending) return pending

  const work = fetchHistoricalHubMoments(bucketT, activityWindow, signal)
    .then((response) => {
      const rows = response.moments.map(mapHubPulseMoment)
      writeBucketMomentsCache(bucketT, activityWindow, rows)
      return response
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, work)
  return work
}

/**
 * Single entry for hub bucket moment network I/O — dedupes concurrent callers.
 */
export async function requestHubBucketMoments(
  options: RequestHubBucketMomentsOptions,
): Promise<PublicHubMomentsResponse> {
  const {
    bucketT,
    activityWindow,
    activityWindowMinutes,
    signal,
    includeAdjacent = false,
  } = options

  if (includeAdjacent && activityWindowMinutes > 0) {
    for (const delta of [-1, 1] as const) {
      const neighbor = adjacentBucketTs(bucketT, activityWindowMinutes, delta)
      if (neighbor <= 0 || hasBucketMomentsCache(neighbor, activityWindow)) continue
      void fetchOneBucket(neighbor, activityWindow).catch(() => {
        /* adjacent prefetch is best-effort */
      })
    }
  }

  return fetchOneBucket(bucketT, activityWindow, signal)
}

/** Test-only */
export function clearHubBucketMomentsInFlight(): void {
  inFlight.clear()
}
