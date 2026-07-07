import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  readPublicHubCacheForCurrentBackend,
  writePublicHubCacheForCurrentBackend,
} from '../lib/publicHubCache'
import {
  fetchPublicHub,
  fetchPublicHubBase,
  normalizePublicHub,
  type PublicHub,
  type PublicHubActivityWindow,
  type PublicHubLoadSource,
} from '../lib/publicHub'

export interface UsePublicHubOptions {
  /** Poll cadence in ms. Matches the backend cache TTL (~30s) by default. */
  pollMs?: number
  enabled?: boolean
  activityWindow?: PublicHubActivityWindow
}

export interface PublicHubState {
  data: PublicHub | null
  loading: boolean
  refreshing: boolean
  /** True while fetching a new activity window but shell data may still be visible. */
  activityRefreshing: boolean
  error: string | null
  loadSource: PublicHubLoadSource | null
  hubEndpointOk: boolean
  /** Loaded successfully but no live channels in the pool. */
  liveEmpty: boolean
  lastUpdated: number | null
  /** When data was read from browser cache (ms since epoch). */
  cachedAt: number | null
  refresh: () => void
}

const DEFAULT_POLL_MS = Number(import.meta.env.VITE_PUBLIC_HUB_POLL_MS ?? 45_000)
const RETRY_MS_NO_DATA = 5_000

function hydrateFromCache(activityWindow: PublicHubActivityWindow) {
  const cached = readPublicHubCacheForCurrentBackend(activityWindow)
  if (!cached) {
    return {
      data: null as PublicHub | null,
      loading: true,
      loadSource: null as PublicHubLoadSource | null,
      lastUpdated: null as number | null,
      cachedAt: null as number | null,
      hasData: false,
      loadedActivityWindow: null as PublicHubActivityWindow | null,
    }
  }
  return {
    data: cached.data,
    loading: false,
    loadSource: 'cache' as PublicHubLoadSource,
    lastUpdated: cached.cachedAt,
    cachedAt: cached.cachedAt,
    hasData: true,
    loadedActivityWindow: activityWindow,
  }
}

function persistSuccessfulHub(activityWindow: PublicHubActivityWindow, hub: PublicHub) {
  writePublicHubCacheForCurrentBackend(activityWindow, hub)
}

export function usePublicHubData(options: UsePublicHubOptions = {}): PublicHubState {
  const { pollMs = DEFAULT_POLL_MS, enabled = true, activityWindow = '24h' } = options
  const initial = hydrateFromCache(activityWindow)
  const [data, setData] = useState<PublicHub | null>(initial.data)
  const [loading, setLoading] = useState(initial.loading)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadSource, setLoadSource] = useState<PublicHubLoadSource | null>(initial.loadSource)
  const [hubEndpointOk, setHubEndpointOk] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(initial.lastUpdated)
  const [cachedAt, setCachedAt] = useState<number | null>(initial.cachedAt)
  const [loadedActivityWindow, setLoadedActivityWindow] = useState<PublicHubActivityWindow | null>(
    initial.loadedActivityWindow,
  )

  const controllerRef = useRef<AbortController | null>(null)
  const inFlightRef = useRef(false)
  const lastFetchAtRef = useRef(0)
  const mountedRef = useRef(true)
  const hasDataRef = useRef(initial.hasData)
  const prevActivityWindowRef = useRef(activityWindow)

  const applySuccessfulLoad = useCallback(
    (hub: PublicHub, source: PublicHubLoadSource, endpointOk: boolean) => {
      setData(hub)
      setLoadSource(source)
      setHubEndpointOk(endpointOk)
      setError(null)
      setLastUpdated(Date.now())
      setCachedAt(null)
      hasDataRef.current = true
      setLoadedActivityWindow(activityWindow)
      persistSuccessfulHub(activityWindow, hub)
    },
    [activityWindow],
  )

  const load = useCallback(async (force = false) => {
    if (inFlightRef.current && !force) return

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    inFlightRef.current = true

    if (hasDataRef.current) setRefreshing(true)
    else setLoading(true)

    try {
      const base = await fetchPublicHubBase(controller.signal, activityWindow)
      if (!mountedRef.current || controller.signal.aborted) return

      if (base.hubEndpointOk) {
        applySuccessfulLoad(normalizePublicHub(base.data), base.loadSource, true)
        return
      }

      const fallback = await fetchPublicHub(controller.signal, activityWindow)
      if (!mountedRef.current || controller.signal.aborted) return
      applySuccessfulLoad(
        normalizePublicHub(fallback.data),
        fallback.loadSource,
        fallback.hubEndpointOk,
      )
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load live hub data')
    } finally {
      if (controllerRef.current === controller) {
        inFlightRef.current = false
        lastFetchAtRef.current = Date.now()
      }
      if (mountedRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [activityWindow, applySuccessfulLoad])

  const refresh = useCallback(() => {
    void load(true)
  }, [load])

  useEffect(() => {
    if (prevActivityWindowRef.current === activityWindow) return
    prevActivityWindowRef.current = activityWindow
    const cached = readPublicHubCacheForCurrentBackend(activityWindow)
    if (cached) {
      setData(cached.data)
      setLoading(false)
      setLoadSource('cache')
      setLastUpdated(cached.cachedAt)
      setCachedAt(cached.cachedAt)
      hasDataRef.current = true
      setLoadedActivityWindow(activityWindow)
      return
    }
    // Stale-while-revalidate: keep prior hub payload visible while the new window loads.
    if (!hasDataRef.current) {
      setLoading(true)
    }
  }, [activityWindow])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) {
      setLoading(false)
      return () => {
        mountedRef.current = false
        controllerRef.current?.abort()
      }
    }

    void load()

    let pollTimer: number | undefined
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load()
    }
    if (pollMs > 0) {
      pollTimer = window.setInterval(tick, pollMs)
    }

    const retryTimer = window.setInterval(() => {
      if (hasDataRef.current) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load()
    }, RETRY_MS_NO_DATA)

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const sinceLastFetch = Date.now() - lastFetchAtRef.current
      if (sinceLastFetch < Math.min(pollMs / 2, 15_000)) return
      void load()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      mountedRef.current = false
      controllerRef.current?.abort()
      if (pollTimer) window.clearInterval(pollTimer)
      window.clearInterval(retryTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, pollMs, load])

  const activityRefreshing = useMemo(
    () =>
      Boolean(
        data && loadedActivityWindow != null && loadedActivityWindow !== activityWindow,
      ),
    [activityWindow, data, loadedActivityWindow],
  )

  return {
    data,
    loading,
    refreshing,
    activityRefreshing,
    error,
    loadSource,
    hubEndpointOk,
    liveEmpty: Boolean(data) && (data?.poolSize ?? 0) === 0,
    lastUpdated,
    cachedAt,
    refresh,
  }
}
