import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDiscoveryCatalogue, type DiscoveryCatalogue, type DiscoveryScope } from '../lib/discoveryCatalogue'
import { uniqueDiscoveryMoments } from '../lib/discoveryMoments'
import { discoveryErrorMessage } from '../lib/discoveryError'
import { isApiError } from '../lib/apiClient'
import { appendRankedPage, fetchRankedDiscovery, type RankedDiscovery, type RankedScope } from '../lib/discoveryCatalogue'
import { fetchRankedAvailability, type RankedAvailability } from '../lib/discoveryAvailability'

const MAX_LOADED = 1000
const RETENTION_MAX_AGE_MS = 2 * 60 * 60 * 1000
const RETENTION_SAFETY_MS = 60 * 1000
const RETENTION_RECHECK_MS = 2 * 60 * 1000
/** A bounded server read provides certified date limits and calendar cells. */
export function useRankedRetention(enabled: boolean, login = '') {
  const localUTCDate = new Date().toISOString().slice(0, 10)
  const [attempt, setAttempt] = useState(0)
  const [manualVersion, setManualVersion] = useState(0)
  const lastVisibilityCheck = useRef(0)
  const key = JSON.stringify([enabled, localUTCDate, login, attempt, manualVersion])
  // A background recheck bumps `attempt` only. The retained lease stays current
  // meanwhile, so dependent ranked reads keep their loaded pages and scroll.
  const leaseKey = JSON.stringify([enabled, localUTCDate, login, manualVersion])
  const [state, setState] = useState<{ key: string; leaseKey: string; localUTCDate: string; login: string; manualVersion: number; availability?: RankedAvailability; expiresAt?: number; loading: boolean; error: string; errorKind?: 'not_deployed' }>({ key, leaseKey, localUTCDate, login, manualVersion, loading: enabled, error: '' })
  useEffect(() => {
    if (!enabled) return
    const request = new AbortController()
    setState(previous => previous.localUTCDate === localUTCDate && previous.login === login && previous.availability
      && previous.expiresAt && performance.now() < previous.expiresAt && !previous.error
      ? { ...previous, key, leaseKey, loading: true }
      : { key, leaseKey, localUTCDate, login, manualVersion, loading: true, error: '' })
    void Promise.resolve().then(async () => {
      if (request.signal.aborted) return
      const availability = await fetchRankedAvailability(login, request.signal)
      // The server clock defines UTC date and proof age. A monotonic countdown
      // expires the local lease before either the certificate or UTC day ends.
      const certificateRemaining = RETENTION_MAX_AGE_MS - (Date.parse(availability.asOf) - Date.parse(availability.verifiedAt)) - RETENTION_SAFETY_MS
      const midnightRemaining = Date.parse(availability.serverToday) + 86_400_000 - Date.parse(availability.asOf) - RETENTION_SAFETY_MS
      const remaining = Math.min(certificateRemaining, midnightRemaining)
      if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('The certified date range cannot be verified while the check expires.')
      if (!request.signal.aborted) setState({ key, leaseKey, localUTCDate, login, manualVersion, availability, expiresAt: performance.now() + remaining, loading: false, error: '' })
    }).catch(error => {
      if (request.signal.aborted) return
      const message = isApiError(error) && error.status === 404 ? 'Ranked history is not deployed on this server yet.'
        : isApiError(error) && error.status === 503 ? 'The certified date range is temporarily unavailable. Try again later.'
        : error instanceof Error && error.message.startsWith('The certified date range') ? error.message
        : 'The certified date range could not be verified. Try again later.'
      setState({ key, leaseKey, localUTCDate, login, manualVersion, loading: false, error: message,
        ...(isApiError(error) && error.status === 404 ? { errorKind: 'not_deployed' as const } : {}) })
    })
    return () => request.abort()
  }, [key, leaseKey, enabled, localUTCDate, login, manualVersion])
  useEffect(() => {
    if (!enabled || state.key !== key || !state.expiresAt) return
    const timer = setTimeout(() => {
      if (document.visibilityState === 'visible') setAttempt(value => value + 1)
      else setState(previous => ({ ...previous, availability: undefined, loading: false, error: 'The certified date check expired. Return to this tab to retry.' }))
    }, Math.max(0, state.expiresAt - performance.now()))
    return () => clearTimeout(timer)
  }, [enabled, key, state.expiresAt, state.key])
  useEffect(() => {
    if (!enabled) return
    const check = () => {
      if (document.visibilityState !== 'visible' || state.loading) return
      const hasLease = Boolean(state.availability && state.expiresAt && performance.now() < state.expiresAt && !state.error)
      if (performance.now() - lastVisibilityCheck.current < (hasLease ? 5_000 : 1_000)) return
      lastVisibilityCheck.current = performance.now()
      setAttempt(value => value + 1)
    }
    const interval = setInterval(check, RETENTION_RECHECK_MS)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
  }, [enabled, state.availability, state.error, state.expiresAt, state.loading])
  const pending = enabled && (state.key !== key || state.loading)
  const current = enabled && state.leaseKey === leaseKey && !state.error && Boolean(state.availability && state.expiresAt && performance.now() < state.expiresAt)
  return { from: current ? state.availability?.certifiedFrom : undefined,
    throughExclusive: current ? state.availability?.certifiedThroughExclusive : undefined,
    serverToday: current ? state.availability?.serverToday : undefined,
    asOf: current ? state.availability?.asOf : undefined,
    checkedAt: current ? state.availability?.verifiedAt : undefined,
    certificateGeneration: current ? state.availability?.certificateGeneration : undefined,
    days: current ? state.availability?.days : undefined,
    manualVersion: current ? state.manualVersion : 0,
    loading: pending && !current, rechecking: pending && current,
    error: enabled && state.key === key ? state.error : '',
    notDeployed: enabled && state.key === key && state.errorKind === 'not_deployed',
    refresh: () => setManualVersion(value => value + 1) }
}

