import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, ArrowRight, History, PanelTopOpen, SlidersHorizontal, Sparkles } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { DiscordMark } from '../../ui/components/DiscordMark'
import { buttonClass } from '../../ui/primitives'
import { discordInviteUrl, DISCORD_PATH } from '../../lib/discord'
import { FEEDBACK_PATH, PRIVACY_PATH } from '../../lib/externalLinks'
// The extension's own release notes, the file /changelog reads.
import releaseNotes from '../../../../src/shared/release-notes.json'
// The old landing page's scroll-driven signal replay, back as a second demo (Aron, 2026-10-21).
import { LiveSignalScrollGraph } from '../../ui/components/landing/LiveSignalScrollGraph'
import '../../ui/tokens.css'
import './extension-page.css'

// The real panel, its styles and the sample stream: one chunk, loaded near the demo.
const DemoPanel = lazy(() => import('../../demo/DemoPanel'))

interface ReleaseNote {
  version: string
  status: string
  releasedAt: string | null
  title: string
  preview?: string[]
}

const LATEST_RELEASE: ReleaseNote | null =
  (releaseNotes as { releases: ReleaseNote[] }).releases.find(release => release.status === 'released') ?? null

function releaseDate(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date)
}

const FEATURES = [
  { icon: Activity, title: 'Live Pulse', text: 'Chat, emotes and viewers per minute, right beside chat.' },
  { icon: Sparkles, title: 'Top Moments', text: 'The strongest reactions, with a picture. Jump to any of them.' },
  { icon: History, title: 'Catch me up', text: 'A recap of a stream you missed: the biggest moment, the busiest half hour.' },
  { icon: SlidersHorizontal, title: 'Your settings', text: 'Turn each feature on or off, and pick your look.' },
] as const

const DEMO_PLACEHOLDER = 'The demo loads when this part of the page is on screen and JavaScript is on.'

/**
 * Loads the demo when it comes within a screen of the viewport, and tells it
 * whether it is on screen (its player clock runs only then).
 */
function DeferredDemo() {
  const host = useRef<HTMLDivElement>(null)
  const [load, setLoad] = useState(false)
  const [onScreen, setOnScreen] = useState(false)

  useEffect(() => {
    const el = host.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setLoad(true)
      setOnScreen(true)
      return
    }
    const near = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setLoad(true)
        near.disconnect()
      }
    }, { rootMargin: '100% 0px' })
    const visible = new IntersectionObserver(entries => {
      setOnScreen(entries.some(entry => entry.isIntersecting))
    })
    near.observe(el)
    visible.observe(el)
    return () => {
      near.disconnect()
      visible.disconnect()
    }
  }, [])

  const placeholder = <div className="xp-demo__placeholder"><p>{DEMO_PLACEHOLDER}</p></div>
  return (
    <div ref={host} className="xp-demo__slot">
      <Suspense fallback={placeholder}>{load ? <DemoPanel active={onScreen} /> : placeholder}</Suspense>
    </div>
  )
}

