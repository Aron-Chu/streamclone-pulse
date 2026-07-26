/**
 * Production GET_PULSE coordinator — cache freshness, coalesce, soft SWR failures.
 * Extracted for exact request-matrix tests against real policy + coalesce behavior.
 */
import type { ExtensionCoverageTierResponse } from '../shared/messages.ts'
import type { PulseCacheWindow, PulseCacheEntry } from '../shared/storage.ts'
import {
  classifyPulseCacheFreshness,
  planGetPulseNetwork,
} from './pulseRequestPolicy.ts'
import {
  coalesceInFlight,
  shouldAllowPulseRevalidate,
  PULSE_REVALIDATE_MIN_GAP_MS,
} from './pulseRevalidateGate.ts'

export type PulsePayload = NonNullable<PulseCacheEntry['payload']>

export type GetPulseResult = {
  payload: PulsePayload | null
  coverageTier: ExtensionCoverageTierResponse | null
  error?: string
  /** Soft warning when stale revalidate failed but cached payload was returned. */
  staleRefreshWarning?: boolean
  network: {
    syncFetches: number
    asyncRevalidatesScheduled: number
    watchRegistrations: number
  }
}

export type PulseFetchDeps = {
  getCached: (
    login: string,
    window: PulseCacheWindow,
    streamId?: string,
  ) => Promise<PulseCacheEntry | null>
  getCoverage: (login: string) => Promise<ExtensionCoverageTierResponse | null>
  fetchPulse: (
    login: string,
    window: PulseCacheWindow,
    forceCoverage: boolean,
  ) => Promise<{
    payload: PulsePayload | null
    coverageTier: ExtensionCoverageTierResponse | null
    error?: string
  }>
  ensureTracked?: (login: string) => Promise<void>
  isTracked?: (login: string) => boolean
  /** Broadcast successful payload updates (SWR). */
  onBroadcast?: (
    login: string,
    payload: PulsePayload | null,
    error: string | undefined,
    coverageTier: ExtensionCoverageTierResponse | null | undefined,
    meta?: { softStaleFailure?: boolean },
  ) => void
  now?: () => number
}

export type PulseCoordinatorState = {
  syncInFlight: Map<string, Promise<GetPulseResult>>
  revalidateInFlight: Map<string, Promise<void>>
  lastRevalidateAt: Map<string, number>
  lastRevalidateFailureAt: Map<string, number>
}

export function createPulseCoordinatorState(): PulseCoordinatorState {
  return {
    syncInFlight: new Map(),
    revalidateInFlight: new Map(),
    lastRevalidateAt: new Map(),
    lastRevalidateFailureAt: new Map(),
  }
}

export function pulseCacheKey(
  login: string,
  window: PulseCacheWindow,
  streamId?: string,
): string {
  const sid = String(streamId ?? '').trim()
  return `${login.trim().toLowerCase()}:${window}:${sid || '-'}`
}

/**
 * Handle one GET_PULSE: fresh→0 net, stale→cache+1 revalidate, cold→1 coalesced sync.
 * Stale revalidate failures never clear the cached response (soft warning only).
 */
