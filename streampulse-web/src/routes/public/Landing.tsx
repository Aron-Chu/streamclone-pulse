import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { lazy, Suspense, useState, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, BookOpen, LineChart, PanelTopOpen, Radio, ShieldCheck, Sparkles } from 'lucide-react'
import '../../ui/tokens.css'
import '../../ui/components/landing/landing.css'
import { buttonClass } from '../../ui/primitives'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { LandingMobileNav } from '../../ui/components/landing/LandingMobileNav'
import { EmoteRain } from '../../ui/components/landing/EmoteRain'
import { TwitchChatBackdrop } from '../../ui/components/landing/TwitchChatBackdrop'
import { LiveSignalScrollGraph } from '../../ui/components/landing/LiveSignalScrollGraph'
import { EmoteTicker } from '../../ui/components/landing/EmoteTicker'
import { ResourceGrid } from '../../ui/components/landing/ResourceGrid'
import { RoadmapTimeline } from '../../ui/components/landing/RoadmapTimeline'
import { buildEmoteTicker, buildMoverTicker } from '../../ui/components/landing/landingData'
import { BrandMark } from '../../ui/components/BrandMark'
import { DiscordMark } from '../../ui/components/DiscordMark'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { AnalyticsPreferences } from '../../ui/components/AnalyticsPreferences'
import { GITHUB_REPO_URL } from '../../lib/externalLinks'
import { discordInviteUrl } from '../../lib/discord'
import { capturePublicCta } from '../../lib/productAnalytics'

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

const DISCORD_LABEL = 'Join the StreamPulse Discord (opens in a new tab)'

