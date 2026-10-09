import { Link } from 'react-router-dom'
import { ArrowRight, Lock } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { buttonClass } from '../../ui/primitives'
import { FEEDBACK_PATH } from '../../lib/externalLinks'
import { feedbackSiteKey, supportFormAvailability } from '../../lib/supportForm'
import './support.css'

export default function Support() {
  // A build without the Turnstile site key cannot take private messages, so
  // the card does not promise them; /feedback then lists public alternatives.
  const formReady = supportFormAvailability(feedbackSiteKey()) === 'ready'
  return (
    <PublicLayout>
      <div data-testid="support-page" className="support-page">
        {/* The page's h1 comes first, so the heading outline and "next h1"
            reach the title before the card's h2. */}
        <header className="support-page__head">
          <span className="support-page__badge">
            <span aria-hidden="true" />
            StreamPulse Help & Diagnostic Desk
          </span>
          <h1>Support & Troubleshooting</h1>
          <p>Troubleshooting for the Twitch Chrome extension, coverage states, and public analytics portal.</p>
        </header>

        {/* The private form lives on /feedback. This card keeps the
            send-feedback id so older /support#send-feedback links land on it. */}
        <section id="send-feedback" className="feedback-card feedback-link-card" aria-labelledby="feedback-title" data-testid="support-feedback-link">
          <div className="feedback-link-card__text">
            <h2 id="feedback-title" className="feedback-card__title">Send private feedback</h2>
            <p className="feedback-card__sub" data-testid="support-feedback-link-sub">
              {/* The lock marks a private channel that can take a message; a build
                  that cannot take one says so without it. */}
              {formReady ? <Lock aria-hidden="true" data-testid="support-feedback-link-lock" /> : null}
              {formReady
                ? 'Report a problem or share an idea. Only the StreamPulse team reads it. No account needed.'
                : "The private feedback form isn't taking messages right now. The feedback page lists public alternatives."}
            </p>
          </div>
          <Link className={buttonClass('default', 'lg')} to={FEEDBACK_PATH}>
            Send feedback<ArrowRight aria-hidden="true" />
          </Link>
        </section>

        <article className="panel public-document support-page__guide">
          <section id="install">
            <h2 className="!mt-0">Install StreamPulse</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <ChromeInstallCta className={buttonClass('default', 'sm')} data-cta="chrome-install-support" />
              <span className="text-xs font-mono text-zinc-500">Official Web Store Build</span>
            </div>
          </section>

          <section className="mt-8 rounded-xl border border-white/[0.08] bg-black/20 p-6">
            <h2 className="!mt-0">Extension not appearing on Twitch</h2>
            <ol className="mt-3 space-y-2 text-sm text-zinc-300">
              <li>
                Open <code className="font-mono text-violet-300">chrome://extensions</code> and confirm StreamPulse is enabled.
              </li>
              <li>
                Turn StreamPulse off and on again, or select <strong>Reload</strong> if that control is available.
              </li>
              <li>Hard-refresh the Twitch channel or VOD tab (<kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-mono">Ctrl+F5</kbd> / <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-mono">Cmd+Shift+R</kbd>).</li>
              <li>
                Open Twitch chat and look for the <strong>Chat / Pulse</strong> switch above the chat input box.
              </li>
            </ol>
          </section>

          <section className="mt-8">
            <h2>Pulse is loading or has limited coverage</h2>
            <p>
              StreamPulse only displays data the backend actually collected. A newly tracked stream can show
              collecting, stats-only, or partial coverage while minute rollups arrive. Check the{' '}
              <Link to="/status" className="text-violet-400 hover:underline font-semibold">service status</Link> and retry after the next update.
            </p>
          </section>

          {/* What to Include */}
          <section className="mt-8">
            <h2>What to include in a support request</h2>
            <ul className="space-y-1.5 text-zinc-300 text-sm">
              <li>Chrome and StreamPulse extension versions.</li>
              <li>The Twitch channel or VOD name (typed manually is fine).</li>
              <li>The exact error message and whether the Chat / Pulse switch appears.</li>
            </ul>
            <p className="alert alert-warning mt-4 text-xs">
              <span>
                <strong>Privacy Protection:</strong> Do not send Twitch cookies, authorization headers, raw chat exports, passwords, or access keys.
                Do not attach screenshots that contain account secrets.
              </span>
            </p>
          </section>

          {/* Contact Mailbox */}
          <section id="contact" className="mt-8 border-t border-white/[0.08] pt-6">
            <h2>Contact</h2>
            <p>
              Email <a href="mailto:privacy@streampulse.stream" className="text-violet-400 font-bold hover:underline">privacy@streampulse.stream</a> for privacy or
              legal questions only. It is not a routine product-support mailbox.
            </p>
            <h3 id="security">Security reports</h3>
            <p className="muted text-xs">A private security-reporting channel has not been published yet. Do not post vulnerability details in public issues, on Discord or in the feedback form. A verified private contact is required before sending sensitive details.</p>
            <p className="text-xs text-zinc-400 mt-2">
              You can also review the <Link to="/docs#extension" className="text-violet-400 hover:underline">extension setup guide</Link> or the{' '}
              <Link to="/privacy" className="text-violet-400 hover:underline">privacy policy</Link>.
            </p>
          </section>
        </article>
      </div>
    </PublicLayout>
  )
}
