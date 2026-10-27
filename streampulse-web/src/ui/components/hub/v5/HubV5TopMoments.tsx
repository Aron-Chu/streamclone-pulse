/**
 * Top moments (F1, 10-25; board artifacts/feed-top20-board-20261025): where
 * the Moments list is on, the hub's feed is the top 20 moments of a window you
 * pick, 1 h to 7 days (24 h first), each tab saying how many it holds. Top
 * ranks them strongest first, Latest newest first; a game chip narrows both.
 * The Picking up row stays on top, closed until clicked. A row opens under
 * itself (the clicked row never moves) with the minutes around the moment, its
 * top emotes and Watch / Open in Moments. A quiet window offers the next one up.
 * While the pointer or focus is in the list, or a row is open, what a poll
 * brings waits behind the "N new" pill.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { isApiError } from '../../../../lib/apiClient'
import { avatarImage, boxArtImage, clk, emoteImage, fx, hms, int, LEAD_S, VERDICT_WORD, type CheckedMoment, type MomentVod } from '../../../../lib/momentsChecked'
import { loadMomentsWindow, type MomentsFeedSnapshot } from '../../../../lib/momentsFeed'
import { loadMomentVod, momentVodCache, vodSeconds } from '../../../../lib/momentsFeedVod'
import { HubToggletip } from '../d3/HubToggletip'
import '../d3/hub-d3-tokens.css'
import { HubV5Avatar } from './HubV5Avatar'
import { GameArt } from './HubV5Rack'
import { FEED_STALE_MS, FEED_UP_MIN, feedClockFloor } from './hubV5FeedModel'
import { channelHref } from './hubV5Model'
import {
  TOP_DEFAULT_WINDOW,
  TOP_FEW,
  TOP_READ,
  TOP_WINDOWS,
  topAgo,
  topCount,
  topCurve,
  topEmote,
  topFrom,
  topGames,
  topMomentsHref,
  topNextWindow,
  topRowAria,
  topRows,
  topWindow,
  type TopGame,
  type TopSort,
  type TopWindowKey,
} from './hubV5TopModel'

const H_ID = 'hv5-tm-h'
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
const SEP = <span className="hv5-fd-sep" aria-hidden="true">·</span>
const calm = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/* ---------- the reads: the picked window's list, and every window's count ---------- */

interface TopRead { key: string; sort: TopSort; snap: MomentsFeedSnapshot }

/**
 * The picked window's first 50 moments, read again with each hub poll (`at`);
 * a window already read since the last poll comes back at once. The tabs'
 * counts are one-moment reads of each window. A 404 (the backend's feed is
 * off) calls `onGone`; another failure keeps what was shown.
 */
function useTopMoments(at: string | null, win: TopWindowKey, sort: TopSort, game: string | null, onGone: () => void) {
  const key = `${win}|${sort}|${game ?? ''}`
  const [read, setRead] = useState<TopRead | null>(null)
  const [counts, setCounts] = useState<{ game: string | null; n: Partial<Record<TopWindowKey, number>> }>({ game: null, n: {} })
  const cache = useRef<{ at: string | null; reads: Map<string, TopRead> }>({ at, reads: new Map() })
  const gone = useRef(onGone)
  gone.current = onGone

  useEffect(() => {
    if (cache.current.at !== at) cache.current = { at, reads: new Map() }
    const hit = cache.current.reads.get(key)
    if (hit) {
      setRead(hit)
      return undefined
    }
    const controller = new AbortController()
    loadMomentsWindow({ from: topFrom(Date.now(), win), sort, limit: TOP_READ, category: game }, controller.signal).then(
      (snap) => {
        const next = { key, sort, snap }
        cache.current.reads.set(key, next)
        setRead(next)
      },
      (error: unknown) => {
        if (!controller.signal.aborted && isApiError(error) && error.status === 404) gone.current()
      },
    )
    return () => controller.abort()
  }, [at, key, win, sort, game])

  useEffect(() => {
    const controller = new AbortController()
    const now = Date.now()
    for (const w of TOP_WINDOWS) {
      loadMomentsWindow({ from: topFrom(now, w.key), sort: 'new', limit: 1, category: game }, controller.signal).then(
        (snap) => setCounts((prev) => ({ game, n: { ...(prev.game === game ? prev.n : {}), [w.key]: topCount(snap) } })),
        () => undefined,
      )
    }
    return () => controller.abort()
  }, [at, game])

  return { read, counts: counts.game === game ? counts.n : {} }
}

/* ---------- controls ---------- */

interface SegOption<K extends string> { key: K; label: ReactNode; aria?: string }

