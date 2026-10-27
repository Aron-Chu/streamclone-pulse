/**
 * Live feed v3 (mockup d3-v5 hub-live.js / hub-live.css, the default since
 * 2026-10-17): the rail beside the page from 1536 px, under the chart below.
 * One row per channel, newest first: chat spikes, moments, went live (the
 * smaller starts share one row), and a "Picking up" row on top. Rows older than
 * 30 minutes fade under an "earlier" rule; a quiet hour says so. The header
 * says how old the data is and greys its dot after 3 minutes. While the pointer
 * or focus is in the list, rows a poll brings wait behind an "N new" pill.
 * A moment row shows the moment card after a 150 ms rest (keyboard focus at
 * once) and opens it in Moments. On phones a 3-row "Live now" peek sits under
 * the hero (HubV5LivePeek).
 * The mockup's Replay button was its polling demo; this page polls for real.
 *
 * L1 (10-21): where /analytics/moments is the checked page, the moment rows
 * come from its list, read again with each hub poll. One number a row (× usual);
 * the rest are in the moment card. From 1100 to 1535 px the list takes the
 * column's height, and a quiet hour shows the day's top moments under it.
 *
 * F2 (10-22): the feed's games sit as covers under the header; one shows that
 * game's rows only, again clears it.
 *
 * Games first (L1, 10-22): a channel's row leads with its game's cover and says
 * "5.0× more emotes · Chess", the time short on the right; the strip's covers
 * carry their names.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { isApiError } from '../../../../lib/apiClient'
import { fx } from '../../../../lib/momentsChecked'
import { pollMomentsFeed } from '../../../../lib/momentsFeed'
import { momentsFeedEnabled } from '../../../../lib/momentsFeedFlag'
import type { HubLivePulseMoment, PublicHub } from '../../../../lib/publicHub'
import { HubToggletip } from '../d3/HubToggletip'
import '../d3/hub-d3-tokens.css'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Icon } from './HubV5Icon'
import { GameArt } from './HubV5Rack'
import {
  FEED_BIG_VIEWERS,
  FEED_LIVES_LIST,
  FEED_STALE_MS,
  FEED_UP_LIST,
  FEED_UP_MIN,
  feedAgo,
  feedCap,
  feedClockFloor,
  feedColumnCap,
  feedForGame,
  feedFresh,
  feedGames,
  feedHref,
  feedIsQuiet,
  feedLivesAria,
  feedMomentSer,
  feedMomentsHref,
  feedMore,
  feedMultiplier,
  feedRestTip,
  feedRowAria,
  feedShort,
  feedTip,
  feedUpAria,
  liveFeedModel,
  type FeedEvent,
  type FeedGame,
  type FeedItem,
  type FeedLive,
  type FeedMomentsList,
  type LiveFeedModel,
} from './hubV5FeedModel'
import {
  channelHref,
  formatHubInt,
  formatHubMultiplier,
  formatHubRate,
  hubClock,
  isLowMultiplier,
  multiplierWords,
  type HubMomentRowV5,
} from './hubV5Model'

const H_ID = 'hv5-lf-h'
const REST_MS = 150

export function useMedia(query: string): boolean {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [matches, setMatches] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [query])
  return matches
}

function useInnerHeight(): number {
  const [h, setH] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight))
  useEffect(() => {
    const on = () => setH(window.innerHeight)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return h
}

/* ---------- the feed's state: what is shown, what a poll brought, and the hold ---------- */

export interface HubLiveFeed {
  shown: LiveFeedModel
  /** Event keys the last applied poll brought (they slide in once). */
  fresh: ReadonlySet<string> | null
  /** New rows waiting behind the pill. */
  pending: number
  setHeld: (held: boolean) => void
  flush: () => void
}

/** The checked Moments page is on (read inline so a production build folds it away, as AnalyticsMomentsPage does). */
function momentsListOn(): boolean {
  const flag = import.meta.env.VITE_PUBLIC_MOMENTS_FEED
  return import.meta.env.PROD ? flag === 'on' || flag === '1' : momentsFeedEnabled()
}

