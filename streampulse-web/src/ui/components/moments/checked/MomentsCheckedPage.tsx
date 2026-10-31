import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AnalyticsFigmaShell } from '../../analytics/AnalyticsFigmaShell'
import { isApiError } from '../../../../lib/apiClient'
import {
  appendMomentsFeed, loadMomentsFeed, loadMomentsFeedItem, loadMomentsFeedRest, mergeMomentsFeed, momentsFeedFrom, momentsFeedIdFromLegacy,
  momentsFeedIdParts, MOMENTS_WINDOW_MS, pollMomentsFeed, type MomentMetricKind, type MomentsFeedCategoryFacet, type MomentsFeedItem, type MomentsFeedSnapshot,
} from '../../../../lib/momentsFeed'
import { momentsGameLabel, momentsGames } from '../../../../lib/momentsGames'
import {
  actOf, ariaOf, avatarImage, boxArtImage, checkMoment, clk, fx, groupsOf, liveFrameImage, openedWhen, SORTS, STALE_MS,
  streamTime, streamWhere, topBursts, updatedText, when, whenShort, type CheckedMoment,
} from '../../../../lib/momentsChecked'
import { loadMomentVod, momentVodCache } from '../../../../lib/momentsFeedVod'
import { removeSavedMoment, SAVED_MOMENTS_FULL, SAVED_MOMENTS_LIMIT, toggleSavedMoment, useSavedMoments, type SavedMoment } from '../../../../lib/savedDiscoveryMoments'
import { clearViewed, pruneViewed, readViewed, recordViewed, VIEWED_DAYS, type ViewedMoment } from '../../../../lib/viewedMoments'
import { fromHubMoment, type DiscoveryMoment } from '../../../../lib/discoveryMoments'
import { broadcastTimelineHref } from '../../../../lib/momentsNavigation'
import { useMatchMedia } from '../../../hooks/useMatchMedia'
import { headerClear, watchHeaderClear } from './headerClear'
import { MomentDetail } from './MomentDetail'
import { MomentAct } from './MomentAct'
import { MomentsGameRow } from './MomentsGameRow'
import { ReplayGlyph, SearchGlyph } from './glyphs'
import './moments-checked.css'

/** Polls bring the newest page every 45 s (the feed's demo cadence; its edge cache holds a page for 30 s). */
const POLL_MS = 45_000
/**
 * Live (Latest until N1, 10-30; ?view=latest still opens it): the moments that hold up or partly do, newest first, as the
 * polls bring them (moments-r4 B2: no verdict tiers, filters or orders). Saved: this browser's.
 * Viewed: the moments you opened here, newest opened first, one row each (V1, 10-21).
 * Top (T1, 10-22): the moments that hold up, strongest first by the feed's score, one row per burst, not grouped by stream;
 * its switch keeps the last 24, 6 or 1 hours of what the page holds (W1, 10-30).
 * The tabs are Live, Top and Saved; Viewed is Saved's other half, behind a switch (M1, 10-22). The window's games sit
 * over them as big covers, and one picks the game every list shows (?game=; B2's Games tab until M1).
 */
type MomentsTab = 'live' | 'top' | 'saved' | 'viewed'
const TABS: readonly MomentsTab[] = ['live', 'top', 'saved', 'viewed']
const HOURS = MOMENTS_WINDOW_MS / 3_600_000
const RANGES = [24, 6, 1] as const
type TopRange = typeof RANGES[number]
const hoursText = (hours: number) => (hours === 1 ? 'hour' : `${hours} hours`)

/**
 * Saves are the site's one save list (channel, stream, second), kept in this browser (V1, 10-30). Each keeps a small
 * card, so a save that has left the feed still draws its row without a read.
 */
const savedKey = (item: MomentsFeedItem) => JSON.stringify([item.login, item.streamId, item.offsetSeconds])

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
  // the page's own whole-copy save list, gone since V1 (10-30): removed from this browser once; Viewed past 30 days goes too
  useEffect(() => {
    try { window.localStorage.removeItem('sp-moments-checked-saved') } catch { /* private window */ }
    pruneViewed()
  }, [])
  const keptRef = useRef<Kept>({})
  if (state.status === 'off') return <>{fallback}</>
  const retry = () => { setState({ status: 'loading' }); setTries(n => n + 1) }
  return <AnalyticsFigmaShell hideSidebar>
    <CheckedMoments key={state.status} initial={state.status === 'ready' ? state : null} onRetry={state.status === 'failed' ? retry : undefined} keptRef={keptRef} />
  </AnalyticsFigmaShell>
}

