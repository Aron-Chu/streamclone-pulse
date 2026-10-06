import { useEffect, useState } from 'react'
import { isApiError } from '../lib/apiClient'
import { fetchRankedAvailability } from '../lib/discoveryAvailability'

export type RankedFeatureState = 'pending' | 'ready' | 'not_deployed' | 'unavailable'
type SettledRankedFeature = Exclude<RankedFeatureState, 'pending'>

/** Latest renders its first screen before this read starts, and never waits on it. */
export const RANKED_FEATURE_CHECK_DELAY_MS = 2_000

// One answer per page session, shared by every mount of the Moments workspace.
let settled: SettledRankedFeature | undefined
let checking = false
let generation = 0
const listeners = new Set<(state: SettledRankedFeature) => void>()

function settle(state: SettledRankedFeature) {
  if (settled === state) return
  settled = state
  for (const listener of listeners) listener(state)
}

/** Only a 404 means the ranked backend is absent. A 503, timeout or invalid body means it exists but is down. */
export function rankedFeatureStateFromError(error: unknown): SettledRankedFeature {
  return isApiError(error) && error.status === 404 ? 'not_deployed' : 'unavailable'
}

function checkOnce() {
  if (settled || checking) return
  checking = true
  const ticket = generation
  void fetchRankedAvailability('', new AbortController().signal)
    .then((): SettledRankedFeature => 'ready', rankedFeatureStateFromError)
    .then(state => {
      if (ticket !== generation) return
      checking = false
      // A ranked view's own retention read may have answered first; it is newer.
      if (!settled) settle(state)
    })
}

export function clearRankedFeatureCheckForTests(): void {
  settled = undefined
  checking = false
  generation += 1
}

/**
 * Whether Explore and History are offered, decided by one ranked availability
 * read per session. `start` begins that read after a short delay; a ranked view
 * passes its own retention outcome as `observed` instead of a second request.
 */
export function useRankedFeatureAvailability({ start, observed }: { start: boolean; observed?: SettledRankedFeature }): RankedFeatureState {
  const [state, setState] = useState<RankedFeatureState>(() => settled ?? 'pending')
  useEffect(() => {
    const listener = (next: SettledRankedFeature) => setState(next)
    listeners.add(listener)
    if (settled) setState(settled)
    return () => { listeners.delete(listener) }
  }, [])
  useEffect(() => { if (observed) settle(observed) }, [observed])
  useEffect(() => {
    if (!start || settled) return
    const timer = setTimeout(checkOnce, RANKED_FEATURE_CHECK_DELAY_MS)
    return () => clearTimeout(timer)
  }, [start])
  return state
}
