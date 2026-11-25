import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { InstallCta } from '../../ui/components/InstallCta'
import { buttonClass } from '../../ui/primitives'
import { SECURITY_REPORT_URL } from '../../lib/externalLinks'
import { feedbackSiteKey, supportFormAvailability } from '../../lib/supportForm'
import { FeedbackFormSlot, PublicAlternatives, type FeedbackPhase } from './FeedbackForm'
import './support.css'

const OPEN_SUB = 'Report a problem or share an idea. No account needed.'
const CLOSED_SUB = "The private form isn't taking messages right now."
/** Before launch: a build without a site key has never had the form open, so it is not an outage. */
const SOON_SUB = 'Our private form opens soon. Until then, you can ask in public.'

/**
 * /help: install, fix problems, ask us. The old help pages open a section of
 * it (src/routes/index.tsx): /docs and /install open Install, /support opens
 * Fix problems, /feedback opens the form. Their old anchors keep a section of
 * the same id here, or are mapped to one there.
 *
 * Discord and GitHub show under Ask us only while the private form can take a
 * message. Otherwise the form's card lists them itself, so they never show
 * twice. In the prerender of a configured build they hide without JavaScript,
 * where the card falls back to that list too.
 */
export default function Help() {
  const formReady = supportFormAvailability(feedbackSiteKey()) === 'ready'
  const [phase, setPhase] = useState<FeedbackPhase>(() => (formReady ? 'open' : 'unavailable'))
  const prerender = typeof window === 'undefined'
  return (
    <PublicLayout>
      <div data-testid="help-page" className="support-page">
        <header className="support-page__head">
          <h1>Help</h1>
          <p>Install StreamPulse, fix a problem, or ask us.</p>
          <p className="help-page__status" data-testid="help-status">
            Something not loading? See the <Link to="/status">service status</Link>.
          </p>
          <nav className="public-toc help-page__toc" aria-label="On this page">
            <a href="#install">Install</a>
            <a href="#fix">Fix problems</a>
            <a href="#ask">Ask us</a>
          </nav>
        </header>

        <article className="panel public-document support-page__guide">
          <section id="install" aria-labelledby="install-title">
            <h2 id="install-title" className="!mt-0">Install</h2>
            <p>
              StreamPulse is a free extension for Chrome, Brave, Edge and Firefox on a computer. Install it, open a
              Twitch channel or VOD, and use the <strong>Chat / Pulse</strong> switch at the top of chat.
            </p>
            <div className="support-page__install mt-4">
              <InstallCta store="chrome" className={buttonClass('default', 'sm')} data-cta="chrome-install-help" />
              <InstallCta store="edge" label="short" className={buttonClass('outline', 'sm')} data-cta="edge-install-help" />
              <InstallCta store="firefox" label="short" className={buttonClass('outline', 'sm')} data-cta="firefox-install-help" />
            </div>
            <p className="mt-3 text-sm">
              On a phone or tablet? Open this page on your computer. The version in a store listing is the extension's
              own, not the website's.
            </p>
            <p className="alert alert-warning mt-4">
              <span>
                <strong>Only install from the stores:</strong> the Chrome Web Store, Edge Add-ons or Firefox Add-ons.
                Never install StreamPulse from a download site.
              </span>
            </p>

            <section id="hub" aria-labelledby="hub-title">
              <h3 id="hub-title">Use the Hub</h3>
              <p>
                The <Link to="/analytics">Hub</Link> shows chat stats, top emotes and reaction moments for the channels
                we track. It never shows raw chat or who said what.
              </p>
              <ol>
                <li>Search a channel, or pick one under Busiest now.</li>
                <li>Check the time window and coverage before you compare numbers.</li>
                <li>Open a moment to see its stream time. The video may be pending or gone even when the stats are there.</li>
              </ol>
            </section>

            <section id="guides" aria-labelledby="guides-title">
              <h3 id="guides-title">Guides</h3>
              <ul>
                <li><Link to="/guides/twitch-vod-timestamps">Make a Twitch VOD timestamp link</Link> and check the replay before you share it.</li>
                <li><Link to="/guides/find-twitch-moments">Find and bookmark reaction moments</Link> in the streams we track.</li>
                <li><Link to="/guides/how-moments-are-picked">See how Moments are picked</Link> and what they can’t tell you.</li>
                <li><Link to="/guides/reading-the-chat-chart">Read a stream’s chat chart</Link>, from viewers to emote bursts.</li>
              </ul>
              <p><Link to="/guides">All guides</Link></p>
            </section>
          </section>

          <section id="fix" aria-labelledby="fix-title" className="mt-8 border-t border-white/[0.08] pt-6">
            <h2 id="fix-title" className="!mt-0">Fix problems</h2>
            <section id="switch" aria-labelledby="switch-title">
              <h3 id="switch-title">The Chat / Pulse switch is missing</h3>
              <ol>
                <li>
                  Check that StreamPulse is on in your browser's extensions page: Chrome or Brave{' '}
                  <code className="font-mono text-violet-300">chrome://extensions</code>, Edge{' '}
                  <code className="font-mono text-violet-300">edge://extensions</code>, Firefox{' '}
                  <code className="font-mono text-violet-300">about:addons</code>.
                </li>
                <li>Turn StreamPulse off and on again.</li>
                <li>
                  Reload the Twitch tab (<kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-mono">Ctrl+F5</kbd>{' '}
                  or <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-mono">Cmd+Shift+R</kbd>).
                </li>
                <li>Open Twitch chat and look for the <strong>Chat / Pulse</strong> switch at the top. Channels with nothing to chart stay on Chat.</li>
              </ol>
            </section>

            <section id="coverage" aria-labelledby="coverage-title">
              <h3 id="coverage-title">Numbers look low or missing</h3>
              <p>
                StreamPulse only shows what it collected. Coverage is about the time window you picked, not the whole
                broadcast, and a gap is not zero activity.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span className="font-bold text-emerald-300 uppercase text-xs font-mono">Synced</span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-300">Minute-by-minute data is in. Check the window before you compare.</p>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    <span className="font-bold text-amber-300 uppercase text-xs font-mono">Collecting</span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-300">New minutes are arriving. Earlier ones may still be missing.</p>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-violet-400" />
                    <span className="font-bold text-violet-300 uppercase text-xs font-mono">Partial</span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-300">Only some minutes or signals are in, such as viewers without chat.</p>
                </div>
              </div>
            </section>

            <section id="billing-email" aria-labelledby="billing-email-title">
              <h3 id="billing-email-title">Can't get into your billing email?</h3>
              <p>Still signed in on the browser you paid in? Open Account &amp; Supporter → Manage subscription and change the email for receipts and billing notices.</p>
              <p>
                If not, we can't move the membership. Email{' '}
                <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>{' '}
                with the old billing email, your card's last 4 digits and the date of one charge. We'll review your request to stop future renewals. You can join again with an email you can use. If the old subscription is still active, you could be charged for both.
              </p>
              <p>Never send your full card number, security code or ID.</p>
              <p>We answer within 7 days. Your bank may also be able to block future charges from STREAMPULSE.</p>
            </section>

            {/* #api sits inside the fold, so an old /docs#api link opens it (lib/routeScroll). */}
            <details className="mt-8 border-t border-white/[0.08] pt-4">
              <summary className="cursor-pointer font-semibold text-zinc-200">Developer reference</summary>
              <div id="api" className="pt-3 text-sm text-zinc-400">
                <p>These read-only aggregate endpoints power the site. Respect rate limits and cache responses; public analytics grant no media access or creator permissions.</p>
                <div className="public-api-reference mt-3 rounded-lg border border-white/[0.08] bg-black/40 p-4 font-mono text-xs text-zinc-400">
                  <p><code>GET https://api.streampulse.stream/v1/public/hub?activityWindow=30m</code></p>
                  <p><code>GET https://api.streampulse.stream/v1/portal/analytics/streams/:streamId</code></p>
                </div>
              </div>
            </details>
          </section>

          <section id="ask" aria-labelledby="ask-title" className="mt-8 border-t border-white/[0.08] pt-6">
            <h2 id="ask-title" className="!mt-0">Ask us</h2>
            <p data-testid="help-ask-intro">
              {phase === 'unavailable'
                ? 'Ask in public on Discord or GitHub. The links are below.'
                : 'Ask in public on Discord or GitHub, or send the team a private message with the form below.'}
            </p>
            {phase === 'open' ? (
              <div className={prerender ? 'feedback-js-only' : undefined} data-testid="help-ask-public">
                <PublicAlternatives />
              </div>
            ) : null}
            <section id="contact" aria-labelledby="contact-title">
              <h3 id="contact-title">Contact by email</h3>
              <p>
                Email <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a> for privacy, legal,
                billing and refund questions. Aron answers billing, cancellation and refund requests within 7 days.
              </p>
            </section>
            <section id="security" aria-labelledby="security-title">
              <h3 id="security-title">Security reports</h3>
              <p data-testid="help-security-report">
                Report a vulnerability privately through{' '}
                <a href={SECURITY_REPORT_URL} target="_blank" rel="noopener noreferrer"
                  aria-label="GitHub private vulnerability reporting (opens in a new tab)">GitHub private vulnerability reporting</a>.
                Only the maintainers see it, and it needs a GitHub account. Don't post vulnerability details in public issues, on Discord or in the form.
              </p>
            </section>
            <h3>What to include</h3>
            <ul>
              <li>Your browser and its version, and the StreamPulse version.</li>
              <li>The Twitch channel or VOD.</li>
              <li>The exact error, and whether the Chat / Pulse switch shows.</li>
            </ul>
            <p className="alert alert-warning mt-4 text-xs">
              <span>
                <strong>Don’t send:</strong> Twitch cookies, authorization headers, raw chat exports, passwords, access keys, or screenshots that show any of them.
              </span>
            </p>
          </section>
        </article>

        <section id="feedback" className="feedback-card" aria-labelledby="feedback-title" data-testid="help-feedback">
          <h2 id="feedback-title" className="feedback-card__title">{formReady ? 'Send private feedback' : 'Send feedback'}</h2>
          {phase !== 'unavailable' ? (
            <>
              <p className={prerender ? 'feedback-card__sub feedback-js-only' : 'feedback-card__sub'} data-testid="help-feedback-sub">{OPEN_SUB}</p>
              {prerender ? <noscript><p className="feedback-card__sub">{CLOSED_SUB}</p></noscript> : null}
            </>
          ) : <p className="feedback-card__sub" data-testid="help-feedback-sub">{formReady ? CLOSED_SUB : SOON_SUB}</p>}
          <FeedbackFormSlot
            onPhase={setPhase}
            lead={(
              <p className="feedback-card__private" data-testid="feedback-private-note">
                <Lock aria-hidden="true" />
                <span>Private. Only the StreamPulse team reads it; nothing here is posted publicly.</span>
              </p>
            )}
          />
        </section>
      </div>
    </PublicLayout>
  )
}