/**
 * The Moments list's newest page, read on mount and again with each hub poll.
 * `settled` once the first read answers either way. A 404 (the backend's feed is
 * off) ends the reads and leaves the hub's own moment rows; another failure keeps
 * the last list. The mount read already answers for the hub's first snapshot,
 * so that snapshot does not read the same page a second time.
 */
function useMomentsList(at: string | null): { list: FeedMomentsList | null; settled: boolean } {
  const [on] = useState(momentsListOn)
  const [state, setState] = useState<{ list: FeedMomentsList | null; settled: boolean; gone: boolean }>(() => ({ list: null, settled: !on, gone: !on }))
  const gone = state.gone
  const coversFirstSnapshot = useRef(at === null)
  const reading = useRef<AbortController | null>(null)
  useEffect(() => () => reading.current?.abort(), [])
  useEffect(() => {
    if (gone) return
    if (at !== null && coversFirstSnapshot.current) {
      coversFirstSnapshot.current = false
      return
    }
    reading.current?.abort()
    const controller = new AbortController()
    reading.current = controller
    pollMomentsFeed(Date.now(), controller.signal).then(
      (snap) => setState({ list: { items: snap.items, generatedAt: snap.generatedAt }, settled: true, gone: false }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        // A failed mount read leaves the hub's first snapshot to try again.
        coversFirstSnapshot.current = false
        setState((prev) => (isApiError(error) && error.status === 404 ? { list: null, settled: true, gone: true } : { ...prev, settled: true }))
      },
    )
  }, [at, gone])
  return state
}

export function useHubLiveFeed(hub: PublicHub | null): HubLiveFeed {
  const moments = useMomentsList(hub?.generatedAt ?? null)
  // until the list's first answer the feed waits, so its moment rows don't arrive as "new"
  const latest = useMemo(() => (moments.settled ? liveFeedModel(hub, moments.list) : liveFeedModel(null)), [hub, moments.settled, moments.list])
  const latestRef = useRef(latest)
  latestRef.current = latest
  const held = useRef(false)
  const [state, setState] = useState<{ shown: LiveFeedModel; fresh: ReadonlySet<string> | null }>(() => ({ shown: latest, fresh: null }))
  const flush = useCallback(() => {
    setState((prev) => {
      const next = latestRef.current
      if (prev.shown === next) return prev
      const fresh = feedFresh(prev.shown, next)
      return { shown: next, fresh: fresh.size ? fresh : null }
    })
  }, [])
  useEffect(() => { if (!held.current) flush() }, [latest, flush])
  const setHeld = useCallback((h: boolean) => {
    held.current = h
    if (!h) flush()
  }, [flush])
  const pending = state.shown === latest ? 0 : feedFresh(state.shown, latest).size
  return { shown: state.shown, fresh: state.fresh, pending, setHeld, flush }
}

/* ---------- pieces of a row ---------- */

const SEP = <span className="hv5-fd-sep" aria-hidden="true">·</span>

function artFor(e: FeedEvent | null, cat: string | null, model: LiveFeedModel): string | null {
  if (e?.kind === 'moment' && e.row.moment.boxArtUrl && !e.row.moment.categoryMetadataRejected) return e.row.moment.boxArtUrl
  return cat ? model.art.get(cat) ?? null : null
}

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

function Ago({ at, nowMs }: { at: number; nowMs: number }) {
  return <time dateTime={new Date(at).toISOString()}>{feedAgo(at, nowMs)}</time>
}

const Jump = () => <span className="hv5-f3-jump">chat jumping</span>
const Viewers = ({ viewers }: { viewers: number | null }) => (viewers != null ? <>{SEP}<span className="hv5-fd-w">{formatHubInt(viewers)} viewers</span></> : null)
/** "5.0× more emotes", as Moments writes it (games first, 10-22). */
const More = ({ x, ser }: { x: string; ser: 'chat' | 'emotes' }) => <span className="hv5-f2-x"><b>{x}</b> more {ser}</span>

