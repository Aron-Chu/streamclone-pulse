import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnalyticsFigmaShell } from '../../analytics/AnalyticsFigmaShell'
import { isApiError } from '../../../../lib/apiClient'
import {
  appendMomentsFeed, isMomentsFeedItem, loadMomentsFeed, loadMomentsFeedItem, loadMomentsFeedRest, mergeMomentsFeed, momentsFeedIdFromLegacy,
  momentsFeedIdParts, MOMENTS_WINDOW_MS, pollMomentsFeed, type MomentMetricKind, type MomentsFeedCategoryFacet, type MomentsFeedItem, type MomentsFeedSnapshot,
} from '../../../../lib/momentsFeed'
import { momentsGameLabel, momentsGames } from '../../../../lib/momentsGames'
import {
  actOf, ariaOf, avatarImage, boxArtImage, checkMoment, clk, fx, groupsOf, liveFrameImage, openedWhen, SORTS, STALE_MS,
  streamTime, streamWhere, topBursts, updatedText, when, whenShort, type CheckedMoment,
} from '../../../../lib/momentsChecked'
import { loadMomentVod, momentVodCache } from '../../../../lib/momentsFeedVod'
import { toggleSavedMoment, useSavedMoments, type SavedMoment } from '../../../../lib/savedDiscoveryMoments'
import { useAccountSession } from '../../../../lib/accountSession'
import { replayHref } from '../../../../lib/accountMoments'
import { clearViewed, readViewed, recordViewed, VIEWED_DAYS, type ViewedMoment } from '../../../../lib/viewedMoments'
import { fromHubMoment } from '../../../../lib/discoveryMoments'
import { broadcastTimelineHref } from '../../../../lib/momentsNavigation'
import { headerClear, watchHeaderClear } from './headerClear'
import { MomentDetail } from './MomentDetail'
import { MomentAct } from './MomentAct'
import { MomentsGameRow } from './MomentsGameRow'
import { ReplayGlyph, SearchGlyph } from './glyphs'
import './moments-checked.css'

/** Polls bring the newest page every 45 s (the feed's demo cadence; its edge cache holds a page for 30 s). */
const POLL_MS = 45_000
const SAVED_KEY = 'sp-moments-checked-saved'
const SAVED_MAX = 200
/**
 * Latest: the moments that hold up or partly do, newest first (moments-r4 B2: no verdict tiers, filters or orders). Saved: this browser's.
 * Viewed: the moments you opened here, newest opened first, one row each (V1, 10-21).
 * Top (T1, 10-22): the moments that hold up, strongest first by the feed's score, one row per burst, not grouped by stream.
 * The tabs are Latest, Top and Saved; Viewed is Saved's other half, behind a switch (M1, 10-22). The window's games sit
 * over them as big covers, and one picks the game every list shows (?game=; B2's Games tab until M1).
 */
type MomentsTab = 'latest' | 'top' | 'saved' | 'viewed'
const TABS: readonly MomentsTab[] = ['latest', 'top', 'saved', 'viewed']
const HOURS = MOMENTS_WINDOW_MS / 3_600_000

function useMatch(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== 'function') return () => undefined
      const mq = window.matchMedia(query)
      mq.addEventListener?.('change', onChange)
      return () => mq.removeEventListener?.('change', onChange)
    },
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  )
}

/**
 * Whether a moment is saved comes from the site's one save list (channel,
 * stream, second), which signed in is the account's. This page also keeps a
 * whole copy of each moment saved here, so one can still be drawn after it
 * leaves the 12-hour feed.
 */
const savedKey = (item: MomentsFeedItem) => JSON.stringify([item.login, item.streamId, item.offsetSeconds])
function readSaved(): Map<string, MomentsFeedItem> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(SAVED_KEY) || '[]')
    return new Map((Array.isArray(raw) ? raw : []).filter(isMomentsFeedItem).map(item => [item.id, item]))
  } catch {
    return new Map()
  }
}
function writeSaved(saved: Map<string, MomentsFeedItem>) {
  try { window.localStorage.setItem(SAVED_KEY, JSON.stringify([...saved.values()].slice(-SAVED_MAX))) } catch { /* private window: this visit only */ }
}

const ini = (name: string) => name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'

/**
 * /analytics/moments behind VITE_PUBLIC_MOMENTS_FEED (design: moments-r2,
 * 2026-10-16, laid out as moments-r4 B2, 2026-10-21: the list with a picture
 * per row, the open moment beside it from 900 px). Reads /v1/public/moments; every verdict, check and baseline is
 * the backend's. The list draws from the feed's first page while the rest load
 * behind it. When the feed is not there (404 while the backend flag is off, or
 * an older feed), the page is the current one, unchanged. A first page that
 * fails otherwise (an outage) says so here, with Try again, and keeps ?m=.
 */
