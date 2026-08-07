import type { PublicHub, PublicHubLoadSource } from './publicHub'

/** Stable hub landing readiness for Playwright and honest empty/error UI. */
export type HubUiState = 'loading' | 'ready' | 'empty' | 'error'

export interface ResolveHubUiStateInput {
  loading: boolean
  data: PublicHub | null
  error: string | null
  hubEndpointOk: boolean
  loadSource: PublicHubLoadSource | null
}

export function resolveHubUiState(input: ResolveHubUiStateInput): HubUiState {
  const { loading, data, error, hubEndpointOk, loadSource } = input

  if (loading && !data) return 'loading'
  if (error && !data) return 'error'
  if (!data) return 'loading'

  // Aggregate-only fallback still has usable shell KPIs — treat as ready (degraded copy elsewhere).
  if (loadSource === 'stats-fallback') return 'ready'

  const poolSize = data.poolSize > 0 ? data.poolSize : data.liveChannels.length
  if (hubEndpointOk && poolSize === 0) return 'empty'

  // Cache or full hub with channels / activity — ready for capture gates.
  if (poolSize > 0 || data.activity.points.length >= 2 || loadSource === 'cache' || hubEndpointOk) {
    return 'ready'
  }

  return 'loading'
}

/**
 * Signal Wire / network feed should pause only after a confirmed hub endpoint failure.
 * `hubEndpointOk` defaults to false before the first successful fetch — that must not
 * look like "Public hub is unavailable".
 */
export function isHubNetworkDegraded(
  loadSource: PublicHubLoadSource | null | undefined,
  hubEndpointOk: boolean | undefined,
): boolean {
  if (loadSource === 'stats-fallback') return true
  // Confirmed network load that did not get a healthy hub endpoint (not cache / not pending).
  return hubEndpointOk === false && loadSource === 'full'
}
