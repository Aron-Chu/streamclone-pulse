/**
 * Top moments today (D1 C1 F1 O1, 10-30; board artifacts/moments-top-today-20261030):
 * the hub's rail is always the day's strongest moments, the last 24 hours.
 * Where the Moments list is on and answers, its top 20 by the feed's score, one
 * game at a time (chips with each game's count); otherwise the hub's own
 * moments on streams live now, strongest × first (hubV5TopModel). One source a
 * list, never both. The Picking up row stays on top, closed until clicked. A
 * row opens under itself (the clicked row never moves), one at a time, with its
 * numbers, the minutes around it where the list sends them, its top emotes and
 * Watch / Open in Moments; Esc closes it. While the pointer or focus is in the
 * list, or a row is open, what a read brings waits behind the "N new" pill; a
 * change of source (the list's rows for the hub's) waits only on an open row,
 * with no pill.
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
 * From 1100 to 1535 px the rail takes the height the row gives it and shows
 * the rows that fit ("Show N more"); from 1536 px it is the sticky column. On
 * phones a "Top today" peek under the hero shows rows 1–3 (HubV5TopPeek).
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { isApiError } from '../../../../lib/apiClient'
import { emoteDisplaySrc } from '../../../../lib/emoteAssetUrl'
import { clk, fx, hms, int, LEAD_S, whenShort, type MomentVod } from '../../../../lib/momentsChecked'
import { loadMomentsWindow, type MomentsFeedCategoryFacet, type MomentsFeedSnapshot } from '../../../../lib/momentsFeed'
import { momentsFeedEnabled } from '../../../../lib/momentsFeedFlag'
import { momentVods, vodSeconds } from '../../../../lib/momentsFeedVod'
import type { PublicHub } from '../../../../lib/publicHub'
import { useMatchMedia } from '../../../hooks/useMatchMedia'
import { HubToggletip } from '../d3/HubToggletip'
import '../d3/hub-d3-tokens.css'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Icon } from './HubV5Icon'
import { GameArt } from './HubV5Rack'
import {
  FEED_UP_LIST,
  FEED_UP_MIN,
  feedFreshText,
  feedMore,
  feedStale,
  feedUp,
  feedUpAria,
  type FeedUp,
} from './hubV5FeedModel'
import { channelHref, hubCategoryArt, hubSavedAt, hubSavedClock } from './hubV5Model'
import {
  TOP_KEEP_MS,
  TOP_MIN_X,
  TOP_READ,
  TOP_START_MIN,
  hubTopRows,
  topColumnCap,
  topCount,
  topCurve,
  topFeedRows,
  topFrom,
  topGames,
  topMomentsHref,
  topRowAria,
  type TopGame,
  type TopRowData,
} from './hubV5TopModel'

const H_ID = 'hv5-tm-h'
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const SEP = <span className="hv5-fd-sep" aria-hidden="true">·</span>
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

const isFeed = (v: TopView | null) => v?.source === 'feed' || v?.source === 'feed-old'
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
}

export interface TopToday {
  shown: TopView | null
  /** A game's list is coming: the shown one is another's. */
  busy: boolean
  /** New rows waiting behind the pill. */
  pending: number
  showPending: () => void
  /** Pointer or focus in the list: what a read brings waits. */
  hold: (what: 'hover' | 'focus', on: boolean) => void
  /** The game chips show: the list has answered this visit, so a pick can always go back to All. */
  chips: boolean
  game: TopGame | null
  games: TopGame[]
  pickGame: (game: TopGame | null) => void
  open: string | null
  setOpen: (open: string | null) => void
  up: FeedUp
  /** Live channels' pictures by login, for a row whose source sends none. */
  avatars: ReadonlyMap<string, string>
  /** Box art by game name, for Picking up. */
  art: ReadonlyMap<string, string>
}