export default function MomentsCheckedPage({ fallback }: { fallback: ReactNode }) {
  const [state, setState] = useState<{ status: 'loading' } | ({ status: 'ready' } & Initial) | { status: 'off' } | { status: 'failed' }>({ status: 'loading' })
  const [tries, setTries] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const readAt = Date.now()
    loadMomentsFeed(readAt, controller.signal).then(
      snap => setState({ status: 'ready', snap, at: Date.now(), readAt }),
      error => {
        if (controller.signal.aborted) return
        setState({ status: isApiError(error) && (error.status === 404 || error.code === 'schema') ? 'off' : 'failed' })
      })
    return () => controller.abort()
  }, [tries])
  if (state.status === 'off') return <>{fallback}</>
  const retry = () => { setState({ status: 'loading' }); setTries(n => n + 1) }
  return <AnalyticsFigmaShell hideSidebar>
    <CheckedMoments key={state.status} initial={state.status === 'ready' ? state : null} onRetry={state.status === 'failed' ? retry : undefined} />
  </AnalyticsFigmaShell>
}

/** The first page, when it came, and the time its read asked from (the later pages ask the same). */
interface Initial { snap: MomentsFeedSnapshot; at: number; readAt: number }

function CheckedMoments({ initial, onRetry }: { initial: Initial | null; onRetry?: () => void }) {
  const wide = useMatch('(min-width: 900px)')
  const phone = useMatch('(max-width: 719px)')
  const motion = !useMatch('(prefers-reduced-motion: reduce)')
  const loaded = initial != null

  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  const deepId = query.get('m') ?? momentsFeedIdFromLegacy(query.get('login'), query.get('stream'), query.get('offset'))
  const [items, setItems] = useState<MomentsFeedItem[]>(() => initial?.snap.items ?? [])
  const [loadedAt, setLoadedAt] = useState(() => initial?.at ?? Date.now())
  const [feedStale, setFeedStale] = useState(() => initial?.snap.stale ?? false)
  /** A deep link to a moment the first page did not bring: looked up by id; until it answers, no other moment opens. */
  const [deepWait, setDeepWait] = useState<'no' | 'pending' | 'gone' | 'failed'>(() => (initial && deepId && !initial.snap.items.some(item => item.id === deepId) ? 'pending' : 'no'))
  const [view, setViewState] = useState<MomentsTab>(() => TABS.find(t => t === query.get('view')) ?? 'latest')
  const [viewed, setViewed] = useState<ViewedMoment[]>(() => readViewed())
  /** Viewed's order, taken when the tab opens, so opening a row there doesn't move it under the pointer. */
  const [viewedOrder, setViewedOrder] = useState<string[]>(() => viewed.map(e => e.item.id))
  const [q, setQ] = useState('')
  /** The picked game's category id: every list shows only its moments. */
  const [game, setGame] = useState<string | null>(() => { const id = query.get('game'); return id && /^\d{1,20}$/.test(id) ? id : null })
  /** The feed's games, for each one's live channels (first page, then each poll). */
  const [cats, setCats] = useState<MomentsFeedCategoryFacet[] | null>(() => initial?.snap.categories ?? null)
  const [sel, setSel] = useState<string | null>(() => (deepId && initial?.snap.items.some(item => item.id === deepId) ? deepId : null))
  const [opened, setOpened] = useState<{ key: string | null; lk: number | null; metric: MomentMetricKind | null }>({ key: null, lk: null, metric: null })
  const [moreAll, setMoreAll] = useState<string | null>(null)
  const [drawn, setDrawn] = useState(readSaved)
  const savedItems = useSavedMoments().items
  const signedOut = useAccountSession().status === 'signed_out'
  /** Saves whose lookup the feed answered with nothing: gone from it (Unavailable saves C, 10-22). */
  const [goneIds, setGoneIds] = useState<ReadonlySet<string>>(() => new Set())
  const savedKeys = useMemo(() => new Set(savedItems.map(item => item.key)), [savedItems])
  const isSaved = (item: MomentsFeedItem) => savedKeys.has(savedKey(item))
  /** Moments a poll brought while the pointer or focus was in the list: they wait behind the pill. */
  const [held, setHeld] = useState<Set<string>>(() => new Set())
  /** Moments that just arrived: they slide in once. */
  const [arrived, setArrived] = useState<Set<string>>(() => new Set())
  const [replay, setReplay] = useState<{ vnow: number; end: number } | null>(null)
  /** During a replay, moments after this time are not shown yet. */
  const [shownUntil, setShownUntil] = useState<number | null>(null)
  const [clock, setClock] = useState(() => Date.now())
  const [said, setSaid] = useState('')

  const mainRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const listWrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const playRef = useRef<((rel: number | null) => void) | null>(null)
  const holding = useRef(false)
  const flipFrom = useRef<Map<string, number> | null>(null)
  const keep = useRef<{ key: string; y0: number } | null>(null)
  const focusAfter = useRef<{ row?: string; scrollTo?: string } | null>(deepId && sel ? { scrollTo: deepId } : null)
  const vods = useMemo(() => momentVodCache(item => loadMomentVod(item, new AbortController().signal)), [])

  const now = replay ? replay.vnow : clock
  const nowMinute = Math.floor(now / 60_000) * 60_000
  const pool = useMemo(() => items.map(item => checkMoment(item, nowMinute)), [items, nowMinute])
  const byKey = useMemo(() => new Map(pool.map(m => [m.key, m])), [pool])
  // a saved moment that has left the feed: shown under Saved only, as an ended stream
  const savedOnly = useMemo(() => [...drawn.values()].filter(item => !byKey.has(item.id) && savedKeys.has(savedKey(item))).map(item => checkMoment({ ...item, streamLive: false }, nowMinute)),
    [drawn, savedKeys, byKey, nowMinute])
  // a save the feed can't find (gone from it, or never a feed moment): a plain row under Saved, counted there
  const goneSaves = useMemo(() => {
    if (!loaded) return []
    const held = new Set([...pool.map(m => savedKey(m.item)), ...[...drawn.values()].map(savedKey)])
    return savedItems.filter(s => {
      if (held.has(s.key)) return false
      const id = momentsFeedIdFromLegacy(s.login, s.streamId, String(s.offsetSeconds))
      return id == null || goneIds.has(id)
    })
  }, [loaded, pool, drawn, savedItems, goneIds])
  const savedCount = pool.filter(m => isSaved(m.item)).length + savedOnly.length + goneSaves.length
  const openedAt = useMemo(() => new Map(viewed.map(e => [e.item.id, e.at])), [viewed])
  // a viewed moment that has left the feed: drawn from its kept copy, as an ended stream
  const viewedOnly = useMemo(() => viewed.filter(e => !byKey.has(e.item.id)).map(e => checkMoment({ ...e.item, streamLive: false }, nowMinute)),
    [viewed, byKey, nowMinute])
  const find = (key: string) => byKey.get(key) ?? savedOnly.find(m => m.key === key) ?? viewedOnly.find(m => m.key === key) ?? null
  const setView = (next: MomentsTab) => {
    if (next === 'viewed') setViewedOrder(viewed.map(e => e.item.id))
    if (next !== 'latest' && replay) stopReplay(false) // the replay plays Latest in time order
    setViewState(next)
  }
  const games = useMemo(() => momentsGames(pool, cats), [pool, cats])
  /** "All games": every moment Latest can show, with a game or without. */
  const allCount = useMemo(() => pool.filter(m => m.item.verdict !== 'bad').length, [pool])
  const gameLabel = game ? momentsGameLabel(game, [...pool, ...savedOnly, ...viewedOnly], cats) : null
  /** An open you asked for (a click, a key, a link) goes to the top of Viewed. The wide layout's first moment doesn't count. */
  const noteViewed = (item: MomentsFeedItem) => setViewed(recordViewed(item))

  const qq = q.trim().toLowerCase()
  // Latest leaves out what didn't hold up, except the open moment (a deep link, or a held minute's "a moment here").
  // Top keeps only the moments that hold up and rose (those with a ×).
  const passes = (m: CheckedMoment) =>
    (view === 'saved' ? isSaved(m.item) : view === 'viewed' ? openedAt.has(m.key) : view === 'top' ? m.rowX != null : m.item.verdict !== 'bad' || m.key === sel)
    && (!qq || m.find.includes(qq)) && (!game || m.item.category?.id === game)
  const shown = (m: CheckedMoment) => (shownUntil == null || m.at <= shownUntil) && !held.has(m.key)
  const viewedRank = new Map(viewedOrder.map((id, i) => [id, i]))
  const byViewed = (a: CheckedMoment, b: CheckedMoment) => (viewedRank.get(a.key) ?? -1) - (viewedRank.get(b.key) ?? -1) // opened since the tab opened: on top
  const list = view === 'viewed'
    ? [...pool, ...viewedOnly].filter(m => shown(m) && passes(m)).sort(byViewed)
    : view === 'top' ? topBursts(pool.filter(m => shown(m) && passes(m)))
      : [...pool, ...(view === 'saved' ? savedOnly : [])].filter(m => shown(m) && passes(m)).sort(SORTS.new)
  const goneRows = view !== 'saved' ? [] : goneSaves.filter(s => (!qq || `${s.login} ${s.displayName ?? ''} ${s.label} ${s.category ?? ''}`.toLowerCase().includes(qq))
    && (!game || s.categoryId === game))
  const flat = view === 'viewed' || view === 'top'
  // one row a stream, its newest; the stream's other moments are in the open moment (M1, 10-22)
  const groups = flat ? list.map(m => [m]) : groupsOf(list)
  /** Each moment's row: its stream's newest. */
  const leadOf = new Map(groups.flatMap(g => g.map(m => [m.key, g[0].key] as const)))
  const selKey = sel != null && list.some(m => m.key === sel) ? sel : wide && list[0] && deepWait === 'no' ? list[0].key : null
  const selM = selKey ? find(selKey) : null
  const lk = opened.key === selKey ? opened.lk : null
  const metric = opened.key === selKey ? opened.metric : null
  const pillN = [...held].filter(key => { const m = byKey.get(key); return m != null && passes(m) }).length

  const latest = useRef({ items, held, replay, selKey, passes, pool })
  latest.current = { items, held, replay, selKey, passes, pool }

  const say = (text: string) => { setSaid(''); window.setTimeout(() => setSaid(text), 30) }
  const rowEl = (key: string) => byData(listRef.current, '.mk-r', 'key', leadOf.get(key) ?? key)
  /** The clicked row stays where it was while things open and close around it. */
  const keepPut = (key: string) => {
    const el = key ? rowEl(key) : null
    keep.current = el ? { key, y0: el.getBoundingClientRect().top } : null
  }
  const captureFlip = () => {
    const tops = new Map<string, number>()
    for (const li of listRef.current?.querySelectorAll<HTMLElement>(':scope > li.mk-g') ?? []) tops.set(li.dataset.sid ?? '', li.getBoundingClientRect().top)
    flipFrom.current = tops
  }
  const writeParam = (name: string, value: string | null) => {
    try {
      const url = new URL(window.location.href)
      if (value) url.searchParams.set(name, value)
      else url.searchParams.delete(name)
      window.history.replaceState(window.history.state, '', url)
    } catch { /* no history */ }
  }
  /** A cover: that game in every list; All (null) every game. */
  const pickGame = (id: string | null) => {
    setGame(id)
    writeParam('game', id)
    say(id ? `Showing ${momentsGameLabel(id, pool, cats)?.name ?? 'one game'}` : 'Showing every game')
  }
  const writeUrl = (key: string | null) => {
    try {
      const url = new URL(window.location.href)
      for (const legacy of ['login', 'stream', 'offset', 'moment']) url.searchParams.delete(legacy)
      if (key) url.searchParams.set('m', key)
      else url.searchParams.delete('m')
      window.history.replaceState(window.history.state, '', url)
    } catch { /* no history */ }
  }

  const select = (key: string | null, o: { keep?: boolean; focus?: boolean; from?: string } = {}) => {
    const next = !wide && key != null && selKey === key && !o.keep ? null : key // narrow: a second click closes it
    keepPut(next ?? o.from ?? '')
    setDeepWait(w => (w === 'pending' ? w : 'no'))
    setSel(next)
    setOpened({ key: next, lk: null, metric: null })
    writeUrl(next)
    if (o.focus && next) focusAfter.current = { row: next }
    const m = next ? find(next) : null
    if (m) { say(ariaOf(m, now)); noteViewed(m.item) }
  }
  const openFromDetail = (key: string) => {
    if (find(key)) select(key, { keep: true, focus: true })
  }
  const closeDetail = () => {
    const key = selKey
    keepPut(key ?? '')
    setSel(null)
    writeUrl(null)
    if (key) focusAfter.current = { row: key }
  }
  const toggleSave = (key: string) => {
    const m = find(key)
    if (!m) return
    const moment = fromHubMoment({ login: m.item.login, streamId: m.item.streamId, offsetSeconds: m.item.offsetSeconds, at: m.item.minuteStart,
      label: momentLabel(m.item.label.text), displayName: m.item.displayName, category: m.item.category?.name })
    if (!moment) return
    const wasSaved = isSaved(m.item)
    toggleSavedMoment(moment)
    const next = new Map(drawn)
    if (wasSaved) next.delete(m.item.id)
    else next.set(m.item.id, m.item)
    setDrawn(next)
    writeSaved(next)
    say(wasSaved ? 'Removed from Saved' : 'Saved')
  }
  const copyLink = async (key: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('m', key)
    try { await navigator.clipboard.writeText(url.href) } catch { /* the button still says Copied, as the mockup does */ }
  }
  const ping = () => {
    const dot = dotRef.current
    if (!motion || !dot) return
    dot.classList.remove('ping')
    void dot.offsetWidth
    dot.classList.add('ping')
  }
  /** Rows a poll brought: with the top of the list on screen they slide in and the rest glide down; further down, the rows you are looking at stay put. */
  const arrive = (keys: string[]) => {
    setArrived(new Set(keys))
    if ((listWrapRef.current?.getBoundingClientRect().top ?? 0) >= 0) captureFlip()
    else keepPut(latest.current.selKey ?? '')
  }
  const release = (jump: boolean) => {
    const keys = [...latest.current.held]
    setHeld(new Set())
    const r = latest.current.replay
    setShownUntil(r ? r.vnow : null)
    if (jump) {
      setArrived(new Set(keys))
      captureFlip()
      listWrapRef.current?.scrollIntoView({ block: 'start', behavior: motion ? 'smooth' : 'auto' })
    } else arrive(keys)
  }
  const setHolding = (on: boolean) => {
    holding.current = on
    if (!on && (latest.current.held.size || (latest.current.replay == null && shownUntil != null))) release(false)
  }

  // a deep link the first page brought counts as opened
  useEffect(() => {
    const m = sel ? byKey.get(sel) : null
    if (m && sel === deepId) noteViewed(m.item)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a deep link to a moment the first page did not bring: one lookup by id
  useEffect(() => {
    if (deepWait !== 'pending' || !deepId) return
    const controller = new AbortController()
    loadMomentsFeedItem(deepId, controller.signal).then(item => {
      if (!item) { setDeepWait('gone'); return }
      setItems(prev => (prev.some(x => x.id === item.id) ? prev : [...prev, item]))
      setSel(item.id)
      noteViewed(item)
      setDeepWait('no')
      focusAfter.current = { scrollTo: item.id }
    }, () => { if (!controller.signal.aborted) setDeepWait('failed') })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a save this page holds no copy of (made signed in elsewhere, or before the feed's window): one lookup by id each, one at a time
  const lookedUp = useRef(new Set<string>())
  useEffect(() => {
    if (!loaded) return
    const held = new Set([...pool.map(m => savedKey(m.item)), ...[...drawn.values()].map(savedKey)])
    const ids = savedItems.filter(s => !held.has(s.key))
      .map(s => momentsFeedIdFromLegacy(s.login, s.streamId, String(s.offsetSeconds)))
      .filter((id): id is string => id != null && !lookedUp.current.has(id))
      .slice(0, SAVED_MAX)
    if (!ids.length) return
    ids.forEach(id => lookedUp.current.add(id))
    const controller = new AbortController()
    let done = 0
    void (async () => {
      for (const id of ids) {
        const item = await loadMomentsFeedItem(id, controller.signal).catch(() => undefined)
        if (controller.signal.aborted) return
        done++
        if (item) setDrawn(prev => { const next = new Map(prev).set(item.id, item); writeSaved(next); return next })
        else if (item === null) setGoneIds(prev => new Set(prev).add(id))
      }
    })()
    // ids not answered yet are asked again by the next run
    return () => { controller.abort(); ids.slice(done).forEach(id => lookedUp.current.delete(id)) }
  }, [loaded, savedItems, pool, drawn])

  // the later pages, one at a time behind the drawn first one; a page that fails leaves what has loaded
  useEffect(() => {
    if (!initial?.snap.nextCursor) return
    const controller = new AbortController()
    void loadMomentsFeedRest(initial.readAt, initial.snap.nextCursor, (page, fresh) => {
      if (fresh) onPoll.current(page) // a new snapshot came out between pages: its first page, as a poll brings it
      else setItems(prev => appendMomentsFeed(prev, page.items))
    }, controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the portal's header: every sticky top, scroll margin and scroll offset clears it
  useLayoutEffect(() => (mainRef.current ? watchHeaderClear(mainRef.current) : undefined), [])

  // "updated … ago" and the rows' times tick every 10 s
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 10_000)
    return () => window.clearInterval(id)
  }, [])

  // polls: the newest page, merged; new moments wait behind the pill while you read
  const onPoll = useRef<(snap: MomentsFeedSnapshot) => void>(() => undefined)
  onPoll.current = (snap) => {
    const { items: merged, added } = mergeMomentsFeed(latest.current.items, snap.items)
    const cutoff = Date.now() - MOMENTS_WINDOW_MS - 10 * 60_000
    setItems(merged.filter(item => item.minuteStart >= cutoff || item.id === latest.current.selKey || isSaved(item)))
    setLoadedAt(Date.now())
    setClock(Date.now())
    setFeedStale(snap.stale)
    if (snap.categories) setCats(snap.categories)
    if (!added.length) return
    if (holding.current) setHeld(prev => new Set([...prev, ...added]))
    else arrive(added)
    ping()
  }
  useEffect(() => {
    if (!loaded || replay) return
    let controller: AbortController | null = null
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      controller?.abort()
      controller = new AbortController()
      // a failed poll keeps what the page holds; "updated … ago" greys after 3 min
      pollMomentsFeed(Date.now(), controller.signal).then(snap => onPoll.current(snap), () => undefined)
    }, POLL_MS)
    return () => { window.clearInterval(id); controller?.abort() }
  }, [loaded, replay])

  // Replay: the last hour as the polls brought it, one 45 s poll every half second
  const step = useRef<() => void>(() => undefined)
  step.current = () => {
    const r = latest.current.replay
    if (!r) return
    const next = Math.min(r.end, r.vnow + 45_000)
    const came = latest.current.pool.filter(m => m.at > r.vnow && m.at <= next && latest.current.passes(m)).map(m => m.key)
    if (holding.current) { if (came.length) setHeld(prev => new Set([...prev, ...came])) } // nothing moves while you read
    else { setShownUntil(next); if (came.length) arrive(came) }
    if (came.length) ping()
    if (next >= r.end) stopReplay(true)
    else setReplay({ ...r, vnow: next })
  }
  useEffect(() => {
    if (!replay) return
    const id = window.setInterval(() => step.current(), motion ? 500 : 1500)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay == null, motion])
  const startReplay = () => {
    const end = Date.now()
    setReplay({ vnow: end - 60 * 60_000, end })
    setShownUntil(end - 60 * 60_000)
    setHeld(new Set())
  }
  const stopReplay = (done: boolean) => {
    setReplay(null)
    setClock(Date.now())
    if (!holding.current || !done) { setShownUntil(null); setHeld(new Set()) }
  }

  // keys: J/K or ↑ ↓ move, S saves, P plays, / searches, Esc closes (narrow)
  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined)
  onKey.current = (e) => {
    if (e.defaultPrevented) return
    const t = e.target as HTMLElement
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || '') || t.isContentEditable
    if (!(t === document.body || mainRef.current?.contains(t))) return
    if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return
    const keys = [...(listRef.current?.querySelectorAll<HTMLElement>('.mk-r[data-key]') ?? [])].map(b => b.dataset.key ?? '')
    const i = selKey ? keys.indexOf(leadOf.get(selKey) ?? selKey) : -1
    if (e.key === 'j' || e.key === 'ArrowDown') { if (keys.length) { e.preventDefault(); select(keys[Math.min(keys.length - 1, i + 1)], { keep: true, focus: true }) } }
    else if (e.key === 'k' || e.key === 'ArrowUp') { if (keys.length) { e.preventDefault(); select(keys[Math.max(0, i < 0 ? 0 : i - 1)], { keep: true, focus: true }) } }
    else if (e.key === 's' && selKey) toggleSave(selKey)
    else if (e.key === 'p' && selKey) playRef.current?.(lk)
    else if (e.key === 'Escape' && selKey && !wide) closeDetail()
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey.current(e)
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  useLayoutEffect(() => {
    const tops = flipFrom.current
    flipFrom.current = null
    if (tops && motion) {
      for (const li of listRef.current?.querySelectorAll<HTMLElement>(':scope > li.mk-g') ?? []) {
        const y = tops.get(li.dataset.sid ?? '')
        if (y == null || typeof li.animate !== 'function') continue
        const d = y - li.getBoundingClientRect().top
        if (Math.abs(d) > 1) li.animate([{ transform: `translateY(${d.toFixed(1)}px)` }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.2,0,0,1)' })
      }
    }
    const k = keep.current
    keep.current = null
    if (k) {
      const el = rowEl(k.key)
      if (el) { const d = el.getBoundingClientRect().top - k.y0; if (Math.abs(d) > 1) window.scrollBy(0, d) }
    }
    const f = focusAfter.current
    if (f) {
      focusAfter.current = null
      if (f.row) { const el = rowEl(f.row); if (el) { (el.querySelector<HTMLElement>('.mk-r-hit') ?? el).focus({ preventScroll: true }); inView(el, motion) } }
      if (f.scrollTo) { const el = rowEl(f.scrollTo); if (el) window.scrollBy(0, el.getBoundingClientRect().top - (wide ? window.innerHeight / 3 : headerClear() + 12)) } // narrow: the row under the header, its detail below
    }
  })
  useEffect(() => {
    if (!arrived.size) return
    const id = window.setTimeout(() => setArrived(new Set()), 700)
    return () => window.clearTimeout(id)
  }, [arrived])

  const detail = (m: CheckedMoment) => <MomentDetail key={m.key} m={m} pool={pool} now={now} metric={metric} lk={lk}
    setMetric={value => setOpened(o => ({ key: m.key, metric: value, lk: o.key === m.key ? o.lk : null }))}
    setLk={value => setOpened(o => ({ key: m.key, lk: value, metric: o.key === m.key ? o.metric : null }))}
    saved={isSaved(m.item)} onSave={() => toggleSave(m.key)} onCopy={() => copyLink(m.key)} onOpen={openFromDetail} onClose={closeDetail}
    motion={motion} phone={phone} say={say} playRef={playRef} vods={vods} moreAll={moreAll} setMoreAll={setMoreAll} game={game} onGame={pickGame} />

  const stale = !replay && (feedStale || clock - loadedAt > STALE_MS)
  const deepAt = deepId ? momentsFeedIdParts(deepId) : null
  const gone = deepWait === 'gone' || deepWait === 'failed'
    ? <p className="mk-gone" role="status">{deepWait === 'gone' ? 'That moment is no longer here.' : 'That moment couldn’t be loaded.'}
      {deepAt ? <> <Link to={broadcastTimelineHref(deepAt.login, deepAt.streamId, '/analytics/moments', deepAt.offsetSeconds)}>Open it on the stream’s page</Link></> : null}</p>
    : null
  // a picked game with nothing in this list says which game (no search typed; Saved and Viewed only once they hold something)
  const gameEmpty = !gameLabel || qq ? null
    : view === 'latest' || view === 'top' ? `No ${gameLabel.name} moments in the last ${HOURS} hours.`
      : view === 'saved' && savedCount ? `No saved ${gameLabel.name} moments.`
        : view === 'viewed' && viewed.length ? `No ${gameLabel.name} moments in Viewed.` : null
  // "Live" while the polls keep up (how old, on hover); how old once it greys; the replay's clock while one plays
  const fresh = !loaded ? null
    : replay ? <span className="mk-rpl">Replay: <b>{clk(replay.vnow)}</b>, one poll every 45 s</span> : stale ? updatedText(clock - loadedAt) : 'Live'

  return <main ref={mainRef} id="analytics-main" className={`mk${motion ? '' : ' no-motion'}`} tabIndex={-1}>
    <header className="mk-head">
      <h1>Moments</h1>
      <p className="mk-lede">When a stream’s chat suddenly goes wild. Pick a game to start.</p>
    </header>

    <MomentsGameRow games={games} total={allCount} picked={game} pickedLabel={gameLabel} loaded={loaded} onPick={pickGame} />

    <div className="mk-bar" role="search" aria-label="Filter moments">
      <div className="mk-seg" role="group" aria-label="Which moments">
        <button type="button" aria-pressed={view === 'latest'} onClick={() => setView('latest')}>Latest</button>
        <button type="button" aria-pressed={view === 'top'} onClick={() => setView('top')}>Top</button>
        <button type="button" aria-pressed={view === 'saved' || view === 'viewed'} onClick={() => setView('saved')}>Saved</button>
      </div>
      {view === 'latest' ? <button className="mk-rp" type="button" aria-pressed={replay != null} disabled={!loaded} onClick={() => (replay ? stopReplay(false) : startReplay())}>
        <ReplayGlyph /><span>{replay ? 'Stop replay' : 'Replay the last hour'}</span>
      </button> : null}
      <span className="mk-bar-sp" />
      <p className={`mk-fresh${stale ? ' stale' : ''}${replay ? ' replaying' : ''}`} title={loaded && !stale && !replay ? updatedText(clock - loadedAt) : undefined}>
        <span className="mk-dot" ref={dotRef} aria-hidden="true" /><span>{fresh}</span></p>
      <label className="mk-srch"><SearchGlyph />
        <input ref={searchRef} type="search" placeholder="Channel, game or emote" aria-label="Search channels, games or emotes" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} />
      </label>
    </div>

    <div className="mk-grid">
      <section className="mk-col" aria-label="Moments">
        <div className="mk-listwrap" ref={listWrapRef}
          onPointerEnter={() => setHolding(true)} onPointerLeave={() => setHolding(false)}
          onFocus={() => setHolding(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHolding(false) }}>
          <button className="mk-pill" type="button" hidden={!pillN} onClick={() => release(true)}>{pillN} new ↑</button>
          {wide ? null : gone}
          {view === 'top' ? <p className="mk-cap">Top moments in the last {HOURS} hours, strongest first</p> : null}
          {/* Saved's two halves (M1, 10-22): what you saved, and what you opened here (V1) */}
          {view === 'saved' || view === 'viewed' ? <div className="mk-sv">
            <div className="mk-seg" role="group" aria-label="Saved or opened">
              <button type="button" aria-pressed={view === 'saved'} onClick={() => setView('saved')}>Saved ({savedCount})</button>
              <button type="button" aria-pressed={view === 'viewed'} onClick={() => setView('viewed')}>Viewed ({viewed.length})</button>
            </div>
            {view === 'viewed' && viewed.length ? <p className="mk-vw-note">Opened here, kept in this browser for {VIEWED_DAYS} days.
              <button type="button" onClick={() => { clearViewed(); setViewed([]); setViewedOrder([]); say('Viewed cleared') }}>Clear</button></p> : null}
          </div> : null}
          <ol className="mk-list" ref={listRef}>
            {onRetry ? <li className="mk-empty"><span role="alert">Moments couldn’t load.</span> <button type="button" onClick={onRetry}>Try again</button></li> : null}
            {loaded && !groups.length && !goneRows.length ? <li className="mk-empty">{gameEmpty ?? (view === 'saved' ? (signedOut ? 'Nothing saved yet. Saves stay in this browser until you sign in.' : 'Nothing saved yet.')
              : view === 'viewed' ? `Nothing viewed yet. Moments you open here stay in this list, in this browser, for ${VIEWED_DAYS} days.` : 'No moments match.')}</li> : null}
            {groups.map(g => {
              // Viewed and Top are one row a moment, so a stream can have several: those rows go by the moment
              const lead = g[0], gid = flat ? lead.key : lead.sid
              const inline = !wide && selM && g.some(m => m.key === selM.key) ? selM : null
              return <li key={gid} className={`mk-g${arrived.has(lead.key) ? ' new' : ''}`} data-sid={gid} data-vd={lead.item.verdict}>
                <Row m={lead} more={g.length - 1} now={now} short={phone} current={selKey != null && g.some(m => m.key === selKey)}
                  opened={view === 'viewed' ? openedAt.get(lead.key) : undefined} onSelect={() => select(lead.key, { from: lead.key })} />
                {inline ? <div className="mk-slot">{detail(inline)}</div> : null}
              </li>
            })}
            {goneRows.map(saved => <li key={saved.key} className="mk-g"><GoneRow saved={saved} /></li>)}
          </ol>
        </div>
      </section>
      <aside className="mk-det" aria-label="Selected moment">{wide && selM ? detail(selM) : wide ? gone : null}</aside>
    </div>
    <div className="mk-vh" aria-live="polite">{said}</div>
  </main>
}

/** The element under root matching sel whose data-<field> is value (ids go in no selector). */
const byData = (root: HTMLElement | null, sel: string, field: string, value: string) =>
  [...(root?.querySelectorAll<HTMLElement>(sel) ?? [])].find(el => el.dataset[field] === value) ?? null

function inView(el: HTMLElement, motion: boolean) {
  const r = el.getBoundingClientRect(), top = headerClear()
  if (r.top < top) window.scrollBy({ top: r.top - top - 8, behavior: motion ? 'smooth' : 'auto' })
  else if (r.bottom > window.innerHeight - 8) window.scrollBy({ top: r.bottom - window.innerHeight + 8, behavior: motion ? 'smooth' : 'auto' })
}

/**
 * One row (M1, 10-22: the B2 row said three things): the picture · who + what chat sent / "8.7× more emotes" + the game ·
 * when. Under Viewed, the right column says when you opened it; on phones the time is short ("13m") and the game is
 * left to the open moment. The stream's other moments, its minutes and its viewers are in the open moment.
 */
function Row({ m, more, now, short, current, opened, onSelect }: {
  m: CheckedMoment; more: number; now: number; short: boolean; current: boolean; opened?: number; onSelect: () => void
}) {
  const item = m.item
  const full = `${new Date(m.at).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · ${streamTime(m, null)} ${streamWhere(null)}`
  const bits: Array<{ key: string; sep?: string; node: ReactNode }> = []
  if (m.rowX != null) bits.push({ key: 'x', node: <span className="mk-r-x"><b>{fx(m.rowX)}</b> more {m.kind === 'chat' ? 'chat' : 'emotes'}</span> })
  else if (m.why) bits.push({ key: 'why', node: <span className="mk-r-why">{m.why}</span> })
  if (item.category) bits.push({ key: 'g', sep: 's-g', node: <span className="mk-r-g">{item.category.name}</span> })
  const at = opened != null
    ? <time className="mk-r-op" dateTime={new Date(opened).toISOString()} title={full}>opened {openedWhen(opened, now)}</time>
    : <time dateTime={new Date(m.at).toISOString()} title={full}>{short ? whenShort(m.at, now) : when(m.at, now)}</time>
  return <div className="mk-r" data-key={m.key} aria-current={current} onClick={onSelect}>
    <button className="mk-r-hit" type="button" aria-current={current} aria-label={ariaOf(m, now, more)} />
    <Thumb m={m} />
    <span className="mk-r-tx">
      <span className="mk-r-l1"><span className="mk-r-nm">{m.name}</span><MomentAct act={actOf(item)} /></span>
      <span className="mk-r-l2">{bits.map((b, i) => <Fragment key={b.key}>{i ? <span className={`mk-sep${b.sep ? ` ${b.sep}` : ''}`} aria-hidden="true">·</span> : null}{b.node}</Fragment>)}</span>
    </span>
    <span className="mk-r-v">{at}</span>
  </div>
}

/** A saved label without the feed's verb: "PJSalt", not "spammed PJSalt" (ACC-03, 10-22). Older saves keep it, so rows strip it too. */
const momentLabel = (label: string) => label.replace(/^spammed\s+/i, '')

/**
 * A save the feed can't find (Unavailable saves C, 10-22): channel and what happened, an empty picture, no minutes, and
 * where it can still be seen (a past broadcast's replay on Twitch, else the stream's page). The right column says when it was saved.
 */
function GoneRow({ saved }: { saved: SavedMoment }) {
  const replay = replayHref(saved)
  const where = replay ? <a href={replay} target="_blank" rel="noopener noreferrer">Replay on Twitch</a>
    : /^\d{1,30}$/.test(saved.streamId) ? <Link to={broadcastTimelineHref(saved.login, saved.streamId, '/analytics/moments', saved.offsetSeconds)}>Open it on the stream’s page</Link>
      : null
  const at = new Date(saved.savedAt)
  return <div className="mk-r mk-r-gone" data-key={saved.key}>
    <span className="mk-r-th" aria-hidden="true" />
    <span className="mk-r-tx">
      <span className="mk-r-l1"><span className="mk-r-nm">{saved.displayName || saved.login}</span><span className="mk-r-em"><span>{momentLabel(saved.label)}</span></span></span>
      <span className="mk-r-l2"><span>Gone from the feed</span>{where ? <><span className="mk-sep" aria-hidden="true">·</span>{where}</> : null}</span>
    </span>
    <span className="mk-r-v"><time dateTime={at.toISOString()} title={`Saved ${at.toLocaleString('en-US')}`}>{at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time></span>
  </div>
}

/** The row's picture: the stream's live frame while it is live, else its game's art, blurred, under the channel's avatar. */
function Thumb({ m }: { m: CheckedMoment }) {
  const item = m.item
  const [failed, setFailed] = useState(false)
  const frame = item.streamLive && !failed ? liveFrameImage(item) : undefined
  if (frame) return <span className="mk-r-th"><img className="mk-r-th-f" src={frame} alt="" width={96} height={54} loading="lazy" onError={() => setFailed(true)} /></span>
  const box = boxArtImage(item), avatar = avatarImage(item)
  return <span className="mk-r-th">
    {box ? <img className="mk-r-th-bx" src={box} alt="" loading="lazy" /> : null}
    {avatar ? <img className="mk-r-th-av" src={avatar} alt="" width={28} height={28} loading="lazy" /> : <span className="mk-ini">{ini(m.name)}</span>}
  </span>
}
