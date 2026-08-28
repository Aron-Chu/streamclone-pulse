import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isApiError } from '../lib/apiClient'
import {
  fetchNewsroom,
  normalizeNewsroomEnvelope,
  type NewsroomEnvelope,
  type NewsroomStory,
  type NewsroomWindow,
} from '../lib/newsroom'

export interface UseNewsroomDataOptions {
  window?: NewsroomWindow
  storyId?: string
  enabled?: boolean
  pollMs?: number
  limit?: number
}

export interface UseNewsroomDataResult {
  data: NewsroomEnvelope | null
  loading: boolean
  refreshing: boolean
  loadingMore: boolean
  error: string | null
  unavailable: boolean
  announcement: string
  refresh: () => void
  loadMore: () => void
}

const DEFAULT_POLL_MS = Number(import.meta.env.VITE_PUBLIC_HUB_POLL_MS ?? 45_000)

function storyMap(stories: NewsroomStory[]): Map<string, NewsroomStory> {
  return new Map(stories.map((story) => [story.id, story]))
}

function announcementFor(previous: Map<string, NewsroomStory>, next: NewsroomStory[]): string {
  for (const story of next) {
    const before = previous.get(story.id)
    if (!story.leadUpdate.notificationEligible || story.leadUpdate.isLate) continue
    if (!before) return `New Pulse story: ${story.headline}`
    if (story.revision > before.revision && story.lifecycle !== before.lifecycle) {
      return `${story.displayName || story.login} story is now ${story.lifecycle}.`
    }
  }
  return ''
}

function staleCopy(envelope: NewsroomEnvelope): NewsroomEnvelope {
  return envelope.status === 'unavailable'
    ? envelope
    : { ...envelope, status: 'stale', reason: 'refresh_unavailable' }
}

