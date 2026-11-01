/**
 * Chat's big moments (C1, 11-01; board artifacts/top-emotes-perf-board-20261031):
 * a stage above Top emotes, one big moment at a time with its neighbours
 * peeking. Its cards are Top moments today's rows, one per channel
 * (hubV5BigMomentsModel). It moves on every 6 seconds, timed by the front
 * dot's fill; it holds while the mouse is over it, keyboard focus is in it,
 * it is mostly off screen, the tab is hidden, or the pause button is pressed.
 * With reduced motion it starts paused and cards fade instead of sliding.
 * ← →, Home and End move it, as do a swipe and a click on a side card. Side
 * cards show Twitch emotes' still frames (a 7TV emote has one file, so it stays
 * as it is). A poll keeps the front card's channel in front while it is still
 * listed. A game picked in Top moments today narrows these cards too, and the
 * header links that game's moments as the rail's does. With no rows there is
 * no section; with one card, no controls.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type SyntheticEvent } from 'react'
import { Link } from 'react-router-dom'
import { fx, int, when } from '../../../../lib/momentsChecked'
import { twitchProfileImageRendition } from '../../../../lib/twitchProfileImage'
import { twitchLivePreviewUrl } from '../../analytics/hubFormat'
import { ResilientImage } from '../../ResilientImage'
import { HubToggletip } from '../d3/HubToggletip'
import { HubV5Icon } from './HubV5Icon'
import type { TopToday } from './HubV5TopMoments'
import {
  BIG_SWIPE_PX,
  bigCardPos,
  bigIntoStream,
  bigMeter,
  bigMomentCards,
  bigSlideLabel,
  bigSpike,
  bigStillEmote,
  bigViewers,
  bigWatchHref,
  type BigCard,
  type BigCardPos,
} from './hubV5BigMomentsModel'
import { hubAvatarTone, hubMonogram } from './hubV5Model'
import { TOP_KEEP_MS, topMomentsHref } from './hubV5TopModel'
import './hub-v5-big-moments.css'

const H_ID = 'hv5-bm-h'
const TIP = 'The same moments as Top moments today, one card per channel.'
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

function BigSlide({ card, i, n, pos, nowMs, live, avatar, seen, still }: {
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
}) {
  const { row, more } = card
  const front = pos === 0
  const meter = bigMeter(row)
  const sub = [row.game, bigIntoStream(row.offsetSeconds)].filter(Boolean).join(' · ')
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
      {live && seen ? (
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
            {sub ? <small>{sub}</small> : null}
          </div>
          {live ? <span className="hv5-bm-live">LIVE{row.viewers != null ? ` · ${bigViewers(row.viewers)}` : ''}</span> : null}
        </div>
        <div className="hv5-bm-what">
          <span className="hv5-bm-lbl">{bigSpike(row.kind)}</span>
          <span className="hv5-bm-x">{fx(row.x)}<small>usual {row.kind}</small></span>
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
                  ? <img src={still ? bigStillEmote(e.imageUrl) : e.imageUrl} alt="" width={32} height={32} draggable={false} decoding="async" referrerPolicy="no-referrer" onError={hide} />
                  : <span className="hv5-bm-emph" aria-hidden="true" />}
                <span className="hv5-bm-emt"><b>{e.name}</b>{int(e.count)} uses</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="hv5-bm-foot">
          <span className="hv5-bm-t">{when(row.at, nowMs)}</span>
          {more ? <span className="hv5-bm-more">+{more} more today</span> : null}
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
  /** Top moments today's state: the list it shows, live channels' pictures and the picked game. */
  top: Pick<TopToday, 'shown' | 'avatars' | 'game'>
  nowMs: number
}

