/** Minimum gap between stale-while-revalidate pulse fetches for the same cache key. */
export const PULSE_REVALIDATE_MIN_GAP_MS = 5_000

/**
 * Gate for GET_PULSE cache-hit revalidation.
 * Force bypasses the gap; otherwise a recent revalidate must not fan out again.
 */
export function shouldAllowPulseRevalidate(
  lastRevalidateAtMs: number | undefined,
  nowMs: number,
  options?: { force?: boolean; minGapMs?: number },
): boolean {
  if (options?.force) return true
  const minGapMs = options?.minGapMs ?? PULSE_REVALIDATE_MIN_GAP_MS
  const lastAt = lastRevalidateAtMs ?? 0
  return nowMs - lastAt >= minGapMs
}