export async function handleGetPulse(
  args: {
    login: string
    window: PulseCacheWindow
    streamId?: string
    allowWatch?: boolean
    forceCoverage?: boolean
    explicitFull?: boolean
  },
  deps: PulseFetchDeps,
  state: PulseCoordinatorState,
): Promise<GetPulseResult> {
  const now = deps.now ?? Date.now
  const window = args.window === 'full' ? 'full' : 'recent'
  const forceCoverage = Boolean(args.forceCoverage)
  const key = pulseCacheKey(args.login, window, args.streamId)
  const network = { syncFetches: 0, asyncRevalidatesScheduled: 0, watchRegistrations: 0 }

  const cached = await deps.getCached(args.login, window, args.streamId)
  const ageMs = cached ? now() - cached.fetchedAt : null
  const freshness = classifyPulseCacheFreshness(ageMs)
  const plan = planGetPulseNetwork({
    freshness,
    window,
    explicitFull: args.explicitFull || window === 'full',
  })

  if (cached && !plan.syncFetch) {
    const coverage =
      (await deps.getCoverage(args.login)) ?? null
    if (plan.asyncRevalidate) {
      const scheduled = scheduleSoftRevalidate(
        {
          login: args.login,
          window,
          forceCoverage,
          key,
        },
        deps,
        state,
        now,
      )
      if (scheduled) network.asyncRevalidatesScheduled = 1
    }
    return {
      payload: cached.payload,
      coverageTier: coverage,
      network,
    }
  }

  // Cold path — optional watch registration then coalesced sync fetch.
  // Watch failure must not block Pulse fetch.
  if (args.allowWatch && deps.ensureTracked) {
    try {
      await deps.ensureTracked(args.login)
      network.watchRegistrations = 1
    } catch {
      network.watchRegistrations = 0
    }
  }

  return coalesceInFlight(state.syncInFlight, key, async () => {
    // Re-check cache inside coalesce (second tab may have populated it).
    const again = await deps.getCached(args.login, window, args.streamId)
    if (again) {
      const age2 = now() - again.fetchedAt
      const fresh2 = classifyPulseCacheFreshness(age2)
      if (fresh2 !== 'cold') {
        const coverage = (await deps.getCoverage(args.login)) ?? null
        const plan2 = planGetPulseNetwork({ freshness: fresh2, window })
        if (plan2.asyncRevalidate) {
          scheduleSoftRevalidate(
            { login: args.login, window, forceCoverage, key },
            deps,
            state,
            now,
          )
        }
        return {
          payload: again.payload,
          coverageTier: coverage,
          network: { ...network, syncFetches: 0 },
        }
      }
    }

    network.syncFetches = 1
    const fetched = await deps.fetchPulse(args.login, window, forceCoverage)
    if (fetched.payload) {
      deps.onBroadcast?.(args.login, fetched.payload, undefined, fetched.coverageTier)
      state.lastRevalidateFailureAt.delete(key)
      state.lastRevalidateAt.set(key, now())
    } else if (fetched.error) {
      state.lastRevalidateFailureAt.set(key, now())
      deps.onBroadcast?.(args.login, null, fetched.error, null)
    }
    return {
      payload: fetched.payload,
      coverageTier: fetched.coverageTier,
      error: fetched.error,
      network,
    }
  })
}

function scheduleSoftRevalidate(
  args: {
    login: string
    window: PulseCacheWindow
    forceCoverage: boolean
    key: string
  },
  deps: PulseFetchDeps,
  state: PulseCoordinatorState,
  now: () => number,
): boolean {
  if (
    !shouldAllowPulseRevalidate(state.lastRevalidateAt.get(args.key), now(), {
      force: args.forceCoverage,
      lastFailureAtMs: state.lastRevalidateFailureAt.get(args.key),
    })
  ) {
    return false
  }
  void coalesceInFlight(state.revalidateInFlight, args.key, async () => {
    try {
      const fetched = await deps.fetchPulse(args.login, args.window, args.forceCoverage)
      if (fetched.error || !fetched.payload) {
        state.lastRevalidateFailureAt.set(args.key, now())
        // Soft failure — do not broadcast a fatal null+error that blanks the overlay.
        deps.onBroadcast?.(
          args.login,
          null,
          undefined,
          undefined,
          { softStaleFailure: true },
        )
        return
      }
      state.lastRevalidateFailureAt.delete(args.key)
      state.lastRevalidateAt.set(args.key, now())
      deps.onBroadcast?.(args.login, fetched.payload, undefined, fetched.coverageTier)
    } catch {
      state.lastRevalidateFailureAt.set(args.key, now())
      deps.onBroadcast?.(args.login, null, undefined, undefined, { softStaleFailure: true })
    }
  })
  return true
}

export { PULSE_REVALIDATE_MIN_GAP_MS }