/** The rail's state, shared by the rail and the phone peek (see the top of this file). */
export function useTopToday({ hub, savedAt, reading, attempt, nowMs }: TopTodayInput): TopToday {
  const [gone, setGone] = useState(false)
  const flag = import.meta.env.VITE_PUBLIC_MOMENTS_FEED
  // read inline so a production build without the flag folds the list's reads away
  const feed = (import.meta.env.PROD ? flag === 'on' || flag === '1' : momentsFeedEnabled()) && !gone
  const [game, setGame] = useState<TopGame | null>(null)
  const [open, setOpenState] = useState<string | null>(null)
  const key = game?.id ?? ''
  const onGone = useCallback(() => setGone(true), [])
  const read = useTopRead(feed, attempt, game?.id ?? null, onGone)
  const hubRows = useMemo(() => {
    const rows = hubTopRows(hub)
    // a saved copy's streams may have ended since: none of its rows says live now
    return savedAt != null ? rows.map((r) => ({ ...r, live: false })) : rows
  }, [hub, savedAt])
  const expired = !!read?.failed && read.snap != null && nowMs - read.snap.generatedAt > TOP_KEEP_MS

  // one source a list: the Moments list or its last answer greyed; else the hub's answer, the saved copy, or nothing
  const listView = useMemo<TopView | null>(() => (feed && read?.snap && !expired
    ? { key: read.key, source: read.failed ? 'feed-old' : 'feed', asOf: read.snap.generatedAt, total: topCount(read.snap), rows: topFeedRows(read.snap) }
    : null), [feed, read, expired])
  const hubView = useMemo<TopView | null>(() => {
    if (hub && (savedAt == null || hubRows.length || !reading)) {
      // a picked game's read failed with nothing kept: the hub's rows from that game, under its pressed chip
      const rows = feed && game ? hubRows.filter((r) => r.game === game.name) : hubRows
      return { key, source: savedAt != null ? 'saved' : 'hub', asOf: savedAt ?? Date.parse(hub.generatedAt), total: rows.length, rows }
    }
    return reading ? null : { key, source: 'none', asOf: null, total: 0, rows: [] }
  }, [hub, hubRows, savedAt, reading, key, feed, game])
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
  const showPending = useCallback(() => {
    setOpenState(null)
    if (latestRef.current) show(latestRef.current)
  }, [show])
  const pending = shown && latest && latest !== shown && latest.key === shown.key && !otherSource(shown, latest)
    ? latest.rows.filter((r) => !shown.rows.some((s) => s.id === r.id)).length
    : 0

  // a row that left the list closes; closing a row lets a waiting read in
  useEffect(() => { if (open && shown && !shown.rows.some((r) => r.id === open)) setOpenState(null) }, [open, shown])
  useEffect(() => { if (!open) release() }, [open, release])

  const pickGame = useCallback((next: TopGame | null) => {
    setOpenState(null)
    setGame(next)
  }, [])
  const games = useMemo(() => topGames(read?.games, game), [read, game])
  const up = useMemo(() => feedUp(hub), [hub])
  const avatars = useMemo(() => new Map((hub?.liveChannels ?? []).flatMap((c) => (c.profileImageUrl ? [[c.login.toLowerCase(), c.profileImageUrl] as const] : []))), [hub])
  const art = useMemo(() => hubCategoryArt(hub?.livePulseMoments ?? []), [hub])

  return {
    shown, busy: shown != null && shown.key !== key, pending, showPending, hold,
    chips: feed && read != null, game, games, pickGame, open, setOpen: setOpenState, up, avatars, art,
  }
}

/* ---------- Picking up ---------- */

/** "5.0× more emotes", as Moments writes it (games first, 10-22). */
const More = ({ x, ser }: { x: string; ser: 'chat' | 'emotes' }) => <span className="hv5-f2-x"><b>{x}</b> more {ser}</span>

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

