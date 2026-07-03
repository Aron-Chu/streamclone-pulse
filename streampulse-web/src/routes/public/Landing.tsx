import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BookOpen, LineChart, PanelTopOpen, Radio, ShieldCheck, Sparkles } from 'lucide-react'
import '../../ui/tokens.css'
import '../../ui/components/landing/landing.css'
import { buttonClass } from '../../ui/primitives'
import { usePublicHubData } from '../../hooks/usePublicHubData'
import { EmoteRain } from '../../ui/components/landing/EmoteRain'
import { TwitchChatBackdrop } from '../../ui/components/landing/TwitchChatBackdrop'
import { EmoteTicker } from '../../ui/components/landing/EmoteTicker'
import { ExtensionShowcase } from '../../ui/components/landing/ExtensionShowcase'
import { LiveSignalScrollGraph } from '../../ui/components/landing/LiveSignalScrollGraph'
import { ResourceGrid } from '../../ui/components/landing/ResourceGrid'
import { RoadmapTimeline } from '../../ui/components/landing/RoadmapTimeline'
import { buildEmoteTicker, buildExtModel, buildMoverTicker } from '../../ui/components/landing/landingData'

const CHROME_EXTENSION_URL = '/docs#extension'
const EXTENSION_BETA_LABEL = 'Install extension (beta)'

function TopNav() {
  return (
    <header className="sl-header">
      <nav className="sl-nav" aria-label="StreamPulse">
        <Link to="/" className="sl-brand">
          StreamPulse
        </Link>
        <div className="sl-menu">
          <a href="#demo">Pulse tab</a>
          <a href="#analysis">Signals</a>
          <a href="#roadmap">Roadmap</a>
          <Link to="/docs">Docs</Link>
        </div>
        <div className="sl-nav__right">
          <Link to="/analytics" className={buttonClass('outline', 'sm')}>
            Open Analytics
          </Link>
        </div>
      </nav>
    </header>
  )
}

function Hero({
  emoteItems,
  moverItems,
}: {
  emoteItems: ReturnType<typeof buildEmoteTicker>
  moverItems: ReturnType<typeof buildMoverTicker>
}) {
  return (
    <section className="sl-hero sl-hero--stage" aria-labelledby="hero-headline">
      <div className="sl-stage">
        <Link to="/analytics" className="sl-announce">
          <span className="sl-announce__new">Live</span>
          Hosted analytics console is online
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
        <h1 id="hero-headline">
          Find the Twitch moments people <span className="sl-grad">actually reacted to</span>.
        </h1>
        <p>
          StreamPulse tracks chat velocity, emote spikes, viewer movement, and jumpable moments across live streams and VODs.
        </p>
        <div className="sl-hero__actions">
          <Link to={CHROME_EXTENSION_URL} className={buttonClass('default', 'lg')}>
            <PanelTopOpen size={17} aria-hidden="true" />
            {EXTENSION_BETA_LABEL}
          </Link>
          <Link to="/analytics" className={buttonClass('outline', 'lg')}>
            <LineChart size={17} aria-hidden="true" />
            Open Analytics
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
        <a href="#demo" className="sl-stage__cue">
          Scroll to open a live stream
          <span className="sl-stage__cuedot" aria-hidden="true" />
        </a>
        <div className="sl-tickwrap" aria-label="Live emote and channel momentum">
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
      copy: 'The extension docks beside chat and shows honest live coverage without pretending it saw earlier minutes.',
    },
    {
      icon: Radio,
      title: 'Watch the signal build',
      copy: 'Chat, viewers, 7TV velocity, and detected peaks roll up minute by minute through the backend.',
    },
    {
      icon: Sparkles,
      title: 'Jump to the loudest moments',
      copy: 'Open StreamPulse Analytics for channel pages, moment feeds, top emotes, and replay-ready stream ledgers.',
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

function Footer() {
  return (
    <footer className="sl-footer">
      <div className="sl-container sl-foot">
        <Link to="/" className="sl-brand">
          <span className="sl-logo">SP</span>
          StreamPulse
        </Link>
        <div className="sl-foot__links">
          <Link to="/docs">Docs</Link>
          <Link to="/status">Status</Link>
          <Link to="/analytics">Analytics</Link>
        </div>
        <small>Public analytics for Streamclone Pulse. Aggregate-first, coverage-honest, and Twitch-native.</small>
      </div>
    </footer>
  )
}

export default function Landing() {
  const { data } = usePublicHubData({ pollMs: 45_000 })
  const emoteItems = useMemo(() => buildEmoteTicker(data), [data])
  const moverItems = useMemo(() => buildMoverTicker(data), [data])
  const extModel = useMemo(() => buildExtModel(data), [data])
  const mainRef = useRef<HTMLElement | null>(null)

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
      <TopNav />
      <main className="sl-main" ref={mainRef}>
        <Hero emoteItems={emoteItems} moverItems={moverItems} />

        <section id="demo" className="sl-section" aria-labelledby="demo-title">
          <div className="sl-container">
            <div className="sl-section-head" data-reveal>
              <h2 id="demo-title">The Pulse tab, feature by feature</h2>
              <p>
                This is the StreamPulse panel as it docks in your Twitch sidebar: live KPIs, chat velocity, coverage, the
                loudest moments, and past VODs.
              </p>
            </div>
            <ExtensionShowcase model={extModel} />
          </div>
        </section>

        <section id="analysis" className="sl-section" aria-labelledby="analysis-title">
          <div className="sl-container">
            <div className="sl-section-head" data-reveal>
              <h2 id="analysis-title">Every channel we track, live by the numbers</h2>
              <p>
                Scroll through a live stream replay and watch StreamPulse turn viewers, chat velocity, and emote rate into
                a ranked moment ledger.
              </p>
            </div>
            <div data-reveal>
              <LiveSignalScrollGraph />
            </div>
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
              <p>What is live today and what is coming next across StreamPulse, ReplayForge, and ClipTrace.</p>
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
            <div data-reveal>
              <HowItWorks />
            </div>
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
      <Footer />
    </div>
  )
}