/**
 * Games first (L1, 10-22): the row leads with its game's cover; then who and what chat sent, "5.0× more emotes" and the
 * game, and the time on the right ("13m"). A went-live row says its viewers. The rest are in the aria label, the title
 * ("Earlier: …") and the moment card.
 */
function GroupRow({ item, model, nowMs, isNew }: { item: Extract<FeedItem, { group: FeedEvent[] }>; model: LiveFeedModel; nowMs: number; isNew: boolean }) {
  const group = item.group
  const e = group[0]!
  const cat = e.cat || group.map((x) => x.cat).find(Boolean) || null
  let act: ReactNode = null
  let mid: ReactNode = null
  if (e.kind === 'spike') {
    mid = <More x={feedMultiplier(e.x)} ser={e.ser} />
  } else if (e.kind === 'moment') {
    const emote = e.act.emote
    act = emote ? (
      <span className="hv5-f2-em">
        {emote.imageUrl ? <img src={emote.imageUrl} alt="" width={20} height={20} decoding="async" referrerPolicy="no-referrer" /> : null}
        <span>{emote.name}</span>
      </span>
    ) : <span className="hv5-f2-act">{e.act.word}</span>
    // a Moments-list row writes its × as that page does; one that partly holds up says why instead
    mid = e.x != null
      ? <More x={e.list ? fx(e.x) : feedMultiplier(e.x)} ser={feedMomentSer(e)} />
      : e.why ? <span className="hv5-fd-w">{e.why}</span> : null
  } else {
    act = <span className="hv5-f2-act hv5-f2-live">went live</span>
    // a fresh stream's chat rate is mostly hellos, so it shows only when chat is jumping
    mid = e.jump ? <Jump /> : e.viewers != null ? <span className="hv5-fd-w">{formatHubInt(e.viewers)} viewers</span> : null
  }
  const tip = feedRestTip(group)
  return (
    <li className={`hv5-fd-it${isNew ? ' hv5-fd-new' : ''}${item.old ? ' hv5-f3-old' : ''}`} data-kind={e.kind}>
      <Link
        className="hv5-fd"
        to={feedHref(e)}
        data-key={item.key}
        data-mom-key={e.kind === 'moment' ? e.row.key : undefined}
        title={tip || undefined}
        aria-label={feedRowAria(group, nowMs)}
      >
        {cat
          ? <span className="hv5-fd-art"><GameArt url={artFor(e, cat, model) ?? undefined} name={cat} w={30} h={40} /></span>
          : <span className="hv5-fd-av"><HubV5Avatar login={e.login} name={e.name} src={e.avatar} size={28} /></span>}
        <span className="hv5-fd-tx">
          <span className="hv5-fd-l1"><span className="hv5-fd-nm">{e.name}</span>{act}</span>
          <span className="hv5-fd-l2">
            {mid}
            {cat ? <>{mid ? SEP : null}<span className="hv5-fd-g">{cat}</span></> : null}
          </span>
        </span>
        <time className="hv5-fd-t" dateTime={new Date(e.at).toISOString()} title={hubClock(e.at)}>{feedShort(e.at, nowMs)}</time>
      </Link>
    </li>
  )
}