/** /extension: the extension, with its real panel running on a sample stream. */
export default function Extension() {
  const discord = discordInviteUrl()
  const latestDate = LATEST_RELEASE ? releaseDate(LATEST_RELEASE.releasedAt) : null

  return (
    <PublicLayout>
      <div className="xp" data-testid="extension-page">
        <section className="xp-hero" aria-labelledby="xp-hero-title">
          <p className="xp-eyebrow">Free browser extension for Twitch</p>
          <h1 id="xp-hero-title">See what Twitch chat reacted to</h1>
          <p className="xp-lead">
            A live chart of chat, emotes and viewers beside Twitch chat. Jump to the moments people reacted to, and get a
            recap when the stream ends.
          </p>
          <div className="xp-hero__actions">
            <ChromeInstallCta className={buttonClass('default', 'lg')} data-cta="chrome-install-extension-page">
              <PanelTopOpen size={17} aria-hidden="true" />
              Add to Chrome
            </ChromeInstallCta>
            <a href="#demo" className={buttonClass('outline', 'lg')}>
              See it run
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
          <p className="xp-hero__note">Also works in Edge and Brave. Firefox soon. No account needed.</p>
        </section>

        <section id="demo" className="xp-demo" aria-labelledby="xp-demo-title">
          <div className="xp-demo__head">
            <span className="xp-pill"><span className="xp-pill__dot" aria-hidden="true" />Live demo · a sample stream</span>
            <h2 id="xp-demo-title">Click anything. It&apos;s the real panel.</h2>
          </div>
          <DeferredDemo />
          <p className="xp-demo__note">
            This is the extension&apos;s own panel code, running on a made-up stream: the channel, the numbers and the
            moments are generated. On Twitch, it shows the stream you&apos;re watching.
          </p>
        </section>

        <section id="signal" className="xp-demo xp-signal" aria-labelledby="xp-signal-title">
          <div className="xp-demo__head">
            <span className="xp-pill">Illustrative demo · not live measurements</span>
            <h2 id="xp-signal-title">See a stream become a signal</h2>
            <p className="xp-demo__note">Scroll through a sample broadcast: chat, emotes, viewers, and the moments worth revisiting.</p>
          </div>
          <LiveSignalScrollGraph />
        </section>

        <section className="xp-section" aria-labelledby="xp-features-title">
          <h2 id="xp-features-title">What it does</h2>
          <ul className="xp-features">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="xp-feature">
                <Icon className="xp-feature__icon" size={20} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <div className="xp-pair">
          <section className="xp-section xp-card" aria-labelledby="xp-privacy-title">
            <h2 id="xp-privacy-title">Privacy, in short</h2>
            <ul className="xp-list">
              <li><strong>Counts, not chat.</strong> The extension shows minute-by-minute totals. It doesn&apos;t show chat messages or who sent them.</li>
              <li><strong>What reaches StreamPulse.</strong> The channel, stream and VOD you&apos;re viewing, so the totals for it can come back.</li>
              <li><strong>Moment pictures stay in the tab.</strong> They&apos;re never uploaded, and one switch in settings turns them off.</li>
            </ul>
            <Link to={PRIVACY_PATH} className="xp-more">Privacy policy <ArrowRight size={14} aria-hidden="true" /></Link>
          </section>

          <section className="xp-section xp-card" aria-labelledby="xp-news-title">
            <h2 id="xp-news-title">What&apos;s new</h2>
            {LATEST_RELEASE ? (
              <div className="xp-release">
                <p className="xp-release__meta">
                  Version {LATEST_RELEASE.version}
                  {latestDate ? <> · {latestDate}</> : null}
                </p>
                <h3>{LATEST_RELEASE.title}</h3>
                {LATEST_RELEASE.preview?.length ? (
                  <ul className="xp-list">
                    {LATEST_RELEASE.preview.slice(0, 3).map(line => <li key={line}>{line}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="xp-muted">No release notes yet.</p>
            )}
            <Link to="/changelog" className="xp-more">All releases <ArrowRight size={14} aria-hidden="true" /></Link>
          </section>
        </div>

        <section className="xp-section xp-talk" aria-labelledby="xp-talk-title">
          <div>
            <h2 id="xp-talk-title">Talk to us</h2>
            <p>Questions, ideas or a bug: we read everything.</p>
          </div>
          <div className="xp-talk__actions">
            {discord ? (
              <Link to={DISCORD_PATH} className={buttonClass('default', 'lg', { className: 'discord-join' })}>
                <DiscordMark size={18} />Join the Discord
              </Link>
            ) : null}
            <Link to={FEEDBACK_PATH} className={buttonClass(discord ? 'outline' : 'default', 'lg')}>Send feedback</Link>
          </div>
        </section>
      </div>
    </PublicLayout>
  )
}
