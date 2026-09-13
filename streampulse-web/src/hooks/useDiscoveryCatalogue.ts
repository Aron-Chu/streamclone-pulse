import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDiscoveryCatalogue, type DiscoveryCatalogue, type DiscoveryScope } from '../lib/discoveryCatalogue'
import { uniqueDiscoveryMoments } from '../lib/discoveryMoments'
import { discoveryErrorMessage } from '../lib/discoveryError'
import { isApiError } from '../lib/apiClient'
import { appendRankedPage, fetchRankedDiscovery, type RankedDiscovery, type RankedScope } from '../lib/discoveryCatalogue'

const MAX_LOADED = 1000
export function useRankedDiscovery(enabled: boolean, scope: RankedScope | null) {
  const key = JSON.stringify([enabled, scope])
  const activeKey = useRef(key); activeKey.current = key
  const controller = useRef<AbortController>()
  const generation = useRef(0)
  const locked = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data?: RankedDiscovery; loading: boolean; error: string; seen: string[]; failed: boolean }>({ key, loading: enabled, error: '', seen: [], failed: false })
  useEffect(() => {
    controller.current?.abort()
    const ticket = ++generation.current
    locked.current = false
    if (!enabled || !scope) return
    const request = new AbortController(); controller.current = request; locked.current = true
    setState(previous => ({ ...previous, key, loading: true, error: '', failed: false }))
    void fetchRankedDiscovery(scope, request.signal).then(data => {
      if (!request.signal.aborted && ticket === generation.current && activeKey.current === key)
        setState({ key, data, loading: false, error: '', failed: false, seen: data.nextCursor ? [data.nextCursor] : [] })
    }).catch(error => {
      if (!request.signal.aborted && ticket === generation.current && activeKey.current === key) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
        const message = isApiError(error) && error.status === 404 ? 'Ranked Explore is not deployed on this server (HTTP 404). Latest remains a separate, unranked live preview.'
          : isApiError(error) && error.status === 503 ? 'Ranked moments are temporarily unavailable (HTTP 503). This is not an empty result.'
          : code === 'discovery_out_of_retention' ? 'This range is outside indexed retention. Choose a later range.'
          : code === 'discovery_busy' || code === 'discovery_rate_limited' ? 'Ranked reads are busy. Wait a moment, then reload.'
          : error instanceof Error && error.message === 'Ranked response could not be verified. Reload the collection.' ? error.message
          : 'Ranked moments are unavailable. This is not an empty result.'
        setState(previous => ({ ...previous, key, loading: false, failed: true, error: message }))
      }
    }).finally(() => { if (ticket === generation.current) locked.current = false })
    return () => { request.abort(); controller.current?.abort(); generation.current++ }
  }, [key, attempt])
  const loading = enabled && Boolean(scope) && (state.key !== key || state.loading)
  const canLoad = enabled && Boolean(scope && state.key === key && state.data?.nextCursor && !state.failed && !loading)
  const loadMore = useCallback(async () => {
    if (!canLoad || locked.current || !scope || !state.data) return
    locked.current = true
    const previous = state.data, ticket = generation.current
    const request = new AbortController(); controller.current = request
    setState(s => ({ ...s, loading: true, error: '' }))
    try {
      const page = await fetchRankedDiscovery(scope, request.signal, previous.nextCursor!, previous.items.length + 1)
      if (request.signal.aborted || ticket !== generation.current || activeKey.current !== key) return
      if (page.nextCursor && state.seen.includes(page.nextCursor)) throw new Error('Repeated cursor')
      const data = appendRankedPage(previous, page)
      setState({ key, data, loading: false, error: '', failed: false, seen: page.nextCursor ? [...state.seen, page.nextCursor] : state.seen })
    } catch {
      if (!request.signal.aborted && ticket === generation.current && activeKey.current === key)
        setState(s => ({ ...s, loading: false, failed: true, error: 'Continuation failed. The loaded snapshot is retained. Reload the collection for a fresh snapshot.' }))
    } finally { if (ticket === generation.current) locked.current = false }
  }, [canLoad, key, scope, state])
  return { data: enabled ? state.data : undefined, loading, canLoad, loadMore,
    error: enabled && state.key === key ? state.error : '', retained: Boolean(state.data && (loading || state.failed || state.key !== key)),
    refresh: () => { if (!locked.current) setAttempt(value => value + 1) } }
}

