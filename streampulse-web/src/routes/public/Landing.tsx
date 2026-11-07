import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { lazy, Suspense, useState, type ReactNode, type RefObject } from 'react'
import { ArrowRight, LineChart } from 'lucide-react'
import '../../ui/tokens.css'
import '../../ui/components/landing/landing.css'
import { buttonClass } from '../../ui/primitives'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { LandingMobileNav } from '../../ui/components/landing/LandingMobileNav'
import { EmoteRain } from '../../ui/components/landing/EmoteRain'
import { TwitchChatBackdrop } from '../../ui/components/landing/TwitchChatBackdrop'
import { EmoteTicker } from '../../ui/components/landing/EmoteTicker'
import { useMatchMedia } from '../../ui/hooks/useMatchMedia'
import { buildEmoteTicker, buildMoverTicker } from '../../ui/components/landing/landingData'
import { BrandMark } from '../../ui/components/BrandMark'
import { DiscordMark } from '../../ui/components/DiscordMark'
import { InstallCta } from '../../ui/components/InstallCta'
import { AnalyticsPreferences } from '../../ui/components/AnalyticsPreferences'
import { StreamerChatStats } from '../../ui/components/StreamerChatStats'
import { FEEDBACK_PATH, GITHUB_REPO_URL, PRIVACY_PATH, REFUNDS_PATH, SUPPORTER_PATH, TERMS_PATH } from '../../lib/externalLinks'
import { discordInviteUrl } from '../../lib/discord'
import { capturePublicCta } from '../../lib/productAnalytics'
import type { HubLiveChannel } from '../../lib/publicHub'
// The hub's own search: the same suggestions and Enter rules, styled for this page in landing.css.
import { HubV5SearchBox } from '../../ui/components/hub/v5/HubV5SearchBox'
import { HubV5Avatar } from '../../ui/components/hub/v5/HubV5Avatar'
import { channelHref, channelsByViewers, formatHubInt, hubCategoryArt, hubSearchEmotes, hubSearchGames, whereChatIs, type HubSearchEmote, type HubSearchGame } from '../../ui/components/hub/v5/hubV5Model'
import { createHubV5SearchStore, HubV5SearchContext, useHubV5SearchStore } from '../../ui/components/hub/v5/hubV5SearchStore'

const ExtensionShowcase = lazy(() => import('../../ui/components/landing/ExtensionShowcase').then(module => ({ default: module.ExtensionShowcase })))

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
  const fallback = <p className="sl-demo-placeholder">Interactive sample: compare chat and emote reactions, inspect a moment, and check its coverage. The demonstration loads when this section is in view and JavaScript is available.</p>
  return <div ref={host}><Suspense fallback={fallback}>{visible ? children : fallback}</Suspense></div>
}

/** landing.css hides .sl-chatbg at max-width 960px; keep this query in step. */
const CHAT_BACKDROP_QUERY = '(min-width: 961px)'

/**
 * The fixed chat backdrop mounts after the page, and only where landing.css
 * shows it. Hidden by CSS alone, its lazy emote images still downloaded
 * (~650 KB on phones). It stays out of the prerendered HTML too.
 */
