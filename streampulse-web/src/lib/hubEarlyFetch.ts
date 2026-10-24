/**
 * Primed hub fetch (plan §2.6). `main.tsx` calls `primePublicHub(location)`
 * before React mounts, so the hub JSON request starts while the analytics
 * chunk is still downloading. `fetchPublicHubBase` adopts the primed promise
 * when its path matches.
 *
 * Imports only ./apiClient, ./portalTimeouts and ./hubWindows: this module is
 * in the entry chunk and must not pull publicHub.ts or packages/* in.
 */
import { apiClient, getBackendUrl, type ApiClientResult, type ApiError } from './apiClient'
import { HUB_LONG_WINDOW_TIMEOUT_MS } from './portalTimeouts'
import { parseHubWindowParam, type HubApiWindow } from './hubWindows'

export type HubPathProjection = 'moments' | 'tickers'

/** How long a primed request stays adoptable after it starts. */
export const PRIMED_HUB_TTL_MS = 10_000

/** The hub page path, without trailing slashes. */
const HUB_PAGE_PATH = '/analytics'

/** `/v1/public/hub?activityWindow=…[&include=…]` (moved from publicHub.ts). */
export function publicHubPath(activityWindow?: HubApiWindow, projection?: HubPathProjection): string {
  const params = new URLSearchParams({ activityWindow: activityWindow ?? '24h' })
  if (projection === 'moments') params.set('include', 'livePulseMoments')
  if (projection === 'tickers') params.set('include', 'topEmotes,topMovers')
  return `/v1/public/hub?${params.toString()}`
}

/**
 * The 24h-and-longer bodies get the long hub deadline; the small 30-minute
 * bodies keep apiClient's default (undefined).
 */
export function hubReadTimeoutMs(activityWindow?: HubApiWindow): number | undefined {
  return activityWindow === '30m' || activityWindow === 'recent' ? undefined : HUB_LONG_WINDOW_TIMEOUT_MS
}

export interface HubLocationLike {
  pathname: string
  search: string
}

export interface PrimedHubRequest {
  path: string
  activityWindow: HubApiWindow
  timeoutMs: number | undefined
}

/** The first request `/analytics` makes on mount, or null on any other route. */
export function primedHubRequestForLocation(location: HubLocationLike | null | undefined): PrimedHubRequest | null {
  if (!location || typeof location.pathname !== 'string') return null
  const pathname = location.pathname.replace(/\/+$/, '') || '/'
  if (pathname !== HUB_PAGE_PATH) return null
  const activityWindow = parseHubWindowParam(location.search)
  return { path: publicHubPath(activityWindow), activityWindow, timeoutMs: hubReadTimeoutMs(activityWindow) }
}

type HubResult = ApiClientResult<unknown>

interface PrimedSlot {
  path: string
  backendUrl: string
  startedAt: number
  promise: Promise<HubResult>
}

let slot: PrimedSlot | null = null

function now(): number {
  return Date.now()
}

/**
 * Starts the first hub request for `/analytics` once per page load. Returns
 * the primed path, or null when the location is not the hub (or a request is
 * already primed).
 */
export function primePublicHub(location: HubLocationLike | null | undefined = typeof window !== 'undefined' ? window.location : null): string | null {
  if (slot) return null
  const request = primedHubRequestForLocation(location)
  if (!request) return null
  let backendUrl: string
  try {
    backendUrl = getBackendUrl()
  } catch {
    return null
  }
  const promise = apiClient<unknown>(request.path, { timeoutMs: request.timeoutMs })
  // Nobody may adopt it (another route, a later visit): never surface an
  // unhandled rejection. The adopter still sees the rejection on its own chain.
  promise.catch(() => undefined)
  slot = { path: request.path, backendUrl, startedAt: now(), promise }
  return request.path
}

function abortedError(): ApiError {
  return { kind: 'aborted', message: 'Request was cancelled', status: 0 }
}

/**
 * Hands the primed promise over once, within 10 s, when `path` matches. The
 * caller's abort rejects its own promise and puts the primed request back, so
 * a StrictMode remount (or the next consumer) can still adopt it.
 */
export function takePrimedPublicHub<T = unknown>(path: string, signal?: AbortSignal | null): Promise<ApiClientResult<T>> | null {
  const current = slot
  if (!current) return null
  if (now() - current.startedAt > PRIMED_HUB_TTL_MS) {
    slot = null
    return null
  }
  if (current.path !== path) return null
  let backendUrl: string
  try {
    backendUrl = getBackendUrl()
  } catch {
    return null
  }
  if (current.backendUrl !== backendUrl) {
    slot = null
    return null
  }
  if (signal?.aborted) return null
  slot = null
  const primed = current.promise as Promise<ApiClientResult<T>>
  if (!signal) return primed
  return new Promise<ApiClientResult<T>>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      // Restore for the next consumer while still fresh and unclaimed.
      if (!slot) slot = current
      reject(abortedError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    primed.then(
      (value) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/** True while a primed request waits to be adopted (diagnostics/tests). */
export function hasPrimedPublicHub(): boolean {
  return slot !== null && now() - slot.startedAt <= PRIMED_HUB_TTL_MS
}

export function resetPrimedPublicHubForTests(): void {
  slot = null
}