/** The first page, when it came, and the time its read asked from (the later pages ask the same). */
interface Initial { snap: MomentsFeedSnapshot; at: number; readAt: number }
/** The tab, Top's hours and the search picked: kept when the list is drawn again (the first read lands, or Try again), still out of the link. */
interface Kept { view?: MomentsTab; range?: TopRange; q?: string }

function CheckedMoments({ initial, onRetry, keptRef }: { initial: Initial | null; onRetry?: () => void; keptRef: { current: Kept } }) {
  const wide = useMatchMedia('(min-width: 900px)')
  const phone = useMatchMedia('(max-width: 719px)')
  const motion = !useMatchMedia('(prefers-reduced-motion: reduce)')
  const loaded = initial != null

  const query = useMemo(() => new URLSearchParams(window.location.search), [])
  const deepId = query.get('m') ?? momentsFeedIdFromLegacy(query.get('login'), query.get('stream'), query.get('offset'))
  const [items, setItems] = useState<MomentsFeedItem[]>(() => initial?.snap.items ?? [])
  const [loadedAt, setLoadedAt] = useState(() => initial?.at ?? Date.now())
  /** When the newest read was: the first page's, then each poll's (a poll drops what is older than its window). */
  const [readAt, setReadAt] = useState(() => initial?.readAt ?? 0)
  const [feedStale, setFeedStale] = useState(() => initial?.snap.stale ?? false)
  /** A deep link to a moment the first page did not bring: looked up by id; until it answers, no other moment opens. */
  const [deepWait, setDeepWait] = useState<'no' | 'pending' | 'gone' | 'failed'>(() => (initial && deepId && !initial.snap.items.some(item => item.id === deepId) ? 'pending' : 'no'))
  const [view, setViewState] = useState<MomentsTab>(() => { const v = query.get('view'); return keptRef.current.view ?? (v === 'latest' ? 'live' : TABS.find(t => t === v) ?? 'live') })
  /** Top's switch: how many hours back it keeps (W1, 10-30). */
  const [range, setRangeState] = useState<TopRange>(() => keptRef.current.range ?? 24)
  const [viewed, setViewed] = useState<ViewedMoment[]>(() => readViewed())
  /** Viewed's order, taken when the tab opens, so opening a row there doesn't move it under the pointer. */
  const [viewedOrder, setViewedOrder] = useState<string[]>(() => viewed.map(e => e.id))
  const [q, setQState] = useState(() => keptRef.current.q ?? '')
  const setRange = (hours: TopRange) => { keptRef.current.range = hours; setRangeState(hours) }
  const setQ = (text: string) => { keptRef.current.q = text; setQState(text) }
  /** The picked game's category id: every list shows only its moments. */
  const [game, setGame] = useState<string | null>(() => { const id = query.get('game'); return id && /^\d{1,20}$/.test(id) ? id : null })
  /** The feed's games, for each one's live channels (first page, then each poll). */
  const [cats, setCats] = useState<MomentsFeedCategoryFacet[] | null>(() => initial?.snap.categories ?? null)
  const [sel, setSel] = useState<string | null>(() => (deepId && initial?.snap.items.some(item => item.id === deepId) ? deepId : null))
  const [opened, setOpened] = useState<{ key: string | null; lk: number | null; metric: MomentMetricKind | null }>({ key: null, lk: null, metric: null })
  const [moreAll, setMoreAll] = useState<string | null>(null)
  const { items: savedItems, warning: savedWarning } = useSavedMoments()
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
  /** The moment whose Save was refused at the limit: it says why under its Save until a save goes through or one is removed. */
  const [refused, setRefused] = useState<string | null>(null)

  const mainRef = useRef<HTMLElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const listWrapRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const svRef = useRef<HTMLButtonElement>(null)
  /** After a Remove: the next row's Remove takes focus (null: the Saved switch). */
  const removedFocus = useRef<string | null | undefined>(undefined)
  const playRef = useRef<((rel: number | null) => void) | null>(null)
  const holding = useRef(false)
  const flipFrom = useRef<Map<string, number> | null>(null)
  const keep = useRef<{ key: string; y0: number } | null>(null)
  const focusAfter = useRef<{ row?: string; sid?: string; scrollTo?: string } | null>(deepId && sel ? { scrollTo: deepId } : null)
  const vods = useMemo(() => momentVodCache(item => loadMomentVod(item, new AbortController().signal)), [])

  const now = replay ? replay.vnow : clock
  const nowMinute = Math.floor(now / 60_000) * 60_000
  const pool = useMemo(() => items.map(item => checkMoment(item, nowMinute)), [items, nowMinute])
  const byKey = useMemo(() => new Map(pool.map(m => [m.key, m])), [pool])
  // a save the page doesn't hold (not read yet, gone from the feed, or never a feed moment): drawn from its card under
  // Saved, counted there, also before the first read and in an outage
  const goneSaves = useMemo(() => {
    const inPool = new Set(pool.map(m => savedKey(m.item)))
    return savedItems.filter(s => !inPool.has(s.key))
  }, [pool, savedItems])
  const savedCount = savedItems.length
  const openedAt = useMemo(() => new Map(viewed.map(e => [e.id, e.at])), [viewed])
  // a viewed moment the page doesn't hold: drawn from its card, as a save is
  const goneViewed = useMemo(() => viewed.filter(e => !byKey.has(e.id)), [viewed, byKey])
  /** "Gone from the feed" only when it is known: the moment is older than the window of the page's newest read. */
  const windowFrom = loaded ? momentsFeedFrom(readAt) : null
  const knownGone = (card: SavedMoment) => windowFrom != null && card.at != null && card.at < windowFrom
  const find = (key: string) => byKey.get(key) ?? null
  const setView = (next: MomentsTab) => {
    if (next === 'viewed') setViewedOrder(viewed.map(e => e.id))
    if (next !== 'live' && replay) stopReplay(false) // the replay plays Live in time order
    keptRef.current.view = next
    setViewState(next)
  }
  const games = useMemo(() => momentsGames(pool, cats), [pool, cats])
  /** "All games": every moment Live can show, with a game or without. */
  const allCount = useMemo(() => pool.filter(m => m.item.verdict !== 'bad').length, [pool])
  const gameLabel = game ? momentsGameLabel(game, pool, cats) : null
  /** An open you asked for (a click, a key, a link) goes to the top of Viewed. */
  const noteViewed = (m: CheckedMoment) => { const card = momentCard(m); if (card) setViewed(recordViewed(m.key, card)) }

  const qq = q.trim().toLowerCase()
  // Live leaves out what didn't hold up, except the open moment (a deep link, or a held minute's "a moment here").
  // Top keeps only the moments that hold up and rose (those with a ×), from the switch's last hours, and the open moment
  // as it ages past them.
  const passes = (m: CheckedMoment) =>
    (view === 'saved' ? isSaved(m.item) : view === 'viewed' ? openedAt.has(m.key)
      : view === 'top' ? m.rowX != null && (m.at > now - range * 3_600_000 || m.key === sel) : m.item.verdict !== 'bad' || m.key === sel)
    && (!qq || m.find.includes(qq)) && (!game || m.item.category?.id === game)
  const shown = (m: CheckedMoment) => (shownUntil == null || m.at <= shownUntil) && !held.has(m.key)
  const viewedRank = new Map(viewedOrder.map((id, i) => [id, i]))
  const byViewed = (a: { key: string }, b: { key: string }) => (viewedRank.get(a.key) ?? -1) - (viewedRank.get(b.key) ?? -1) // opened since the tab opened: on top
  const listed = pool.filter(m => shown(m) && passes(m))
  const list = view === 'top' ? topBursts(listed) : view === 'viewed' ? listed : listed.sort(SORTS.new) // Viewed: sorted with its card rows below
  // a save from before the cards kept the game's id has only its name
  const cardPasses = (card: SavedMoment) => (!qq || `${card.login} ${card.displayName ?? ''} ${card.label} ${card.category ?? ''}`.toLowerCase().includes(qq))
    && (!game || (card.categoryId ? card.categoryId === game : card.category != null && card.category === gameLabel?.name))
  const goneRows: GoneEntry[] = (view === 'saved' ? goneSaves.map(card => ({ key: card.key, card }))
    : view === 'viewed' ? goneViewed.map(e => ({ key: e.id, card: e.card, opened: e.at })) : []).filter(r => cardPasses(r.card))
  const flat = view === 'viewed' || view === 'top'
  // one row a stream, its newest; the stream's other moments are in the open moment (M1, 10-22)
  const groups = flat ? list.map(m => [m]) : groupsOf(list)
  /** The rows in order: Viewed puts the ones drawn from a card among the others by when they were opened; Saved puts them last. */
  const rows: Array<{ key: string; g: CheckedMoment[] } | { key: string; gone: GoneEntry }> = [
    ...groups.map(g => ({ key: flat ? g[0].key : g[0].sid, g })), ...goneRows.map(gone => ({ key: gone.key, gone }))]
  if (view === 'viewed') rows.sort(byViewed)
  /** Each moment's row: its stream's newest. */
  const leadOf = new Map(groups.flatMap(g => g.map(m => [m.key, g[0].key] as const)))
  // nothing opens by itself (A1, 10-30): the wide layout's side panel waits for a click
  const selKey = sel != null && list.some(m => m.key === sel) ? sel : null
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
    if (key != null && !find(key)) return // a row drawn from a card doesn't open: sel and ?m= keep a feed id
    const next = !wide && key != null && selKey === key && !o.keep ? null : key // narrow: a second click closes it
    keepPut(next ?? o.from ?? '')
    setDeepWait(w => (w === 'pending' ? w : 'no'))
    setSel(next)
    setOpened({ key: next, lk: null, metric: null })
    writeUrl(next)
    if (o.focus && next) focusAfter.current = { row: next }
    const m = next ? find(next) : null
    if (m) { say(ariaOf(m, now)); noteViewed(m) }
  }
  const openFromDetail = (key: string) => {
    if (find(key)) select(key, { keep: true, focus: true })
  }
  const closeDetail = () => {
    const key = selKey
    keepPut(key ?? '')
    setSel(null)
    writeUrl(null)
    if (key) focusAfter.current = { row: key, sid: find(key)?.sid }
  }
  const toggleSave = (key: string) => {
    const m = find(key)
    const card = m && momentCard(m)
    if (!m || !card) return
    const wasSaved = isSaved(m.item)
    const result = toggleSavedMoment(card)
    setRefused(result === SAVED_MOMENTS_FULL ? key : null)
    // a save the list refuses (200 reached), or keeps for this session only, says so, not "Saved"
    say(wasSaved ? 'Removed from Saved' : result === 'Saved on this device.' ? 'Saved' : result)
  }
  /** Remove on a save the page doesn't hold (Q3b, 10-31): its row goes, and focus moves to the next row's Remove. */
  const removeSave = (key: string) => {
    const keys = goneRows.map(r => r.key)
    const i = keys.indexOf(key)
    removedFocus.current = keys[i + 1] ?? keys[i - 1] ?? null
    removeSavedMoment(key)
    setRefused(null)
    say('Removed from Saved')
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
    if (m && sel === deepId) noteViewed(m)
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
      noteViewed(checkMoment(item, nowMinute))
      setDeepWait('no')
      focusAfter.current = { scrollTo: item.id }
    }, () => { if (!controller.signal.aborted) setDeepWait('failed') })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setReadAt(Date.now())
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

  // keys: J/K or ↑ ↓ move, S saves, P plays, / searches, Esc closes the open moment
  const onKey = useRef<(e: KeyboardEvent) => void>(() => undefined)
  onKey.current = (e) => {
    if (e.defaultPrevented) return
    const t = e.target as HTMLElement
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName || '') || t.isContentEditable
    if (!(t === document.body || mainRef.current?.contains(t))) return
    if (e.key === '/' && !typing) { e.preventDefault(); searchRef.current?.focus(); return }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return
    // rows drawn from a card don't open, so J/K pass over them
    const keys = [...(listRef.current?.querySelectorAll<HTMLElement>('.mk-r[data-key]:not(.mk-r-gone)') ?? [])].map(b => b.dataset.key ?? '')
    const i = selKey ? keys.indexOf(leadOf.get(selKey) ?? selKey) : -1
    if (e.key === 'j' || e.key === 'ArrowDown') { if (keys.length) { e.preventDefault(); select(keys[Math.min(keys.length - 1, i + 1)], { keep: true, focus: true }) } }
    else if (e.key === 'k' || e.key === 'ArrowUp') { if (keys.length) { e.preventDefault(); select(keys[Math.max(0, i < 0 ? 0 : i - 1)], { keep: true, focus: true }) } }
    else if (e.key === 's' && selKey) toggleSave(selKey)
    else if (e.key === 'p' && selKey) playRef.current?.(lk)
    else if (e.key === 'Escape' && selKey) {
      // a held minute goes first, wherever focus is in the moment; then the moment closes, wide too: "Pick a moment." (Q4b, 10-31)
      if (lk != null) { setOpened(o => ({ ...o, lk: null })); say('Let go') } else closeDetail()
    }
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
      if (f.row) {
        // a moment listed only while it was open (a deep link that didn't hold up, Top's past its hours) leaves on close:
        // its stream's row (Top and Viewed list a stream's moments apart: its first), else the page if focus left with it
        const near = f.sid ? list.find(m => m.sid === f.sid && m.key !== f.row) : undefined
        const el = rowEl(f.row) ?? (near ? rowEl(near.key) : null)
        if (el) { (el.querySelector<HTMLElement>('.mk-r-hit') ?? el).focus({ preventScroll: true }); inView(el, motion) }
        else if (f.sid && !mainRef.current?.contains(document.activeElement)) mainRef.current?.focus({ preventScroll: true })
      }
      if (f.scrollTo) { const el = rowEl(f.scrollTo); if (el) window.scrollBy(0, el.getBoundingClientRect().top - (wide ? window.innerHeight / 3 : headerClear() + 12)) } // narrow: the row under the header, its detail below
    }
    const rf = removedFocus.current
    if (rf !== undefined) {
      removedFocus.current = undefined
      const el = rf ? byData(listRef.current, '.mk-r', 'key', rf)?.querySelector<HTMLElement>('.mk-r-rm') : null
      ;(el ?? svRef.current)?.focus({ preventScroll: true })
    }
  })
  useEffect(() => {
    if (!arrived.size) return
    const id = window.setTimeout(() => setArrived(new Set()), 700)
    return () => window.clearTimeout(id)
  }, [arrived])

  const full = savedCount >= SAVED_MOMENTS_LIMIT
  const detail = (m: CheckedMoment) => <MomentDetail key={m.key} m={m} pool={pool} now={now} metric={metric} lk={lk}
    setMetric={value => setOpened(o => ({ key: m.key, metric: value, lk: o.key === m.key ? o.lk : null }))}
    setLk={value => setOpened(o => ({ key: m.key, lk: value, metric: o.key === m.key ? o.metric : null }))}
    saved={isSaved(m.item)} onSave={() => toggleSave(m.key)} saveNote={full && refused === m.key ? SAVED_MOMENTS_FULL : null}
    onCopy={() => copyLink(m.key)} onOpen={openFromDetail} onClose={closeDetail}
    motion={motion} phone={phone} say={say} playRef={playRef} vods={vods} moreAll={moreAll} setMoreAll={setMoreAll} game={game} onGame={pickGame} />

  const stale = !replay && (feedStale || clock - loadedAt > STALE_MS)
  const deepAt = deepId ? momentsFeedIdParts(deepId) : null
  const gone = deepWait === 'gone' || deepWait === 'failed'
    ? <p className="mk-gone" role="status">{deepWait === 'gone' ? 'That moment is no longer here.' : 'That moment couldn’t be loaded.'}
      {deepAt ? <> <Link to={broadcastTimelineHref(deepAt.login, deepAt.streamId, '/analytics/moments', deepAt.offsetSeconds)}>Open it on the stream’s page</Link></> : null}</p>
    : null
  // a picked game with nothing in this list says which game (no search typed; Saved and Viewed only once they hold something)
  const gameEmpty = !gameLabel || qq ? null
    : view === 'live' || view === 'top' ? `No ${gameLabel.name} moments in the last ${hoursText(view === 'top' ? range : HOURS)}.`
      : view === 'saved' && savedCount ? `No saved ${gameLabel.name} moments.`
        : view === 'viewed' && viewed.length ? `No ${gameLabel.name} moments in Viewed.` : null
  // the dot and how old the list is, once it has loaded (Q2c, 10-31: the tab says Live, N1); the replay's clock while one plays
  const fresh = !loaded ? null
    : replay ? <span className="mk-rpl">Replay: <b>{clk(replay.vnow)}</b>, one poll every 45 s</span> : updatedText(clock - loadedAt)
  // the save list's one line (Q3b, 10-31): a storage warning, and under Saved while it is full, the limit (a refused Save says it under itself)
  const saveNote = [savedWarning, full && view === 'saved' ? SAVED_MOMENTS_FULL : ''].filter(Boolean).join(' ')

  return <main ref={mainRef} id="analytics-main" className={`mk${motion ? '' : ' no-motion'}`} tabIndex={-1}>
    <header className="mk-head">
      <h1>Moments</h1>
      <p className="mk-lede">When a stream’s chat suddenly goes wild. Pick a game to start.</p>
    </header>

    <MomentsGameRow games={games} total={allCount} picked={game} pickedLabel={gameLabel} loaded={loaded} onPick={pickGame} />

    <div className="mk-bar" role="search" aria-label="Filter moments">
      <div className="mk-seg" role="group" aria-label="Which moments">
        <button type="button" aria-pressed={view === 'live'} onClick={() => setView('live')}>Live</button>
        <button type="button" aria-pressed={view === 'top'} onClick={() => setView('top')}>Top</button>
        <button type="button" aria-pressed={view === 'saved' || view === 'viewed'} onClick={() => setView('saved')}>Saved</button>
      </div>
      {view === 'live' ? <button className="mk-rp" type="button" aria-pressed={replay != null} disabled={!loaded} onClick={() => (replay ? stopReplay(false) : startReplay())}>
        <ReplayGlyph /><span>{replay ? 'Stop replay' : 'Replay the last hour'}</span>
      </button> : null}
      {view === 'top' ? <div className="mk-seg mk-rng" role="group" aria-label="How far back">
        {RANGES.map(h => <button key={h} type="button" aria-pressed={range === h} onClick={() => setRange(h)}>{h}h</button>)}
      </div> : null}
      <span className="mk-bar-sp" />
      <p className={`mk-fresh${stale ? ' stale' : ''}${replay ? ' replaying' : ''}`}>
        <span className="mk-dot" ref={dotRef} aria-hidden="true" />{fresh ? <span>{fresh}</span> : null}</p>
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
          {view === 'top' ? <p className="mk-cap">Top moments in the last {hoursText(range)}, strongest first</p> : null}
          {/* Saved's two halves (M1, 10-22): what you saved, and what you opened here (V1) */}
          {view === 'saved' || view === 'viewed' ? <div className="mk-sv">
            <div className="mk-seg" role="group" aria-label="Saved or opened">
              <button ref={svRef} type="button" aria-pressed={view === 'saved'} onClick={() => setView('saved')}>Saved ({savedCount})</button>
              <button type="button" aria-pressed={view === 'viewed'} onClick={() => setView('viewed')}>Viewed ({viewed.length})</button>
            </div>
            {view === 'viewed' && viewed.length ? <p className="mk-vw-note">Opened here, kept in this browser for {VIEWED_DAYS} days.
              <button type="button" onClick={() => { clearViewed(); setViewed([]); setViewedOrder([]); say('Viewed cleared') }}>Clear</button></p> : null}
          </div> : null}
          {saveNote ? <p className="mk-note">{saveNote}</p> : null}
          <ol className="mk-list" ref={listRef}>
            {onRetry ? <li className="mk-empty"><span role="alert">Moments couldn’t load.</span> <button type="button" onClick={onRetry}>Try again</button></li> : null}
            {loaded && !rows.length ? <li className="mk-empty">{gameEmpty ?? (view === 'saved' ? (savedCount ? 'No moments match.' : 'Nothing saved yet. Save a moment and it stays here, in this browser.')
              : view === 'viewed' ? (viewed.length ? 'No moments match.' : `Nothing viewed yet. Moments you open here stay in this list, in this browser, for ${VIEWED_DAYS} days.`)
                : view === 'top' && !qq && !game ? `No top moments in the last ${hoursText(range)}.` : 'No moments match.')}</li> : null}
            {rows.map(r => {
              if ('gone' in r) {
                return <li key={r.key} className="mk-g" data-sid={r.key}>
                  <GoneRow {...r.gone} gone={knownGone(r.gone.card)} now={now} onRemove={view === 'saved' ? () => removeSave(r.key) : undefined} /></li>
              }
              // Viewed and Top are one row a moment, so a stream can have several: those rows go by the moment
              const g = r.g, lead = g[0]
              const inline = !wide && selM && g.some(m => m.key === selM.key) ? selM : null
              return <li key={r.key} className={`mk-g${arrived.has(lead.key) ? ' new' : ''}`} data-sid={r.key} data-vd={lead.item.verdict}>
                <Row m={lead} more={g.length - 1} now={now} short={phone} current={selKey != null && g.some(m => m.key === selKey)}
                  opened={view === 'viewed' ? openedAt.get(lead.key) : undefined} onSelect={() => select(lead.key, { from: lead.key })} />
                {inline ? <div className="mk-slot">{detail(inline)}</div> : null}
              </li>
            })}
          </ol>
        </div>
      </section>
      <aside className="mk-det" aria-label="Selected moment">{!wide ? null : selM ? detail(selM)
        : gone ?? (deepWait === 'no' && groups.length ? <p className="mk-pick">Pick a moment.</p> : null)}</aside>
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
 * The small card a save or a Viewed entry keeps (V1, 10-30): who, what chat sent, the game and its id, when, and the row's
 * × with what rose. No rates, top emotes, pictures or minutes: the row draws from it without a read.
 */
