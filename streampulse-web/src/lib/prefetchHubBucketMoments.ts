import { mapHubPulseMoment } from './figmaSessionAnalytics'
import { getBackendUrl, isApiError, type ApiError } from './apiClient'
import {
  bucketMomentsCacheKey,
  hasBucketMomentsCache,
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
const backoff = new Map<string, { until: number; error: ApiError }>()

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
): Promise<PublicHubMomentsResponse> {
  const key = dedupeKey(bucketT, activityWindow)
  const pending = inFlight.get(key)
  if (pending) return pending
  const origin = getBackendUrl()
  const cooldown = backoff.get(origin)
  if (cooldown && cooldown.until > Date.now()) throw { ...cooldown.error, retryAfterMs: cooldown.until - Date.now() }
  backoff.delete(origin)

  // The transport belongs to the shared request, never to its first consumer.
  // apiClient supplies a bounded deadline; an abandoned consumer stops waiting.
  const work = fetchHistoricalHubMoments(bucketT, activityWindow)
    .then((response) => {
      const rows = response.moments.map(mapHubPulseMoment)
      writeBucketMomentsCache(bucketT, activityWindow, rows, response)
      return response
    })
    .catch(error => {
      if (isApiError(error) && error.kind === 'rate_limited') {
        backoff.set(origin, { until: Date.now() + (error.retryAfterMs ?? 30_000), error })
      }
      throw error
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

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const work = fetchOneBucket(bucketT, activityWindow)
  if (!signal) return work
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Test-only */
export function clearHubBucketMomentsInFlight(): void {
  inFlight.clear()
  backoff.clear()
}