export function HubV5BigMoments({ top, nowMs }: HubV5BigMomentsProps) {
  const { shown, avatars } = top
  const cards = useMemo(() => bigMomentCards(shown?.rows ?? []), [shown])
  const n = cards.length
  const playing = n > 1

  // the front card, by channel: a poll that keeps the channel keeps it in front; one that drops it starts again at 1
  const [front, setFront] = useState<string | null>(null)
  const found = cards.findIndex((c) => c.row.login === front)
  const at = found < 0 ? 0 : found
  useEffect(() => {
    if (n && found < 0) setFront(cards[0]!.row.login)
  }, [cards, found, n])
  const go = useCallback((i: number) => {
    if (n) setFront(cards[((i % n) + n) % n]!.row.login)
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

  // a swipe turns the page and swallows the click it ends in; a click on a side card brings it to the front
  const down = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(false)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    down.current = { x: event.clientX, y: event.clientY }
    swiped.current = false
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const start = down.current
    down.current = null
    if (!start || !playing) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > BIG_SWIPE_PX && Math.abs(dx) > Math.abs(dy)) {
      swiped.current = true
      go(at + (dx < 0 ? 1 : -1))
    }
  }
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

  const onFocus = (event: FocusEvent<HTMLDivElement>) => setFocus(keyboardFocus(event.target))
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) setFocus(false)
  }

  // pictures load once a card has been in front or beside it
  const seen = useRef(new Set<string>())
  const moving = !calm()
  // an answer over 15 minutes old no longer says a stream is live now
  const recent = shown?.asOf != null && nowMs - shown.asOf <= TOP_KEEP_MS
  // the link goes where the rail's does: the picked game's moments while its Moments list is shown, else every game's
  const linkGame = shown?.source === 'feed' || shown?.source === 'feed-old' ? top.game : null

  if (!n) return null
  return (
    <section id="big-moments" className="hv5-sec hv5-big" aria-labelledby={H_ID}>
      <div className="hv5-rh">
        <h2 id={H_ID}>Chat’s big moments</h2>
        <HubToggletip tip={TIP} label="About Chat’s big moments" />
        <span className="hv5-end">
          <Link className={`hv5-mo-all${linkGame ? ' hv5-mo-game' : ''}`} to={topMomentsHref(linkGame?.id ?? null)}>
            {linkGame ? <><span className="hv5-mo-gm">{linkGame.name}</span>&nbsp;moments →</> : 'All moments →'}
          </Link>
        </span>
      </div>
      <div
        ref={stageRef}
        className="hv5-bm"
        role="group"
        aria-roledescription="carousel"
        aria-labelledby={H_ID}
        tabIndex={playing ? 0 : undefined}
        data-paused={paused ? '' : undefined}
        onKeyDown={onKey}
        onFocus={onFocus}
        onBlur={onBlur}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHover(true) }}
        onPointerLeave={(event) => { if (event.pointerType === 'mouse') setHover(false) }}
      >
        <div
          className="hv5-bm-track"
          aria-live={paused || !playing ? 'polite' : 'off'}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { down.current = null }}
          onClickCapture={onClickCapture}
        >
          {cards.map((card, k) => {
            const pos = bigCardPos(k, at, n)
            if (pos !== 'far' && Math.abs(pos) <= 1) seen.current.add(card.row.login)
            return (
              <BigSlide
                key={card.row.login}
                card={card}
                i={k}
                n={n}
                pos={pos}
                nowMs={nowMs}
                live={card.row.live && recent}
                avatar={card.row.avatar ?? avatars.get(card.row.login) ?? null}
                seen={seen.current.has(card.row.login)}
                still={pos !== 0 || !moving}
              />
            )
          })}
        </div>
        {playing ? (
          <div className="hv5-bm-nav">
            <button className="hv5-ib" type="button" aria-label="Previous moment" onClick={() => go(at - 1)}><HubV5Icon name="left" /></button>
            <div ref={dotsRef} className="hv5-bm-dots" role="group" aria-label="Choose a moment">
              {cards.map((card, k) => (
                <button
                  key={card.row.login}
                  className={k < at ? 'hv5-bm-done' : undefined}
                  type="button"
                  aria-label={card.row.name}
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
    </section>
  )
}