function momentCard(m: CheckedMoment): (DiscoveryMoment & { multiplier?: number }) | null {
  const item = m.item
  const moment = fromHubMoment({ login: item.login, streamId: item.streamId, offsetSeconds: item.offsetSeconds, at: item.minuteStart,
    label: momentLabel(item.label.text), displayName: item.displayName, category: item.category?.name, categoryId: item.category?.id, kind: m.kind })
  return moment && { ...moment, measurementScope: undefined, multiplier: m.rowX ?? undefined }
}

/** A save, or a moment opened here, that the page doesn't hold: its card, and when it was opened (Viewed). */
interface GoneEntry { key: string; card: SavedMoment; opened?: number }

/**
 * A save the page doesn't hold (Unavailable saves C, 10-22), drawn from its card (V1, 10-30): channel and what happened,
 * the ×, an empty picture, no minutes, "Gone from the feed" once that is known (older than the window read), where it can
 * still be seen (the stream's page; a card holds no replay id), and the game last, as a row has it (phones leave it out).
 * The right column says when it was saved, with Remove under it (Q3b, 10-31), or under Viewed when it was opened.
 */
function GoneRow({ card, opened, gone, now, onRemove }: GoneEntry & { gone: boolean; now: number; onRemove?: () => void }) {
  const where = /^\d{1,30}$/.test(card.streamId) ? <Link to={broadcastTimelineHref(card.login, card.streamId, '/analytics/moments', card.offsetSeconds)}>Open it on the stream’s page</Link>
    : null
  const bits: Array<{ key: string; sep?: string; node: ReactNode }> = []
  if (card.multiplier != null) bits.push({ key: 'x', node: <span className="mk-r-x"><b>{fx(card.multiplier)}</b> more {card.reactionSignal === 'chat' ? 'chat' : 'emotes'}</span> })
  if (gone) bits.push({ key: 'gone', node: <span>Gone from the feed</span> })
  if (where) bits.push({ key: 'where', node: where })
  if (card.category) bits.push({ key: 'g', sep: 's-g', node: <span className="mk-r-g">{card.category}</span> })
  const at = new Date(opened ?? card.savedAt)
  return <div className="mk-r mk-r-gone" data-key={card.key}>
    <span className="mk-r-th" aria-hidden="true" />
    <span className="mk-r-tx">
      <span className="mk-r-l1"><span className="mk-r-nm">{card.displayName || card.login}</span><span className="mk-r-em"><span>{momentLabel(card.label)}</span></span></span>
      <span className="mk-r-l2">{bits.map((b, i) => <Fragment key={b.key}>{i ? <span className={`mk-sep${b.sep ? ` ${b.sep}` : ''}`} aria-hidden="true">·</span> : null}{b.node}</Fragment>)}</span>
    </span>
    <span className="mk-r-v">{opened != null
      ? <time className="mk-r-op" dateTime={at.toISOString()} title={at.toLocaleString('en-US')}>opened {openedWhen(opened, now)}</time>
      : <time dateTime={at.toISOString()} title={`Saved ${at.toLocaleString('en-US')}`}>{at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</time>}
    {onRemove ? <button className="mk-r-rm" type="button" aria-label={`Remove ${card.displayName || card.login}, ${momentLabel(card.label)}, from Saved`} onClick={onRemove}>Remove</button> : null}</span>
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