export function useDiscoveryCatalogue(enabled: boolean, scope: DiscoveryScope) {
  const key = JSON.stringify([enabled, scope.month, scope.creator, scope.day, scope.category ?? ''])
  const [state, setState] = useState<{ key: string; data?: DiscoveryCatalogue; loading: boolean; error: string; unsupported: boolean; truncated?: boolean; seenCursors: string[] }>({ key, loading: enabled, error: '', unsupported: false, seenCursors: [] })
  const controller = useRef<AbortController>()
  const generation = useRef(0)
  const activeKey = useRef(key)
  activeKey.current = key
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    controller.current?.abort()
    const ticket = ++generation.current
    if (!enabled) return
    const request = new AbortController(); controller.current = request
    setState({ key, loading: true, error: '', unsupported: false, seenCursors: [] })
    fetchDiscoveryCatalogue(scope, request.signal).then(data => {
      if (!request.signal.aborted && ticket === generation.current && key === activeKey.current) setState({ key, data, loading: false, error: '', unsupported: false, seenCursors: data.nextCursor ? [data.nextCursor] : [] })
    }).catch(error => {
      if (!request.signal.aborted && ticket === generation.current && key === activeKey.current) {
        const unsupported = isApiError(error) && error.status === 404
        setState({ key, loading: false, error: unsupported ? '' : 'Stored activity could not be loaded. Your recent feed and saved moments are unchanged.', unsupported, seenCursors: [] })
      }
    })
    return () => { request.abort(); controller.current?.abort(); generation.current++ }
    // Scope fields are encoded in key; selection of a moment does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])
  const data = state.key === key ? state.data : undefined
  const loading = enabled && (state.key !== key || state.loading)
  const loadMore = useCallback(async () => {
    if (!enabled || loading || !data?.nextCursor || data.items.length >= MAX_LOADED) return
    const ticket = generation.current
    const request = new AbortController(); controller.current?.abort(); controller.current = request
    setState(previous => ({ ...previous, loading: true, error: '', unsupported: false }))
    try {
      const page = await fetchDiscoveryCatalogue(scope, request.signal, data.nextCursor)
      if (page.asOf !== data.asOf || page.nextCursor === data.nextCursor || (page.nextCursor && state.seenCursors.includes(page.nextCursor))) throw new Error('Pagination snapshot changed')
      if (!request.signal.aborted && ticket === generation.current && key === activeKey.current) {
        const items = uniqueDiscoveryMoments([...data.items, ...page.items])
        if (page.items.length > 0 && items.length === data.items.length) throw new Error('Pagination made no progress')
        setState({ key, loading: false, error: '', unsupported: false, truncated: items.length > MAX_LOADED, seenCursors: page.nextCursor ? [...state.seenCursors, page.nextCursor] : state.seenCursors,
          data: { ...page, items: items.slice(0, MAX_LOADED) } })
      }
    } catch {
      if (!request.signal.aborted && ticket === generation.current && key === activeKey.current) setState(previous => ({ ...previous, loading: false, error: 'More results could not be loaded. Retry, or refresh this collection if its cursor has expired.' }))
    }
  }, [data, enabled, key, loading, scope, state.seenCursors])
  return { data, loading, loadMore, refresh: () => setAttempt(value => value + 1),
    error: state.key === key ? state.error : '', unsupported: state.key === key && state.unsupported,
    limited: Boolean(data && (state.truncated || (data.items.length >= MAX_LOADED && data.nextCursor))) }
}
