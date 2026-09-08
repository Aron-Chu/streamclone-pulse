import { useCallback, useEffect, useRef, useState } from 'react'
import { isApiError } from '../lib/momentsApiClient'
import { computeJitteredDelayMs } from '../lib/pollDelay'
import {
  fetchPublicHubRecentMoments,
  type FetchPublicHubRecentMomentsResult,
  type PublicHubRecentMomentsResponse,
} from '../lib/publicHub'
import {
  readPublicHubRecentMomentsCache,
  writePublicHubRecentMomentsCache,
} from '../lib/publicHubRecentMomentsCache'

export interface UsePublicHubRecentMomentsOptions {
  enabled?: boolean
  pollMs?: number
  limit?: number
  /** Injected RNG for deterministic poll tests. */
  random?: () => number
}

export interface PublicHubRecentMomentsState {
  data: PublicHubRecentMomentsResponse | null
  loading: boolean
  refreshing: boolean
  error: string | null
  loadSource: FetchPublicHubRecentMomentsResult['loadSource'] | 'cache' | null
  refresh: () => void
}

const DEFAULT_POLL_MS = Number(import.meta.env.VITE_PUBLIC_HUB_POLL_MS ?? 45_000)

function recentMomentsErrorMessage(caught: unknown): string {
  if (!isApiError(caught)) return caught instanceof Error ? caught.message : 'Recent moments unavailable'
  if (caught.kind === 'rate_limited') return 'Recent moments are busy. The feed will retry after the server wait period.'
  if (caught.kind === 'unreachable' || caught.kind === 'timeout') return 'Could not reach the recent moments feed.'
  if (caught.kind === 'server') return 'Recent moments are temporarily unavailable.'
  return caught.message
}

export function usePublicHubRecentMoments(
  options: UsePublicHubRecentMomentsOptions = {},
): PublicHubRecentMomentsState {
  const { enabled = true, pollMs = DEFAULT_POLL_MS, limit = 10, random = Math.random } = options
  const [initial] = useState(() => readPublicHubRecentMomentsCache())
  const [data, setData] = useState<PublicHubRecentMomentsResponse | null>(() => initial?.data ?? null)
  const [loading, setLoading] = useState(enabled && !initial)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadSource, setLoadSource] = useState<PublicHubRecentMomentsState['loadSource']>(() => initial ? 'cache' : null)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const hasDataRef = useRef(Boolean(initial))
  const inFlightRef = useRef(false)
  const lastFetchAtRef = useRef(0)
  const failuresRef = useRef(0)
  const retryAfterRef = useRef<number | null>(null)
  const retryNotBeforeRef = useRef(0)
  const randomRef = useRef(random)
  randomRef.current = random

  const load = useCallback(async (supersede = false) => {
    // Explicit refresh still respects a server-issued Retry-After.
    if (Date.now() < retryNotBeforeRef.current) return
    if (inFlightRef.current && !supersede) return
    controllerRef.current?.abort(new DOMException('superseded', 'AbortError'))
    const controller = new AbortController()
    controllerRef.current = controller
    inFlightRef.current = true
    if (hasDataRef.current) setRefreshing(true)
    else setLoading(true)
    try {
      const result = await fetchPublicHubRecentMoments(controller.signal, limit)
      if (!mountedRef.current || controller.signal.aborted) return
      setData(result.data)
      setLoadSource(result.loadSource)
      setError(null)
      writePublicHubRecentMomentsCache(result.data)
      hasDataRef.current = true
      failuresRef.current = 0
      retryAfterRef.current = null
      retryNotBeforeRef.current = 0
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted || (isApiError(caught) && caught.kind === 'aborted')) return
      failuresRef.current += 1
      if (isApiError(caught) && caught.retryAfterMs && caught.retryAfterMs > 0) {
        const delay = Math.max(pollMs, caught.retryAfterMs)
        retryAfterRef.current = delay
        retryNotBeforeRef.current = Date.now() + delay
      }
      setError(recentMomentsErrorMessage(caught))
    } finally {
      if (controllerRef.current === controller) {
        inFlightRef.current = false
        lastFetchAtRef.current = Date.now()
        if (mountedRef.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    }
  }, [limit, pollMs])

  const refresh = useCallback(() => { void load(true) }, [load])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) {
      setLoading(false)
      return () => {
        mountedRef.current = false
        controllerRef.current?.abort(new DOMException('hook disabled', 'AbortError'))
        controllerRef.current = null
        inFlightRef.current = false
      }
    }

    let active = true
    let initialTimer: number | undefined
    let pollTimer: number | undefined
    const schedule = () => {
      if (!active || pollMs <= 0) return
      const retryAfter = retryAfterRef.current
      retryAfterRef.current = null
      const delay = retryAfter ?? computeJitteredDelayMs(pollMs, failuresRef.current, randomRef.current)
      pollTimer = window.setTimeout(() => {
        if (document.visibilityState === 'hidden') {
          schedule()
          return
        }
        void load().finally(schedule)
      }, delay)
    }
    // Defer one task so React development StrictMode can complete its probe
    // mount/unmount without issuing and immediately aborting a duplicate read.
    initialTimer = window.setTimeout(() => { void load().finally(schedule) }, 0)

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || pollMs <= 0) return
      // A failed request already owns one scheduled exponential/Retry-After
      // retry. Tab focus must not create a parallel faster retry path.
      if (failuresRef.current > 0) return
      if (Date.now() - lastFetchAtRef.current < Math.min(pollMs / 2, 15_000)) return
      void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      mountedRef.current = false
      controllerRef.current?.abort(new DOMException('component unmounted', 'AbortError'))
      controllerRef.current = null
      inFlightRef.current = false
      if (initialTimer) window.clearTimeout(initialTimer)
      if (pollTimer) window.clearTimeout(pollTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, load, pollMs])

  return { data, loading, refreshing, error, loadSource, refresh }
}
