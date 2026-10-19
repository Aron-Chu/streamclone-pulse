/**
 * Moments for one selected hub bar (plan §1.5 "Interval list", §1.8).
 *
 * A bar can span several server buckets; `hub/moments` answers one bucket at a time
 * (limit 10). This module lists a bar with at most 5 bucket calls, at most 2 in flight
 * across the whole page, and marks the total "10+" when a bucket hit the limit. Long
 * windows and bars wider than 5 buckets answer "Zoom in to list moments" without calling.
 *
 * Network I/O goes through `requestHubBucketMoments` (dedupe, rate-limit backoff) and its
 * session cache; a hover prefetch only warms that cache and never opens any UI.
 */
import { readBucketMomentsResponse } from './bucketMomentsCache'
import { HUB_MOMENTS_TEXT } from './hubBucketCardModel'
import { requestHubBucketMoments } from './prefetchHubBucketMoments'
import type { HubApiWindow } from './hubWindows'
import type { HubLivePulseMoment, PublicHubMomentsResponse } from './publicHub'

/** Most `hub/moments` calls one bar may make. */
export const HUB_INTERVAL_MAX_BUCKETS = 5
/** Most bucket calls in flight at once, page-wide. */
export const HUB_INTERVAL_MAX_IN_FLIGHT = 2
/** `fetchHistoricalHubMoments` asks for 10 rows per bucket. */
export const HUB_INTERVAL_MOMENT_LIMIT = 10

/** Production strings (plan §1.8), shared with the card model. */
export const HUB_INTERVAL_TEXT = HUB_MOMENTS_TEXT

/** Windows whose buckets are too coarse to list (H1: the card shows bucket totals only). */
const LONG_WINDOWS: ReadonlySet<string> = new Set(['1m', '3m', '6m', '1y', 'all'])

export interface HubIntervalRequest {
  /** Start of the bar (any time inside its first server bucket). */
  t: number
  /** End of the bar; omitted or ≤ t for one server bucket. */
  endT?: number | null
  activityWindow: HubApiWindow
  /** The server bucket size (`hub.activity.bucketMinutes`). */
  bucketMinutes: number
}

export type HubIntervalPlan =
  | { kind: 'zoom-in'; reason: 'long-window' | 'wide-bar'; bucketTs: number[] }
  | { kind: 'buckets'; bucketTs: number[] }

export type HubIntervalMomentsState =
  | { status: 'zoom-in' }
  | { status: 'loading'; bucketsRead: number; bucketsTotal: number }
  | {
    status: 'ready'
    /** Every row of every bucket in the bar, in response order; sort for display. */
    rows: HubLivePulseMoment[]
    total: number
    /** A bucket answered with the limit (or could not list), so the total is a minimum. */
    atLimit: boolean
    /** "10+" at the limit, else the count. */
    totalLabel: string
    bucketsTotal: number
  }
  | { status: 'empty'; bucketsTotal: number }
  | { status: 'unavailable'; reason: string | null; bucketsTotal: number }
  | { status: 'error'; error: unknown; retryAfterMs: number | null; bucketsRead: number; bucketsTotal: number }

/** The server buckets inside a bar, oldest first. */
export function hubIntervalBucketTs(request: Pick<HubIntervalRequest, 't' | 'endT' | 'bucketMinutes'>): number[] {
  const bucketMs = Math.max(1, request.bucketMinutes) * 60_000
  const start = Math.floor(request.t / bucketMs) * bucketMs
  const end = request.endT != null && request.endT > start + bucketMs ? request.endT : start + bucketMs
  const out: number[] = []
  // Cap the walk: a misuse (a year-wide bar) must not build a huge array before the zoom-in check.
  for (let t = start; t < end && out.length <= HUB_INTERVAL_MAX_BUCKETS; t += bucketMs) out.push(t)
  return out
}

export function planHubInterval(request: HubIntervalRequest): HubIntervalPlan {
  const bucketTs = hubIntervalBucketTs(request)
  if (LONG_WINDOWS.has(request.activityWindow)) return { kind: 'zoom-in', reason: 'long-window', bucketTs: [] }
  if (bucketTs.length > HUB_INTERVAL_MAX_BUCKETS) return { kind: 'zoom-in', reason: 'wide-bar', bucketTs: [] }
  return { kind: 'buckets', bucketTs }
}

/* ---------- page-wide limiter: at most 2 bucket calls in flight ---------- */

interface Waiter {
  grant: () => void
  cancel: () => void
  signal?: AbortSignal
}

let active = 0
let peakActive = 0
const waiting: Waiter[] = []

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

function acquireSlot(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError())
  if (active < HUB_INTERVAL_MAX_IN_FLIGHT) {
    active += 1
    peakActive = Math.max(peakActive, active)
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      const index = waiting.indexOf(waiter)
      if (index >= 0) waiting.splice(index, 1)
      reject(abortError())
    }
    const waiter: Waiter = {
      signal,
      grant: () => {
        signal?.removeEventListener('abort', onAbort)
        resolve()
      },
      cancel: onAbort,
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    waiting.push(waiter)
  })
}

function releaseSlot(): void {
  active = Math.max(0, active - 1)
  while (waiting.length && active < HUB_INTERVAL_MAX_IN_FLIGHT) {
    const next = waiting.shift()!
    if (next.signal?.aborted) continue
    active += 1
    peakActive = Math.max(peakActive, active)
    next.grant()
  }
}

/**
 * One bucket through the limiter. The slot is held until the shared transport settles,
 * so an abandoned consumer never lets a third request start.
 */
