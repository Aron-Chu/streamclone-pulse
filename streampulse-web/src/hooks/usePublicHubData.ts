import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchPublicHub,
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
  error: string | null
  loadSource: PublicHubLoadSource | null
  hubEndpointOk: boolean
  /** Loaded successfully but no live channels in the pool. */
  liveEmpty: boolean
  lastUpdated: number | null
  refresh: () => void
}

const DEFAULT_POLL_MS = 30_000
const RETRY_MS_NO_DATA = 5_000

export function usePublicHubData(options: UsePublicHubOptions = {}): PublicHubState {
  const { pollMs = DEFAULT_POLL_MS, enabled = true, activityWindow } = options
  const [data, setData] = useState<PublicHub | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadSource, setLoadSource] = useState<PublicHubLoadSource | null>(null)
  const [hubEndpointOk, setHubEndpointOk] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)

  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const hasDataRef = useRef(false)

  const load = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    if (hasDataRef.current) setRefreshing(true)
    else setLoading(true)

    try {
      const result = await fetchPublicHub(controller.signal, activityWindow)
      if (!mountedRef.current || controller.signal.aborted) return
      setData(normalizePublicHub(result.data))
      setLoadSource(result.loadSource)
      setHubEndpointOk(result.hubEndpointOk)
      setError(null)
      setLastUpdated(Date.now())
      hasDataRef.current = true
    } catch (err) {
      if (controller.signal.aborted || !mountedRef.current) return
      // Keep any previously loaded data on screen; just surface the error.
      setError(err instanceof Error ? err.message : 'Failed to load live hub data')
    } finally {
      if (mountedRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [activityWindow])

  const refresh = useCallback(() => {
    void load()
  }, [load])

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

    // Retry quickly until the first successful load (e.g. backend still starting).
    const retryTimer = window.setInterval(() => {
      if (hasDataRef.current) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      void load()
    }, RETRY_MS_NO_DATA)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
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

  return {
    data,
    loading,
    refreshing,
    error,
    loadSource,
    hubEndpointOk,
    liveEmpty: Boolean(data) && (data?.poolSize ?? 0) === 0,
    lastUpdated,
    refresh,
  }
}
