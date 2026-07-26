/** Minimum gap between successful stale-while-revalidate pulse fetches for the same cache key. */
export const PULSE_REVALIDATE_MIN_GAP_MS = 5_000

/** Cooldown after a failed revalidate before the same key may retry (unless force). */
export const PULSE_REVALIDATE_FAILURE_COOLDOWN_MS = 15_000

/**
 * Gate for GET_PULSE cache-hit revalidation.
 * Force bypasses the gap; otherwise a recent success or failure cooldown must not fan out again.
 */
export function shouldAllowPulseRevalidate(
  lastRevalidateAtMs: number | undefined,
  nowMs: number,
  options?: {
    force?: boolean
    minGapMs?: number
    lastFailureAtMs?: number
    failureCooldownMs?: number
  },
): boolean {
  if (options?.force) return true
  const failureCooldownMs = options?.failureCooldownMs ?? PULSE_REVALIDATE_FAILURE_COOLDOWN_MS
  const lastFailure = options?.lastFailureAtMs ?? 0
  if (lastFailure > 0 && nowMs - lastFailure < failureCooldownMs) {
    return false
  }
  const minGapMs = options?.minGapMs ?? PULSE_REVALIDATE_MIN_GAP_MS
  const lastAt = lastRevalidateAtMs ?? 0
  return nowMs - lastAt >= minGapMs
}

/**
 * Single-flight / coalesce helper: if a promise is already in-flight for `key`,
 * return it; otherwise start `factory`, store it, and clear on settle.
 */
export function coalesceInFlight<T>(
  map: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key)
  if (existing) return existing
  const task = factory().finally(() => {
    if (map.get(key) === task) map.delete(key)
  })
  map.set(key, task)
  return task
}
