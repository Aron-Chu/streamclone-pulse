import { Link } from 'react-router-dom'
import { ArrowRight, Lock } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { InstallCta } from '../../ui/components/InstallCta'
import { buttonClass } from '../../ui/primitives'
import { FEEDBACK_PATH, SECURITY_REPORT_URL } from '../../lib/externalLinks'
import { feedbackSiteKey, supportFormAvailability } from '../../lib/supportForm'
import './support.css'

export default function Support() {
  // A build without the Turnstile site key cannot take private messages yet, so
  // the card says the form opens soon and its button says where it goes:
  // /feedback then lists the public places to ask.
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
          <p>Troubleshooting for the Twitch extension, coverage states, and public analytics portal.</p>
        </header>

        {/* The private form lives on /feedback. This card keeps the
            send-feedback id so older /support#send-feedback links land on it. */}
        <section id="send-feedback" className="feedback-card feedback-link-card" aria-labelledby="feedback-title" data-testid="support-feedback-link">
          <div className="feedback-link-card__text">
            <h2 id="feedback-title" className="feedback-card__title">{formReady ? 'Send private feedback' : 'Send feedback'}</h2>
            <p className="feedback-card__sub" data-testid="support-feedback-link-sub">
              {/* The lock marks a private channel that can take a message; a build
                  that cannot take one says so without it. */}
              {formReady ? <Lock aria-hidden="true" data-testid="support-feedback-link-lock" /> : null}
              {formReady
                ? 'Report a problem or share an idea. Only the StreamPulse team reads it. No account needed.'
                : 'Our private form opens soon. Until then, you can ask in public.'}
            </p>
          </div>
          <Link className={buttonClass('default', 'lg')} to={FEEDBACK_PATH}>
            {formReady ? 'Send feedback' : 'See where to ask'}<ArrowRight aria-hidden="true" />
          </Link>
        </section>

        <article className="panel public-document support-page__guide">
          <section id="install">
            <h2 className="!mt-0">Install StreamPulse</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <InstallCta className={buttonClass('default', 'sm')} data-cta="chrome-install-support" />
              <span className="text-xs font-mono text-zinc-500">Chrome Web Store · Chrome and Brave</span>
            </div>
          </section>

          <section className="mt-8 rounded-xl border border-white/[0.08] bg-black/20 p-6">
            <h2 className="!mt-0">Extension not appearing on Twitch</h2>
            <ol className="mt-3 space-y-2 text-sm text-zinc-300">
              <li>
                Confirm StreamPulse is enabled in your browser's extension manager: Chrome or Brave —{' '}
                <code className="font-mono text-violet-300">chrome://extensions</code>; Edge —{' '}
                <code className="font-mono text-violet-300">edge://extensions</code>; Firefox —{' '}
                <code className="font-mono text-violet-300">about:addons</code> → <strong>Extensions</strong>.
              </li>
              <li>
                Turn StreamPulse off and on again. For an unpacked Chrome, Brave or Edge build, select{' '}
                <strong>Reload</strong> if available. For a temporary Firefox build, open{' '}
                <code className="font-mono text-violet-300">about:debugging#/runtime/this-firefox</code>{' '}
                and select <strong>Reload</strong> under StreamPulse.
              </li>
              <li>Hard-refresh the Twitch channel or VOD tab (<kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-mono">Ctrl+F5</kbd> / <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-mono">Cmd+Shift+R</kbd>).</li>
              <li>
                Open Twitch chat and look for the <strong>Chat / Pulse</strong> switch at the top of chat.
                <strong> Pulse</strong> opens by default.
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
              <li>Your browser name and version, and the StreamPulse extension version.</li>
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
            {/* OWNER CONFIRMED 2026-10-13 (D35): Aron answers billing, cancellation
                and refund requests within 7 days. Private mailbox routing is ops-owned. */}
            <p>
              Email <a href="mailto:privacy@streampulse.stream" className="text-violet-400 font-bold hover:underline">privacy@streampulse.stream</a> for
              privacy, legal, billing and refund questions. For bugs and ideas use the{' '}
              <Link to={FEEDBACK_PATH} className="text-violet-400 hover:underline">{formReady ? 'private feedback form' : 'feedback page'}</Link>.
            </p>
            <p>Aron answers billing, cancellation and refund requests within 7 days.</p>
            <h3 id="security">Security reports</h3>
            <p className="muted text-xs" data-testid="support-security-report">
              Report vulnerabilities privately through{' '}
              <a href={SECURITY_REPORT_URL} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:underline"
                aria-label="GitHub private vulnerability reporting (opens in a new tab)">GitHub private vulnerability reporting</a>
              {' '}(only the maintainers see it; needs a GitHub account). Do not post vulnerability details in public issues, on Discord or in the feedback form.
            </p>
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
