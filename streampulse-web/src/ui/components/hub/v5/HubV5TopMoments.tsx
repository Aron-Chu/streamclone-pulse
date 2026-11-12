/**
 * Top moments today (D1 C1 F1 O1, 10-30; board artifacts/moments-top-today-20261030),
 * the day's strongest moments, the last 24 hours. Since M1 (hub rail board
 * 2026-11-02) they show in the carousel under the chart (HubV5BigMoments) with
 * the game chips, and the right rail is Picking up now (HubV5PickingUp); this
 * file keeps the state they share, the chips and the phone peek.
 * Where the Moments list is on and answers, its top 20 by the feed's score, one
 * game at a time (chips with each game's count); otherwise the hub's own
 * moments, strongest × first, with the ones it sent earlier today that this
 * browser kept (hubV5TopModel topDayRows; localStorage, beside the hub's saved
 * copy, so a page crash clears it too). One source a list, never both. While the pointer or keyboard focus is in the carousel,
 * what a read brings waits; a change of source (the list's rows for the hub's)
 * goes in at once.
 * Under 10 hub rows, each other channel's busiest minute from the chart's
 * hub/moments reads fills in after them (busiestFillRows; board 2A, 11-02),
 * labelled as that, never as a spike, and never kept in this browser.
 *
 * The list is read once each time the hub reads (a poll, Try again, back to
 * the tab), answered or not, so it keeps going while the hub fails, and once
 * when a game is picked. A read that fails leaves the last list up, greyed, for
 * 15 minutes; then the hub's rows stand in. A first read that fails (8 seconds
 * at most) leaves the hub's rows until a later read answers; a 404 (the
 * backend's list is off) leaves them for the rest of the visit. A picked
 * game's read that fails with nothing kept shows the hub's rows from that game.
 * With neither, the page's saved copy; with nothing at all, "Unavailable right
 * now."
 *
 * On phones a "Top today" peek under the hero shows rows 1–3 (HubV5TopPeek).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { isApiError } from '../../../../lib/apiClient'
import { emoteDisplaySrc } from '../../../../lib/emoteAssetUrl'
import { clk, fx, int, whenShort } from '../../../../lib/momentsChecked'
import { loadMomentsWindow, type MomentsFeedCategoryFacet, type MomentsFeedSnapshot } from '../../../../lib/momentsFeed'
import { momentsFeedEnabled } from '../../../../lib/momentsFeedFlag'
import type { HubLivePulseMoment, PublicHub } from '../../../../lib/publicHub'
import { publicHubCacheWritesStopped, STORAGE_PREFIX } from '../../../../lib/publicHubCacheReset'
import '../d3/hub-d3-tokens.css'
import { HubV5Avatar } from './HubV5Avatar'
import { GameArt } from './HubV5Rack'
import { feedFreshText, feedStale, feedUp, type FeedUp } from './hubV5FeedModel'
import { hubCategoryArt, hubSavedAt, hubSavedClock, screenerDown } from './hubV5Model'
import {
  TOP_KEEP_MS,
  TOP_MIN_X,
  TOP_READ,
  TOP_START_MIN,
  busiestFillRows,
  hubTopRows,
  topCount,
  topDayParse,
  topDayRows,
  topFeedRows,
  topFrom,
  topGames,
  topPlainLabel,
  topRowAria,
  type TopGame,
  type TopRowData,
} from './hubV5TopModel'

const SEP = <span className="hv5-fd-sep" aria-hidden="true">·</span>

/** The day's hub rows this browser kept; under the hub's saved-copy prefix, so a crash's reset clears it too. */
export const TOP_DAY_KEY = `${STORAGE_PREFIX}topDay`
function readTopDay(): TopRowData[] {
  try {
    const raw = window.localStorage.getItem(TOP_DAY_KEY)
    return raw ? topDayParse(JSON.parse(raw)) : []
  } catch {
    return []
  }
}
function writeTopDay(rows: readonly TopRowData[]) {
  if (publicHubCacheWritesStopped()) return
  try {
    window.localStorage.setItem(TOP_DAY_KEY, JSON.stringify(rows.map((r) => ({ ...r, live: false }))))
  } catch {
    // storage blocked or full: the list is the hub's latest only
  }
}
const sameIds = (a: readonly TopRowData[], b: readonly TopRowData[]) => a.length === b.length && a.every((r, i) => r.id === b[i]!.id)
const calm = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- the reads and what is shown ---------- */