async function fetchBucket(bucketT: number, activityWindow: HubApiWindow, signal?: AbortSignal): Promise<PublicHubMomentsResponse> {
  await acquireSlot(signal)
  try {
    return await requestHubBucketMoments({ bucketT, activityWindow, activityWindowMinutes: 0, includeAdjacent: false })
  } finally {
    releaseSlot()
  }
}

/* ---------- results ---------- */

function unavailable(response: PublicHubMomentsResponse): boolean {
  return response.moments.length === 0
    && (response.status === 'unavailable' || (response.reason?.includes('unavailable') ?? false))
}

function momentKey(row: HubLivePulseMoment): string {
  return row.publicMomentId ?? `${row.login ?? row.streamId ?? ''}:${row.at ?? row.offsetSeconds}`
}

function settle(responses: PublicHubMomentsResponse[], bucketsTotal: number): HubIntervalMomentsState {
  const seen = new Set<string>()
  const rows: HubLivePulseMoment[] = []
  let atLimit = false
  let unavailableBuckets = 0
  let reason: string | null = null
  for (const response of responses) {
    if (response.moments.length >= HUB_INTERVAL_MOMENT_LIMIT) atLimit = true
    if (unavailable(response)) {
      unavailableBuckets += 1
      reason = reason ?? response.reason ?? null
    }
    for (const row of response.moments) {
      const key = momentKey(row)
      if (seen.has(key)) continue
      seen.add(key)
      rows.push(row)
    }
  }
  if (!rows.length) {
    return unavailableBuckets > 0
      ? { status: 'unavailable', reason, bucketsTotal }
      : { status: 'empty', bucketsTotal }
  }
  // A bucket that could not list leaves the total a minimum too, never a silent undercount.
  const minimum = atLimit || unavailableBuckets > 0
  return {
    status: 'ready',
    rows,
    total: rows.length,
    atLimit: minimum,
    totalLabel: `${rows.length}${minimum ? '+' : ''}`,
    bucketsTotal,
  }
}

/**
 * The bar's state from the session cache alone, or null when a bucket still needs a call.
 * Lets the card render a cached list on the first frame, with no loading flash.
 */
export function readHubIntervalMoments(request: HubIntervalRequest): HubIntervalMomentsState | null {
  const plan = planHubInterval(request)
  if (plan.kind === 'zoom-in') return { status: 'zoom-in' }
  const responses: PublicHubMomentsResponse[] = []
  for (const bucketT of plan.bucketTs) {
    const cached = readBucketMomentsResponse(bucketT, request.activityWindow)
    if (!cached) return null
    responses.push(cached)
  }
  return settle(responses, plan.bucketTs.length)
}

export interface LoadHubIntervalOptions {
  signal?: AbortSignal
  /** Called with 'loading' progress as buckets answer (never after an abort). */
  onProgress?: (state: HubIntervalMomentsState) => void
}

/**
 * List the bar's moments: cached buckets are read, the rest are called (≤5, ≤2 in flight).
 * Rejects with an AbortError when `signal` aborts; queued calls are then dropped.
 */
export async function loadHubIntervalMoments(
  request: HubIntervalRequest,
  options: LoadHubIntervalOptions = {},
): Promise<HubIntervalMomentsState> {
  const { signal, onProgress } = options
  const plan = planHubInterval(request)
  if (plan.kind === 'zoom-in') return { status: 'zoom-in' }
  if (signal?.aborted) throw abortError()

  const total = plan.bucketTs.length
  const responses: Array<PublicHubMomentsResponse | undefined> = plan.bucketTs
    .map(bucketT => readBucketMomentsResponse(bucketT, request.activityWindow))
  let read = responses.filter(Boolean).length
  const missing = plan.bucketTs.filter((_, index) => !responses[index])
  if (missing.length) onProgress?.({ status: 'loading', bucketsRead: read, bucketsTotal: total })

  let failure: unknown = null
  await Promise.all(missing.map(async (bucketT) => {
    try {
      const response = await fetchBucket(bucketT, request.activityWindow, signal)
      responses[plan.bucketTs.indexOf(bucketT)] = response
      read += 1
      if (!signal?.aborted) onProgress?.({ status: 'loading', bucketsRead: read, bucketsTotal: total })
    } catch (error) {
      if (failure == null) failure = error
    }
  }))

  if (signal?.aborted) throw abortError()
  if (failure != null) {
    const retryAfterMs = typeof (failure as { retryAfterMs?: unknown }).retryAfterMs === 'number'
      ? (failure as { retryAfterMs: number }).retryAfterMs
      : null
    return { status: 'error', error: failure, retryAfterMs, bucketsRead: read, bucketsTotal: total }
  }
  return settle(responses as PublicHubMomentsResponse[], total)
}

/**
 * Hover prefetch: warms the session cache for a bar through the same limiter.
 * It never opens UI and swallows every error. Returns the number of calls it queued.
 */
export function prefetchHubIntervalMoments(request: HubIntervalRequest, signal?: AbortSignal): number {
  const plan = planHubInterval(request)
  if (plan.kind === 'zoom-in' || signal?.aborted) return 0
  const missing = plan.bucketTs.filter(bucketT => !readBucketMomentsResponse(bucketT, request.activityWindow))
  for (const bucketT of missing) {
    void fetchBucket(bucketT, request.activityWindow, signal).catch(() => {
      /* best effort: the click path reports errors */
    })
  }
  return missing.length
}

/** Test-only: the limiter's current and highest in-flight counts. */
export function hubIntervalInFlightForTests(): { active: number; peak: number; queued: number } {
  return { active, peak: peakActive, queued: waiting.length }
}

/** Test-only: drops queued waiters and zeroes the counters. */
export function resetHubIntervalMomentsForTests(): void {
  for (const waiter of waiting.splice(0)) waiter.cancel()
  active = 0
  peakActive = 0
}
