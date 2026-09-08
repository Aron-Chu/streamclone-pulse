import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDiscoveryCatalogue, type DiscoveryCatalogue, type DiscoveryScope } from '../lib/discoveryCatalogue'
import { uniqueDiscoveryMoments } from '../lib/discoveryMoments'
import { isApiError } from '../lib/momentsApiClient'

const MAX_LOADED = 1000
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