function DeferredChatBackdrop() {
  const wide = useMatchMedia(CHAT_BACKDROP_QUERY)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  return mounted && wide ? <TwitchChatBackdrop /> : null
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

function TopNav({ discord, heroButtons }: { discord: string | null; heroButtons: boolean }) {
  return (
    <header className="sl-header">
      <nav className={discord ? 'sl-nav sl-nav--discord' : 'sl-nav'} aria-label="StreamPulse" data-hero-buttons={heroButtons ? '' : undefined}>
        <Link to="/" className="sl-brand">
          <BrandMark className="sl-brand__mark" size={28} />
          StreamPulse
        </Link>
        <div className="sl-menu">
          <a href="#demo">Pulse tab</a>
          <Link to="/docs">Docs</Link>
        </div>
        <div className="sl-nav__right">
          {discord ? (
            <a href={discord} target="_blank" rel="noopener noreferrer" className={buttonClass('default', 'sm', { className: 'sl-discord-nav' })} aria-label={DISCORD_LABEL}>
              <DiscordMark size={16} />Discord
            </a>
          ) : null}
          <InstallCta className={buttonClass('outline', 'sm', { className: 'sl-nav__install' })} data-cta="chrome-install-nav" icon="mark" />
          <Link to="/analytics" className={buttonClass('outline', 'sm', { className: 'sl-nav__analytics' })} onClick={() => capturePublicCta('open_analytics')}>
            Open the Hub
          </Link>
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
  if (!channels.length) return null
  return (
    <p className="sl-try">
      <span className="sl-try__label">Try</span>
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

/** / and Ctrl/⌘K focus the search box, as on the hub. */
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
      store.inputs.hero?.focus()
      store.inputs.hero?.select()
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
  useSearchShortcut()
  return (
    <section className="sl-hero sl-hero--stage" aria-labelledby="hero-headline">
      <div className="sl-stage">
        <h1 id="hero-headline">
          Find the Twitch moments people <span className="sl-grad">actually reacted to.</span>
        </h1>
        <p>Chat, emotes and top moments for the Twitch channels we track, minute by minute.</p>
        <div className="sl-search">
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
      </div>
    </section>
  )
}

/** Product, help and legal links in three columns (B1), with the Twitch disclaimer. */
function Footer({ discord }: { discord: string | null }) {
  return (
    <footer className="sl-footer">
      <div className="sl-container sl-foot">
        <div className="sl-foot__brand">
          <Link to="/" className="sl-brand">
            <BrandMark className="sl-brand__mark" size={28} />
            StreamPulse
          </Link>
          <p>Free Twitch chat and emote stats.</p>
        </div>
        <nav className="sl-foot__cols" aria-label="Footer">
          <div className="sl-foot__links">
            <span className="sl-foot__head">Product</span>
            <Link to="/analytics" onClick={() => capturePublicCta('open_analytics')}>Hub</Link>
            <Link to="/docs">Extension guide</Link>
            <Link to="/tools/twitch-vod-timestamp-link">Twitch timestamp tool</Link>
            <Link to="/guides/find-twitch-moments">Find Twitch moments</Link>
            <Link to="/status">Status</Link>
            <Link to="/changelog">Changelog</Link>
          </div>
          <div className="sl-foot__links">
            <span className="sl-foot__head">Help</span>
            <Link to="/support">Support</Link>
            <Link to={FEEDBACK_PATH}>Send feedback</Link>
            {discord ? (
              <a href={discord} target="_blank" rel="noopener noreferrer" className="sl-foot__discord" aria-label="Discord (opens in a new tab)">
                <DiscordMark size={15} />Discord
              </a>
            ) : null}
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">GitHub</a>
          </div>
          <div className="sl-foot__links">
            <span className="sl-foot__head">Legal</span>
            <Link to={PRIVACY_PATH}>Privacy</Link>
            <Link to={TERMS_PATH}>Terms</Link>
            <Link to={REFUNDS_PATH}>Refunds</Link>
            <Link to={SUPPORTER_PATH}>Supporter</Link>
          </div>
        </nav>
        <small>
          StreamPulse is not affiliated with Twitch. <AnalyticsPreferences />
        </small>
      </div>
    </footer>
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
        <EmoteRain />
        <DeferredChatBackdrop />
        <a className="sl-skip-link" href="#landing-main">Skip to main content</a>
        <TopNav discord={discord} heroButtons={heroButtons} />
        <main id="landing-main" tabIndex={-1} className="sl-main" ref={mainRef}>
          <Hero live={live} games={searchGames} emotes={searchEmotes} emoteItems={emoteItems} moverItems={moverItems} />

          <section id="demo" className="sl-section" aria-labelledby="demo-title">
            <div className="sl-container">
              <div className="sl-section-head" data-reveal>
                <h2 id="demo-title">See it beside Twitch chat</h2>
                <span className="sl-sample-label">Sample data · interactive demonstration</span>
                <p>
                  The extension panel on a made-up stream. These numbers illustrate the interface; they are not a live broadcast.
                </p>
              </div>
              <DeferredDemo><ExtensionShowcase /></DeferredDemo>
            </div>
          </section>
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
        <Footer discord={discord} />
      </div>
    </HubV5SearchContext.Provider>
  )
}