export function useRankedDiscovery(enabled: boolean, scope: RankedScope | null, expectedRetentionStart?: string, refreshVersion = 0, expectedCertifiedThroughExclusive?: string, expectedCertificateGeneration?: number) {
  const key = JSON.stringify([enabled, scope, expectedRetentionStart, expectedCertifiedThroughExclusive, expectedCertificateGeneration, refreshVersion])
  const activeKey = useRef(key); activeKey.current = key
  const controller = useRef<AbortController>()
  const generation = useRef(0)
  const locked = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data?: RankedDiscovery; loading: boolean; error: string; seen: string[]; failed: boolean; truncated?: boolean }>({ key, loading: enabled, error: '', seen: [], failed: false })
  useEffect(() => {
    controller.current?.abort()
    const ticket = ++generation.current
    locked.current = false
    if (!enabled || !scope) return
    const request = new AbortController(); controller.current = request; locked.current = true
    setState(previous => ({ ...previous, key, loading: true, error: '', failed: false }))
    void fetchRankedDiscovery(scope, request.signal).then(data => {
      if (expectedRetentionStart && (data.indexedRetentionStart !== expectedRetentionStart || data.certifiedThroughExclusive !== expectedCertifiedThroughExclusive || data.certificateGeneration !== expectedCertificateGeneration)) throw new Error('Ranked response could not be verified. Reload the collection.')
      if (expectedRetentionStart && data.freshness !== 'ready') throw new Error('Ranked index delayed')
      if (!request.signal.aborted && ticket === generation.current && activeKey.current === key) {
        const truncated = data.items.length > MAX_LOADED
        setState({ key, data: truncated ? { ...data, items: data.items.slice(0, MAX_LOADED) } : data, truncated,
          loading: false, error: '', failed: false, seen: data.nextCursor ? [data.nextCursor] : [] })
      }
    }).catch(error => {
      if (!request.signal.aborted && ticket === generation.current && activeKey.current === key) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
        const message = isApiError(error) && error.status === 404 ? 'Ranked discovery is not deployed on this server (HTTP 404). Latest remains a separate, unranked live preview.'
          : isApiError(error) && error.status === 503 ? 'Ranked moments are temporarily unavailable (HTTP 503). This is not an empty result.'
          : code === 'discovery_out_of_retention' ? 'This range is outside indexed retention. Choose a later range.'
          : code === 'discovery_busy' || code === 'discovery_rate_limited' ? 'Ranked reads are busy. Wait a moment, then reload.'
          : error instanceof Error && error.message === 'Ranked response could not be verified. Reload the collection.' ? error.message
          : 'Ranked moments are unavailable. This is not an empty result.'
        const invalidated = isApiError(error) && error.status === 503 || code === 'discovery_out_of_retention'
          || error instanceof Error && (error.message === 'Ranked index delayed' || error.message === 'Ranked response could not be verified. Reload the collection.')
        setState(previous => ({ ...previous, key, data: invalidated ? undefined : previous.data, loading: false, failed: true, error: message }))
      }
    }).finally(() => { if (ticket === generation.current) locked.current = false })
    return () => { request.abort(); controller.current?.abort(); generation.current++ }
  }, [key, attempt])
  const loading = enabled && Boolean(scope) && (state.key !== key || state.loading)
  const data = enabled && (!expectedRetentionStart || state.data?.indexedRetentionStart === expectedRetentionStart
    && state.data.certifiedThroughExclusive === expectedCertifiedThroughExclusive && state.data.certificateGeneration === expectedCertificateGeneration) ? state.data : undefined
  const limited = Boolean(data && (state.truncated || (data.items.length >= MAX_LOADED && data.nextCursor)))
  const canLoad = enabled && Boolean(scope && state.key === key && data?.nextCursor && !state.failed && !loading && !limited)
  const loadMore = useCallback(async () => {
    if (!canLoad || locked.current || !scope || !state.data) return
    locked.current = true
    const previous = state.data, ticket = generation.current
    const request = new AbortController(); controller.current = request
    setState(s => ({ ...s, loading: true, error: '' }))
    try {
      const page = await fetchRankedDiscovery(scope, request.signal, previous.nextCursor!, previous.items.length + 1)
      if (expectedRetentionStart && (page.indexedRetentionStart !== expectedRetentionStart || page.certifiedThroughExclusive !== expectedCertifiedThroughExclusive || page.certificateGeneration !== expectedCertificateGeneration || page.freshness !== 'ready')) throw new Error('Retention boundary changed')
      if (request.signal.aborted || ticket !== generation.current || activeKey.current !== key) return
      if (page.nextCursor && state.seen.includes(page.nextCursor)) throw new Error('Repeated cursor')
      const data = appendRankedPage(previous, page)
      const truncated = data.items.length > MAX_LOADED
      setState({ key, data: truncated ? { ...data, items: data.items.slice(0, MAX_LOADED) } : data, truncated,
        loading: false, error: '', failed: false, seen: page.nextCursor ? [...state.seen, page.nextCursor] : state.seen })
    } catch (error) {
      if (!request.signal.aborted && ticket === generation.current && activeKey.current === key) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
        const invalidated = isApiError(error) && error.status === 503 || code === 'discovery_out_of_retention'
          || error instanceof Error && error.message === 'Retention boundary changed'
        setState(s => ({ ...s, data: invalidated ? undefined : s.data, loading: false, failed: true,
          error: invalidated ? 'The indexed range can no longer be verified. Reload the collection.'
            : 'Continuation failed. The loaded snapshot is retained. Reload the collection for a fresh snapshot.' }))
      }
    } finally { if (ticket === generation.current) locked.current = false }
  }, [canLoad, expectedRetentionStart, expectedCertifiedThroughExclusive, expectedCertificateGeneration, key, scope, state])
  return { data, loading, canLoad, limited, loadMore,
    error: enabled && state.key === key ? state.error : '', retained: Boolean(data && (loading || state.failed || state.key !== key)),
    refresh: () => { if (!locked.current) setAttempt(value => value + 1) } }
}

