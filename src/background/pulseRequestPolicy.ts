import {
  PULSE_CACHE_TTL_MS,
  type PulseCacheWindow,
} from '../shared/storage.ts'
import { PULSE_REVALIDATE_MIN_GAP_MS } from './pulseRevalidateGate.ts'

export type PulseCacheFreshness = 'cold' | 'fresh' | 'stale'

export type PulseRequestKind =
  | 'get_pulse'
  | 'poll_recent'
  | 'explicit_full'
  | 'coverage'
  | 'backfill_status'
  | 'local_watch'

/**
 * Classify a session-cache entry age for GET_PULSE request policy.
 * - cold: missing or past TTL (caller must sync-fetch)
 * - fresh: within revalidate min-gap → zero network
 * - stale: still within TTL but old enough for SWR revalidate
 */
export function classifyPulseCacheFreshness(
  ageMs: number | null,
  options?: { ttlMs?: number; freshMs?: number },
): PulseCacheFreshness {
  if (ageMs == null || ageMs < 0) return 'cold'
  const ttlMs = options?.ttlMs ?? PULSE_CACHE_TTL_MS
  const freshMs = options?.freshMs ?? PULSE_REVALIDATE_MIN_GAP_MS
  if (ageMs > ttlMs) return 'cold'
  if (ageMs < freshMs) return 'fresh'
  return 'stale'
}

export interface GetPulseNetworkPlan {
  /** Blocking network before responding (cold miss). */
  syncFetch: boolean
  /** Background SWR after responding with cached payload. */
  asyncRevalidate: boolean
}

/**
 * Decide network work for a GET_PULSE-style call.
 * Recurring polls must pass window=recent; explicit Full uses window=full.
 */
export function planGetPulseNetwork(args: {
  freshness: PulseCacheFreshness
  window: PulseCacheWindow
  explicitFull?: boolean
}): GetPulseNetworkPlan {
  if (args.explicitFull || args.window === 'full') {
    // Explicit full is always a sync fetch path for the full window cache key.
    return {
      syncFetch: args.freshness === 'cold',
      asyncRevalidate: args.freshness === 'stale',
    }
  }
  if (args.freshness === 'fresh') {
    return { syncFetch: false, asyncRevalidate: false }
  }
  if (args.freshness === 'stale') {
    return { syncFetch: false, asyncRevalidate: true }
  }
  return { syncFetch: true, asyncRevalidate: false }
}

/** Recurring live poll never requests full history. */
export function recurringPollWindow(): PulseCacheWindow {
  return 'recent'
}

/**
 * Generation token for cancelling obsolete backfill/status work on navigation.
 * Callers bump the token when the active login/stream changes; workers exit when
 * their captured generation no longer matches.
 */
export function createRequestGeneration(): { current: number; bump: () => number; isCurrent: (g: number) => boolean } {
  let current = 0
  return {
    get current() {
      return current
    },
    bump() {
      current += 1
      return current
    },
    isCurrent(g: number) {
      return g === current
    },
  }
}
