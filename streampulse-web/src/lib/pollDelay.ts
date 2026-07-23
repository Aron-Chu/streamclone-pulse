/** Shared poll delay helpers (±15% jitter + capped exponential backoff). */

export const HUB_JITTER_RATIO = 0.15
/** Cap failure backoff so polls do not stall forever (2 minutes). */
export const HUB_FAILURE_BACKOFF_CAP_MS = 120_000

/**
 * Healthy poll: base ±15% jitter.
 * Failure: never shorter than the healthy cadence; then exponential growth
 * (base × 2^(n-1)) capped at HUB_FAILURE_BACKOFF_CAP_MS, still ±15% of the
 * chosen delay floor.
 */
export function computeJitteredDelayMs(
  baseIntervalMs: number,
  consecutiveFailures: number,
  random = Math.random,
): number {
  const safeBase = Math.max(1_000, baseIntervalMs)
  if (consecutiveFailures <= 0) {
    const jitterSpan = safeBase * HUB_JITTER_RATIO
    const jitter = (random() * 2 - 1) * jitterSpan
    return Math.max(1_000, Math.round(safeBase + jitter))
  }
  const exp = Math.min(2 ** (consecutiveFailures - 1), 16)
  const failureFloor = Math.min(HUB_FAILURE_BACKOFF_CAP_MS, Math.max(safeBase, safeBase * exp))
  const jitterSpan = failureFloor * HUB_JITTER_RATIO
  const jitter = (random() * 2 - 1) * jitterSpan
  return Math.max(safeBase, Math.round(failureFloor + jitter))
}

/** Parse Retry-After as seconds or HTTP-date; clamp to [1s, 120s]. */
export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header?.trim()) return null
  const raw = header.trim()
  if (/^\d+$/.test(raw)) {
    const sec = Number(raw)
    if (!Number.isFinite(sec) || sec < 0) return null
    return Math.min(120_000, Math.max(1_000, Math.round(sec * 1000)))
  }
  const when = Date.parse(raw)
  if (!Number.isFinite(when)) return null
  const delta = when - now
  if (delta <= 0) return 1_000
  return Math.min(120_000, Math.max(1_000, delta))
}