/** A radio group with a pill that slides to the pick; the arrow keys move the pick. */
function Seg<K extends string>({ label, value, options, onPick, small = false }: { label: string; value: K; options: Array<SegOption<K>>; onPick: (key: K) => void; small?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const pill = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const on = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')
    const p = pill.current
    if (!on || !p) return
    p.style.transform = `translateX(${on.offsetLeft}px)`
    p.style.width = `${on.offsetWidth}px`
    // placed once before it may glide, so it doesn't sweep in from the left on first paint
    if (!p.dataset.on) window.requestAnimationFrame(() => { p.dataset.on = '1' })
  })
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const i = options.findIndex((o) => o.key === value)
    const next = options[(i + (event.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]!
    event.preventDefault()
    onPick(next.key)
    ref.current?.querySelector<HTMLElement>(`[data-k="${next.key}"]`)?.focus()
  }
  return (
    <div ref={ref} className={`hv5-tm-seg${small ? ' hv5-tm-sm' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      <span ref={pill} className="hv5-tm-pill" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.key} type="button" role="radio" data-k={o.key} aria-checked={o.key === value} tabIndex={o.key === value ? 0 : -1} aria-label={o.aria} onClick={() => onPick(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Games({ games, game, onGame }: { games: TopGame[]; game: TopGame | null; onGame: (game: TopGame | null) => void }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const shown = games.length >= 2 || !!game
  // as the Live feed's strip: an up/down wheel scrolls the covers sideways until either end, then the page scrolls
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
          aria-label={`${g.name}, ${g.moments} ${g.moments === 1 ? 'moment' : 'moments'}`}
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

function TopDetail({ m, id, vod }: { m: CheckedMoment; id: string; vod: MomentVod | null }) {
  const item = m.item
  const c = topCurve(m)
  const rate = item[m.kind].perMin
  const usual = m.kind === 'chat' ? m.baseC : m.baseE
  const cat = item.category?.name
  const watch = vod
    ? `https://www.twitch.tv/videos/${vod.vodId}?t=${hms(vodSeconds(vod, item.offsetSeconds, LEAD_S))}`
    : `https://www.twitch.tv/${encodeURIComponent(item.login.toLowerCase())}`
  const emotes = item.topEmotes.slice(0, 3)
  return (
    <div className="hv5-tm-det" id={id} data-s={m.kind}>
      <p className="hv5-tm-dt">
        <span><b>{int(rate)}</b> <span className="hv5-tm-ttl">{m.kind} a minute</span></span>
        <span>usually {int(usual)}{item.viewers != null ? ` · ${int(item.viewers)} watching` : ''}{cat ? ` · ${cat}` : ''} · {clk(m.at)}</span>
        {m.rowX == null && m.why ? <span className="hv5-tm-why">{VERDICT_WORD[item.verdict]}: {m.why}</span> : null}
        {item.streamLive ? <span className="hv5-tm-lv">● live now</span> : null}
      </p>
      <svg className="hv5-tm-ch" viewBox={`0 0 ${c.w} ${c.h}`} preserveAspectRatio="none" aria-hidden="true">
        <rect className="hv5-tm-span" x={c.span.x} y={0} width={c.span.w} height={c.h} />
        {c.base != null ? <line className="hv5-tm-bl" x1={0} x2={c.w} y1={c.base} y2={c.base} /> : null}
        <path className="hv5-tm-ar" data-s={m.kind} d={c.area} />
        <path className="hv5-tm-ln" data-s="chat" d={c.chat} />
        <path className="hv5-tm-ln" data-s="emotes" d={c.emotes} />
      </svg>
      <div className="hv5-tm-ax">
        <span>{clk(c.from)}</span>
        <span className="hv5-tm-lg"><i data-s="chat" />chat<i data-s="emotes" />emotes<i className="hv5-tm-lgb" />usual</span>
        <span>{clk(c.to)}</span>
      </div>
      {emotes.length ? (
        <ul className="hv5-tm-em" aria-label="Top emotes that minute">
          {emotes.map((e) => {
            const src = emoteImage(e)
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
        <Link className="hv5-tm-btn" to={`/analytics/moments?${new URLSearchParams({ m: item.id })}`}>Open in Moments</Link>
        <Link className="hv5-tm-btn hv5-tm-ghost" to={channelHref({ login: item.login.toLowerCase(), streamId: item.streamId })}>{m.name} →</Link>
      </div>
    </div>
  )
}

function TopRow({ m, avatar, rank, nowMs, open, isNew, vod, onToggle }: {
  m: CheckedMoment
  avatar: string | null
  rank: number | null
  nowMs: number
  open: boolean
  isNew: boolean
  vod: MomentVod | null
  onToggle: (key: string, el: HTMLElement) => void
}) {
  const id = useId()
  const item = m.item
  const cat = item.category?.name || null
  const emote = topEmote(m)
  const emoteSrc = emote ? emoteImage(emote) : undefined
  return (
    <li className={`hv5-tm-it${open ? ' hv5-tm-on' : ''}${isNew ? ' hv5-fd-new' : ''}`} data-id={m.key}>
      <button
        className="hv5-tm-row"
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={topRowAria(m, rank, nowMs, open)}
        onClick={(event) => onToggle(m.key, event.currentTarget)}
      >
        {rank != null ? <span className={`hv5-tm-rk${rank <= 3 ? ' hv5-tm-top' : ''}`} aria-hidden="true">{rank}</span> : null}
        <span className="hv5-tm-cv hv5-tm-face" aria-hidden="true">
          <HubV5Avatar login={item.login} name={m.name} src={avatar} size={28} />
        </span>
        <span className="hv5-tm-tx" aria-hidden="true">
          <span className="hv5-tm-l1">
            <span className="hv5-tm-nm">{m.name}</span>
            {emote ? (
              <span className="hv5-f2-em">
                {emoteSrc ? <img src={emoteSrc} alt="" width={18} height={18} decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
                <span>{emote.name}</span>
              </span>
            ) : null}
          </span>
          <span className="hv5-tm-l2">
            {m.rowX != null
              ? <span className="hv5-f2-x"><b>{fx(m.rowX)}</b> more {m.kind}</span>
              : <span className="hv5-fd-w">{m.why || VERDICT_WORD[item.verdict]}</span>}
            {cat ? <>{SEP}<span className="hv5-fd-g">{cat}</span></> : null}
          </span>
        </span>
        {cat ? <span className="hv5-tm-cv hv5-tm-gm" aria-hidden="true"><GameArt url={boxArtImage(item)} name={cat} w={18} h={24} /></span> : null}
        <time className="hv5-tm-t" dateTime={new Date(m.at).toISOString()} title={clk(m.at)} aria-hidden="true">{topAgo(m.at, nowMs)}</time>
      </button>
      {open ? <TopDetail m={m} id={id} vod={vod} /> : null}
    </li>
  )
}

/* ---------- the feed ---------- */

interface TopView {
  key: string
  sort: TopSort
  asOf: number
  /** The window's moments that hold up or partly do (the tab's count). */
  total: number
  rows: CheckedMoment[]
}

function freshText(asOf: number | null, nowMs: number): string {
  if (asOf == null) return ''
  const s = Math.round((nowMs - asOf) / 1000)
  return `as of ${feedClockFloor(asOf)}${s >= 60 ? ` · ${Math.floor(s / 60)} min old` : ''}`
}

const TIP = 'The strongest moments of the window you pick, from the Moments page’s own list, with its checks. '
  + 'Top: the moments that hold up and rose, one per burst, strongest first by the feed’s score. Latest: every moment that holds up or partly does, newest first. '
  + 'The × is that minute against the stream’s 15 minutes before it (“6.2× more emotes”). '
  + 'A tab’s count is the window’s moments that hold up or partly do; a game’s count is every moment the feed has in that game. '
  + `Picking up: channels whose chat over the last 5 minutes ran at least ${FEED_UP_MIN}× their own usual. Open a row for the minutes around the moment.`

export interface HubV5TopMomentsProps {
  /** The hub's last poll: the list is read again with each one. */
  at: string | null
  nowMs: number
  /** Live channels' pictures by login, for a moment whose list item has none. */
  avatars?: ReadonlyMap<string, string>
  /** The backend's feed is off (404): the page goes back to the Live feed. */
  onGone: () => void
  /** The Picking up row (an `li`) for the picked game, or null. */
  up: (game: string | null) => ReactNode
}

const NO_AVATARS: ReadonlyMap<string, string> = new Map()

export function HubV5TopMoments({ at, nowMs, avatars = NO_AVATARS, onGone, up }: HubV5TopMomentsProps) {
  const [win, setWin] = useState<TopWindowKey>(TOP_DEFAULT_WINDOW)
  const [sort, setSort] = useState<TopSort>('top')
  const [game, setGame] = useState<TopGame | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const { read, counts } = useTopMoments(at, win, sort, game?.id ?? null, onGone)
  const key = `${win}|${sort}|${game?.id ?? ''}`

  const latest = useMemo<TopView | null>(() => (read
    ? { key: read.key, sort: read.sort, asOf: read.snap.generatedAt, total: topCount(read.snap), rows: topRows(read.snap.items, read.sort, read.snap.generatedAt) }
    : null), [read])
  const games = useMemo(() => topGames(read?.snap.categories, game), [read, game])

  // what is shown: a poll's list waits while you're in the list or a row is open; a new window, order or game shows at once
  const [shown, setShown] = useState<TopView | null>(null)
  const [fresh, setFresh] = useState<ReadonlySet<string> | null>(null)
  const shownRef = useRef<TopView | null>(null)
  const latestRef = useRef(latest)
  latestRef.current = latest
  const held = useRef({ hover: false, focus: false })
  const glide = useRef(false)
  const isHeld = () => held.current.hover || held.current.focus || open != null
  const show = useCallback((next: TopView) => {
    const prev = shownRef.current
    let added: Set<string> | null = null
    if (prev && prev.key === next.key) {
      const had = new Set(prev.rows.map((m) => m.key))
      added = new Set(next.rows.filter((m) => !had.has(m.key)).map((m) => m.key))
    } else glide.current = prev != null
    shownRef.current = next
    setShown(next)
    setFresh(added && added.size ? added : null)
  }, [])
  useEffect(() => {
    if (!latest || latest === shownRef.current) return
    if (shownRef.current?.key === latest.key && isHeld()) return
    show(latest)
    // isHeld reads refs and `open`; a change to either is handled where it happens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, show])
  const release = () => {
    const next = latestRef.current
    if (!isHeld() && next && next !== shownRef.current) show(next)
  }
  const pending = shown && latest && latest !== shown && latest.key === shown.key
    ? latest.rows.filter((m) => !shown.rows.some((s) => s.key === m.key)).length
    : 0

  // a row that left the list closes; closing a row lets a waiting poll in
  const rows = shown?.rows ?? []
  useEffect(() => { if (open && shown && !shown.rows.some((m) => m.key === open)) setOpen(null) }, [open, shown])
  useEffect(() => { if (!open) release() })

  // the opened row's VOD (one stream-record read, as Moments makes), so Watch lands on the minute
  const vods = useMemo(() => momentVodCache((item) => loadMomentVod(item, new AbortController().signal)), [])
  const [vod, setVod] = useState<{ key: string; vod: MomentVod | null } | null>(null)
  const openItem = rows.find((m) => m.key === open)?.item ?? null
  useEffect(() => {
    if (!openItem) return undefined
    let live = true
    const hit = vods.peek(openItem)
    if (hit !== undefined) setVod({ key: openItem.id, vod: hit })
    else vods.read(openItem).then((v) => { if (live) setVod({ key: openItem.id, vod: v }) }, () => { if (live) setVod({ key: openItem.id, vod: null }) })
    return () => { live = false }
  }, [openItem, vods])

  // the clicked row never moves: undo the shift when a row above it closes
  const listRef = useRef<HTMLOListElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<{ key: string; top: number } | null>(null)
  const rowEl = (k: string) => [...(listRef.current?.children ?? [])].find((el) => (el as HTMLElement).dataset.id === k) as HTMLElement | undefined
  const onToggle = (k: string, el: HTMLElement) => {
    anchor.current = { key: k, top: el.getBoundingClientRect().top }
    setOpen((o) => (o === k ? null : k))
  }
  useLayoutEffect(() => {
    const a = anchor.current
    anchor.current = null
    const el = a ? rowEl(a.key) : undefined
    if (!a || !el) return
    const d = el.getBoundingClientRect().top - a.top
    if (Math.abs(d) < 0.5) return
    const body = bodyRef.current
    if (body && body.scrollHeight > body.clientHeight + 1 && getComputedStyle(body).overflowY !== 'visible') body.scrollTop += d
    else window.scrollBy(0, d)
  }, [open])

  // a new window, order or game: rows glide to their new places and new ones fade in
  const tops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const list = listRef.current
    const move = glide.current && !calm()
    glide.current = false
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

  const pick = <T,>(set: (v: T) => void) => (v: T) => { setOpen(null); set(v) }
  const onWin = pick(setWin)
  const onSort = pick(setSort)
  const onGame = pick(setGame)
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || !open) return
    const k = open
    anchor.current = null
    setOpen(null)
    rowEl(k)?.querySelector('button')?.focus()
  }

  const busy = shown != null && shown.key !== key
  const ranked = shown?.sort === 'top'
  const w = topWindow(win)
  const next = topNextWindow(win)
  const where = game ? ` from ${game.name}` : ''
  const nextCount = next ? counts[next.key] : undefined
  const seeNext = next ? (
    <button type="button" className="hv5-tm-lnk" onClick={() => onWin(next.key)}>
      See {next.short}{nextCount != null ? ` · ${int(nextCount)}` : ''} →
    </button>
  ) : null
  const quiet = shown && !busy && shown.key === key && rows.length < TOP_FEW
  const upRow = up(game?.name ?? null)
  const asOf = shown?.asOf ?? null
  const stale = asOf != null && nowMs - asOf > FEED_STALE_MS
  const isNew = (m: CheckedMoment) => !!fresh?.has(m.key)

  return (
    <aside id="latest" className={`hv5-sec hv5-latest hv5-feed hv5-top${stale ? ' hv5-f2-stale' : ''}`} aria-labelledby={H_ID} onKeyDown={onKey}>
      <div className="hv5-rh">
        <h2 id={H_ID}><span className="hv5-fd-dot" aria-hidden="true" />Top moments</h2>
        <span className="hv5-f2-fresh">{freshText(asOf, nowMs)}</span>
        <HubToggletip tip={TIP} label="About Top moments" />
        <span className="hv5-end">
          <Link className={`hv5-mo-all${game ? ' hv5-mo-game' : ''}`} to={topMomentsHref(sort, game?.id ?? null)}>
            {game ? <><span className="hv5-mo-gm">{game.name}</span>&nbsp;moments →</> : 'All moments →'}
          </Link>
        </span>
      </div>
      <div className="hv5-tm-ctl">
        <Seg
          label="Time window"
          value={win}
          onPick={onWin}
          options={TOP_WINDOWS.map((t) => ({
            key: t.key,
            label: <>{t.short}{counts[t.key] != null ? <small>{int(counts[t.key])}</small> : null}</>,
            aria: `${t.words}${counts[t.key] != null ? `, ${int(counts[t.key])} moments` : ''}`,
          }))}
        />
        <Seg label="Order" value={sort} onPick={onSort} small options={[{ key: 'top', label: 'Top' }, { key: 'new', label: 'Latest' }]} />
      </div>
      <Games games={games} game={game} onGame={onGame} />
      <div
        className="hv5-f2-wrap hv5-tm-wrap"
        onPointerEnter={(event) => { if (event.pointerType !== 'touch') held.current.hover = true }}
        onPointerLeave={() => { held.current.hover = false; release() }}
        onFocus={() => { held.current.focus = true }}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
          held.current.focus = false
          release()
        }}
      >
        <button
          className="hv5-f2-pill"
          type="button"
          hidden={!pending}
          aria-label={`Show ${pending} new ${pending === 1 ? 'moment' : 'moments'}`}
          onClick={() => { setOpen(null); if (latestRef.current) show(latestRef.current) }}
        >
          {pending} new ↑
        </button>
        <div ref={bodyRef} className="hv5-tm-body">
          {upRow ? <ol className="hv5-fd-list hv5-tm-up">{upRow}</ol> : null}
          {shown ? (
            <ol ref={listRef} className={`hv5-tm-list${busy ? ' hv5-tm-busy' : ''}`} aria-labelledby={H_ID} aria-busy={busy || undefined}>
              {rows.map((m, i) => (
                <TopRow
                  key={m.key}
                  m={m}
                  avatar={avatarImage(m.item) ?? avatars.get(m.item.login.toLowerCase()) ?? null}
                  rank={ranked ? i + 1 : null}
                  nowMs={nowMs}
                  open={open === m.key}
                  isNew={isNew(m)}
                  vod={vod?.key === m.key ? vod.vod : null}
                  onToggle={onToggle}
                />
              ))}
            </ol>
          ) : (
            <ol className="hv5-tm-list hv5-tm-wait" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => <li key={i} />)}
            </ol>
          )}
          {quiet ? (
            <p className="hv5-tm-q">
              {rows.length === 0 ? `Nothing${where} in ${w.words}.` : `Only ${rows.length} ${rows.length === 1 ? 'moment' : 'moments'}${where} in ${w.words}.`}
              {seeNext ? <> {seeNext}</> : null}
            </p>
          ) : null}
        </div>
      </div>
      {shown && rows.length ? (
        <p className="hv5-tm-ft">
          {ranked ? 'Top' : 'Latest'} {rows.length} of {int(shown.total)}{game ? ` ${game.name}` : ''} moments
          {SEP}<Link to={topMomentsHref(shown.sort, game?.id ?? null)}>see all</Link>
        </p>
      ) : null}
    </aside>
  )
}
