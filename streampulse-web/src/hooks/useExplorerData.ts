import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isApiError } from '../lib/apiClient'
import {
  fetchExplorer,
  normalizeExplorerEnvelope,
  type ExplorerEnvelope,
  type ExplorerQuery,
} from '../lib/explorer'

export interface UseExplorerDataOptions extends ExplorerQuery {
  broadcastId?: string
  enabled?: boolean
  limit?: number
  pollMs?: number
}

const cache = new Map<string, ExplorerEnvelope>()
const DEFAULT_POLL_MS = Number(import.meta.env.VITE_PUBLIC_HUB_POLL_MS ?? 45_000)

function keyFor(options: UseExplorerDataOptions): string {
  return JSON.stringify({
    id: options.broadcastId ?? '',
    window: options.window,
    signal: options.signal,
    category: options.category ?? '',
    state: options.state,
    sort: options.sort,
    q: options.q ?? '',
  })
}

function staleCopy(envelope: ExplorerEnvelope): ExplorerEnvelope {
  return envelope.status === 'unavailable'
    ? envelope
    : { ...envelope, status: 'stale', reason: 'refresh_unavailable' }
}

export function useExplorerData(options: UseExplorerDataOptions) {
  const {
    broadcastId,
    enabled = true,
    limit = 25,
    pollMs = broadcastId ? 0 : DEFAULT_POLL_MS,
    ...query
  } = options
  const queryKey = keyFor(options)
  const [data, setData] = useState<ExplorerEnvelope | null>(() => cache.get(queryKey) ?? null)
  const [loading, setLoading] = useState(enabled && !cache.has(queryKey))
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Retry-After from the last failed read: no attempt, polled or pressed, starts before it.
  const [retryBlocked, setRetryBlocked] = useState(false)
  const retryNotBeforeRef = useRef(0)
  const unblockTimerRef = useRef<number>()
  const requestRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)
  // A continuation belongs to the query that requested it; a filter change aborts it.
  const loadMoreRef = useRef<AbortController | null>(null)

  const clearRetryBlock = useCallback(() => {
    retryNotBeforeRef.current = 0
    window.clearTimeout(unblockTimerRef.current)
    setRetryBlocked(false)
  }, [])

  const load = useCallback(async () => {
    if (!enabled) return
    const request = ++requestRef.current
    controllerRef.current?.abort(new DOMException('superseded', 'AbortError'))
    const controller = new AbortController()
    controllerRef.current = controller
    const previous = cache.get(queryKey)
    if (previous) {
      setData(previous)
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    try {
      const envelope = await fetchExplorer({ ...query, broadcastId, limit, abortSignal: controller.signal })
      if (controller.signal.aborted || request !== requestRef.current) return
      const before = previous?.summary.broadcastCount ?? 0
      if (!broadcastId && envelope.status === 'ready' && envelope.summary.broadcastCount > before && before > 0) {
        const added = envelope.summary.broadcastCount - before
        setAnnouncement(`${added} new verified ${added === 1 ? 'broadcast' : 'broadcasts'} available.`)
      } else {
        setAnnouncement('')
      }
      if (envelope.status !== 'unavailable') cache.set(queryKey, envelope)
      setData(envelope)
      setError(null)
      clearRetryBlock()
    } catch (caught) {
      if (controller.signal.aborted || (isApiError(caught) && caught.kind === 'aborted')) return
      const unavailable = isApiError(caught) ? normalizeExplorerEnvelope(caught.body) : null
      const retryAfterMs = isApiError(caught) && typeof caught.retryAfterMs === 'number' && caught.retryAfterMs > 0 ? caught.retryAfterMs : undefined
      if (retryAfterMs) {
        retryNotBeforeRef.current = Date.now() + retryAfterMs
        setRetryBlocked(true)
        window.clearTimeout(unblockTimerRef.current)
        unblockTimerRef.current = window.setTimeout(() => setRetryBlocked(false), retryAfterMs)
      }
      if (previous) {
        const stale = staleCopy(previous)
        setData(stale)
        setError(unavailable?.reason ?? (isApiError(caught) ? caught.message : caught instanceof Error ? caught.message : 'Explorer refresh failed'))
      } else if (unavailable) {
        setData(unavailable)
        setError(unavailable.reason ?? 'Explorer unavailable')
      } else {
        setData(null)
        setError(isApiError(caught) ? caught.message : caught instanceof Error ? caught.message : 'Explorer unavailable')
      }
    } finally {
      if (request === requestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [broadcastId, clearRetryBlock, enabled, limit, query.category, query.q, query.signal, query.sort, query.state, query.window, queryKey])

  const loadMore = useCallback(async () => {
    if (!data?.nextCursor || loadingMore || broadcastId) return
    const cursor = data.nextCursor
    const controller = new AbortController()
    loadMoreRef.current = controller
    setLoadingMore(true)
    try {
      const page = await fetchExplorer({ ...query, cursor, limit, abortSignal: controller.signal })
      if (controller.signal.aborted) return
      const byId = new Map(data.broadcasts.map((broadcast) => [broadcast.id, broadcast]))
      for (const broadcast of page.broadcasts) byId.set(broadcast.id, broadcast)
      const merged = { ...data, broadcasts: [...byId.values()], nextCursor: page.nextCursor, generatedAt: page.generatedAt, dataThrough: page.dataThrough }
      cache.set(queryKey, merged)
      setData(merged)
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(isApiError(caught) ? caught.message : 'Could not load more broadcasts')
    } finally {
      if (loadMoreRef.current === controller) {
        loadMoreRef.current = null
        setLoadingMore(false)
      }
    }
  }, [broadcastId, data, limit, loadingMore, query.category, query.q, query.signal, query.sort, query.state, query.window, queryKey])

  useEffect(() => {
    const cached = cache.get(queryKey)
    setData(cached ?? null)
    setLoading(enabled && !cached)
    setLoadingMore(false)
    setError(null)
    setAnnouncement('')
    clearRetryBlock()
    let active = true
    let timer: number | undefined
    // Each read is followed by at most one timer: a list polls, never sooner than Retry-After.
    const next = () => {
      if (!active || !enabled || pollMs <= 0) return
      const wait = Math.max(0, retryNotBeforeRef.current - Date.now())
      timer = window.setTimeout(poll, Math.max(pollMs, wait))
    }
    const poll = () => {
      if (!active) return
      // A read pressed meanwhile may have pushed Retry-After past this tick.
      const wait = retryNotBeforeRef.current - Date.now()
      if (wait > 0) {
        timer = window.setTimeout(poll, wait)
        return
      }
      if (document.visibilityState !== 'visible') {
        next()
        return
      }
      void load().then(next)
    }
    void load().then(next)
    return () => {
      active = false
      window.clearTimeout(timer)
      requestRef.current += 1
      controllerRef.current?.abort(new DOMException('unmounted', 'AbortError'))
      loadMoreRef.current?.abort(new DOMException('superseded', 'AbortError'))
      loadMoreRef.current = null
    }
  }, [clearRetryBlock, enabled, load, pollMs, queryKey])

  useEffect(() => () => window.clearTimeout(unblockTimerRef.current), [])

  const unavailable = useMemo(() => enabled && ((!loading && !data) || data?.status === 'unavailable'), [data, enabled, loading])
  const refresh = () => {
    // The server asked for a pause; the page offers no retry until it ends.
    if (Date.now() < retryNotBeforeRef.current) return
    void load()
  }
  // A polling list reads again on its own; a detail read waits for the reader.
  const retryScheduled = enabled && pollMs > 0
  return { data, loading, refreshing, loadingMore, error, unavailable, announcement, retryBlocked, retryScheduled, refresh, loadMore }
}
