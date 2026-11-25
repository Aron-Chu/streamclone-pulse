import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { lazy, Suspense, useState, type ReactNode, type RefObject } from 'react'
import { ArrowRight, LineChart } from 'lucide-react'
import '../../ui/tokens.css'
import '../../ui/components/landing/landing.css'
import { buttonClass } from '../../ui/primitives'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { LandingMobileNav } from '../../ui/components/landing/LandingMobileNav'
import { HeroBackdrop } from '../../ui/components/landing/HeroBackdrop'
import { EmoteTicker } from '../../ui/components/landing/EmoteTicker'
import { buildEmoteTicker, buildMoverTicker } from '../../ui/components/landing/landingData'
import { BrandMark } from '../../ui/components/BrandMark'
import { DiscordMark } from '../../ui/components/DiscordMark'
import { InstallCta } from '../../ui/components/InstallCta'
import { SiteFooter } from '../../ui/components/SiteFooter'
import { StreamerChatStats } from '../../ui/components/StreamerChatStats'
import { SITE_NAV_ITEMS } from '../../lib/siteNav'
import { discordInviteUrl } from '../../lib/discord'
import { capturePublicCta } from '../../lib/productAnalytics'
import type { HubLiveChannel } from '../../lib/publicHub'
// The hub's own search: the same suggestions and Enter rules, styled for this page in landing.css.
import { HubV5SearchBox } from '../../ui/components/hub/v5/HubV5SearchBox'
import { HubV5DockSearch } from '../../ui/components/hub/v5/HubV5TopBar'
import { HubV5Avatar } from '../../ui/components/hub/v5/HubV5Avatar'
import { channelHref, channelsByViewers, formatHubInt, hubCategoryArt, hubSearchEmotes, hubSearchGames, whereChatIs, type HubSearchEmote, type HubSearchGame } from '../../ui/components/hub/v5/hubV5Model'
import { createHubV5SearchStore, HubV5SearchContext, useHubV5SearchStore } from '../../ui/components/hub/v5/hubV5SearchStore'

import { LandingScrollCue } from '../../ui/components/landing/LandingScrollCue'
import { LandingBrainChat } from './LandingBrainChat'

// The demo beside Twitch chat (board extension-brainchat 11-22, ★ E1): its code, and the stream's three.js after it,
// load only when the section comes into view.
const LandingBesideChat = lazy(() => import('../../ui/components/landing/besideChat/LandingBesideChat').then(module => ({ default: module.LandingBesideChat })))

/** Heavy illustrative UI loads near its section, not on every public route. */
function DeferredDemo({ children }: { children: ReactNode }) {
  const host = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!host.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '0px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  const fallback = <p className="sl-demo-placeholder">A short demo of the extension beside Twitch chat: chat floods, Pulse marks the spike and jumps the video to just before it. It plays when this section is in view and JavaScript is available.</p>
  return <div ref={host}><Suspense fallback={fallback}>{visible ? children : fallback}</Suspense></div>
}

const DISCORD_LABEL = 'Join the StreamPulse Discord (opens in a new tab)'
const NO_LIVE: readonly HubLiveChannel[] = []

/**
 * Whether the hero's own buttons are on screen below the header. While they
 * are, the header's step back, so the page shows one of each at a time
 * (11-01). On at first paint, which is the top of the page.
 */
function useHeroButtonsInView(mainRef: RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const targets = Array.from(mainRef.current?.querySelectorAll<HTMLElement>('.sl-hero__actions') ?? [])
    if (!targets.length || typeof IntersectionObserver === 'undefined') { setInView(false); return }
    const header = document.querySelector('.sl-header')?.getBoundingClientRect().height ?? 0
    const showing = new Set<Element>()
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) showing.add(entry.target)
        else showing.delete(entry.target)
      }
      setInView(showing.size > 0)
    }, { rootMargin: `${-Math.round(header)}px 0px 0px 0px` })
    targets.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [mainRef])
  return inView
}

/**
 * Docks the hero's search in the header once the field has gone up under it, as the hub's
 * hero does with its bar (HubV5Hero): the header then shows the same box (HubV5DockSearch).
 */
function useDockedSearch(fieldRef: RefObject<HTMLElement | null>) {
  const store = useHubV5SearchStore()
  useEffect(() => {
    const field = fieldRef.current
    if (!field || typeof IntersectionObserver === 'undefined') return undefined
    const header = Math.round(document.querySelector('.sl-header')?.getBoundingClientRect().bottom ?? 0)
    const io = new IntersectionObserver(([entry]) => {
      if (entry) store.set({ docked: !entry.isIntersecting && entry.boundingClientRect.bottom <= header + 1 })
    }, { rootMargin: `${-header}px 0px 0px 0px` })
    io.observe(field)
    return () => {
      io.disconnect()
      store.set({ docked: false })
    }
  }, [fieldRef, store])
}