interface TopRead {
  /** The game it was read for ('' for all). */
  key: string
  snap: MomentsFeedSnapshot | null
  /** The last read for this game failed; `snap` is that game's last answer this visit, if it had one. */
  failed: boolean
  /** The day's games, from the list's last answer (any game's), for the chips. */
  games: readonly MomentsFeedCategoryFacet[] | null
}

/**
 * The day's moments from the Moments list: read once for each hub read
 * (`attempt`, answered or not) and once when a game is picked; a game read
 * since the hub's last read comes back at once. Nothing is read before the
 * hub's first read starts, so first load reads once. A 404 calls `onGone`;
 * any other failure keeps that game's last answer this visit, if it had one
 * (none before the first answer, so the hub's rows stand in). Null until the
 * list first answers or fails.
 */
function useTopRead(on: boolean, attempt: number, game: string | null, onGone: () => void): TopRead | null {
  const [read, setRead] = useState<TopRead | null>(null)
  const cache = useRef<{ attempt: number; snaps: Map<string, MomentsFeedSnapshot> }>({ attempt: 0, snaps: new Map() })
  // each game's last answer this visit, whatever the attempt: what a failed read falls back to
  const last = useRef(new Map<string, MomentsFeedSnapshot>())
  const gone = useRef(onGone)
  gone.current = onGone

  useEffect(() => {
    if (!on || attempt < 1) return undefined
    const key = game ?? ''
    if (cache.current.attempt !== attempt) cache.current = { attempt, snaps: new Map() }
    const hit = cache.current.snaps.get(key)
    if (hit) {
      setRead({ key, snap: hit, failed: false, games: hit.categories })
      return undefined
    }
    const controller = new AbortController()
    loadMomentsWindow({ from: topFrom(Date.now()), sort: 'top', verdict: 'ok', limit: TOP_READ, category: game }, controller.signal).then(
      (snap) => {
        cache.current.snaps.set(key, snap)
        last.current.set(key, snap)
        setRead({ key, snap, failed: false, games: snap.categories })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // only a 404 (the list is off) is for the visit; anything else is read again with the hub's next read
        if (isApiError(error) && error.status === 404) gone.current()
        else setRead((prev) => ({ key, snap: last.current.get(key) ?? null, failed: true, games: prev?.games ?? null }))
      },
    )
    return () => controller.abort()
  }, [on, attempt, game])

  return read
}

export type TopSource = 'feed' | 'feed-old' | 'hub' | 'saved' | 'none'

export interface TopView {
  /** The game the list is for ('' for all). */
  key: string
  /** The Moments list's (greyed once a read failed), the hub's answer, the page's saved copy, or nothing. */
  source: TopSource
  /** When its data is from. */
  asOf: number | null
  /** The day's moments that hold up (the list's count), else the rows. */
  total: number
  rows: TopRowData[]
}

export const isFeed = (v: TopView | null) => v?.source === 'feed' || v?.source === 'feed-old'
/** One view is the list's and the other the hub's (a saved copy's included): their rows' ids are not comparable. */
const otherSource = (a: TopView, b: TopView) =>
  a.source !== 'none' && b.source !== 'none' && isFeed(a) !== isFeed(b)

export interface TopTodayInput {
  /** The hub answer on screen, a saved copy included; null for none or totals only. */
  hub: PublicHub | null
  /** The saved copy's time, while one is on screen. */
  savedAt: number | null
  /** A hub read is running for what is on screen: with nothing to show, the rail waits instead of saying unavailable. */
  reading: boolean
  /** The hub's read count (usePublicHubData's pollAttempt): the list is read again with each one. */
  attempt: number
  nowMs: number
  /** The chart's hub/moments answers this visit (the locks and their warm-up): busiest minutes that fill the hub's rows to 10. */
  busiest?: readonly HubLivePulseMoment[]
}

export interface TopToday {
  shown: TopView | null
  /** Pointer or focus in the carousel: what a read brings waits. */
  hold: (what: 'hover' | 'focus', on: boolean) => void
  /** The game chips show: the list has answered this visit, so a pick can always go back to All. */
  chips: boolean
  game: TopGame | null
  games: TopGame[]
  pickGame: (game: TopGame | null) => void
  open: string | null
  setOpen: (open: string | null) => void
  /** Picking up now (the rail), from the hub answer on screen. */
  up: FeedUp
  /** When Picking up's data is from; null before the hub's first answer. */
  upAsOf: number | null
  /** Picking up is the page's saved copy. */
  upSaved: boolean
  /** The chat counts behind Picking up did not load (screenerDown): `up` is the last good list, at most 3 min old, or empty. */
  upDown: boolean
  /** Live channels' pictures by login, for a row whose source sends none. */
  avatars: ReadonlyMap<string, string>
  /** Box art by game name, for Picking up. */
  art: ReadonlyMap<string, string>
}

