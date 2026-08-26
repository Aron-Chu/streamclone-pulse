/**
 * Live Wire right-rail catch-moment radar: pure, dependency-free helpers.
 *
 * These functions are deliberately free of React/IO so they can be unit-tested
 * in isolation and reused across the feed filter (in-window/older split, cap)
 * and the incremental poll-identity logic.
 */

/** Resolve a moment's timestamp to millis. Accepts already-ms (>1e12) or seconds.
 *  Returns null for missing, non-finite, zero, or negative values. */
export function resolveMomentAtMs(at?: number): number | null {
  if (at === undefined || at === null) return null
  if (!Number.isFinite(at) || at <= 0) return null
  // Treat anything > 1e12 as already millis (unix-sec values are ~1.7e9).
  return at > 1_000_000_000_000 ? at : at * 1000
}

export type MomentWindowClass = 'live' | 'older' | 'omit'

export interface MomentWindowBuckets<T> {
  live: T[]
  older: T[]
}

/**
 * Classify a moment timestamp against `now` (both in ms) using a freshness
 * window. Returns:
 *  - 'omit'  when the timestamp is missing/invalid or in the future
 *  - 'live'  when `now - at <= windowMs` (boundary-inclusive)
 *  - 'older' otherwise
 */
export function classifyMomentWindow(
  at: number | undefined,
  now: number,
  windowMs: number,
): MomentWindowClass {
  const ms = resolveMomentAtMs(at)
  if (ms === null || ms > now) return 'omit'
  return now - ms <= windowMs ? 'live' : 'older'
}

/**
 * Apply the same timestamp/window validation to every Live Wire section.
 * Invalid, missing, and future rows are omitted; only valid rows older than
 * the live horizon enter the explicit earlier-detections section.
 */
export function partitionMomentWindow<T extends { at?: number }>(
  items: T[],
  now: number,
  windowMs: number,
): MomentWindowBuckets<T> {
  const live: T[] = []
  const older: T[] = []
  for (const item of items) {
    const classification = classifyMomentWindow(item.at, now, windowMs)
    if (classification === 'live') live.push(item)
    else if (classification === 'older') older.push(item)
  }
  return { live, older }
}

/**
 * Normalize a rate (e.g. chat/min) into a "percentage of the visible max"
 * display string, clamped to 100. Returns null when rate or max are missing,
 * zero, or non-positive.
 */
export function normalizeRatePct(rate: number | undefined, maxRate: number): string | null {
  if (rate === undefined || rate === null || rate <= 0) return null
  if (maxRate === undefined || maxRate === null || maxRate <= 0) return null
  const pct = Math.min(100, (rate / maxRate) * 100)
  return `${Math.round(pct)}%`
}

/** Translate an entry direction into the horizontal offset (px) for a slide-in
 *  tween. `right` (rail cards entering from the right edge) → +24, else −24. */
export function buildDirectionalX(from?: 'left' | 'right'): number {
  return from === 'right' ? 24 : -24
}

/**
 * Dedupe moment items by `login`, dropping items whose login appeared within
 * the previous `windowMs` (a recent re-surge is not a fresh moment), then cap
 * the result to `cap` items (keeping earliest first). Items without a usable
 * login are kept as-is.
 */
export function dedupeMomentsByLogin<T extends { login?: string; at?: number }>(
  items: T[],
  cap: number,
  windowMs: number,
): T[] {
  const out: T[] = []
  const seenAtByLogin = new Map<string, number[]>()
  const threshold = Math.max(0, Number.isFinite(windowMs) ? windowMs : 0)

  // Unit fixtures sometimes use small relative timestamps. Production rows
  // use Unix seconds or milliseconds; normalize only values that look like
  // epoch timestamps so the threshold remains in milliseconds in production
  // without changing the relative-time helper contract in tests.
  const comparableTimestamp = (value: number | undefined): number | null => {
    if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) return null
    if (value > 1_000_000_000_000) return value
    if (value > 100_000_000) return value * 1000
    return value
  }

  for (const item of items) {
    const login = item.login?.trim().toLowerCase()
    if (!login) {
      out.push(item)
      continue
    }
    const at = comparableTimestamp(item.at)
    const seen = seenAtByLogin.get(login) ?? []
    // Compare absolute distance, not `current - last`: Live Wire callers can
    // receive an out-of-order refresh, and a negative delta must not collapse
    // a genuinely older reappearance into the newer row.
    if (at != null && seen.some((previous) => Math.abs(at - previous) <= threshold)) {
      continue
    }
    if (at != null) seen.push(at)
    seenAtByLogin.set(login, seen)
    out.push(item)
    if (out.length >= cap) break
  }
  return out
}

/**
 * From a set of "seen" moment keys plus this poll's moments, return the keys
 * that are fresh (in-window), unseen, capped to `maxNew`. Keys are stable
 * identifiers (e.g. `${login}:${offsetSeconds}`), so repeated polls can build
 * up the seen set incrementally.
 */
export function capNewKeysPerPoll(
  seen: Set<string>,
  moments: Array<{ key: string; at?: number }>,
  now: number,
  windowMs: number,
  maxNew: number,
): Set<string> {
  const fresh = new Set<string>()
  for (const m of moments) {
    if (fresh.size >= maxNew) break
    if (seen.has(m.key)) continue
    const cls = classifyMomentWindow(m.at, now, windowMs)
    if (cls !== 'live') continue
    fresh.add(m.key)
  }
  return fresh
}
