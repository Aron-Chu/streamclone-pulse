import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isApiError } from '../lib/apiClient'
import {
  EXPLORER_MAX_LIMIT,
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
/** A detail read (which does not poll) tries again this many times while its window warms. */
export const EXPLORER_WARMING_RETRIES = 1
/** Used only if a warming answer arrives without Retry-After. */
const WARMING_RETRY_FALLBACK_MS = 30_000

/** What a failed read tells the next one. */
interface LoadOutcome {
  reason?: string
  retryAfterMs?: number
}

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

/**
 * How many rows a list read asks for. A list the reader extended with Load more
 * is read again as deep as they reached, up to what one read can return, so a
 * poll refreshes those rows instead of only the first page.
 */
function readDepth(list: ExplorerEnvelope | undefined, limit: number): number {
  return Math.min(EXPLORER_MAX_LIMIT, Math.max(limit, list?.broadcasts.length ?? 0))
}

/**
 * The list after a read of its first `depth` rows. When the read covered every
 * row on the list, or returned the whole result set, it is the list: rows that
 * left are gone, and its cursor follows the last row it returned, so a row
 * pushed further down comes back with Load more. On a list longer than one read
 * returns, the rows below the read stay as they were loaded, with the cursor
 * past them, and a row within the read that it did not return is dropped.
 */
function withFreshRead(list: ExplorerEnvelope, fresh: ExplorerEnvelope, depth: number): ExplorerEnvelope {
  if (!fresh.nextCursor || list.broadcasts.length <= depth) return fresh
  const read = new Set(fresh.broadcasts.map((broadcast) => broadcast.id))
  return {
    ...fresh,
    broadcasts: [...fresh.broadcasts, ...list.broadcasts.slice(depth).filter((broadcast) => !read.has(broadcast.id))],
    nextCursor: list.nextCursor,
  }
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
  // The list as last shown, for a read that lands after others have replaced it.
  const dataRef = useRef(data)
  const show = useCallback((next: ExplorerEnvelope | null) => {
    dataRef.current = next
    setData(next)
  }, [])
  const [loading, setLoading] = useState(enabled && !cache.has(queryKey))
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Retry-After from the last failed read: no attempt, polled or pressed, starts before it.
  const [retryBlocked, setRetryBlocked] = useState(false)
  // A detail read that answered "warming" has one automatic attempt queued.
  const [retryScheduled, setRetryScheduled] = useState(false)
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

  const load = useCallback(async (): Promise<LoadOutcome | undefined> => {
    if (!enabled) return
    const request = ++requestRef.current
    controllerRef.current?.abort(new DOMException('superseded', 'AbortError'))
    const controller = new AbortController()
    controllerRef.current = controller
    const previous = cache.get(queryKey)
    const depth = broadcastId ? limit : readDepth(previous, limit)
    if (previous) {
      show(previous)
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    try {
      const envelope = await fetchExplorer({ ...query, broadcastId, limit: depth, abortSignal: controller.signal })
      if (controller.signal.aborted || request !== requestRef.current) return
      const before = previous?.summary.broadcastCount ?? 0
      if (!broadcastId && envelope.status === 'ready' && envelope.summary.broadcastCount > before && before > 0) {
        const added = envelope.summary.broadcastCount - before
        setAnnouncement(`${added} new verified ${added === 1 ? 'broadcast' : 'broadcasts'} available.`)
      } else {
        setAnnouncement('')
      }
      // Merged onto the list as it is now: a Load more may have landed during this read.
      const current = cache.get(queryKey)
      const next = !broadcastId && envelope.status !== 'unavailable' && current
        ? withFreshRead(current, envelope, depth)
        : envelope
      if (next.status !== 'unavailable') cache.set(queryKey, next)
      show(next)
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
        show(stale)
        setError(unavailable?.reason ?? (isApiError(caught) ? caught.message : caught instanceof Error ? caught.message : 'Explorer refresh failed'))
      } else if (unavailable) {
        show(unavailable)
        setError(unavailable.reason ?? 'Explorer unavailable')
      } else {
        show(null)
        setError(isApiError(caught) ? caught.message : caught instanceof Error ? caught.message : 'Explorer unavailable')
      }
      return { reason: unavailable?.reason, retryAfterMs }
    } finally {
      if (request === requestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [broadcastId, clearRetryBlock, enabled, limit, query.category, query.q, query.signal, query.sort, query.state, query.window, queryKey, show])

  const loadMore = useCallback(async () => {
    if (!dataRef.current?.nextCursor || loadMoreRef.current || broadcastId) return
    const controller = new AbortController()
    loadMoreRef.current = controller
    setLoadingMore(true)
    try {
      // A poll that lands while a page is in flight can read the list again and
      // move its cursor. The page then continues the old list and could skip a
      // row the poll pushed down, so the next page is read once more after the
      // list as it is now.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const from = dataRef.current
        const cursor = from?.nextCursor
        if (!from || !cursor || from.status === 'unavailable') return
        const page = await fetchExplorer({ ...query, cursor, limit, abortSignal: controller.signal })
        if (controller.signal.aborted) return
        const list = dataRef.current
        if (!list || list.status === 'unavailable') return
        if (list.nextCursor !== cursor) {
          if (attempt === 0) continue
          return
        }
        // A poll that kept the cursor (or a failed one) may still have replaced the
        // list: add this page to it, keeping the poll's fresher rows and summary.
        const polled = list !== from
        const byId = new Map(list.broadcasts.map((broadcast) => [broadcast.id, broadcast]))
        for (const broadcast of page.broadcasts) if (!polled || !byId.has(broadcast.id)) byId.set(broadcast.id, broadcast)
        const merged = {
          ...list,
          broadcasts: [...byId.values()],
          nextCursor: page.nextCursor,
          ...(polled ? {} : { generatedAt: page.generatedAt, dataThrough: page.dataThrough }),
        }
        cache.set(queryKey, merged)
        show(merged)
        return
      }
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(isApiError(caught) ? caught.message : 'Could not load more broadcasts')
    } finally {
      if (loadMoreRef.current === controller) {
        loadMoreRef.current = null
        setLoadingMore(false)
      }
    }
  }, [broadcastId, limit, query.category, query.q, query.signal, query.sort, query.state, query.window, queryKey, show])

  useEffect(() => {
    const cached = cache.get(queryKey)
    show(cached ?? null)
    setLoading(enabled && !cached)
    setLoadingMore(false)
    setError(null)
    setAnnouncement('')
    clearRetryBlock()
    setRetryScheduled(false)
    let active = true
    let timer: number | undefined
    let warmingRetries = 0
    // Each read is followed by at most one timer. A list polls, never sooner than
    // Retry-After; a detail read tries again only while its window warms.
    const next = (outcome?: LoadOutcome) => {
      if (!active || !enabled) return
      const wait = Math.max(0, retryNotBeforeRef.current - Date.now())
      if (pollMs > 0) {
        timer = window.setTimeout(poll, Math.max(pollMs, wait))
      } else if (outcome?.reason === 'snapshot_warming' && warmingRetries < EXPLORER_WARMING_RETRIES) {
        warmingRetries += 1
        setRetryScheduled(true)
        timer = window.setTimeout(() => {
          setRetryScheduled(false)
          void load().then(next)
        }, wait || WARMING_RETRY_FALLBACK_MS)
      }
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
  }, [clearRetryBlock, enabled, load, pollMs, queryKey, show])

  useEffect(() => () => window.clearTimeout(unblockTimerRef.current), [])

  const unavailable = useMemo(() => enabled && ((!loading && !data) || data?.status === 'unavailable'), [data, enabled, loading])
  const refresh = () => {
    // The server asked for a pause; the page offers no retry until it ends.
    if (Date.now() < retryNotBeforeRef.current) return
    void load()
  }
  // A polling list always reads again on its own; a detail read only while a warming retry is queued.
  const automatic = retryScheduled || (enabled && pollMs > 0)
  return { data, loading, refreshing, loadingMore, error, unavailable, announcement, retryBlocked, retryScheduled: automatic, refresh, loadMore }
}
