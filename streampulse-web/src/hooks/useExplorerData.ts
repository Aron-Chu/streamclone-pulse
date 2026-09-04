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
  const requestRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

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
    } catch (caught) {
      if (controller.signal.aborted || (isApiError(caught) && caught.kind === 'aborted')) return
      const unavailable = isApiError(caught) ? normalizeExplorerEnvelope(caught.body) : null
      if (previous) {
        const stale = staleCopy(previous)
        setData(stale)
        setError(isApiError(caught) ? caught.message : caught instanceof Error ? caught.message : 'Explorer refresh failed')
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
  }, [broadcastId, enabled, limit, query.category, query.q, query.signal, query.sort, query.state, query.window, queryKey])

  const loadMore = useCallback(async () => {
    if (!data?.nextCursor || loadingMore || broadcastId) return
    const cursor = data.nextCursor
    setLoadingMore(true)
    try {
      const page = await fetchExplorer({ ...query, cursor, limit })
      const byId = new Map(data.broadcasts.map((broadcast) => [broadcast.id, broadcast]))
      for (const broadcast of page.broadcasts) byId.set(broadcast.id, broadcast)
      const merged = { ...data, broadcasts: [...byId.values()], nextCursor: page.nextCursor, generatedAt: page.generatedAt, dataThrough: page.dataThrough }
      cache.set(queryKey, merged)
      setData(merged)
    } catch (caught) {
      setError(isApiError(caught) ? caught.message : 'Could not load more broadcasts')
    } finally {
      setLoadingMore(false)
    }
  }, [broadcastId, data, limit, loadingMore, query.category, query.q, query.signal, query.sort, query.state, query.window, queryKey])

  useEffect(() => {
    const cached = cache.get(queryKey)
    setData(cached ?? null)
    setLoading(enabled && !cached)
    setError(null)
    setAnnouncement('')
    void load()
    const timer = enabled && pollMs > 0
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void load()
        }, pollMs)
      : undefined
    return () => {
      requestRef.current += 1
      controllerRef.current?.abort(new DOMException('unmounted', 'AbortError'))
      if (timer) window.clearInterval(timer)
    }
  }, [enabled, load, pollMs, queryKey])

  const unavailable = useMemo(() => enabled && ((!loading && !data) || data?.status === 'unavailable'), [data, enabled, loading])
  return { data, loading, refreshing, loadingMore, error, unavailable, announcement, refresh: () => void load(), loadMore }
}
