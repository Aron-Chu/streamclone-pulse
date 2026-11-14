/**
 * Top moments today (M1, hub rail board 2026-11-02; was Chat's big moments, C1,
 * 11-01, board artifacts/top-emotes-perf-board-20261031): a stage above Top
 * emotes, one big moment at a time with its neighbours peeking, with the game
 * chips and "All moments →". Its cards are the day's rows (useTopToday),
 * one per moment (hubV5BigMomentsModel). It moves on every 6 seconds, timed by the front
 * dot's fill; it holds while the mouse is over it, keyboard focus is in it,
 * it is mostly off screen, the tab is hidden, or the pause button is pressed.
 * The mouse or keyboard focus in it also keeps a read's new rows waiting.
 * With reduced motion it starts paused and cards fade instead of sliding.
 * ← →, Home and End move it, as do a swipe or a mouse drag (the cards follow
 * it), the wheel (up and down until the first or last card, or sideways) and a click
 * on a side card. Side
 * cards show Twitch emotes' still frames (a 7TV emote has one file, so it stays
 * as it is). A poll keeps the front card in front while it is still
 * listed. A picked game narrows the cards, and the header links that game's
 * moments. Its header says how old the list is ("Saved …" for the page's saved
 * copy). A phone peek row brings its card to the front and the
 * stage into view. Before the first answer there is no section; with no rows it
 * says so; with one card, no controls.
 * Board 2A (11-02): a card with no × shows its rate a minute under its reason
 * ("Busiest minute", "Early in the stream", "Chat spike · not compared"). A
 * live stream's picture shows only behind a moment under 10 minutes old, and a
 * moment before midnight says how long ago it was, not "Yesterday" (HUB-6).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { formatLiftWords } from '@streampulse/pulse-core'
import { emoteDisplaySrc } from '../../../../lib/emoteAssetUrl'
import { int } from '../../../../lib/momentsChecked'
import { twitchProfileImageRendition } from '../../../../lib/twitchProfileImage'
import { twitchLivePreviewUrl } from '../../analytics/hubFormat'
import { ResilientImage } from '../../ResilientImage'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Icon } from './HubV5Icon'
import { isFeed, TOP_ALL, TOP_NONE, TopGames, topEndLine, topFresh, topStale, topTip, type TopToday } from './HubV5TopMoments'
import {
  BIG_SWIPE_PX,
  bigCardPos,
  bigDragPx,
  bigFigure,
  bigFrontByEntry,
  bigIntoStream,
  bigLabel,
  bigLivePicture,
  bigMeter,
  bigMomentCards,
  bigSlideLabel,
  bigStillEmote,
  bigViewers,
  bigWatchHref,
  bigWheel,
  bigWheelTurn,
  bigWhen,
  type BigCard,
  type BigCardPos,
} from './hubV5BigMomentsModel'
import { hubAvatarTone, hubMonogram } from './hubV5Model'
import { TOP_KEEP_MS, topMomentsHref } from './hubV5TopModel'
import './hub-v5-big-moments.css'

const H_ID = 'hv5-bm-h'
const calm = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
const keyboardFocus = (el: Element) => {
  try {
    return el.matches(':focus-visible')
  } catch {
    return false
  }
}
const hide = (event: SyntheticEvent<HTMLImageElement>) => { event.currentTarget.style.display = 'none' }

const PAUSE = (
  <svg className="hv5-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 5v14M15 5v14" />
  </svg>
)
const PLAY = (
  <svg className="hv5-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 5.5v13a.5.5 0 0 0 .77.42l10.2-6.5a.5.5 0 0 0 0-.84L8.77 5.08A.5.5 0 0 0 8 5.5z" />
  </svg>
)

/** The channel's picture at 40 px (Twitch's 150 px rendition), else its toned monogram. */
function Face({ login, name, src }: { login: string; name: string; src: string | null }) {
  return (
    <ResilientImage
      className="hv5-av hv5-bm-av"
      src={twitchProfileImageRendition(src, 150)}
      fallbackSrc={src}
      fallback={<span className="hv5-av hv5-mono hv5-bm-av" style={{ background: hubAvatarTone(login) }} aria-hidden="true">{hubMonogram(name, login)}</span>}
      alt=""
      width={40}
      height={40}
      draggable={false}
      decoding="async"
      referrerPolicy="no-referrer"
    />
  )
}