export function useDiscoveryCatalogue(enabled: boolean, scope: DiscoveryScope) {
  const key = JSON.stringify([enabled, scope.month, scope.creator, scope.day, scope.category ?? ''])
  const [state, setState] = useState<{ key: string; data?: DiscoveryCatalogue; loading: boolean; error: string; truncated?: boolean; seenCursors: string[] }>({ key, loading: enabled, error: '', seenCursors: [] })
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
    setState({ key, loading: true, error: '', seenCursors: [] })
    fetchDiscoveryCatalogue(scope, request.signal).then(data => {
      if (!request.signal.aborted && ticket === generation.current && key === activeKey.current) setState({ key, data, loading: false, error: '', seenCursors: data.nextCursor ? [data.nextCursor] : [] })
    }).catch(error => {
      if (!request.signal.aborted && ticket === generation.current && key === activeKey.current) setState({ key, loading: false, error: discoveryErrorMessage(error), seenCursors: [] })
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
    setState(previous => ({ ...previous, loading: true, error: '' }))
    try {
      const page = await fetchDiscoveryCatalogue(scope, request.signal, data.nextCursor)
      if (page.asOf !== data.asOf || page.nextCursor === data.nextCursor || (page.nextCursor && state.seenCursors.includes(page.nextCursor))) throw new Error('Pagination snapshot changed')
      if (!request.signal.aborted && ticket === generation.current && key === activeKey.current) {
        const items = uniqueDiscoveryMoments([...data.items, ...page.items])
        if (page.items.length > 0 && items.length === data.items.length) throw new Error('Pagination made no progress')
        setState({ key, loading: false, error: '', truncated: items.length > MAX_LOADED, seenCursors: page.nextCursor ? [...state.seenCursors, page.nextCursor] : state.seenCursors,
          data: { ...page, items: items.slice(0, MAX_LOADED) } })
      }
    } catch {
      if (!request.signal.aborted && ticket === generation.current && key === activeKey.current) setState(previous => ({ ...previous, loading: false, error: 'More results could not be loaded. Retry, or refresh this collection if its cursor has expired.' }))
    }
  }, [data, enabled, key, loading, scope, state.seenCursors])
  return { data, loading, loadMore, refresh: () => setAttempt(value => value + 1),
    error: state.key === key ? state.error : '', limited: Boolean(data && (state.truncated || (data.items.length >= MAX_LOADED && data.nextCursor))) }
}