function UpRow({ up, art, open, onToggle, onUpMore }: { up: FeedUp; art: ReadonlyMap<string, string>; open: boolean; onToggle: () => void; onUpMore?: () => void }) {
  const id = useId()
  const n = up.up.length
  const rest = n - FEED_UP_LIST
  return (
    <li>
      <button className="hv5-fd" type="button" aria-expanded={open} aria-controls={id} aria-label={feedUpAria(up)} onClick={onToggle}>
        <span className="hv5-fd-stack" aria-hidden="true">
          {up.up.slice(0, 3).map((x) => <HubV5Avatar key={x.login} login={x.login} name={x.name} src={x.avatar} size={22} />)}
        </span>
        <span className="hv5-fd-tx">
          <span className="hv5-fd-l1"><span className="hv5-f2-act hv5-f2-up">Picking up</span><span className="hv5-fd-nm hv5-f2-names">{n}{n === 1 ? ' channel' : ' channels'}</span></span>
          <span className="hv5-fd-l2"><span className="hv5-fd-w">chat {FEED_UP_MIN}×+ usual{up.upWindow ? ` · ${up.upWindow}` : ''}</span></span>
        </span>
        <span className="hv5-fd-end"><span className="hv5-fd-chev"><HubV5Icon name="down" /></span></span>
      </button>
      <ol className="hv5-fd-sub" id={id} hidden={!open}>
        {up.up.slice(0, FEED_UP_LIST).map((x) => (
          <li key={x.login}>
            <Link
              className="hv5-fd"
              to={channelHref({ login: x.login, streamId: x.streamId })}
              aria-label={`${x.name}, picking up: ${feedMore(x.add)} more chat a minute than usual, ${fx(x.x).replace('×', ' times')} usual${x.cat ? `, ${x.cat}` : ''}. Opens the stream page.`}
            >
              <span className="hv5-fd-av"><HubV5Avatar login={x.login} name={x.name} src={x.avatar} size={22} /></span>
              <span className="hv5-fd-tx">
                <span className="hv5-fd-l1"><span className="hv5-fd-nm">{x.name}</span></span>
                <span className="hv5-fd-l2"><More x={fx(x.x)} ser="chat" /><Game cat={x.cat} art={x.cat ? art.get(x.cat) ?? null : null} /></span>
              </span>
            </Link>
          </li>
        ))}
        {rest > 0 ? (
          <li className="hv5-f2-upmore">
            <a href="#channels" onClick={(event) => { if (onUpMore) { event.preventDefault(); onUpMore() } }}>+{rest} more in Channels, by chat vs own avg</a>
          </li>
        ) : null}
      </ol>
    </li>
  )
}

/* ---------- the chips ---------- */