function BigSlide({ card, i, n, pos, nowMs, live, avatar, seen, still, fresh }: {
  card: BigCard
  i: number
  n: number
  pos: BigCardPos
  nowMs: number
  /** Its stream is live in an answer under 15 minutes old. */
  live: boolean
  avatar: string | null
  /** It has been in front or beside it: its pictures load. */
  seen: boolean
  /** Its emotes hold still (a side card, or reduced motion). */
  still: boolean
  /** It arrived in the last refresh: a quiet 'New' tag until the next one (R1, 11-13). */
  fresh: boolean
}) {
  const { row } = card
  const front = pos === 0
  const meter = bigMeter(row)
  const into = bigIntoStream(row.offsetSeconds)
  const tab = front ? undefined : -1
  return (
    <article
      className="hv5-bm-card"
      data-i={i}
      data-pos={String(pos)}
      data-s={row.kind}
      data-live={live ? '' : undefined}
      role="group"
      aria-roledescription="slide"
      aria-label={bigSlideLabel(row, i, n)}
      aria-hidden={front ? undefined : true}
    >
      {live && seen && bigLivePicture(row.at, nowMs) ? (
        <>
          <img className="hv5-bm-bg" src={twitchLivePreviewUrl(row.login, 640, 360)} alt="" draggable={false} decoding="async" referrerPolicy="no-referrer" onError={hide} />
          <div className="hv5-bm-shade" />
        </>
      ) : null}
      <div className="hv5-bm-body">
        <div className="hv5-bm-who">
          <Face login={row.login} name={row.name} src={avatar} />
          <div className="hv5-bm-id">
            <strong>{row.name}</strong>
            {/* the game, then the time in: 'about' quiet beside the normal-weight time (K1, 11-14). The clock is
                never cut. ' into broadcast' shows whole or leaves: it sits outside the game-and-clock piece and wraps
                out of the one-line box when it can't fit whole; only then does the game ellipsize (11-14). */}
            {row.game || into ? (
              <small>
                <span className="hv5-bm-gc">
                  {row.game ? <span className="hv5-bm-gm">{row.game}</span> : null}
                  {row.game && into ? <span className="hv5-bm-sep"> · </span> : null}
                  {into ? <span className="hv5-bm-clk">{into.approximate ? <><span className="hv5-bm-ab">about</span>{' '}</> : null}{into.text}</span> : null}
                </span>
                {into ? <span className="hv5-bm-in"> into broadcast</span> : null}
              </small>
            ) : null}
          </div>
          {/* under 480 px the badge starts the game line, so the name gets the whole top row (N1, 11-13) */}
          {live ? <span className="hv5-bm-live">LIVE{row.viewers != null ? ` · ${bigViewers(row.viewers)}` : ''}</span> : null}
        </div>
        <div className="hv5-bm-what">
          <span className="hv5-bm-lbl">{bigLabel(row)}</span>
          <span className="hv5-bm-x">{bigFigure(row)}<small>{row.x != null ? `more ${row.kind}` : `${row.kind}/min`}</small></span>
          {fresh ? <span className="hv5-new">New</span> : null}
        </div>
        {meter ? (
          <div className="hv5-bm-meter">
            <span>Now</span><span className="hv5-bm-bar"><i style={{ width: `${meter.nowPct}%` }} /></span><span>{int(meter.now)}/min</span>
            <span>Usual</span><span className="hv5-bm-bar hv5-bm-base"><i style={{ width: `${meter.usualPct}%` }} /></span><span>{int(meter.usual)}/min</span>
          </div>
        ) : null}
        {row.emotes.length ? (
          <ul className="hv5-bm-em" aria-label="Top emotes that minute">
            {row.emotes.map((e) => (
              <li key={e.name}>
                {e.imageUrl && seen
                  // right-sized (1x for 32 px, not the 4x the feed may send) and lazy; hidden cards load none (`seen`)
                  ? <img src={emoteDisplaySrc(still ? bigStillEmote(e.imageUrl) : e.imageUrl, 32) ?? e.imageUrl} alt="" width={32} height={32} draggable={false} decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={hide} />
                  : <span className="hv5-bm-emph" aria-hidden="true" />}
                <span className="hv5-bm-emt"><b>{e.name}</b>{int(e.count)} uses</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="hv5-bm-foot">
          <span className="hv5-bm-t">{bigWhen(row.at, nowMs)}</span>
          <span className="hv5-bm-act">
            {live ? (
              <a className="hv5-bm-tw" href={bigWatchHref(row.login)} target="_blank" rel="noopener noreferrer" tabIndex={tab} draggable={false}>
                Watch live <span aria-hidden="true">↗</span>
              </a>
            ) : null}
            <Link className="hv5-bm-open" to={row.href} tabIndex={tab} draggable={false}>Open in Moments</Link>
          </span>
        </div>
      </div>
    </article>
  )
}

export interface HubV5BigMomentsProps {
  /** Top moments today's state: the list it shows, live channels' pictures, the game chips, a phone peek's pick and the rows new in the last refresh. */
  top: Pick<TopToday, 'shown' | 'avatars' | 'game' | 'games' | 'chips' | 'pickGame' | 'open' | 'setOpen' | 'hold'> & Partial<Pick<TopToday, 'fresh'>>
  nowMs: number
}

export function HubV5BigMoments({ top, nowMs }: HubV5BigMomentsProps) {
  const { shown, avatars } = top
  const cards = useMemo(() => bigMomentCards(shown?.rows ?? []), [shown])
  const n = cards.length
  const playing = n > 1

  // the front card, by moment: a poll that keeps the moment keeps it in front; one that drops it starts again at 1.
  // Back to this page brings back the card that was in front (HUB-LIVE-3).
  const { key: entry } = useLocation()
  const [front, setFront] = useState<string | null>(() => bigFrontByEntry.get(entry) ?? null)
  useEffect(() => {
    if (front != null) bigFrontByEntry.set(entry, front)
  }, [entry, front])
  const found = cards.findIndex((c) => c.row.id === front)
  const at = found < 0 ? 0 : found
  useEffect(() => {
    if (n && found < 0) setFront(cards[0]!.row.id)
  }, [cards, found, n])
  const go = useCallback((i: number) => {
    if (n) setFront(cards[((i % n) + n) % n]!.row.id)
  }, [cards, n])
  const step = useRef(() => {})
  step.current = () => go(at + 1)

  // what holds it: the pause button (pressed from the start with reduced motion), the mouse, keyboard focus, off screen, a hidden tab
  const [user, setUser] = useState(calm)
  const [hover, setHover] = useState(false)
  const [focus, setFocus] = useState(false)
  const [away, setAway] = useState(false)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  const paused = user || hover || focus || away || hidden
  const stageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = stageRef.current
    if (!playing || !el || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver(([entry]) => setAway(!entry || !entry.isIntersecting || entry.intersectionRatio < 0.3), { threshold: 0.3 })
    io.observe(el)
    return () => io.disconnect()
  }, [playing])
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // the front dot's fill is the clock: holding pauses the fill, and its end turns the page
  const dotsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = dotsRef.current
    if (!playing || !el) return undefined
    const onEnd = (event: Event) => {
      if ((event.target as Element | null)?.classList?.contains('hv5-bm-fill')) step.current()
    }
    el.addEventListener('animationend', onEnd)
    return () => el.removeEventListener('animationend', onEnd)
  }, [playing])

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const to: Record<string, number> = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: n - 1 }
    if (!playing || !(event.key in to) || (event.target as Element).closest('a')) return
    event.preventDefault()
    go(to[event.key]!)
  }

  // a swipe or a mouse drag: the cards follow it, and a long enough one turns the page and swallows the click it ends in;
  // a click on a side card brings it to the front
  const trackRef = useRef<HTMLDivElement>(null)
  const down = useRef<{ x: number; y: number; id: number; drag: boolean } | null>(null)
  const swiped = useRef(false)
  const follow = (dx: number | null) => {
    const el = trackRef.current
    if (!el) return
    if (dx == null) {
      delete el.dataset.drag
      el.style.removeProperty('--hv5-bm-drag')
    } else {
      el.dataset.drag = ''
      el.style.setProperty('--hv5-bm-drag', `${bigDragPx(dx, el.clientWidth)}px`)
    }
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swiped.current = false
    if (event.button !== 0) return
    down.current = { x: event.clientX, y: event.clientY, id: event.pointerId, drag: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = down.current
    if (!start || start.id !== event.pointerId || !playing) return
    const dx = event.clientX - start.x
    if (!start.drag) {
      // a drag once it goes 8 px across, more across than down; the stage keeps the pointer from then on
      if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(event.clientY - start.y)) return
      start.drag = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // the pointer has gone
      }
    }
    follow(dx)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = down.current
    down.current = null
    follow(null)
    if (!start || !playing) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (start.drag) swiped.current = true
    if (Math.abs(dx) > BIG_SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true
      go(at + (dx < 0 ? 1 : -1))
    }
  }
  const onPointerCancel = () => {
    down.current = null
    follow(null)
  }

  // the wheel turns one page a gesture: sideways (a trackpad swipe, or shift and the wheel) or up and down (Aron, 11-02:
  // "scroll wheel doesn't work"); up and down, it lets the page scroll on past the first and the last card
  const turn = useRef((_d: number) => {})
  turn.current = (d: number) => go(at + d)
  const edge = useRef((_d: number): boolean => false)
  edge.current = (d: number) => (d > 0 ? at >= n - 1 : at <= 0)
  useEffect(() => {
    const el = trackRef.current
    if (!playing || !el) return undefined
    const wheel = bigWheel()
    const onWheel = (event: WheelEvent) => {
      const across = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      const dx = across ? event.deltaX : event.deltaY
      if (!dx || (!across && !event.shiftKey && edge.current(dx))) return
      event.preventDefault()
      // a wheel that counts in lines: about 40 px a line
      const d = bigWheelTurn(wheel, event.deltaMode === 1 ? dx * 40 : dx, event.timeStamp)
      if (d) turn.current(d)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [playing])

  const onClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    const card = (event.target as Element).closest<HTMLElement>('.hv5-bm-card')
    if (swiped.current) {
      swiped.current = false
      event.preventDefault()
      event.stopPropagation()
    } else if (card && card.dataset.pos !== '0') {
      event.preventDefault()
      event.stopPropagation()
      go(Number(card.dataset.i))
    }
  }

  // a card picked from a peek row holds like keyboard focus until focus leaves the stage (HUB-LIVE-1): a tap's focus is not :focus-visible
  const picked = useRef(false)
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const on = picked.current || keyboardFocus(event.target)
    setFocus(on)
    top.hold('focus', on)
  }
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    picked.current = false
    setFocus(false)
    top.hold('focus', false)
  }

  // leaving the page lets a waiting read in
  const { hold } = top
  useEffect(() => () => {
    hold('hover', false)
    hold('focus', false)
  }, [hold])

  // a phone peek row (top.open): its card to the front, the stage into view and focus, and it holds there (HUB-LIVE-1, HUB-LIVE-6)
  const { open, setOpen } = top
  useEffect(() => {
    if (open == null) return
    setOpen(null)
    if (!cards.some((c) => c.row.id === open)) return
    setFront(open)
    const stage = stageRef.current
    if (!stage) return
    stage.scrollIntoView?.({ block: 'center', behavior: calm() ? 'auto' : 'smooth' })
    picked.current = true
    if (document.activeElement === stage) {
      setFocus(true)
      hold('focus', true)
    } else stage.focus({ preventScroll: true })
  }, [open, setOpen, cards, hold])

  // pictures load once a card has been in front or beside it
  const seen = useRef(new Set<string>())
  const moving = !calm()
  // an answer over 15 minutes old no longer says a stream is live now
  const recent = shown?.asOf != null && nowMs - shown.asOf <= TOP_KEEP_MS
  // the link goes where the rail's does: the picked game's moments while its Moments list is shown, else every game's
  const linkGame = isFeed(shown) ? top.game : null

  if (!shown) return null
  // nothing today (or a picked game with nothing): the heading, the chips and one line
  const empty = !n ? (shown.source === 'none' ? TOP_NONE : isFeed(shown) ? `Nothing${linkGame ? ` from ${linkGame.name}` : ''} in the last 24 hours.` : topEndLine(shown, 0, nowMs)) : null
  return (
    <section id="big-moments" className={`hv5-sec hv5-big${topStale(shown, nowMs) ? ' hv5-f2-stale' : ''}`} aria-labelledby={H_ID}>
      <div className="hv5-rh">
        <h2 id={H_ID}>Top moments today</h2>
        <span className="hv5-f2-fresh">{topFresh(shown, nowMs)}</span>
        {shown.source !== 'none' ? <HubToggletip tip={topTip(shown, nowMs)} label="About Top moments today" /> : null}
        <span className="hv5-end">
          <Link className={`hv5-mo-all${linkGame ? ' hv5-mo-game' : ''}`} to={topMomentsHref(linkGame?.name ?? null)}>
            {linkGame ? <>All&nbsp;<span className="hv5-mo-gm">{linkGame.name}</span>&nbsp;moments →</> : TOP_ALL}
          </Link>
        </span>
      </div>
      {top.chips ? <TopGames games={top.games} game={top.game} onGame={top.pickGame} /> : null}
      {empty ? <p className="hv5-bm-q">{empty}</p> : (
      <div
        ref={stageRef}
        className="hv5-bm"
        role="group"
        aria-roledescription="carousel"
        aria-labelledby={H_ID}
        tabIndex={playing ? 0 : -1}
        data-paused={paused ? '' : undefined}
        onKeyDown={onKey}
        onFocus={onFocus}
        onBlur={onBlur}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') { setHover(true); top.hold('hover', true) } }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') { setHover(false); top.hold('hover', false) } }}
      >
        <div
          ref={trackRef}
          className="hv5-bm-track"
          aria-live={paused || !playing ? 'polite' : 'off'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClickCapture={onClickCapture}
        >
          {cards.map((card, k) => {
            const pos = bigCardPos(k, at, n)
            if (pos !== 'far' && Math.abs(pos) <= 1) seen.current.add(card.row.id)
            return (
              <BigSlide
                key={card.row.id}
                card={card}
                i={k}
                n={n}
                pos={pos}
                nowMs={nowMs}
                live={card.row.live && recent}
                avatar={card.row.avatar ?? avatars.get(card.row.login) ?? null}
                seen={seen.current.has(card.row.id)}
                still={pos !== 0 || !moving}
                fresh={!!top.fresh?.has(card.row.id)}
              />
            )
          })}
        </div>
        {playing ? (
          <div className="hv5-bm-nav">
            <button className="hv5-ib" type="button" aria-label="Previous moment" onClick={() => go(at - 1)}><HubV5Icon name="left" /></button>
            {/* the dots are for the pointer: Previous, Next, the arrow keys and a swipe do the same, so they are not ten Tab stops (HUB-LIVE-7) */}
            <div ref={dotsRef} className="hv5-bm-dots" role="group" aria-label="Choose a moment">
              {cards.map((card, k) => (
                <button
                  key={card.row.id}
                  className={k < at ? 'hv5-bm-done' : undefined}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${card.row.name}, ${card.row.x != null ? formatLiftWords(card.row.x, card.row.kind) : `${bigFigure(card.row)} ${card.row.kind}/min`}`}
                  aria-current={k === at ? 'true' : undefined}
                  onClick={() => go(k)}
                >
                  <span className="hv5-bm-dot"><i className="hv5-bm-fill" /></span>
                </button>
              ))}
            </div>
            <button className="hv5-ib" type="button" aria-label="Next moment" onClick={() => go(at + 1)}><HubV5Icon name="right" /></button>
            <button className="hv5-ib" type="button" aria-label={user ? 'Play' : 'Pause'} onClick={() => setUser((u) => !u)}>{user ? PLAY : PAUSE}</button>
            <span className="hv5-bm-count" aria-hidden="true">{at + 1} / {n}</span>
          </div>
        ) : null}
      </div>
      )}
    </section>
  )
}
