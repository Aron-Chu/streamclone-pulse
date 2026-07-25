/**
 * Coalesce POST /watch per normalized login with in-flight gate + success TTL.
 * Watch failure must not block Pulse fetch (caller soft-fails).
 */

export const WATCH_SUCCESS_TTL_MS = 60_000

export type WatchCoordinatorDeps = {
  postWatch: (login: string) => Promise<void>
  /** Called only after a successful watch POST. */
  onWatchSuccess?: (login: string) => void
  now?: () => number
  successTtlMs?: number
}

export type WatchCoordinatorState = {
  inFlight: Map<string, Promise<WatchResult>>
  lastSuccessAt: Map<string, number>
}

export type WatchResult = {
  ok: boolean
  coalesced: boolean
  skippedTtl: boolean
  error?: string
}

export function createWatchCoordinatorState(): WatchCoordinatorState {
  return {
    inFlight: new Map(),
    lastSuccessAt: new Map(),
  }
}

export function normalizeWatchLogin(login: string): string {
  return login.trim().toLowerCase()
}

/**
 * Ensure a watch registration for login. Concurrent callers share one POST.
 * Recent successes within TTL skip a new POST (still report ok).
 */
export async function ensureWatchCoalesced(
  login: string,
  deps: WatchCoordinatorDeps,
  state: WatchCoordinatorState,
): Promise<WatchResult> {
  const key = normalizeWatchLogin(login)
  if (!key) {
    return { ok: false, coalesced: false, skippedTtl: false, error: 'empty_login' }
  }

  const now = deps.now ?? Date.now
  const ttl = deps.successTtlMs ?? WATCH_SUCCESS_TTL_MS
  const lastOk = state.lastSuccessAt.get(key) ?? 0
  if (lastOk > 0 && now() - lastOk < ttl) {
    return { ok: true, coalesced: false, skippedTtl: true }
  }

  const existing = state.inFlight.get(key)
  if (existing) {
    const result = await existing
    return { ...result, coalesced: true }
  }

  const work = (async (): Promise<WatchResult> => {
    try {
      await deps.postWatch(key)
      state.lastSuccessAt.set(key, now())
      deps.onWatchSuccess?.(key)
      return { ok: true, coalesced: false, skippedTtl: false }
    } catch (err) {
      return {
        ok: false,
        coalesced: false,
        skippedTtl: false,
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      state.inFlight.delete(key)
    }
  })()

  state.inFlight.set(key, work)
  return work
}