function Games({ games, game, onGame }: { games: TopGame[]; game: TopGame | null; onGame: (game: TopGame | null) => void }) {
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

/* ---------- a row, and the row opened ---------- */

function TopDetail({ row, id, vod, live }: { row: TopRowData; id: string; vod: MomentVod | null; live: boolean }) {
  const c = row.checked ? topCurve(row.checked) : null
  const watch = vod
    ? `https://www.twitch.tv/videos/${vod.vodId}?t=${hms(vodSeconds(vod, row.offsetSeconds, LEAD_S))}`
    : `https://www.twitch.tv/${encodeURIComponent(row.login)}`
  return (
    <div className="hv5-tm-det" id={id} data-s={row.kind}>
      <p className="hv5-tm-dt">
        <span><b>{int(row.rate)}</b> <span className="hv5-tm-ttl">{row.kind} a minute</span></span>
        <span>usually {int(row.usual)}{row.viewers != null ? ` · ${int(row.viewers)} watching` : ''}{row.game ? ` · ${row.game}` : ''} · {clk(row.at)}</span>
        {row.also.length ? <span className="hv5-tm-why">The same emotes that minute on {row.also.join(', ')}</span> : null}
        {live ? <span className="hv5-tm-lv">● live now</span> : null}
      </p>
      {c ? (
        <>
          <svg className="hv5-tm-ch" viewBox={`0 0 ${c.w} ${c.h}`} preserveAspectRatio="none" aria-hidden="true">
            <rect className="hv5-tm-span" x={c.span.x} y={0} width={c.span.w} height={c.h} />
            {c.base != null ? <line className="hv5-tm-bl" x1={0} x2={c.w} y1={c.base} y2={c.base} /> : null}
            <path className="hv5-tm-ar" data-s={row.kind} d={c.area} />
            <path className="hv5-tm-ln" data-s="chat" d={c.chat} />
            <path className="hv5-tm-ln" data-s="emotes" d={c.emotes} />
          </svg>
          <div className="hv5-tm-ax">
            <span>{clk(c.from)}</span>
            <span className="hv5-tm-lg"><i data-s="chat" />chat<i data-s="emotes" />emotes<i className="hv5-tm-lgb" />usual</span>
            <span>{clk(c.to)}</span>
          </div>
        </>
      ) : null}
      {row.emotes.length ? (
        <ul className="hv5-tm-em" aria-label="Top emotes that minute">
          {row.emotes.map((e) => {
            const src = emoteDisplaySrc(e.imageUrl, 22)
            return (
              <li key={e.name}>
                {src ? <img src={src} alt="" width={22} height={22} decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
                <span>{e.name}</span><small>{int(e.count)}</small>
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className="hv5-tm-act">
        <a className="hv5-tm-btn hv5-tm-pri" href={watch} target="_blank" rel="noopener noreferrer">{vod ? 'Watch the moment' : 'Watch on Twitch'} <span aria-hidden="true">↗</span></a>
        <Link className="hv5-tm-btn" to={row.href}>Open in Moments</Link>
        <Link className="hv5-tm-btn hv5-tm-ghost" to={channelHref({ login: row.login, streamId: row.streamId })}>{row.name} →</Link>
      </div>
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
              {emoteSrc ? <img src={emoteSrc} alt="" width={18} height={18} decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
              <span>{row.emote.name}</span>
            </span>
          ) : null}
        </span>
        <span className="hv5-tm-l2">
          <More x={fx(row.x)} ser={row.kind} />
          <Game cat={row.game} art={null} />
        </span>
      </span>
      {row.game ? <span className="hv5-tm-cv hv5-tm-gm" aria-hidden="true"><GameArt url={row.art ?? undefined} name={row.game} w={18} h={24} /></span> : null}
      <time className="hv5-tm-t" dateTime={new Date(row.at).toISOString()} title={clk(row.at)} aria-hidden="true">{whenShort(row.at, nowMs)}</time>
    </>
  )
}

function TopRow({ row, avatar, rank, nowMs, open, old, live, vod, onToggle }: {
  row: TopRowData
  avatar: string | null
  rank: number
  nowMs: number
  open: boolean
  /** The list's last answer, kept after a read failed. */
  old: boolean
  /** Opened, it says "live now": its stream was live in an answer under 15 minutes old. */
  live: boolean
  vod: MomentVod | null
  onToggle: (id: string, el: HTMLElement) => void
}) {
  const id = useId()
  return (
    <li className={`hv5-tm-it${open ? ' hv5-tm-on' : ''}${old ? ' hv5-tm-old' : ''}`} data-id={row.id}>
      <button
        className="hv5-tm-row"
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={topRowAria(row, rank, nowMs, open)}
        onClick={(event) => onToggle(row.id, event.currentTarget)}
      >
        <RowFace row={row} avatar={avatar} rank={rank} nowMs={nowMs} />
      </button>
      {open ? <TopDetail row={row} id={id} vod={vod} live={live} /> : null}
    </li>
  )
}

/** The opened row's VOD (one stream-record read, shared with Moments), so Watch lands on the minute. */
function useOpenVod(row: TopRowData | null): { id: string; vod: MomentVod | null } | null {
  const [vod, setVod] = useState<{ id: string; vod: MomentVod | null } | null>(null)
  useEffect(() => {
    if (!row?.streamId) return undefined
    let live = true
    const hit = momentVods.peek(row)
    if (hit !== undefined) setVod({ id: row.id, vod: hit })
    else momentVods.read(row).then((v) => { if (live) setVod({ id: row.id, vod: v }) }, () => { if (live) setVod({ id: row.id, vod: null }) })
    return () => { live = false }
  }, [row])
  return vod
}

/* ---------- the words ---------- */

const UP_TIP = `Picking up: channels whose chat over the last 5 minutes ran at least ${FEED_UP_MIN}× their own usual.`
const FEED_TIP = 'The day’s strongest moments, the last 24 hours, from the Moments page’s own list, with its checks: the moments that hold up and rose, '
  + 'one per burst, strongest first by its score. The × is that minute against the stream’s 15 minutes before it (“6.2× more emotes”). '
  // ended streams drop out of the list until B1 brings them back (board 04)
  + `A game’s count is its moments today that hold up. Streams that have ended drop out. ${UP_TIP} Open a row for the minutes around the moment.`
/** A saved copy's streams may have ended since: it says when they were live, and keeps its rows (Q1b, 10-31). */
const hubTip = (savedAt: string | null) => `The day’s strongest moments, the last 24 hours, on streams ${savedAt ? `that were live ${savedAt}` : 'live now'}: `
  + 'the hub sends up to 10, from the 12 chattiest live channels. '
  + `None from a stream’s first ${TOP_START_MIN} minutes (chat saying hello), and only those at least ${TOP_MIN_X}× the stream’s own average before them. `
  + 'One row per burst; channels that counted the same emotes in the same minute share a row. Strongest × first. '
  + `${savedAt ? '' : 'Streams that have ended drop out. '}${UP_TIP} Open a row for its numbers.`
export const TOP_NONE = 'Unavailable right now.'
export const TOP_HUB_EMPTY = 'No standout moments on streams live now yet.'
export const TOP_HUB_END = 'That’s all on streams live now.'
/** A saved copy's last line, empty or not: "as of" its time, never "live now". */
export const topSavedLine = (rows: number, clock: string) => (rows ? `That’s all as of ${clock}.` : `No standout moments as of ${clock}.`)
const EVERY = 'Every moment today →'

/** The dot greys: still waiting, a kept list, a saved copy, nothing, or data over 3 minutes old. */
const staleView = (v: TopView | null, nowMs: number) => v == null || v.source === 'feed-old' || v.source === 'saved' || v.source === 'none' || feedStale(v.asOf, nowMs)
const savedClock = (v: TopView | null, nowMs: number) => (v?.source === 'saved' && v.asOf != null ? hubSavedClock(v.asOf, nowMs) : null)
const freshLine = (v: TopView | null, nowMs: number) => { const clock = savedClock(v, nowMs); return clock ? `Saved ${clock}` : feedFreshText(v?.asOf ?? null, nowMs) }
/** The hub's line under its rows: a saved copy's says when it was saved. */
const hubLine = (v: TopView, rows: number, nowMs: number) => { const clock = savedClock(v, nowMs); return clock ? topSavedLine(rows, clock) : rows ? TOP_HUB_END : TOP_HUB_EMPTY }

/* ---------- the rail ---------- */

export interface HubV5TopMomentsProps {
  top: TopToday
  nowMs: number
  /** "+N more in Channels": sort Channels by chat vs own avg and bring it into view. */
  onUpMore?: () => void
}

export function HubV5TopMoments({ top, nowMs, onUpMore }: HubV5TopMomentsProps) {
  const { shown, busy, pending, game, open, setOpen } = top
  const feed = isFeed(shown)
  const rows = useMemo(() => shown?.rows ?? [], [shown])
  const up = useMemo<FeedUp>(() => (feed && game ? { ...top.up, up: top.up.up.filter((u) => u.cat === game.name) } : top.up), [feed, game, top.up])
  const [upOpen, setUpOpen] = useState(false)
  const upOn = up.up.length > 0
  const vod = useOpenVod(rows.find((r) => r.id === open) ?? null)

  // 1100–1535 px: the rail takes the height Top emotes and Where chat is give the row (CSS hv5-fd-fit), and its rows fit that
  const column = useMatchMedia('(min-width: 1100px) and (max-width: 1535px)')
  const [showAll, setShowAll] = useState(false)
  const [columnPx, setColumnPx] = useState<number | null>(null)
  const secRef = useRef<HTMLElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const fit = column && !showAll && open == null && !(upOn && upOpen)
  useEffect(() => {
    const sec = secRef.current
    const wrap = wrapRef.current
    if (!fit || !sec || !wrap || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => setColumnPx(sec.getBoundingClientRect().bottom - wrap.getBoundingClientRect().top - 4)
    const observer = new ResizeObserver(measure)
    observer.observe(sec)
    measure()
    return () => observer.disconnect()
  }, [fit])
  // an open row or Picking up lets the rail grow (fit off), but only Show more lifts the cap
  const fitCap = column && columnPx != null ? topColumnCap(columnPx, upOn) : rows.length
  const cap = showAll ? rows.length : fitCap
  const listed = rows.slice(0, cap)
  const hidden = rows.length - listed.length

  // the clicked row never moves: undo the shift when a row above it closes
  const listRef = useRef<HTMLOListElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ id: string; top: number } | null>(null)
  const rowEl = (k: string) => [...(listRef.current?.children ?? [])].find((el) => (el as HTMLElement).dataset.id === k) as HTMLElement | undefined
  const onToggle = (k: string, el: HTMLElement) => {
    anchor.current = { id: k, top: el.getBoundingClientRect().top }
    setOpen(open === k ? null : k)
  }
  useLayoutEffect(() => {
    const a = anchor.current
    anchor.current = null
    const el = a ? rowEl(a.id) : undefined
    if (!a || !el) return
    const d = el.getBoundingClientRect().top - a.top
    if (Math.abs(d) < 0.5) return
    const body = bodyRef.current
    if (body && body.scrollHeight > body.clientHeight + 1 && getComputedStyle(body).overflowY !== 'visible') body.scrollTop += d
    else window.scrollBy(0, d)
  }, [open])

  // >= 1536 px the body scrolls inside the sticky rail: its bottom fades only while there is more below it (hub-v5.css)
  const [more, setMore] = useState(false)
  const measureMore = useCallback(() => {
    const body = bodyRef.current
    setMore(!!body && body.scrollHeight - body.scrollTop - body.clientHeight > 1)
  }, [])
  useLayoutEffect(() => measureMore())
  useEffect(() => {
    const body = bodyRef.current
    if (!body || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measureMore)
    observer.observe(body)
    return () => observer.disconnect()
  }, [measureMore])

  // a picked game: rows glide to their new places and new ones fade in
  const tops = useRef(new Map<string, number>())
  const lastKey = useRef<string | null>(null)
  useLayoutEffect(() => {
    const list = listRef.current
    const move = shown != null && lastKey.current != null && lastKey.current !== shown.key && !calm()
    if (shown) lastKey.current = shown.key
    const next = new Map<string, number>()
    let n = 0
    for (const node of list?.children ?? []) {
      const el = node as HTMLElement
      const k = el.dataset.id
      if (!k) continue
      next.set(k, el.offsetTop)
      if (!move || typeof el.animate !== 'function') continue
      const was = tops.current.get(k)
      if (was == null) el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: Math.min(n++, 20) * 16, easing: EASE, fill: 'backwards' })
      else if (Math.abs(was - el.offsetTop) > 1) el.animate([{ transform: `translateY(${was - el.offsetTop}px)` }, { transform: 'none' }], { duration: 380, easing: EASE })
    }
    tops.current = next
  })

  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return
    // the open row closes first; the chart's bar card stays
    event.preventDefault()
    const k = open
    anchor.current = null
    setOpen(null)
    rowEl(k)?.querySelector('button')?.focus()
  }

  const where = feed && game ? ` from ${game.name}` : ''
  const linkGame = feed ? game?.id ?? null : null
  const old = shown?.source === 'feed-old'
  // an answer over 15 minutes old (the hub's, still served) no longer says a stream is live now
  const recent = shown?.asOf != null && nowMs - shown.asOf <= TOP_KEEP_MS
  // the footer names the game: the count is the shown list's, the link the picked game's
  const shownGame = feed && shown?.key ? (game?.id === shown.key ? game : top.games.find((g) => g.id === shown.key)) ?? null : null
  let foot = null
  // nothing to show: the page's banner above has the one Try again (Q5b, 10-31)
  if (shown?.source === 'none') foot = <p className="hv5-tm-q">{TOP_NONE}</p>
  else if (shown && !feed && !busy) {
    foot = (
      <p className="hv5-tm-q">
        {hubLine(shown, rows.length, nowMs)} <Link className="hv5-tm-lnk" to={topMomentsHref(null)}>{EVERY}</Link>
      </p>
    )
  }

  return (
    <aside
      ref={secRef}
      id="latest"
      className={`hv5-sec hv5-latest hv5-feed hv5-top${fit ? ' hv5-fd-fit' : ''}${staleView(shown, nowMs) ? ' hv5-f2-stale' : ''}`}
      aria-labelledby={H_ID}
      onKeyDown={onKey}
    >
      <div className="hv5-rh">
        <h2 id={H_ID}><span className="hv5-fd-dot" aria-hidden="true" />Top moments today</h2>
        <span className="hv5-f2-fresh">{freshLine(shown, nowMs)}</span>
        {shown && shown.source !== 'none' ? <HubToggletip tip={feed ? FEED_TIP : hubTip(shown.source === 'saved' && shown.asOf != null ? hubSavedAt(shown.asOf, nowMs) : null)} label="About Top moments today" /> : null}
        <span className="hv5-end">
          <Link className={`hv5-mo-all${feed && game ? ' hv5-mo-game' : ''}`} to={topMomentsHref(linkGame)}>
            {feed && game ? <><span className="hv5-mo-gm">{game.name}</span>&nbsp;moments →</> : 'All moments →'}
          </Link>
        </span>
      </div>
      {top.chips ? <Games games={top.games} game={game} onGame={top.pickGame} /> : null}
      <div
        ref={wrapRef}
        className="hv5-f2-wrap hv5-tm-wrap"
        onPointerEnter={(event) => { if (event.pointerType !== 'touch') top.hold('hover', true) }}
        onPointerLeave={() => top.hold('hover', false)}
        onFocus={() => top.hold('focus', true)}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          top.hold('focus', false)
        }}
      >
        <button
          className="hv5-f2-pill"
          type="button"
          hidden={!pending}
          aria-label={`Show ${pending} new ${pending === 1 ? 'moment' : 'moments'}`}
          onClick={top.showPending}
        >
          {pending} new ↑
        </button>
        <div ref={bodyRef} className="hv5-tm-body" data-more={more ? '' : undefined} onScroll={measureMore}>
          {upOn ? <ol className="hv5-fd-list hv5-tm-up"><UpRow up={up} art={top.art} open={upOpen} onToggle={() => setUpOpen((o) => !o)} onUpMore={onUpMore} /></ol> : null}
          {shown ? (
            <ol ref={listRef} className={`hv5-tm-list${busy ? ' hv5-tm-busy' : ''}`} aria-labelledby={H_ID} aria-busy={busy || undefined}>
              {listed.map((row, i) => (
                <TopRow
                  key={row.id}
                  row={row}
                  avatar={row.avatar ?? top.avatars.get(row.login) ?? null}
                  rank={i + 1}
                  nowMs={nowMs}
                  open={open === row.id}
                  old={old}
                  live={row.live && recent}
                  vod={vod?.id === row.id ? vod.vod : null}
                  onToggle={onToggle}
                />
              ))}
            </ol>
          ) : (
            <>
              <ol className="hv5-tm-list hv5-tm-wait" aria-busy="true" aria-hidden="true">
                {Array.from({ length: 8 }, (_, i) => <li key={i} />)}
              </ol>
              <p role="status" className="hv5-vh">Loading top moments</p>
            </>
          )}
          {hidden > 0 || showAll ? (
            <div className="hv5-fd-more">
              <button
                className="hv5-qb"
                type="button"
                aria-expanded={showAll}
                onClick={() => {
                  // Show fewer closes an open row it hides, so the rail fits again and reads aren't held
                  if (showAll && open != null && rows.findIndex((r) => r.id === open) >= fitCap) setOpen(null)
                  setShowAll((v) => !v)
                  if (showAll) secRef.current?.scrollIntoView?.({ block: 'nearest' })
                }}
              >
                {showAll ? 'Show fewer' : `Show ${hidden} more`}
              </button>
            </div>
          ) : null}
          {feed && !busy && !rows.length ? <p className="hv5-tm-q">Nothing{where} in the last 24 hours.</p> : null}
          {foot}
        </div>
      </div>
      {feed && shown ? (
        <p className="hv5-tm-ft">
          {rows.length ? <>Top {rows.length} of {int(shown.total)}{shownGame ? ` ${shownGame.name} ${shown.total === 1 ? 'moment' : 'moments'}` : ''} today{SEP}</> : null}
          <Link to={topMomentsHref(linkGame)}>{feed && game ? `Every ${game.name} moment →` : 'Every moment →'}</Link>
        </p>
      ) : null}
    </aside>
  )
}

/* ---------- phones: the peek under the hero ---------- */

/**
 * Phones: "Top today" under the hero (CSS shows it under 720 px), the rail's
 * rows 1–3. A row opens in the rail below, which comes into view; the link
 * goes down to the rail. It says what the rail says when it has no rows.
 */
export function HubV5TopPeek({ top, nowMs }: { top: TopToday; nowMs: number }) {
  const { shown } = top
  const rows = shown?.rows.slice(0, 3) ?? []
  const onJump = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('latest')
    if (!target) return
    event.preventDefault()
    target.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' })
  }
  const onPick = (id: string) => {
    top.setOpen(id)
    window.requestAnimationFrame(() => {
      const el = [...document.querySelectorAll<HTMLElement>('#latest .hv5-tm-it')].find((li) => li.dataset.id === id)
      // focus goes with it, so the next Tab and a screen reader carry on from the opened row
      el?.querySelector<HTMLElement>('.hv5-tm-row')?.focus({ preventScroll: true })
      el?.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' })
    })
  }
  const line = shown?.source === 'none' ? TOP_NONE
    : shown && !rows.length ? (isFeed(shown) ? 'Nothing in the last 24 hours.' : hubLine(shown, 0, nowMs))
      : null
  return (
    <section
      className={`hv5-sec hv5-f3-peek hv5-top${staleView(shown, nowMs) ? ' hv5-f2-stale' : ''}`}
      aria-labelledby="hv5-pk-h"
      // Keeps the three rows' height while it waits (hub-v5.css), so they land without a shift.
      data-wait={shown ? undefined : ''}
    >
      <div className="hv5-rh">
        <h2 id="hv5-pk-h"><span className="hv5-fd-dot" aria-hidden="true" />Top today</h2>
        <span className="hv5-f2-fresh">{freshLine(shown, nowMs)}</span>
        <span className="hv5-end"><a className="hv5-mo-all" href="#latest" onClick={onJump}>Top moments ↓</a></span>
      </div>
      {shown ? (
        <ol className="hv5-tm-list">
          {rows.map((row, i) => (
            <li key={row.id} className={`hv5-tm-it${shown.source === 'feed-old' ? ' hv5-tm-old' : ''}`}>
              <button
                className="hv5-tm-row"
                type="button"
                aria-label={topRowAria(row, i + 1, nowMs, null)}
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
