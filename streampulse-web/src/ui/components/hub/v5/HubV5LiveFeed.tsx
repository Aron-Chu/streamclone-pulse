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
  feedFresh,
  feedHref,
  feedIsQuiet,
  feedLivesAria,
  feedMomentSer,
  feedMore,
  feedMultiplier,
  feedRestTip,
  feedRowAria,
  feedTip,
  feedUpAria,
  liveFeedModel,
  type FeedEvent,
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
 * the last list.
 */
function useMomentsList(at: string | null): { list: FeedMomentsList | null; settled: boolean } {
  const [on] = useState(momentsListOn)
  const [state, setState] = useState<{ list: FeedMomentsList | null; settled: boolean; gone: boolean }>(() => ({ list: null, settled: !on, gone: !on }))
  const gone = state.gone
  useEffect(() => {
    if (gone) return undefined
    const controller = new AbortController()
    pollMomentsFeed(Date.now(), controller.signal).then(
      (snap) => setState({ list: { items: snap.items, generatedAt: snap.generatedAt }, settled: true, gone: false }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState((prev) => (isApiError(error) && error.status === 404 ? { list: null, settled: true, gone: true } : { ...prev, settled: true }))
      },
    )
    return () => controller.abort()
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

/** One number a row (L1): × usual beside the time; a went-live row's is its viewers. The rest are in the aria label and the moment card. */
function GroupRow({ item, model, nowMs, isNew }: { item: Extract<FeedItem, { group: FeedEvent[] }>; model: LiveFeedModel; nowMs: number; isNew: boolean }) {
  const group = item.group
  const e = group[0]!
  const rest = group.length - 1
  const cat = e.cat || group.map((x) => x.cat).find(Boolean) || null
  let act: ReactNode
  let mid: ReactNode = null
  if (e.kind === 'spike') {
    act = <span className="hv5-f2-act hv5-f3-spk">{e.ser === 'chat' ? 'chat spike' : 'emote spike'}</span>
    mid = <span className="hv5-f2-x">{feedMultiplier(e.x)} usual</span>
  } else if (e.kind === 'moment') {
    const emote = e.act.emote
    act = emote ? (
      <>
        <span className="hv5-f2-act hv5-f3-spk">spammed</span>
        <span className="hv5-f2-em">
          {emote.imageUrl ? <img src={emote.imageUrl} alt="" width={20} height={20} decoding="async" referrerPolicy="no-referrer" /> : null}
          <span>{emote.name}</span>
        </span>
      </>
    ) : <span className="hv5-f2-act hv5-f3-spk">{e.act.word}</span>
    // a Moments-list row writes its × as that page does; one that partly holds up says why instead.
    // The × says what it counts, as on Moments (X1, 10-22): "emotes 5.7× usual"
    mid = e.x != null
      ? <span className="hv5-f2-x"><span className="hv5-f2-xk">{feedMomentSer(e)}</span> {e.list ? fx(e.x) : feedMultiplier(e.x)} usual</span>
      : e.why ? <span className="hv5-fd-w">{e.why}</span> : null
  } else {
    act = <span className="hv5-f2-act hv5-f2-live">went live</span>
    // a fresh stream's chat rate is mostly hellos, so it shows only when chat is jumping
    mid = e.jump ? <Jump /> : null
  }
  const viewers = e.kind === 'live' ? <Viewers viewers={e.viewers} /> : null
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
        <span className={`hv5-fd-av${group.some((x) => x.kind === 'live') ? ' hv5-f2-ring' : ''}`}>
          <HubV5Avatar login={e.login} name={e.name} src={e.avatar} size={28} />
        </span>
        <span className="hv5-fd-tx">
          <span className="hv5-fd-l1"><span className="hv5-fd-nm">{e.name}</span>{act}</span>
          <span className="hv5-fd-l2">
            <Ago at={e.at} nowMs={nowMs} />
            {mid ? <>{SEP}{mid}</> : null}
            {viewers}
            <Game cat={cat} art={artFor(e, cat, model)} />
            {rest ? <>{SEP}<span className="hv5-f2-more">+{rest} earlier</span></> : null}
          </span>
        </span>
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
                <span className="hv5-fd-l2"><span className="hv5-f2-x">{feedMultiplier(x.x)} usual</span><Game cat={x.cat} art={artFor(null, x.cat, model)} /></span>
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
  const model = feed.shown
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
        <span className="hv5-end"><Link className="hv5-mo-all" to="/analytics/moments">All moments →</Link></span>
      </div>
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
          {model.asOf != null && !upOn && !rows.length ? <p className="hv5-fd-quiet">Quiet right now · nothing in the last hour</p> : null}
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