/** How long Picking up keeps its last good list, greyed, while the chat counts don't load. */
export const UP_KEEP_MS = 3 * 60_000
const NO_UP: FeedUp = { up: [], upWindow: '' }

/** The rail's state, shared by the rail and the phone peek (see the top of this file). */
const NO_MOMENTS: readonly HubLivePulseMoment[] = []

export function useTopToday({ hub, savedAt, reading, attempt, nowMs, busiest = NO_MOMENTS }: TopTodayInput): TopToday {
  const [gone, setGone] = useState(false)
  const flag = import.meta.env.VITE_PUBLIC_MOMENTS_FEED
  // read inline so a production build without the flag folds the list's reads away
  const feed = (import.meta.env.PROD ? flag === 'on' || flag === '1' : momentsFeedEnabled()) && !gone
  const [game, setGame] = useState<TopGame | null>(null)
  const [open, setOpenState] = useState<string | null>(null)
  const key = game?.id ?? ''
  const onGone = useCallback(() => setGone(true), [])
  const read = useTopRead(feed, attempt, game?.id ?? null, onGone)
  // the day's rows the hub sent before, kept in this browser
  const [kept, setKept] = useState(readTopDay)
  const hubRows = useMemo(() => {
    if (!hub) return []
    const live = new Set(savedAt != null ? [] : hub.liveChannels.map((c) => c.login.toLowerCase()))
    const rows = hubTopRows(hub)
    // a saved copy's streams may have ended since: none of its rows says live now
    return topDayRows(kept, savedAt != null ? rows.map((r) => ({ ...r, live: false })) : rows, live, savedAt ?? Date.parse(hub.generatedAt))
  }, [hub, savedAt, kept])
  useEffect(() => {
    if (hub && savedAt == null && hubRows.length) {
      writeTopDay(hubRows)
      setKept((prev) => (sameIds(prev, hubRows) ? prev : hubRows))
    }
  }, [hub, savedAt, hubRows])
  const expired = !!read?.failed && read.snap != null && nowMs - read.snap.generatedAt > TOP_KEEP_MS

  // one source a list: the Moments list or its last answer greyed; else the hub's answer, the saved copy, or nothing
  const listView = useMemo<TopView | null>(() => (feed && read?.snap && !expired
    ? { key: read.key, source: read.failed ? 'feed-old' : 'feed', asOf: read.snap.generatedAt, total: topCount(read.snap), rows: topFeedRows(read.snap) }
    : null), [feed, read, expired])
  const hubView = useMemo<TopView | null>(() => {
    if (hub && (savedAt == null || hubRows.length || !reading)) {
      const asOf = savedAt ?? Date.parse(hub.generatedAt)
      // a picked game's read failed with nothing kept: the hub's rows from that game, under its pressed chip
      if (feed && game) {
        const rows = hubRows.filter((r) => r.game === game.name)
        return { key, source: savedAt != null ? 'saved' : 'hub', asOf, total: rows.length, rows }
      }
      // under 10, other channels' busiest minutes fill in; a saved copy's channels may have ended, so none says live
      const live = new Map(savedAt != null ? [] : hub.liveChannels.map((c) => [c.login.toLowerCase(), c] as const))
      const rows = [...hubRows, ...busiestFillRows(busiest, hubRows, live, asOf)]
      return { key, source: savedAt != null ? 'saved' : 'hub', asOf, total: rows.length, rows }
    }
    return reading ? null : { key, source: 'none', asOf: null, total: 0, rows: [] }
  }, [hub, hubRows, savedAt, reading, key, feed, game, busiest])
  const latest = feed && read?.key !== key ? null : listView ?? hubView

  // what is shown: a read's list waits while you're in the list or a row is open; a picked game shows at once
  const [shown, setShown] = useState<TopView | null>(null)
  const shownRef = useRef<TopView | null>(null)
  const latestRef = useRef(latest)
  latestRef.current = latest
  const openRef = useRef(open)
  openRef.current = open
  const held = useRef({ hover: false, focus: false })
  // a change of source (the list's rows against the hub's) waits only on an open row, with no "N new"
  const isHeld = useCallback((prev: TopView | null, next: TopView) => !!prev && prev.key === next.key && prev.rows.length > 0
    && (openRef.current != null || (!otherSource(prev, next) && (held.current.hover || held.current.focus))), [])
  const show = useCallback((next: TopView | null) => {
    shownRef.current = next
    setShown(next)
  }, [])
  useEffect(() => {
    const prev = shownRef.current
    // nothing to show yet: "Unavailable" gives way to the skeleton while a read runs
    if (!latest) {
      if (prev?.source === 'none') show(null)
      return
    }
    if (latest !== prev && !isHeld(prev, latest)) show(latest)
  }, [latest, show, isHeld])
  const release = useCallback(() => {
    const next = latestRef.current
    if (next && next !== shownRef.current && !isHeld(shownRef.current, next)) show(next)
  }, [show, isHeld])
  const hold = useCallback((what: 'hover' | 'focus', on: boolean) => {
    held.current[what] = on
    if (!on) release()
  }, [release])

  // a row that left the list closes; closing a row lets a waiting read in
  useEffect(() => { if (open && shown && !shown.rows.some((r) => r.id === open)) setOpenState(null) }, [open, shown])
  useEffect(() => { if (!open) release() }, [open, release])

  const pickGame = useCallback((next: TopGame | null) => {
    setOpenState(null)
    setGame(next)
  }, [])
  const games = useMemo(() => topGames(read?.games, game), [read, game])
  const hubUp = useMemo(() => feedUp(hub), [hub])
  const hubUpAsOf = hub ? savedAt ?? Date.parse(hub.generatedAt) : null
  // Our 5-minute chat read failed (screenerDown): "nothing is picking up" would be a guess. The rail says it
  // can't tell, and keeps the last good list greyed for up to 3 minutes (UP_KEEP_MS).
  const upDown = !!hub && screenerDown(hub.liveChannels)
  const lastUp = useRef<{ up: FeedUp; asOf: number } | null>(null)
  useEffect(() => {
    if (hub && !upDown && hubUpAsOf != null) lastUp.current = { up: hubUp, asOf: hubUpAsOf }
  }, [hub, upDown, hubUp, hubUpAsOf])
  const keptUp = upDown && lastUp.current && nowMs - lastUp.current.asOf <= UP_KEEP_MS ? lastUp.current : null
  const up = upDown ? keptUp?.up ?? NO_UP : hubUp
  const upAsOf = upDown ? keptUp?.asOf ?? null : hubUpAsOf
  const avatars = useMemo(() => new Map((hub?.liveChannels ?? []).flatMap((c) => (c.profileImageUrl ? [[c.login.toLowerCase(), c.profileImageUrl] as const] : []))), [hub])
  const art = useMemo(() => hubCategoryArt(hub?.livePulseMoments ?? []), [hub])

  return {
    shown, hold,
    chips: feed && read != null, game, games, pickGame, open, setOpen: setOpenState, up, upAsOf, upSaved: savedAt != null, upDown, avatars, art,
  }
}