function TopNav({ discord, heroButtons, live, games, emotes }: { discord: string | null; heroButtons: boolean; live: readonly HubLiveChannel[]; games: readonly HubSearchGame[]; emotes: readonly HubSearchEmote[] }) {
  return (
    <header className="sl-header">
      <nav className={discord ? 'sl-nav sl-nav--discord' : 'sl-nav'} aria-label="StreamPulse" data-hero-buttons={heroButtons ? '' : undefined}>
        <Link to="/" className="sl-brand">
          <BrandMark className="sl-brand__mark" size={28} />
          StreamPulse
        </Link>
        <div className="sl-menu">
          {SITE_NAV_ITEMS.map((item) => (
            <Link key={item.to} to={item.to}
              onClick={item.to === '/analytics' ? () => capturePublicCta('open_analytics') : undefined}>
              {item.label}
            </Link>
          ))}
        </div>
        {/* The hub's docked search (11-18): from 1100 px a field on the header's middle, 760-1099 px a search button (landing.css). */}
        <div className="sl-dock">
          <HubV5DockSearch live={live} games={games} emotes={emotes} />
        </div>
        {/* Install and Open the Hub step back while the hero's own buttons show (11-22), so they lead the group:
            their empty places join the free room and Discord stays at the end. */}
        <div className="sl-nav__right">
          <InstallCta className={buttonClass('outline', 'sm', { className: 'sl-nav__install' })} data-cta="chrome-install-nav" icon="mark" />
          <Link to="/analytics" className={buttonClass('outline', 'sm', { className: 'sl-nav__analytics' })} onClick={() => capturePublicCta('open_analytics')}>
            Open the Hub
          </Link>
          {discord ? (
            <a href={discord} target="_blank" rel="noopener noreferrer" className={buttonClass('default', 'sm', { className: 'sl-discord-nav' })} aria-label={DISCORD_LABEL}>
              <DiscordMark size={16} />Discord
            </a>
          ) : null}
        </div>
        <LandingMobileNav />
        {/* At Menu widths the nav button collapses to this 44px mark beside Menu. */}
        {discord ? (
          <a href={discord} target="_blank" rel="noopener noreferrer" className="sl-discord-icon" aria-label={DISCORD_LABEL}>
            <DiscordMark size={22} />
          </a>
        ) : null}
      </nav>
    </header>
  )
}

/** Five live channels to try, busiest first, as on the hub. */
function TryChannels({ live }: { live: readonly HubLiveChannel[] }) {
  const channels = useMemo(() => channelsByViewers(live).slice(0, 5), [live])
  // Keep one chip row reserved while empty (see .sl-try min-height).
  // Longer desktop names may still wrap; phones keep a scrollable row.
  return (
    <p className="sl-try">
      {channels.length ? <span className="sl-try__label">Try</span> : null}
      {channels.map((c) => (
        <Link
          key={c.login}
          className="sl-try__chip"
          to={channelHref(c)}
          aria-label={`${c.displayName || c.login}, live, ${formatHubInt(c.viewers || 0)} viewers`}
        >
          <HubV5Avatar login={c.login} name={c.displayName} src={c.profileImageUrl} size={22} />
          <span>{c.displayName || c.login}</span>
        </Link>
      ))}
    </p>
  )
}

/** / and Ctrl/⌘K focus the search box on show, as on the hub: the header's once docked (opening its row when narrow), else the hero's. */
function useSearchShortcut() {
  const store = useHubV5SearchStore()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const inField = Boolean(target && (/INPUT|TEXTAREA|SELECT/.test(target.tagName) || target.isContentEditable))
      const cmdK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      const slash = event.key === '/' && !inField && !event.metaKey && !event.ctrlKey && !event.altKey
      if (!cmdK && !slash) return
      event.preventDefault()
      const { inputs } = store
      const dock = store.get().docked ? inputs.dock : null
      if (dock && !dock.getClientRects().length) inputs.openDock?.()
      const input = dock ?? inputs.hero
      input?.focus()
      input?.select()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [store])
}

/**
 * The front page is this hero and the demo (Aron's F2 pick, 11-02): find a
 * streamer, see what is trending, then add the extension or open the Hub.
 */