function mergePage(current: NewsroomEnvelope, page: NewsroomEnvelope): NewsroomEnvelope | null {
  if (current.snapshotAt !== page.snapshotAt || current.window !== page.window) return null
  if (current.story || page.story) {
    if (!current.story || !page.story || current.story.id !== page.story.id) return null
    const byId = new Map((current.updates ?? []).map((update) => [update.id, update]))
    for (const update of page.updates ?? []) byId.set(update.id, update)
    return {
      ...current,
      story: page.story,
      updates: [...byId.values()].sort(
        (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || b.id.localeCompare(a.id),
      ),
      nextCursor: page.nextCursor,
      generatedAt: page.generatedAt,
      dataThrough: page.dataThrough,
    }
  }
  const byId = new Map(current.stories.map((story) => [story.id, story]))
  for (const story of page.stories) byId.set(story.id, story)
  return {
    ...current,
    stories: [...byId.values()].sort(
      (a, b) => Date.parse(b.lastPublishedAt) - Date.parse(a.lastPublishedAt) || b.id.localeCompare(a.id),
    ),
    nextCursor: page.nextCursor,
    generatedAt: page.generatedAt,
    dataThrough: page.dataThrough,
  }
}

export function useNewsroomData(options: UseNewsroomDataOptions = {}): UseNewsroomDataResult {
  const {
    window: newsroomWindow = 'live',
    storyId,
    enabled = true,
    pollMs = storyId ? 0 : DEFAULT_POLL_MS,
    limit = storyId ? 25 : 20,
  } = options
  const queryKey = storyId?.trim() ? `story:${storyId.trim()}` : `window:${newsroomWindow}`
  const cacheRef = useRef(new Map<string, NewsroomEnvelope>())
  const baselineRef = useRef(new Map<string, NewsroomStory>())
  const baselinedKeyRef = useRef<string | null>(null)
  const recoveringKeysRef = useRef(new Set<string>())
  const controllerRef = useRef<AbortController | null>(null)
  const paginationControllerRef = useRef<AbortController | null>(null)
  const paginationSequenceRef = useRef(0)
  const activeQueryKeyRef = useRef(queryKey)
  activeQueryKeyRef.current = queryKey
  const mountedRef = useRef(true)
  const [data, setData] = useState<NewsroomEnvelope | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const requestSequenceRef = useRef(0)

  const applyEnvelope = useCallback((envelope: NewsroomEnvelope, key: string) => {
    const stories = envelope.story ? [envelope.story] : envelope.stories
    const recoveryBaseline = recoveringKeysRef.current.has(key) || envelope.status === 'stale' || envelope.status === 'unavailable'
    if (baselinedKeyRef.current !== key || recoveryBaseline) {
      baselineRef.current = storyMap(stories)
      baselinedKeyRef.current = key
      setAnnouncement('')
      if (envelope.status === 'stale' || envelope.status === 'unavailable') recoveringKeysRef.current.add(key)
      else recoveringKeysRef.current.delete(key)
    } else {
      setAnnouncement(announcementFor(baselineRef.current, stories))
      baselineRef.current = storyMap(stories)
    }
    if (envelope.status !== 'unavailable') cacheRef.current.set(key, envelope)
    setData(envelope)
    setError(null)
  }, [])

  const load = useCallback(async () => {
    if (!enabled) return
    const sequence = ++requestSequenceRef.current
    paginationSequenceRef.current += 1
    paginationControllerRef.current?.abort(new DOMException('superseded', 'AbortError'))
    setLoadingMore(false)
    controllerRef.current?.abort(new DOMException('superseded', 'AbortError'))
    const controller = new AbortController()
    controllerRef.current = controller
    const cached = cacheRef.current.get(queryKey)
    if (cached) {
      setData(cached)
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    try {
      const envelope = await fetchNewsroom({ window: newsroomWindow, storyId, limit, signal: controller.signal })
      if (!mountedRef.current || controller.signal.aborted || sequence !== requestSequenceRef.current) return
      applyEnvelope(envelope, queryKey)
    } catch (caught) {
      if (!mountedRef.current || controller.signal.aborted || (isApiError(caught) && caught.kind === 'aborted')) return
      const unavailableEnvelope = isApiError(caught)
        ? normalizeNewsroomEnvelope(caught.body)
        : null
      const previous = cacheRef.current.get(queryKey)
      if (previous) {
        recoveringKeysRef.current.add(queryKey)
        const stale = staleCopy(previous)
        setData(stale)
        setError(isApiError(caught) ? caught.message : caught instanceof Error ? caught.message : 'Newsroom refresh failed')
      } else if (unavailableEnvelope?.status === 'unavailable') {
        recoveringKeysRef.current.add(queryKey)
        setData(unavailableEnvelope)
        setError(unavailableEnvelope.reason ?? 'Newsroom unavailable')
      } else {
        setData(null)
        setError(
          isApiError(caught)
            ? caught.status === 404 && storyId
              ? 'Story not found'
              : caught.message
            : caught instanceof Error
              ? caught.message
              : 'Newsroom unavailable',
        )
      }
    } finally {
      if (mountedRef.current && sequence === requestSequenceRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [applyEnvelope, enabled, limit, newsroomWindow, queryKey, storyId])

  const refresh = useCallback(() => void load(), [load])

  const loadMore = useCallback(() => {
    if (!data?.nextCursor || loadingMore) return
    const cursor = data.nextCursor
    const source = data
    const key = queryKey
    const sequence = ++paginationSequenceRef.current
    paginationControllerRef.current?.abort(new DOMException('superseded', 'AbortError'))
    const controller = new AbortController()
    paginationControllerRef.current = controller
    setLoadingMore(true)
    void fetchNewsroom({ window: newsroomWindow, storyId, limit, cursor, signal: controller.signal })
      .then((page) => {
        if (
          !mountedRef.current || controller.signal.aborted || sequence !== paginationSequenceRef.current ||
          key !== activeQueryKeyRef.current
        ) return
        const merged = mergePage(source, page)
        if (!merged) {
          setError('Newsroom changed while loading more. Refresh to continue.')
          return
        }
        cacheRef.current.set(queryKey, merged)
        setData(merged)
      })
      .catch((caught) => {
        if (
          !mountedRef.current || controller.signal.aborted || sequence !== paginationSequenceRef.current ||
          key !== activeQueryKeyRef.current || (isApiError(caught) && caught.kind === 'aborted')
        ) return
        setError(isApiError(caught) ? caught.message : 'Could not load more stories')
      })
      .finally(() => {
        if (
          mountedRef.current && sequence === paginationSequenceRef.current &&
          key === activeQueryKeyRef.current
        ) setLoadingMore(false)
      })
  }, [data, limit, loadingMore, newsroomWindow, queryKey, storyId])

  useEffect(() => {
    mountedRef.current = true
    const cached = cacheRef.current.get(queryKey)
    setData(cached ?? null)
    setLoading(enabled && !cached)
    setError(null)
    setAnnouncement('')
    setLoadingMore(false)
    void load()
    let timer: number | undefined
    if (enabled && pollMs > 0) {
      timer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load()
      }, pollMs)
    }
    return () => {
      mountedRef.current = false
      controllerRef.current?.abort(new DOMException('unmounted', 'AbortError'))
      paginationSequenceRef.current += 1
      paginationControllerRef.current?.abort(new DOMException('unmounted', 'AbortError'))
      if (timer) window.clearInterval(timer)
    }
  }, [enabled, load, pollMs, queryKey])

  const unavailable = useMemo(
    () => (!loading && !data) || data?.status === 'unavailable',
    [data, loading],
  )

  return { data, loading, refreshing, loadingMore, error, unavailable, announcement, refresh, loadMore }
}