function TopNav({ discord }: { discord: string | null }) {
  return (
    <header className="sl-header">
      <nav className={discord ? 'sl-nav sl-nav--discord' : 'sl-nav'} aria-label="StreamPulse">
        <Link to="/" className="sl-brand">
          <BrandMark className="sl-brand__mark" size={28} />
          StreamPulse
        </Link>
        <div className="sl-menu">
          <a href="#demo">Pulse tab</a>
          <a href="#analysis">Signal replay</a>
          <a href="#roadmap">Roadmap</a>
          <Link to="/docs">Docs</Link>
        </div>
        <div className="sl-nav__right">
          {discord ? (
            <a href={discord} target="_blank" rel="noopener noreferrer" className={buttonClass('default', 'sm', { className: 'sl-discord-nav' })} aria-label={DISCORD_LABEL}>
              <DiscordMark size={16} />Discord
            </a>
          ) : null}
          <ChromeInstallCta className={buttonClass('outline', 'sm')} data-cta="chrome-install-nav" />
          <Link to="/analytics" className={buttonClass('outline', 'sm', { className: 'sl-nav__analytics' })} onClick={() => capturePublicCta('open_analytics')}>
            Open Analytics
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

function Hero({
  emoteItems,
  moverItems,
  discord,
}: {
  emoteItems: ReturnType<typeof buildEmoteTicker>
  moverItems: ReturnType<typeof buildMoverTicker>
  discord: string | null
}) {
  return (
    <section className="sl-hero sl-hero--stage" aria-labelledby="hero-headline">
      <div className="sl-stage">
        <Link to="/analytics" className="sl-announce" onClick={() => capturePublicCta('open_analytics')}>
          <span className="sl-announce__new">Explore</span>
          Public analytics — no account needed
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
        <h1 id="hero-headline">
          Find the Twitch moments people <span className="sl-grad">actually reacted to.</span>
        </h1>
        <p>
          StreamPulse tracks chat velocity, emote spikes, viewer movement, and jumpable moments across live streams and
          VODs.
        </p>
        <div className="sl-hero__actions">
          <ChromeInstallCta className={buttonClass('default', 'lg')} data-cta="chrome-install-hero">
            <PanelTopOpen size={17} aria-hidden="true" />
            Add StreamPulse to Chrome
          </ChromeInstallCta>
          <Link to="/analytics" className={buttonClass('outline', 'lg')} onClick={() => capturePublicCta('open_analytics')}>
            <LineChart size={17} aria-hidden="true" />
            Open Analytics
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        {discord ? (
          <div className="sl-community">
            {/* The name starts with the words on the pill, for voice control. */}
            <a href={discord} target="_blank" rel="noopener noreferrer" className="sl-discord-pill" aria-label="Join the Discord (opens in a new tab)">
              <DiscordMark size={20} />
              Join the Discord
              <ArrowUpRight className="sl-discord-pill__ext" size={13} aria-hidden="true" />
            </a>
          </div>
        ) : null}
        <a href="#demo" className="sl-stage__cue">
          See an example of the Pulse tab
          <span className="sl-stage__cuedot" aria-hidden="true" />
        </a>
        <div className="sl-tickwrap" aria-label="Latest available emote and channel snapshot">
          <EmoteTicker variant="a" label="Trending emotes" items={emoteItems} />
          <EmoteTicker variant="b" label="Trending channels" items={moverItems} />
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  const steps = [
    {
      icon: PanelTopOpen,
      title: 'Open Twitch with Pulse',
      copy: 'Switch from Chat to Pulse beside a Twitch stream. See which parts of the broadcast have measurements.',
    },
    {
      icon: Radio,
      title: 'Watch the signal build',
      copy: 'Compare chat, viewers, and emote reactions minute by minute. Missing measurements stay visible as gaps.',
    },
    {
      icon: Sparkles,
      title: 'Jump to the loudest moments',
      copy: 'Open a moment in Analytics, then jump to its replay when video is available.',
    },
  ]

  return (
    <div className="sl-steps">
      {steps.map(({ icon: Icon, title, copy }) => (
        <article className="sl-card sl-step" key={title}>
          <span className="sl-step__ic" aria-hidden="true">
            <Icon />
          </span>
          <h3>{title}</h3>
          <p>{copy}</p>
        </article>
      ))}
    </div>
  )
}

function FeatureGrid() {
  const features = [
    {
      icon: ShieldCheck,
      title: 'Coverage honesty',
      copy: 'Live pages distinguish no pulse, stats-only, chat-synced, and full-pulse states instead of filling gaps client-side.',
    },
    {
      icon: LineChart,
      title: 'Backend-scored peaks',
      copy: 'Pulse scores, emote bursts, and stream ledgers stay server-authored so every surface reports the same truth.',
    },
    {
      icon: BookOpen,
      title: 'Public-safe analytics',
      copy: 'Global and hub views expose aggregate signals only: no raw chat, user IDs, or chatter-level rankings.',
    },
  ]

  return (
    <div className="sl-featgrid">
      {features.map(({ icon: Icon, title, copy }) => (
        <article className="sl-card sl-feat" key={title}>
          <span className="sl-feat__ic" aria-hidden="true">
            <Icon />
          </span>
          <h3>{title}</h3>
          <p>{copy}</p>
        </article>
      ))}
    </div>
  )
}

function Footer({ discord }: { discord: string | null }) {
  return (
    <footer className="sl-footer">
      <div className="sl-container sl-foot">
        <Link to="/" className="sl-brand">
          <BrandMark className="sl-brand__mark" size={28} />
          StreamPulse
        </Link>
        <div className="sl-foot__links">
          <Link to="/docs">Docs</Link>
          <Link to="/status">Status</Link>
          <Link to="/analytics" onClick={() => capturePublicCta('open_analytics')}>Analytics</Link>
          <Link to="/support">Support</Link>
          <Link to="/support#send-feedback">Send feedback</Link>
          {discord ? (
            <a href={discord} target="_blank" rel="noopener noreferrer" className="sl-foot__discord" aria-label="Discord (opens in a new tab)">
              <DiscordMark size={15} />Discord
            </a>
          ) : null}
          <Link to="/privacy">Privacy</Link>
          <AnalyticsPreferences />
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">GitHub</a>
        </div>
        <small>Public analytics for StreamPulse. Aggregate-first, coverage-honest, and Twitch-native.</small>
      </div>
    </footer>
  )
}

export default function Landing() {
  // Marketing needs one bounded snapshot, not a full analytics poll loop.
  const { data } = usePublicHubData({ pollMs: 0, activityWindow: '30m', projection: 'tickers' })
  const emoteItems = useMemo(() => buildEmoteTicker(data), [data])
  const moverItems = useMemo(() => buildMoverTicker(data), [data])
  const mainRef = useRef<HTMLElement | null>(null)
  const discord = discordInviteUrl()

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
    <div className="sp-landing">
      <EmoteRain />
      <TwitchChatBackdrop />
      <a className="sl-skip-link" href="#landing-main">Skip to main content</a>
      <TopNav discord={discord} />
      <main id="landing-main" tabIndex={-1} className="sl-main" ref={mainRef}>
        <Hero emoteItems={emoteItems} moverItems={moverItems} discord={discord} />

        <section id="demo" className="sl-section" aria-labelledby="demo-title">
          <div className="sl-container">
            <div className="sl-section-head" data-reveal>
              <h2 id="demo-title">The Pulse tab, feature by feature</h2>
              <span className="sl-sample-label">Sample data · interactive demonstration</span>
              <p>
                Explore an example of the panel beside Twitch chat. These numbers illustrate the interface; they are not a live broadcast.
              </p>
            </div>
            <DeferredDemo><ExtensionShowcase /></DeferredDemo>
          </div>
        </section>

        <section id="analysis" className="sl-section" aria-labelledby="analysis-title">
          <div className="sl-container">
            <div className="sl-section-head" data-reveal>
              <h2 id="analysis-title">See a stream become a signal</h2>
              <span className="sl-sample-label">Illustrative product demo · not live measurements</span>
              <p>Scroll through a sample broadcast: chat, emotes, viewers, and the moments worth revisiting.</p>
            </div>
            <LiveSignalScrollGraph />
          </div>
        </section>

        <section className="sl-section" aria-labelledby="features-title">
          <div className="sl-container">
            <div className="sl-section-head" data-reveal>
              <h2 id="features-title">Designed around trust, not mystery scores</h2>
              <p>Coverage state, backfill state, and Pulse peaks come from the backend source of truth.</p>
            </div>
            <div data-reveal>
              <FeatureGrid />
            </div>
          </div>
        </section>

        <section id="roadmap" className="sl-section" aria-labelledby="roadmap-title">
          <div className="sl-container">
            <div className="sl-section-head" data-reveal>
              <h2 id="roadmap-title">Roadmap</h2>
              <p>
                Available today and the next focused step. ReplayForge is for channel owners clipping their own broadcasts; access remains gated while the authorized moment-to-clip journey is verified.
              </p>
            </div>
            <div data-reveal>
              <RoadmapTimeline />
            </div>
          </div>
        </section>

        <section id="how" className="sl-section" aria-labelledby="how-title">
          <div className="sl-container">
            <div className="sl-section-head" data-reveal>
              <h2 id="how-title">How it works</h2>
              <p>Three steps from opening Twitch to catching up on the loudest minutes.</p>
            </div>
            <HowItWorks />
          </div>
        </section>

        <section id="resources" className="sl-section" aria-labelledby="resources-title">
          <div className="sl-container">
            <div className="sl-section-head" data-reveal>
              <h2 id="resources-title">Resources</h2>
              <p>Documentation, setup, and the status of the hosted stack.</p>
            </div>
            <div data-reveal>
              <ResourceGrid />
            </div>
          </div>
        </section>
      </main>
      <Footer discord={discord} />
    </div>
  )
}