/* ---------- Picking up ---------- */

/** "5.0× more emotes", as Moments writes it (games first, 10-22). */
const More = ({ x, ser }: { x: string; ser: 'chat' | 'emotes' }) => <span className="hv5-f2-x"><b>{x}</b> more {ser}</span>
/** A row with no ×: "Busiest minute · 1,204 chat/min". On a narrow row the game goes first, then the reason ellipses; the rate stays. */
const Plain = ({ row }: { row: TopRowData }) => (
  <span className="hv5-f2-x hv5-f2-plain">
    {row.plain ? <span className="hv5-f2-why">{topPlainLabel(row.plain)} ·</span> : null}
    <span className="hv5-f2-rt"> <b>{int(row.rate)}</b> {row.kind}/min</span>
  </span>
)

function Game({ cat, art }: { cat: string | null; art: string | null }) {
  if (!cat) return null
  return (
    <>
      {SEP}
      {art ? <img src={art} alt="" width={12} height={16} decoding="async" referrerPolicy="no-referrer" /> : null}
      <span className="hv5-fd-g">{cat}</span>
    </>
  )
}

/* ---------- the chips ---------- */

export function TopGames({ games, game, onGame }: { games: TopGame[]; game: TopGame | null; onGame: (game: TopGame | null) => void }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const shown = games.length >= 2 || !!game
  // an up/down wheel scrolls the covers sideways until either end, then the page scrolls
  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return undefined
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
      const max = strip.scrollWidth - strip.clientWidth
      const dy = event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? strip.clientWidth : 1)
      if (max <= 1 || (dy > 0 && strip.scrollLeft >= max - 1) || (dy < 0 && strip.scrollLeft <= 1)) return
      event.preventDefault()
      strip.scrollLeft += dy
    }
    strip.addEventListener('wheel', onWheel, { passive: false })
    return () => strip.removeEventListener('wheel', onWheel)
  }, [shown])
  if (!shown) return null
  return (
    <div ref={stripRef} className="hv5-fd-games hv5-tm-games" role="group" aria-label="Show one game">
      <button className="hv5-fd-gall" type="button" aria-pressed={!game} onClick={() => onGame(null)}>All</button>
      {games.map((g) => (
        <button
          key={g.id}
          className="hv5-fd-gm"
          type="button"
          title={g.name}
          aria-pressed={g.id === game?.id}
          aria-label={`${g.name}, ${g.moments} ${g.moments === 1 ? 'moment' : 'moments'} that hold up today`}
          onClick={() => onGame(g.id === game?.id ? null : g)}
        >
          <GameArt url={g.art ?? undefined} name={g.name} w={15} h={20} />
          <span className="hv5-fd-gn">{g.name}</span>
          <small>{g.moments}</small>
        </button>
      ))}
    </div>
  )
}