function LivesRow({ lives, old, model, nowMs, isNew }: { lives: FeedLive[]; old: boolean; model: LiveFeedModel; nowMs: number; isNew: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const n = lives.length
  const what = n === 1 ? ' smaller channel' : ' smaller channels'
  return (
    <li className={`hv5-fd-it${isNew ? ' hv5-fd-new' : ''}${old ? ' hv5-f3-old' : ''}`} data-kind="lives">
      <button className="hv5-fd" type="button" data-key="lives" aria-expanded={open} aria-controls={id} aria-label={feedLivesAria(lives, nowMs)} onClick={() => setOpen((o) => !o)}>
        <span className="hv5-fd-stack" aria-hidden="true">
          {lives.slice(0, 3).map((e) => <HubV5Avatar key={e.key} login={e.login} name={e.name} src={e.avatar} size={22} />)}
        </span>
        <span className="hv5-fd-tx">
          <span className="hv5-fd-l1"><span className="hv5-f2-act hv5-f2-live">Went live</span><span className="hv5-fd-nm hv5-f2-names">{n}{what}</span></span>
          <span className="hv5-fd-l2"><span className="hv5-fd-w">latest <Ago at={lives[0]!.at} nowMs={nowMs} /> · under {formatHubInt(FEED_BIG_VIEWERS)} viewers each</span></span>
        </span>
        <span className="hv5-fd-end"><span className="hv5-fd-chev"><HubV5Icon name="down" /></span></span>
      </button>
      <ol className="hv5-fd-sub" id={id} hidden={!open}>
        {lives.slice(0, FEED_LIVES_LIST).map((e) => (
          <li key={e.key} className="hv5-fd-it" data-kind="live">
            <Link
              className="hv5-fd"
              to={feedHref(e)}
              data-key={e.key}
              aria-label={`${e.name} went live ${feedAgo(e.at, nowMs)}${e.jump ? ', chat jumping' : ''}${e.cat ? `, ${e.cat}` : ''}${e.viewers != null ? `, ${formatHubInt(e.viewers)} viewers now` : ''}. Opens the stream page.`}
            >
              <span className="hv5-fd-av"><HubV5Avatar login={e.login} name={e.name} src={e.avatar} size={22} /></span>
              <span className="hv5-fd-tx">
                <span className="hv5-fd-l1"><span className="hv5-fd-nm">{e.name}</span>{e.jump ? <Jump /> : null}</span>
                <span className="hv5-fd-l2"><Ago at={e.at} nowMs={nowMs} /><Viewers viewers={e.viewers} /><Game cat={e.cat} art={artFor(null, e.cat, model)} /></span>
              </span>
            </Link>
          </li>
        ))}
        {n > FEED_LIVES_LIST ? <li className="hv5-f2-upmore">+{n - FEED_LIVES_LIST} more, each under {formatHubInt(FEED_BIG_VIEWERS)} viewers</li> : null}
      </ol>
    </li>
  )
}

function UpRow({ model, isNew, onUpMore }: { model: LiveFeedModel; isNew: boolean; onUpMore?: () => void }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const n = model.up.length
  const rest = n - FEED_UP_LIST
  return (
    <li className={`hv5-fd-it${isNew ? ' hv5-fd-new' : ''}`} data-kind="now">
      <button className="hv5-fd" type="button" data-key="now" aria-expanded={open} aria-controls={id} aria-label={feedUpAria(model)} onClick={() => setOpen((o) => !o)}>
        <span className="hv5-fd-stack" aria-hidden="true">
          {model.up.slice(0, 3).map((x) => <HubV5Avatar key={x.login} login={x.login} name={x.name} src={x.avatar} size={22} />)}
        </span>
        <span className="hv5-fd-tx">
          <span className="hv5-fd-l1"><span className="hv5-f2-act hv5-f2-up">Picking up</span><span className="hv5-fd-nm hv5-f2-names">{n}{n === 1 ? ' channel' : ' channels'}</span></span>
          <span className="hv5-fd-l2"><span className="hv5-fd-w">chat {FEED_UP_MIN}×+ usual{model.upWindow ? ` · ${model.upWindow}` : ''}</span></span>
        </span>
        <span className="hv5-fd-end"><span className="hv5-fd-chev"><HubV5Icon name="down" /></span></span>
      </button>
      <ol className="hv5-fd-sub" id={id} hidden={!open}>
        {model.up.slice(0, FEED_UP_LIST).map((x) => (
          <li key={x.login} className="hv5-fd-it" data-kind="up">
            <Link
              className="hv5-fd"
              to={channelHref({ login: x.login, streamId: x.streamId })}
              data-key={`u:${x.login}`}
              aria-label={`${x.name}, picking up: ${feedMore(x.add)} more chat a minute than usual, ${multiplierWords(x.x)} times usual${x.cat ? `, ${x.cat}` : ''}. Opens the stream page.`}
            >
              <span className="hv5-fd-av"><HubV5Avatar login={x.login} name={x.name} src={x.avatar} size={22} /></span>
              <span className="hv5-fd-tx">
                <span className="hv5-fd-l1"><span className="hv5-fd-nm">{x.name}</span></span>
                <span className="hv5-fd-l2"><More x={feedMultiplier(x.x)} ser="chat" /><Game cat={x.cat} art={artFor(null, x.cat, model)} /></span>
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

/* ---------- the moment card (R5-2's, for moment rows) ---------- */

function MomentArt({ moment }: { moment: HubLivePulseMoment }) {
  return moment.boxArtUrl && !moment.categoryMetadataRejected
    ? <img src={moment.boxArtUrl} alt="" width={12} height={16} decoding="async" referrerPolicy="no-referrer" />
    : null
}

function MomentCard({ row, avatar }: { row: HubMomentRowV5; avatar: string | null }) {
  const m = row.moment
  const unit = `${row.series}/min`
  const cmp = row.cmp
  return (
    <>
      <div className="hv5-mc-h">
        <HubV5Avatar login={row.login} name={row.displayName} src={avatar} size={24} />
        <span className="hv5-mc-nm">{row.displayName}</span>
        {row.at != null ? <span className="hv5-mc-t">{hubClock(row.at)}</span> : null}
      </div>
      <div className="hv5-mc-g"><MomentArt moment={m} /><span>{m.category || 'Game not sent'}</span></div>
      <div className="hv5-mc-r"><b>{formatHubRate(row.rate)}</b> {unit}<span className="hv5-mc-l">{row.label}</span></div>
      {'x' in cmp && cmp.over ? (
        <p className="hv5-mc-x">
          <b className={isLowMultiplier(cmp.x) ? 'lo' : undefined}>{fx(cmp.x)}</b> {cmp.over}
          <span>{formatHubRate(cmp.avg)} {unit} on average over the {cmp.mins} measured min before it</span>
        </p>
      ) : 'x' in cmp ? (
        <p className="hv5-mc-x">
          <b className={isLowMultiplier(cmp.x) ? 'lo' : undefined}>{formatHubMultiplier(cmp.x)}</b> its own average
          <span>{formatHubRate(cmp.avg)} {unit} on average before this, over {cmp.mins} measured min</span>
        </p>
      ) : (
        <p className="hv5-mc-x hv5-mc-na">{cmp.long}</p>
      )}
      {row.topEmoteName ? (
        <div className="hv5-mc-e">
          Top emote {row.topEmote?.imageUrl ? <img src={row.topEmote.imageUrl} alt="" width={20} height={20} decoding="async" /> : null}
          <b>{row.topEmoteName}</b>
        </div>
      ) : null}
      <p className="hv5-mc-go">Click to open in Moments</p>
    </>
  )
}

function useMomentCard(byKey: ReadonlyMap<string, { row: HubMomentRowV5; avatar: string | null }>) {
  const fine = useMedia('(pointer: fine)')
  const [on, setOn] = useState<{ key: string; el: HTMLElement } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)
  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    setOn(null)
  }, [])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  // a row that left the list (a new poll) takes its card with it
  useEffect(() => { if (on && !byKey.has(on.key)) hide() }, [byKey, on, hide])
  useEffect(() => {
    if (!on) return undefined
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide() }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('scroll', hide, { passive: true, capture: true })
    window.addEventListener('resize', hide)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', hide, { capture: true })
      window.removeEventListener('resize', hide)
    }
  }, [on, hide])
  // beside the row (right, else left); with no room beside it, under or over; kept 8 px inside the window
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!on || !card) return
    const b = on.el.getBoundingClientRect()
    const w = card.offsetWidth
    const h = card.offsetHeight
    const g = 10
    let left = b.right + g
    if (left + w > window.innerWidth - 8) left = b.left - g - w
    let top = b.top + b.height / 2 - h / 2
    if (left < 8) {
      left = Math.max(8, Math.min(window.innerWidth - w - 8, b.left))
      top = b.bottom + g + h <= window.innerHeight - 8 ? b.bottom + g : b.top - g - h
    }
    card.style.left = `${Math.round(left)}px`
    card.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, top)))}px`
    card.style.visibility = ''
  }, [on])

  const rowOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('[data-mom-key]') : null)
  const handlers = {
    onPointerOver: (event: PointerEvent<HTMLElement>) => {
      const el = rowOf(event.target)
      if (!el || el === on?.el || event.pointerType === 'touch' || !fine) return
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        if (el.isConnected && el.matches(':hover')) setOn({ key: el.dataset.momKey!, el })
      }, on ? 0 : REST_MS)
    },
    onPointerOut: (event: PointerEvent<HTMLElement>) => {
      const el = rowOf(event.target)
      if (!el || (event.relatedTarget instanceof Node && el.contains(event.relatedTarget))) return
      window.clearTimeout(timer.current)
      if (on?.el === el) hide()
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      const el = rowOf(event.target)
      let visible = false
      try { visible = Boolean(el?.matches(':focus-visible')) } catch { visible = false }
      if (el && visible) setOn({ key: el.dataset.momKey!, el })
      else if (on) hide()
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      if (on && event.target === on.el) hide()
    },
  }
  const current = on ? byKey.get(on.key) : undefined
  const card = current && typeof document !== 'undefined'
    ? createPortal(
      <div ref={cardRef} className="hub-d3-layer hv5-layer hv5-mo-card" aria-hidden="true" data-hv5-moment-card="" style={{ left: 0, top: 0, visibility: 'hidden' }}>
        <MomentCard row={current.row} avatar={current.avatar} />
      </div>,
      document.body,
    )
    : null
  return { handlers, card }
}

/* ---------- F2: one game at a time ---------- */

function GameStrip({ games, game, onGame }: { games: FeedGame[]; game: string | null; onGame: (game: string | null) => void }) {
  const stripRef = useRef<HTMLDivElement>(null)
  const shown = games.length >= 2 || !!game
  // An up/down wheel scrolls the covers sideways (the scrollbar is hidden). At either end the page scrolls;
  // sideways swipes and Shift+wheel stay native; Ctrl+wheel stays the browser's zoom.
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
    <div ref={stripRef} className="hv5-fd-games" role="group" aria-label="Show one game">
      <button className="hv5-fd-gall" type="button" aria-pressed={!game} onClick={() => onGame(null)}>All</button>
      {games.map((g) => (
        <button
          key={g.name}
          className="hv5-fd-gm"
          type="button"
          title={g.name}
          aria-pressed={g.name === game}
          aria-label={`${g.name}, ${g.rows} ${g.rows === 1 ? 'row' : 'rows'}`}
          onClick={() => onGame(g.name === game ? null : g.name)}
        >
          <GameArt url={g.art ?? undefined} name={g.name} w={15} h={20} />
          <span className="hv5-fd-gn">{g.name}</span>
        </button>
      ))}
    </div>
  )
}

/* ---------- the header's age line ---------- */

function freshText(asOf: number | null, nowMs: number): string {
  if (asOf == null) return ''
  const s = Math.round((nowMs - asOf) / 1000)
  return `as of ${feedClockFloor(asOf)}${s >= 60 ? ` · ${Math.floor(s / 60)} min old` : ''}`
}
const isStale = (asOf: number | null, nowMs: number) => asOf != null && nowMs - asOf > FEED_STALE_MS

/* ---------- the rail ---------- */

export interface HubV5LiveFeedProps {
  feed: HubLiveFeed
  nowMs: number
  loading?: boolean
  /** "+N more in Channels": sort Channels by chat vs own avg and bring it into view. */
  onUpMore?: () => void
}

export function HubV5LiveFeed({ feed, nowMs, loading = false, onUpMore }: HubV5LiveFeedProps) {
  const [game, setGame] = useState<string | null>(null)
  const model = useMemo(() => feedForGame(feed.shown, game), [feed.shown, game])
  const games = useMemo(() => feedGames(feed.shown, game), [feed.shown, game])
  // the picked game, when its id is known: "All moments →" opens Moments on it
  const linked = game ? games.find((g) => g.name === game && g.id) ?? null : null
  const phone = useMedia('(max-width: 719px)')
  const wide = useMedia('(min-width: 1536px)')
  const column = useMedia('(min-width: 1100px) and (max-width: 1535px)')
  const innerHeight = useInnerHeight()
  const [showAll, setShowAll] = useState(false)
  // a Picking up or went-live list is open: the feed grows under it instead of keeping the column's height
  const [opened, setOpened] = useState(false)
  const [columnPx, setColumnPx] = useState<number | null>(null)
  const secRef = useRef<HTMLElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hover = useRef(false)
  const focus = useRef(false)

  // 1100–1535 px: the rail takes the height Top emotes and Where chat is give the row (CSS hv5-fd-fit), and its rows fit that
  const fit = column && !showAll && !opened
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

  const upOn = model.up.length > 0
  const cap = column && columnPx != null ? feedColumnCap(columnPx) : feedCap(phone, wide, innerHeight)
  const room = Math.max(0, cap - (upOn ? 1 : 0))
  const shown = model.items.slice(0, showAll ? model.items.length : room)
  const hidden = model.items.length - shown.length
  const quiet = feedIsQuiet(model)
  // a quiet hour: the day's top moments under it, in the rows it leaves
  const filler = quiet ? model.top.slice(0, Math.max(0, room - shown.length)) : []
  const fresh = feed.fresh
  const isNew = (it: FeedItem) => !!fresh && ('group' in it ? fresh.has(it.group[0]!.key) : it.lives.some((e) => fresh.has(e.key)))

  const byKey = useMemo(() => {
    const map = new Map<string, { row: HubMomentRowV5; avatar: string | null }>()
    for (const it of model.top) if ('group' in it) for (const e of it.group) if (e.kind === 'moment') map.set(e.row.key, { row: e.row, avatar: e.avatar })
    for (const e of model.events) if (e.kind === 'moment') map.set(e.row.key, { row: e.row, avatar: e.avatar })
    return map
  }, [model])
  const { handlers, card } = useMomentCard(byKey)

  // While the pointer or focus is in the list, a poll's rows wait behind the pill.
  const { setHeld } = feed
  const sync = () => setHeld(hover.current || focus.current)
  useEffect(() => () => setHeld(false), [setHeld])

  let ruled = false
  const rows: ReactNode[] = []
  for (const it of shown) {
    if (it.old && !ruled) {
      ruled = true
      rows.push(<li key="rule" className="hv5-f3-rule" aria-hidden="true">earlier</li>)
    }
    rows.push('group' in it
      ? <GroupRow key={it.key} item={it} model={model} nowMs={nowMs} isNew={isNew(it)} />
      : <LivesRow key={it.key} lives={it.lives} old={it.old} model={model} nowMs={nowMs} isNew={isNew(it)} />)
  }
  if (filler.length) {
    rows.push(<li key="rule-top" className="hv5-f3-rule" aria-hidden="true">{ruled ? 'top moments today' : 'earlier today, top moments'}</li>)
    for (const it of filler) if ('group' in it) rows.push(<GroupRow key={it.key} item={it} model={model} nowMs={nowMs} isNew={false} />)
  }

  const stale = isStale(model.asOf, nowMs)
  return (
    <aside
      ref={secRef}
      id="latest"
      className={`hv5-sec hv5-latest hv5-feed${showAll ? ' hv5-fd-all' : ''}${fit ? ' hv5-fd-fit' : ''}${stale ? ' hv5-f2-stale' : ''}`}
      aria-labelledby={H_ID}
    >
      <div className="hv5-rh">
        <h2 id={H_ID}><span className="hv5-fd-dot" aria-hidden="true" />Live feed</h2>
        <span className="hv5-f2-fresh">{freshText(model.asOf, nowMs)}</span>
        <HubToggletip tip={feedTip(model)} label="About the Live feed" />
        <span className="hv5-end">
          <Link className={`hv5-mo-all${linked ? ' hv5-mo-game' : ''}`} to={feedMomentsHref(linked)}>
            {linked ? <><span className="hv5-mo-gm">{linked.name}</span>&nbsp;moments →</> : 'All moments →'}
          </Link>
        </span>
      </div>
      <GameStrip games={games} game={game} onGame={setGame} />
      <div
        ref={wrapRef}
        className="hv5-f2-wrap"
        onPointerEnter={(event) => { if (event.pointerType !== 'touch') { hover.current = true; sync() } }}
        onPointerLeave={() => { hover.current = false; sync() }}
        onFocus={() => { focus.current = true; sync() }}
        onBlur={(event) => {
          if (event.relatedTarget instanceof Node && wrapRef.current?.contains(event.relatedTarget)) return
          focus.current = false
          sync()
        }}
      >
        <button
          className="hv5-f2-pill"
          type="button"
          hidden={!feed.pending}
          aria-label={`Show ${feed.pending} new ${feed.pending === 1 ? 'event' : 'events'}`}
          onClick={() => feed.flush()}
        >
          {feed.pending} new ↑
        </button>
        <div
          className="hv5-fd-body"
          {...handlers}
          onClick={() => window.requestAnimationFrame(() => setOpened(!!wrapRef.current?.querySelector('.hv5-fd-list [aria-expanded="true"]')))}
        >
          {model.asOf != null && !upOn && !rows.length ? <p className="hv5-fd-quiet">{game ? `Nothing from ${game} in the last hour` : 'Quiet right now · nothing in the last hour'}</p> : null}
          {upOn || rows.length ? (
            <ol className="hv5-fd-list" aria-labelledby={H_ID}>
              {upOn ? <UpRow model={model} isNew={!!fresh?.has('now')} onUpMore={onUpMore} /> : null}
              {rows}
            </ol>
          ) : null}
          {hidden > 0 || showAll ? (
            <div className="hv5-fd-more">
              <button
                className="hv5-qb"
                type="button"
                aria-expanded={showAll}
                onClick={() => {
                  setShowAll((v) => !v)
                  if (showAll) secRef.current?.scrollIntoView?.({ block: 'nearest' })
                }}
              >
                {showAll ? 'Show fewer' : `Show ${hidden} more`}
              </button>
            </div>
          ) : null}
          {model.asOf == null && !loading ? <p className="hv5-none">No live data yet.</p> : null}
        </div>
      </div>
      {card}
    </aside>
  )
}

/** Phones: a 3-row "Live now" peek under the hero (CSS shows it under 720 px); the full feed stays where it is. */
export function HubV5LivePeek({ feed, nowMs }: { feed: HubLiveFeed; nowMs: number }) {
  const model = feed.shown
  const groups = model.items.filter((it): it is Extract<FeedItem, { group: FeedEvent[] }> => 'group' in it).slice(0, 3)
  if (model.asOf == null) return null
  const onJump = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('latest')
    if (!target) return
    event.preventDefault()
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }
  return (
    <section className={`hv5-sec hv5-f3-peek${isStale(model.asOf, nowMs) ? ' hv5-f2-stale' : ''}`} aria-labelledby="hv5-pk-h">
      <div className="hv5-rh">
        <h2 id="hv5-pk-h"><span className="hv5-fd-dot" aria-hidden="true" />Live now</h2>
        <span className="hv5-f2-fresh">{freshText(model.asOf, nowMs)}</span>
        <span className="hv5-end"><a className="hv5-mo-all" href="#latest" onClick={onJump}>Live feed ↓</a></span>
      </div>
      <ol className="hv5-fd-list">
        {groups.length
          ? groups.map((it) => <GroupRow key={it.key} item={{ ...it, old: false }} model={model} nowMs={nowMs} isNew={false} />)
          : <li className="hv5-fd-quiet">Quiet right now.</li>}
      </ol>
    </section>
  )
}
