/**
 * The d3-v5 hub's hero search (R5-12 / R5-14, mockup hub.js masthead): "Find
 * your streamer", a 60 px field with a Search button (HubV5SearchBox), five
 * live channels to try, and what the hub covers. / and Ctrl/⌘K focus the
 * field while it is on screen; once it scrolls under the top bar, the top
 * bar's "Search a streamer" button docks (AnalyticsFind) and the keys open the
 * same search in a centred window. Behind it runs the emote conveyor at Soft
 * (R5-15, HubV5Conveyor); the mockup's hero-motion switch was a proposal aid
 * and is not ported.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import panelChart from '../../../../demo/pictures/panel-chart-2x.webp'
import panelCard from '../../../../demo/pictures/panel-moment-card-2x.webp'
import panelMoments from '../../../../demo/pictures/panel-top-moments-2x.webp'
import type { HubActivityPoint, HubLiveChannel } from '../../../../lib/publicHub'
import { isFindShortcut, useAnalyticsFind } from '../../analytics/analyticsFindContext'
import { ChromeInstallCta } from '../../ChromeInstallCta'
import { HubV5Avatar } from './HubV5Avatar'
import { HubV5Conveyor, type HubV5ConveyorRefs } from './HubV5Conveyor'
import { useMedia } from './HubV5LiveFeed'
import { HubV5SearchBox } from './HubV5Search'
import { channelHref, channelsByViewers, formatHubInt } from './hubV5Model'

const NO_POINTS: readonly HubActivityPoint[] = []
/** The mockup's 56 px bar, when the page has no analytics top bar to measure. */
const TOP_BAR_FALLBACK_PX = 56
/** P2 (10-22): 2× captures of the real panel (the sandbox /extension demo): Top moments, the chart, a moment's card. */
const PANEL_FRAMES = [panelMoments, panelChart, panelCard] as const
const PANEL_FRAME_MS = 4000

/** The panel's three states crossfading every 4 s; hover holds the one on show; reduced motion keeps the first. */
function PanelFrames() {
  const reduce = useMedia('(prefers-reduced-motion: reduce)')
  const [at, setAt] = useState(0)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (reduce || held) return undefined
    const id = window.setInterval(() => setAt((n) => (n + 1) % PANEL_FRAMES.length), PANEL_FRAME_MS)
    return () => window.clearInterval(id)
  }, [reduce, held])
  const on = reduce ? 0 : at
  return (
    <div className="hv5-get-pic" aria-hidden="true" onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}>
      {PANEL_FRAMES.map((src, i) => (
        <img key={src} src={src} alt="" width={338} height={188} decoding="async" className={i === on ? 'on' : undefined} />
      ))}
      {reduce ? null : (
        <span className="hv5-get-dots">
          {PANEL_FRAMES.map((src, i) => <i key={src} className={i === on ? 'on' : undefined} />)}
        </span>
      )}
    </div>
  )
}

export function HubV5Hero({ live, poolSize, points = NO_POINTS }: { live: readonly HubLiveChannel[]; poolSize: number; points?: readonly HubActivityPoint[] }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mastRef = useRef<HTMLElement>(null)
  const kickerRef = useRef<HTMLParagraphElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const tryRef = useRef<HTMLParagraphElement>(null)
  const getRef = useRef<HTMLDivElement>(null)
  const footRef = useRef<HTMLDivElement>(null)
  const conveyorRefs = useMemo<HubV5ConveyorRefs>(
    () => ({ mast: mastRef, kicker: kickerRef, field: fieldRef, tryRow: tryRef, getRow: getRef, foot: footRef }),
    [],
  )
  const setFindHero = useAnalyticsFind()?.setHero
  const [inView, setInView] = useState(true)
  const inViewRef = useRef(true)

  // The field counts as gone once it is under the top bar (the mockup's rootMargin -56px; the bar is
  // taller on phones, so it is measured, and again when the window resizes).
  useEffect(() => {
    const field = fieldRef.current
    if (!field || typeof IntersectionObserver === 'undefined') return
    let observer: IntersectionObserver | null = null
    let barHeight = -1
    const watch = () => {
      const bar = document.querySelector('.analytics-topnav')
      const height = bar ? Math.round(bar.getBoundingClientRect().height) : TOP_BAR_FALLBACK_PX
      if (height === barHeight) return
      barHeight = height
      observer?.disconnect()
      observer = new IntersectionObserver(([entry]) => {
        if (!entry) return
        inViewRef.current = entry.isIntersecting
        setInView(entry.isIntersecting)
      }, { rootMargin: `-${height}px 0px 0px 0px` })
      observer.observe(field)
    }
    watch()
    window.addEventListener('resize', watch)
    return () => {
      window.removeEventListener('resize', watch)
      observer?.disconnect()
    }
  }, [])

  useEffect(() => {
    setFindHero?.({ inView, live })
  }, [setFindHero, inView, live])
  useEffect(() => () => setFindHero?.(null), [setFindHero])

  // / and Ctrl/⌘K focus the field while it is on screen; past it, the top bar's search takes them.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!inViewRef.current || !isFindShortcut(event)) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const tryChannels = useMemo(() => channelsByViewers(live).slice(0, 5), [live])

  return (
    <header className="hv5-mast" ref={mastRef}>
      <HubV5Conveyor points={points} refs={conveyorRefs} />
      <p className="hv5-hero-k" ref={kickerRef}>Analytics</p>
      <h1 className="hv5-hero-h">Find your streamer</h1>
      <p className="hv5-hero-sub">Chat, emotes and top moments for any Twitch channel, minute by minute.</p>
      <div className="hv5-hero-field" ref={fieldRef}>
        <HubV5SearchBox live={live} inputRef={inputRef} />
      </div>
      {/* What you get, under the search, which stays first: the real panel, one line and one big
          button (Aron's C1 pick, 10-21, with the P2 picture, 10-22; the copy is a draft). */}
      <div className="hv5-hero-get" ref={getRef}>
        <PanelFrames />
        <div className="hv5-get-tx">
          <p className="hv5-get-h">See chat's big moments on Twitch</p>
          <p className="hv5-get-p">The Pulse panel sits next to Twitch chat and shows the spikes and top moments of the stream you're on.</p>
          <p className="hv5-get-row">
            <ChromeInstallCta className="hv5-hero-install" data-cta="chrome-install-hub-hero">
              <span className="chrome-mark" aria-hidden="true" />Add to Chrome
            </ChromeInstallCta>
            <span className="hv5-get-free">Free · no account · also Edge and Brave</span>
          </p>
        </div>
      </div>
      {tryChannels.length ? (
        <p className="hv5-hero-try" ref={tryRef}>
          <span className="hv5-hero-tl">Try</span>
          {tryChannels.map((c) => (
            <Link
              key={c.login}
              className="hv5-hero-chip"
              to={channelHref(c)}
              aria-label={`${c.displayName || c.login}, live, ${formatHubInt(c.viewers || 0)} viewers`}
            >
              <HubV5Avatar login={c.login} name={c.displayName} src={c.profileImageUrl} size={24} />
              <span>{c.displayName || c.login}</span>
            </Link>
          ))}
        </p>
      ) : null}
      <div className="hv5-hero-foot" ref={footRef}>
        {poolSize > 0 ? <p className="hv5-scope">The hub below covers {formatHubInt(poolSize)} channels we follow · not all of Twitch</p> : null}
      </div>
    </header>
  )
}