/** What a row shows (F1's look): rank, the channel's picture, who and the emote, "6.2× more emotes", the game's cover, the time. */
function RowFace({ row, avatar, rank, nowMs }: { row: TopRowData; avatar: string | null; rank: number; nowMs: number }) {
  const emoteSrc = emoteDisplaySrc(row.emote?.imageUrl, 18)
  return (
    <>
      <span className={`hv5-tm-rk${rank <= 3 ? ' hv5-tm-top' : ''}`} aria-hidden="true">{rank}</span>
      <span className="hv5-tm-cv hv5-tm-face" aria-hidden="true">
        <HubV5Avatar login={row.login} name={row.name} src={avatar} size={28} />
      </span>
      <span className="hv5-tm-tx" aria-hidden="true">
        <span className="hv5-tm-l1">
          <span className="hv5-tm-nm">{row.name}</span>
          {row.emote ? (
            <span className="hv5-f2-em">
              {emoteSrc ? <img src={emoteSrc} alt="" width={18} height={18} decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
              <span>{row.emote.name}</span>
            </span>
          ) : null}
        </span>
        <span className="hv5-tm-l2">
          {row.x != null ? <More x={fx(row.x)} ser={row.kind} /> : <Plain row={row} />}
          <Game cat={row.game} art={null} />
        </span>
      </span>
      {row.game ? <span className="hv5-tm-cv hv5-tm-gm" aria-hidden="true"><GameArt url={row.art ?? undefined} name={row.game} w={18} h={24} streamIds={[row.streamId]} /></span> : null}
      <time className="hv5-tm-t" dateTime={new Date(row.at).toISOString()} title={clk(row.at)} aria-hidden="true">{whenShort(row.at, nowMs)}</time>
    </>
  )
}

/* ---------- the words ---------- */

const FEED_TIP = 'The day’s strongest moments, the last 24 hours, from the Moments page’s own list, with its checks: the moments that hold up and rose, '
  + 'one per burst, strongest first by its score, one card per moment. The × is that minute against the stream’s 15 minutes before it (“6.2× more emotes”). '
  // ended streams drop out of the list until B1 brings them back (board 04)
  + 'A game’s count is its moments today that hold up. Streams that have ended drop out.'
/** A saved copy's streams may have ended since: it says when they were live, and keeps its rows (Q1b, 10-31). */
const hubTip = (savedAt: string | null) => `The day’s strongest moments, the last 24 hours, on streams ${savedAt ? `that were live ${savedAt}` : 'live today'}: `
  + 'the hub sends its latest 10, from the 12 chattiest live channels. '
  + `Those at least ${TOP_MIN_X}× the stream’s own average before them come first, strongest × first, one card per moment. `
  + `A moment from a stream’s first ${TOP_START_MIN} minutes (too soon for its average), or one whose two counts disagree, shows its rate a minute and no ×. `
  + 'Under 10, a “Busiest minute” card fills in for other channels: the most chat a minute in the chart’s reads, not a spike. '
  + 'This browser keeps the moments the hub sent earlier today, so a moment stays after its stream ends.'
/** Top moments today's "?" (the carousel's): the list's words, or the hub's. */
export const topTip = (v: TopView, nowMs: number) => (isFeed(v) ? FEED_TIP : hubTip(v.source === 'saved' && v.asOf != null ? hubSavedAt(v.asOf, nowMs) : null))
export const TOP_NONE = 'Unavailable right now.'
export const TOP_HUB_EMPTY = 'No standout moments on streams live now yet.'
export const TOP_HUB_END = 'That’s all so far today.'
/** A saved copy's last line, empty or not: "as of" its time, never "live now". */
export const topSavedLine = (rows: number, clock: string) => (rows ? `That’s all as of ${clock}.` : `No standout moments as of ${clock}.`)
/** The header's link: the Moments page (board 2A: it has no Top view yet). */
export const TOP_ALL = 'All moments →'

/** The dot greys: still waiting, a kept list, a saved copy, nothing, or data over 3 minutes old. */
export const topStale = (v: TopView | null, nowMs: number) => v == null || v.source === 'feed-old' || v.source === 'saved' || v.source === 'none' || feedStale(v.asOf, nowMs)
const savedClock = (v: TopView | null, nowMs: number) => (v?.source === 'saved' && v.asOf != null ? hubSavedClock(v.asOf, nowMs) : null)
export const topFresh = (v: TopView | null, nowMs: number) => { const clock = savedClock(v, nowMs); return clock ? `Saved ${clock}` : feedFreshText(v?.asOf ?? null, nowMs) }
/** The hub's line under its rows: a saved copy's says when it was saved. */
export const topEndLine = (v: TopView, rows: number, nowMs: number) => { const clock = savedClock(v, nowMs); return clock ? topSavedLine(rows, clock) : rows ? TOP_HUB_END : TOP_HUB_EMPTY }

/* ---------- phones: the peek under the hero ---------- */

/**
 * Phones: "Top today" under the hero (CSS shows it under 720 px), Top moments
 * today's rows 1–3. A row brings its channel's card to the front of the
 * carousel below (HubV5BigMoments), which comes into view; the link goes down
 * to it. It says what the carousel says when it has no rows.
 */
export function HubV5TopPeek({ top, nowMs }: { top: TopToday; nowMs: number }) {
  const { shown } = top
  const rows = shown?.rows.slice(0, 3) ?? []
  const onJump = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('big-moments')
    if (!target) return
    event.preventDefault()
    target.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' })
  }
  // the carousel takes the pick (top.open), brings the card to the front and comes into view
  const onPick = (id: string) => top.setOpen(id)
  const line = shown?.source === 'none' ? TOP_NONE
    : shown && !rows.length ? (isFeed(shown) ? 'Nothing in the last 24 hours.' : topEndLine(shown, 0, nowMs))
      : null
  return (
    <section
      className={`hv5-sec hv5-f3-peek hv5-top${topStale(shown, nowMs) ? ' hv5-f2-stale' : ''}`}
      aria-labelledby="hv5-pk-h"
      // Keeps the three rows' height while it waits (hub-v5.css), so they land without a shift.
      data-wait={shown ? undefined : ''}
    >
      <div className="hv5-rh">
        <h2 id="hv5-pk-h"><span className="hv5-fd-dot" aria-hidden="true" />Top today</h2>
        <span className="hv5-f2-fresh">{topFresh(shown, nowMs)}</span>
        <span className="hv5-end"><a className="hv5-mo-all" href="#big-moments" onClick={onJump}>Top moments ↓</a></span>
      </div>
      {shown ? (
        <ol className="hv5-tm-list">
          {rows.map((row, i) => (
            <li key={row.id} className={`hv5-tm-it${shown.source === 'feed-old' ? ' hv5-tm-old' : ''}`}>
              <button
                className="hv5-tm-row"
                type="button"
                aria-label={topRowAria(row, i + 1, nowMs)}
                onClick={() => onPick(row.id)}
              >
                <RowFace row={row} avatar={row.avatar ?? top.avatars.get(row.login) ?? null} rank={i + 1} nowMs={nowMs} />
              </button>
            </li>
          ))}
          {line ? <li className="hv5-fd-quiet">{line}</li> : null}
        </ol>
      ) : (
        <ol className="hv5-tm-list hv5-tm-wait" aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => <li key={i} />)}
        </ol>
      )}
    </section>
  )
}
