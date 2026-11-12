/**
 * The locks' warm-up (L1, hub rail board 2026-11-02): a bar's busiest chats and
 * an emote's "Who drove it" both read `hub/moments` for one server bucket, and
 * a cold read takes 3–4 s. Reading the likely ones before the click lets the
 * click answer from the session cache, and the edge keeps a closed bucket for
 * an hour for every viewer.
 *
 * - A bar the pointer rests on: the chart calls `noteHubBarRest` after 250 ms,
 *   and the page's listener prefetches that bar.
 * - After the page settles: a short list of buckets, one call at a time, each
 *   only while no other bucket call is in flight or queued, stopping at the
 *   first failure (a 429 starts the shared backoff, so nothing more goes out).
 *
 * It never opens UI and never retries.
 */
import { readBucketMomentsResponse } from './bucketMomentsCache'
import { hubIntervalBusy, loadHubIntervalMoments } from './hubIntervalMoments'
import type { HubApiWindow } from './hubWindows'

/** How long the pointer rests on a bar before it is read. */
export const HUB_BAR_REST_MS = 250
/** Most buckets one warm-up reads. */
export const HUB_WARM_MAX = 8
/** How often a waiting warm-up looks again for a free limiter. */
const IDLE_POLL_MS = 400

/* ---------- a bar the pointer rests on ---------- */

export interface HubBarRest {
  t: number
  endT: number
}

const restListeners = new Set<(bar: HubBarRest) => void>()

/** The chart: the pointer (or keyboard cursor) has rested on this bar. */
export function noteHubBarRest(bar: HubBarRest): void {
  for (const listener of [...restListeners]) listener(bar)
}

/** The page: hear rested bars. Returns the unsubscribe function. */
export function onHubBarRest(listener: (bar: HubBarRest) => void): () => void {
  restListeners.add(listener)
  return () => {
    restListeners.delete(listener)
  }
}

/* ---------- after the page settles ---------- */

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const id = setTimeout(done, ms)
    function done() {
      clearTimeout(id)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Reads each bucket the cache lacks, one at a time, and only while the limiter
 * is idle. Stops at the first failure or when `signal` aborts. Returns how many
 * calls it made.
 */
export async function warmHubBuckets(
  bucketTs: readonly number[],
  activityWindow: HubApiWindow,
  bucketMinutes: number,
  signal: AbortSignal,
): Promise<number> {
  let calls = 0
  for (const t of bucketTs.slice(0, HUB_WARM_MAX)) {
    if (signal.aborted) break
    if (readBucketMomentsResponse(t, activityWindow)) continue
    while (hubIntervalBusy() && !signal.aborted) await pause(IDLE_POLL_MS, signal)
    if (signal.aborted) break
    calls += 1
    try {
      const state = await loadHubIntervalMoments({ t, activityWindow, bucketMinutes }, { signal })
      if (state.status === 'error') break
    } catch {
      break
    }
  }
  return calls
}
