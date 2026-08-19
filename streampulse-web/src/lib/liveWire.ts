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
  const lastSeenAt = new Map<string, number>()
  for (const item of items) {
    const login = item.login
    if (!login) {
      out.push(item)
      continue
    }
    const at = item.at ?? 0
    const last = lastSeenAt.get(login)
    if (last !== undefined && at - last <= windowMs) {
      // Recent re-surge of the same login — keep the first occurrence only.
      continue
    }
    lastSeenAt.set(login, at)
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
