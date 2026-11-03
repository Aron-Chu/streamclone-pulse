import { useCallback, useEffect, useRef, useState } from 'react'
import {
  NATIVE_CLIPS_SEARCH_MAX, clipsNotOn, loadNativeClips, nativeClipsSearch,
  type NativeClip, type NativeClipsPage, type NativeClipsPeriod, type NativeClipsQuery, type NativeClipsSort,
} from './nativeClips'

/**
 * The clip lists this tab has read, so Back from a clip's page returns to the
 * grid as it was (the clips already loaded) and Up next can carry on through
 * the same list. Kept in memory only, for a few minutes.
 */
export type ClipListQuery = Omit<NativeClipsQuery, 'cursor'>
interface Cached { page: NativeClipsPage; items: NativeClip[]; at: number }

const KEEP_MS = 5 * 60_000
const KEEP_LISTS = 8
const cache = new Map<string, Cached>()

export const clipListKey = (query: ClipListQuery) => nativeClipsSearch(query)

/** The list a key names, so a clip's page can read it again once it has left memory. null: not a list key. */
export function clipListQueryFromKey(key: string): ClipListQuery | null {
  const params = new URLSearchParams(key)
  const period = params.get('period') as NativeClipsPeriod
  const sort = params.get('sort') as NativeClipsSort
  if (!['24h', '7d', '30d'].includes(period) || !['newest', 'views', 'reaction'].includes(sort)) return null
  const game = params.get('game')
  const channel = params.get('channel')
  const limit = Number(params.get('limit'))
  return {
    period, sort, mix: params.get('mix') !== '0',
    ...(game && /^[0-9]{1,20}$/.test(game) ? { game } : {}),
    ...(channel && /^[a-z0-9_]{1,25}$/.test(channel) ? { channel } : {}),
    ...(params.get('q') ? { q: params.get('q')!.slice(0, NATIVE_CLIPS_SEARCH_MAX) } : {}),
    ...(limit >= 1 && limit <= 48 ? { limit } : {}),
  }
}

function cached(key: string): Cached | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > KEEP_MS) { cache.delete(key); return null }
  return entry
}

function remember(key: string, page: NativeClipsPage, items: NativeClip[]) {
  cache.delete(key)
  cache.set(key, { page, items, at: Date.now() })
  while (cache.size > KEEP_LISTS) cache.delete(cache.keys().next().value!)
}

/** The clips a remembered list holds, in order, or null. */
export function cachedClipList(key: string): NativeClip[] | null {
  return cached(key)?.items ?? null
}

/** A clip from any remembered list, so its page opens without a fresh read. */
export function cachedClip(id: string): NativeClip | null {
  for (const entry of cache.values()) {
    const clip = entry.items.find(item => item.id === id)
    if (clip) return clip
  }
  return null
}

export function resetClipListsForTests() {
  cache.clear()
}

interface ListState {
  key: string
  page: NativeClipsPage | null
  items: NativeClip[]
  loading: boolean
  error: 'off' | 'failed' | null
  more: 'idle' | 'loading' | 'failed'
}

function startState(key: string): ListState {
  const hit = cached(key)
  return hit ? { key, page: hit.page, items: hit.items, loading: false, error: null, more: 'idle' }
    : { key: '', page: null, items: [], loading: true, error: null, more: 'idle' }
}

/**
 * One list: a first page, then more on request. A list read in the last few
 * minutes comes back from memory without asking again. Nothing refreshes on
 * its own.
 */
export function useClipList(query: ClipListQuery, enabled: boolean, attempt: number) {
  const key = clipListKey(query)
  const latest = useRef(query)
  latest.current = query
  const [state, setState] = useState<ListState>(() => startState(key))
  const moreRead = useRef<AbortController | null>(null)
  const firstAttempt = useRef(attempt)
  useEffect(() => {
    if (!enabled) return
    // A remembered list is shown as it was; Try again always reads afresh.
    if (attempt === firstAttempt.current && cached(key)) {
      setState(s => (s.key === key ? s : startState(key)))
      return
    }
    const controller = new AbortController()
    moreRead.current?.abort()
    setState(s => ({ ...s, loading: true, error: null, more: 'idle' }))
    loadNativeClips(latest.current, controller.signal).then(
      page => {
        if (controller.signal.aborted) return
        remember(key, page, page.items)
        setState({ key, page, items: page.items, loading: false, error: null, more: 'idle' })
      },
      error => { if (!controller.signal.aborted) setState(s => ({ ...s, key, loading: false, error: clipsNotOn(error) ? 'off' : 'failed' })) },
    )
    return () => controller.abort()
  }, [key, enabled, attempt])
  useEffect(() => () => moreRead.current?.abort(), [])
  const loadMore = useCallback(() => {
    const cursor = state.page?.nextCursor
    if (!cursor || state.more === 'loading' || state.key !== key) return
    const controller = new AbortController()
    moreRead.current?.abort()
    moreRead.current = controller
    setState(s => ({ ...s, more: 'loading' }))
    loadNativeClips({ ...latest.current, cursor }, controller.signal).then(
      page => {
        if (controller.signal.aborted) return
        // The library may have been rebuilt between pages; a clip already shown stays where it is.
        setState(s => {
          if (s.key !== key) return s
          const seen = new Set(s.items.map(clip => clip.id))
          const items = [...s.items, ...page.items.filter(clip => !seen.has(clip.id))]
          remember(key, page, items)
          return { ...s, page, items, more: 'idle' }
        })
      },
      () => { if (!controller.signal.aborted) setState(s => (s.key === key ? { ...s, more: 'failed' } : s)) },
    )
  }, [key, state.key, state.more, state.page?.nextCursor])
  return { ...state, key, current: state.key === key, loadMore }
}