function Hero({
  live,
  games,
  emotes,
  emoteItems,
  moverItems,
}: {
  live: readonly HubLiveChannel[]
  /** What the top search offers besides channels (3A): games live now and the top emotes. */
  games: readonly HubSearchGame[]
  emotes: readonly HubSearchEmote[]
  emoteItems: ReturnType<typeof buildEmoteTicker>
  moverItems: ReturnType<typeof buildMoverTicker>
}) {
  const searchRef = useRef<HTMLDivElement>(null)
  useSearchShortcut()
  useDockedSearch(searchRef)
  return (
    <section className="sl-hero sl-hero--stage" aria-labelledby="hero-headline">
      <div className="sl-stage">
        <h1 id="hero-headline">
          Find the Twitch moments people <span className="sl-accent">actually reacted to.</span>
        </h1>
        <p>Chat, emotes and top moments for the Twitch channels we track, minute by minute.</p>
        <div className="sl-search" ref={searchRef}>
          <HubV5SearchBox live={live} variant="hero" games={games} emotes={emotes} />
        </div>
        <TryChannels live={live} />
        <div className="sl-tickwrap" aria-label="Latest available emote and channel snapshot">
          <EmoteTicker variant="a" label="Trending emotes" items={emoteItems} />
          <EmoteTicker variant="b" label="Trending channels" items={moverItems} />
        </div>
        <div className="sl-hero__actions">
          <InstallCta className={buttonClass('default', 'lg')} data-cta="chrome-install-hero" icon="mark" />
          {/* a phone leads with this one, filled, and no install button (P1, 11-02; landing.css) */}
          <Link to="/analytics" className={buttonClass('outline', 'lg', { className: 'sl-hero__hub' })} onClick={() => capturePublicCta('open_analytics')}>
            <LineChart size={17} aria-hidden="true" />
            Open the Hub
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <p className="sl-hero__desk">Desktop extension for Chrome, Edge and Firefox</p>
        {/* ★ A1: the way down to the demo, which it starts from the top */}
        <LandingScrollCue />
      </div>
    </section>
  )
}

export default function Landing() {
  // Marketing needs one bounded snapshot, not a full analytics poll loop.
  const { data } = usePublicHubData({ pollMs: 0, activityWindow: '30m', projection: 'tickers' })
  const emoteItems = useMemo(() => buildEmoteTicker(data), [data])
  const moverItems = useMemo(() => buildMoverTicker(data), [data])
  const live = data?.liveChannels ?? NO_LIVE
  const searchGames = useMemo(() => hubSearchGames(whereChatIs(live, undefined, '30m'), hubCategoryArt(data?.livePulseMoments ?? [])), [live, data?.livePulseMoments])
  const searchEmotes = useMemo(() => hubSearchEmotes([{ topEmotes: data?.topEmotes }]), [data?.topEmotes])
  // One store for the box and the / shortcut.
  const [searchStore] = useState(createHubV5SearchStore)
  const mainRef = useRef<HTMLElement | null>(null)
  const discord = discordInviteUrl()
  const heroButtons = useHeroButtonsInView(mainRef)

  // A hash in the entry URL cannot scroll on its own: the browser looks for the
  // target while React is still rendering, finds nothing, and gives up. Without
  // this, a shared or reloaded /#demo link lands at the top of the page.
  useEffect(() => {
    let id = ''
    // A malformed fragment (/#%, /#100%) has no target; skip the jump rather than crash.
    try { id = decodeURIComponent(window.location.hash.slice(1)) } catch { return }
    if (!id) return
    let cancelled = false
    const jump = () => {
      if (!cancelled) document.getElementById(id)?.scrollIntoView()
    }
    // Land immediately (this also works in a background tab, where rAF is
    // parked), then correct once webfonts have resized the hero above us.
    jump()
    void document.fonts?.ready.then(jump)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const root = mainRef.current
    if (!root) return
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (typeof IntersectionObserver === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      targets.forEach((el) => el.classList.add('is-in'))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in')
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    targets.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return (
    <HubV5SearchContext.Provider value={searchStore}>
      <div className="sp-landing">
        <HeroBackdrop data={data} />
        <a className="sl-skip-link" href="#landing-main">Skip to main content</a>
        <TopNav discord={discord} heroButtons={heroButtons} live={live} games={searchGames} emotes={searchEmotes} />
        <main id="landing-main" tabIndex={-1} className="sl-main" ref={mainRef}>
          <Hero live={live} games={searchGames} emotes={searchEmotes} emoteItems={emoteItems} moverItems={moverItems} />

          {/* tabIndex: the hero's cue moves focus here, so a keyboard carries on from the demo */}
          <section id="demo" className="sl-section" aria-labelledby="demo-title" tabIndex={-1}>
            <div className="sl-container">
              <div className="sl-section-head" data-reveal>
                <h2 id="demo-title">See it beside Twitch chat</h2>
                <span className="sl-sample-label">Sample data · interactive demonstration</span>
                <p>
                  The extension panel on a made-up stream. These numbers illustrate the interface; they are not a live broadcast.
                </p>
              </div>
              <DeferredDemo><LandingBesideChat /></DeferredDemo>
            </div>
          </section>
          {/* ★ B1: BrainChat, coming later */}
          <LandingBrainChat />
          <div className="sl-container sl-streamer-stats"><StreamerChatStats /></div>
          <section className="sl-section" aria-labelledby="about-title">
            <div className="sl-container">
              <div className="sl-section-head" data-reveal>
                <h2 id="about-title">What is StreamPulse?</h2>
                <p>
                  StreamPulse is a free desktop extension for Chrome, Edge and Firefox, with this website as its hub. It counts
                  Twitch chat and top emotes, 7TV ones included, minute by minute for the channels we track, and marks the
                  reaction moments when chat jumps.
                </p>
              </div>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    </HubV5SearchContext.Provider>
  )
}
