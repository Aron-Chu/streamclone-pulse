import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  diffNewLiveActivityIds,
  fetchLiveActivity,
  filterLiveActivityEvents,
  isLiveActivityPortalReadEnabled,
  seedLiveActivityBaseline,
  type LiveActivityEvent,
  type LiveActivityKindFilter,
  type LiveActivityMetadata,
  type LiveActivityResponse,
} from '../lib/liveActivity'

export type LiveActivityUiStatus =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'degraded'
  | 'stale'
  | 'unavailable'
  | 'error'

export interface UseLiveActivityOptions {
  enabled?: boolean
  /** Poll cadence in ms. Defaults to ~30s. */
  pollMs?: number
  window?: string
  limit?: number
  /** Initial kind filter (client-side; server fetch stays kind=all for stable baseline). */
  initialKind?: LiveActivityKindFilter
  /**
   * Override portal-read promotion gate. Defaults to
   * `VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED === 'true'` (default OFF).
   */
  portalReadEnabled?: boolean
}

export interface UseLiveActivityResult {
  events: LiveActivityEvent[]
  allEvents: LiveActivityEvent[]
  metadata: LiveActivityMetadata | null
  asOf: string | null
  window: string | null
  completeness: string | null
  status: LiveActivityUiStatus
  error: string | null
  newIds: Set<string>
  kindFilter: LiveActivityKindFilter
  setKindFilter: (kind: LiveActivityKindFilter) => void
  lastSuccessfulAt: number | null
  refetch: () => void
}

const DEFAULT_POLL_MS = 30_000

function deriveStatus(
  loading: boolean,
  payload: LiveActivityResponse | null,
  fetchFailed: boolean,
  error: string | null,
  portalReadEnabled: boolean,
): LiveActivityUiStatus {
  if (!portalReadEnabled) return 'unavailable'
  if (fetchFailed || error) {
    return payload ? 'unavailable' : error ? 'error' : 'unavailable'
  }
  if (loading && !payload) return 'loading'
  if (!payload) return 'loading'
  const meta = payload.metadata.state
  if (meta === 'degraded') return 'degraded'
  if (meta === 'stale') return 'stale'
  if (meta === 'unavailable') return 'unavailable'
  if (payload.events.length === 0) return 'empty'
  return 'ready'
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  if (err instanceof Error) return err.message
  return 'live_activity_unavailable'
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  if (err instanceof DOMException && err.name === 'AbortError') return true
  return 'name' in err && (err as { name: unknown }).name === 'AbortError'
}

/**
 * Polls the portal Live Activity endpoint.
 * Never falls back to poolWireReducer on failure — keeps last successful payload if any.
 * Portal read is gated by VITE_LIVE_ACTIVITY_PORTAL_READ_ENABLED (default OFF).
 */
export function useLiveActivity(options: UseLiveActivityOptions = {}): UseLiveActivityResult {
  const {
    enabled = true,
    pollMs = DEFAULT_POLL_MS,
    window: activityWindow = '6h',
    limit = 20,
    initialKind = 'all',
    portalReadEnabled: portalReadOverride,
  } = options

  const portalReadEnabled =
    portalReadOverride ?? isLiveActivityPortalReadEnabled()

  const [payload, setPayload] = useState<LiveActivityResponse | null>(null)
  const [loading, setLoading] = useState(() => enabled && portalReadEnabled)
  const [error, setError] = useState<string | null>(null)
  const [fetchFailed, setFetchFailed] = useState(() => !portalReadEnabled)
  const [kindFilter, setKindFilter] = useState<LiveActivityKindFilter>(initialKind)
  const [newIds, setNewIds] = useState<Set<string>>(() => new Set())
  const [lastSuccessfulAt, setLastSuccessfulAt] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  const baselineRef = useRef<Set<string> | null>(null)
  const payloadRef = useRef<LiveActivityResponse | null>(null)
  const requestSeqRef = useRef(0)
  const fetchAbortRef = useRef<AbortController | null>(null)
  payloadRef.current = payload

  const refetch = useCallback(() => {
    setTick((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !portalReadEnabled) {
      // Promotion gate OFF — no fetch, no browser inference.
      fetchAbortRef.current?.abort()
      fetchAbortRef.current = null
      setLoading(false)
      setFetchFailed(true)
      setError(null)
      return
    }

    let cancelled = false

    const run = async () => {
      if (cancelled) return
      // Abort any in-flight request so polls never overlap.
      fetchAbortRef.current?.abort()
      const abort = new AbortController()
      fetchAbortRef.current = abort
      const seq = ++requestSeqRef.current

      if (!baselineRef.current && !payloadRef.current) {
        setLoading(true)
      }

      try {
        const next = await fetchLiveActivity({
          window: activityWindow,
          limit,
          kind: 'all',
          signal: abort.signal,
        })
        // Stale / aborted / superseded — do not overwrite newer payload.
        if (cancelled || abort.signal.aborted || seq !== requestSeqRef.current) return

        const ids = next.events.map((e) => e.id)
        if (baselineRef.current == null) {
          baselineRef.current = seedLiveActivityBaseline(ids)
          setNewIds(new Set())
        } else {
          const fresh = diffNewLiveActivityIds(baselineRef.current, ids)
          for (const id of ids) baselineRef.current.add(id)
          setNewIds(fresh)
        }
        setPayload(next)
        setLastSuccessfulAt(Date.now())
        setError(null)
        setFetchFailed(false)
      } catch (err) {
        if (cancelled || abort.signal.aborted || seq !== requestSeqRef.current) return
        if (isAbortError(err)) return
        setError(errorMessage(err))
        setFetchFailed(true)
        // Keep last successful payload — never call poolWireReducer.
      } finally {
        if (!cancelled && seq === requestSeqRef.current) {
          setLoading(false)
        }
        if (fetchAbortRef.current === abort) {
          fetchAbortRef.current = null
        }
      }
    }

    void run()
    const timer = window.setInterval(() => {
      void run()
    }, pollMs)

    return () => {
      cancelled = true
      fetchAbortRef.current?.abort()
      fetchAbortRef.current = null
      window.clearInterval(timer)
    }
  }, [activityWindow, enabled, limit, pollMs, portalReadEnabled, tick])

  const status = useMemo(
    () => deriveStatus(loading, payload, fetchFailed, error, portalReadEnabled),
    [error, fetchFailed, loading, payload, portalReadEnabled],
  )

  const allEvents = payload?.events ?? []
  const events = useMemo(
    () => filterLiveActivityEvents(allEvents, kindFilter),
    [allEvents, kindFilter],
  )

  return {
    events,
    allEvents,
    metadata: payload?.metadata ?? null,
    asOf: payload?.asOf ?? null,
    window: payload?.window ?? null,
    completeness: payload?.completeness ?? null,
    status,
    error,
    newIds,
    kindFilter,
    setKindFilter,
    lastSuccessfulAt,
    refetch,
  }
}
