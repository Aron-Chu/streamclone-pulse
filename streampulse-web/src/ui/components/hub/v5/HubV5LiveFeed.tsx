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
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
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
  FEED_WINDOW_MS,
  feedAgo,
  feedCap,
  feedClockFloor,
  feedFresh,
  feedHref,
  feedIsQuiet,
  feedLivesAria,
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

export function useHubLiveFeed(hub: PublicHub | null): HubLiveFeed {
  const latest = useMemo(() => liveFeedModel(hub), [hub])
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

const SizeFig = ({ add, unit }: { add: number; unit: string }) => (
  <span className="hv5-mo-v"><span className="hv5-mo-x">+{feedMore(add)}</span><span className="hv5-mo-u">more {unit}/min</span></span>
)
const XFig = ({ x, unit }: { x: number; unit: string }) => (
  <span className="hv5-mo-v"><span className={`hv5-mo-x${isLowMultiplier(x) ? ' lo' : ''}`}>{formatHubMultiplier(x)}</span><span className="hv5-mo-u">{unit} vs avg</span></span>
)
const ViewFig = ({ viewers }: { viewers: number | null }) => (
  viewers != null
    ? <span className="hv5-mo-v"><span className="hv5-mo-x hv5-sm">{formatHubInt(viewers)}</span><span className="hv5-mo-u">viewers now</span></span>
    : <span className="hv5-mo-v" />
)
const Jump = () => <span className="hv5-f3-jump">chat jumping</span>

function GroupRow({ item, model, nowMs, isNew }: { item: Extract<FeedItem, { group: FeedEvent[] }>; model: LiveFeedModel; nowMs: number; isNew: boolean }) {
  const group = item.group
  const e = group[0]!
  const rest = group.length - 1
  const cat = e.cat || group.map((x) => x.cat).find(Boolean) || null
  let act: ReactNode
  let mid: ReactNode = null
  let fig: ReactNode
  if (e.kind === 'spike') {
    const unit = e.ser === 'chat' ? 'chat' : 'emotes'
    act = <span className="hv5-f2-act hv5-f3-spk">{e.ser === 'chat' ? 'chat spike' : 'emote spike'}</span>
    mid = <span className="hv5-f2-x">{feedMultiplier(e.x)} usual</span>
    fig = <SizeFig add={e.add} unit={unit} />
  } else if (e.kind === 'moment') {
    const unit = e.row.series
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
    mid = e.x != null ? <span className="hv5-f2-x">{feedMultiplier(e.x)} usual</span> : null
    fig = e.add != null && e.add > 0 ? <SizeFig add={e.add} unit={unit} /> : e.x != null ? <XFig x={e.x} unit={unit} /> : <span className="hv5-mo-v" />
  } else {
    act = <span className="hv5-f2-act hv5-f2-live">went live</span>
    // a fresh stream's chat rate is mostly hellos, so it shows only when chat is jumping
    mid = e.jump ? <><Jump />{e.chat != null && e.chat >= 1 ? <>{SEP}<span className="hv5-fd-w">chat {feedMore(e.chat)}/min</span></> : null}</> : null
    fig = <ViewFig viewers={e.viewers} />
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
        <span className={`hv5-fd-av${group.some((x) => x.kind === 'live') ? ' hv5-f2-ring' : ''}`}>
          <HubV5Avatar login={e.login} name={e.name} src={e.avatar} size={28} />
        </span>
        <span className="hv5-fd-tx">
          <span className="hv5-fd-l1"><span className="hv5-fd-nm">{e.name}</span>{act}</span>
          <span className="hv5-fd-l2">
            <Ago at={e.at} nowMs={nowMs} />
            {mid ? <>{SEP}{mid}</> : null}
            <Game cat={cat} art={artFor(e, cat, model)} />
            {rest ? <>{SEP}<span className="hv5-f2-more">+{rest} earlier</span></> : null}
          </span>
        </span>
        {fig}
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
                <span className="hv5-fd-l2"><Ago at={e.at} nowMs={nowMs} /><Game cat={e.cat} art={artFor(null, e.cat, model)} /></span>
              </span>
              <ViewFig viewers={e.viewers} />
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
              <SizeFig add={x.add} unit="chat" />
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
      {'x' in cmp ? (
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
  const innerHeight = useInnerHeight()
  const [showAll, setShowAll] = useState(false)
  const secRef = useRef<HTMLElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const hover = useRef(false)
  const focus = useRef(false)

  const upOn = model.up.length > 0
  const cap = feedCap(phone, wide, innerHeight)
  const shown = model.items.slice(0, showAll ? model.items.length : Math.max(0, cap - (upOn ? 1 : 0)))
  const hidden = model.items.length - shown.length
  const quiet = feedIsQuiet(model)
  const fresh = feed.fresh
  const isNew = (it: FeedItem) => !!fresh && ('group' in it ? fresh.has(it.group[0]!.key) : it.lives.some((e) => fresh.has(e.key)))

  const byKey = useMemo(() => {
    const map = new Map<string, { row: HubMomentRowV5; avatar: string | null }>()
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

  const stale = isStale(model.asOf, nowMs)
  return (
    <aside ref={secRef} id="latest" className={`hv5-sec hv5-latest hv5-feed${showAll ? ' hv5-fd-all' : ''}${stale ? ' hv5-f2-stale' : ''}`} aria-labelledby={H_ID}>
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
        <div className="hv5-fd-body" {...handlers}>
          {model.asOf != null && quiet && !upOn ? (
            <p className="hv5-fd-quiet">Quiet right now{model.items.length ? ` · last event ${feedAgo(model.items[0]!.at, nowMs)}` : ' · nothing in the last hour'}</p>
          ) : null}
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
          {model.asOf != null ? (
            <p className="hv5-f3-earlier">
              Before {feedClockFloor(model.asOf - FEED_WINDOW_MS)}, and the day’s top moments: <Link to="/analytics/moments">All moments →</Link>
            </p>
          ) : loading ? null : (
            <p className="hv5-none">No live data yet.</p>
          )}
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
