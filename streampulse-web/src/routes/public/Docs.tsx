import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { ChromeInstallCta } from '../../ui/components/ChromeInstallCta'
import { buttonClass } from '../../ui/primitives'

export default function Docs() {
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="docs-page">
        <h1>Docs</h1>
        <p className="muted">Install the Twitch extension, understand coverage, and open public analytics.</p>

        <section id="extension" aria-labelledby="extension-title">
          <h2 id="extension-title">Install the StreamPulse extension</h2>
          <p>
            StreamPulse is available on the Chrome Web Store. Install it from the official listing, then open any Twitch
            channel or VOD and switch from <strong>Chat</strong> to <strong>Pulse</strong>.
          </p>
          <p>
            <ChromeInstallCta className={buttonClass('default', 'sm')} data-cta="chrome-install-docs" />
          </p>
          <p className="alert alert-warning">
            Do not install StreamPulse packages from third-party download sites. Use only the official Chrome Web Store
            listing linked above.
          </p>
        </section>

        <section aria-labelledby="coverage-title">
          <h2 id="coverage-title">Coverage states</h2>
          <p>
            Pulse never fills missing minutes with invented activity. <strong>Collecting</strong> means current data is
            arriving, <strong>partial</strong> means only some signals are available, and <strong>synced</strong> means
            the displayed stream window has the expected backend coverage.
          </p>
        </section>

        <section aria-labelledby="analytics-title">
          <h2 id="analytics-title">Public analytics</h2>
          <p>
            <Link to="/analytics">StreamPulse Analytics</Link> provides aggregate channel, stream, emote, and reaction
            signals without exposing raw chat or chatter identities.
          </p>
        </section>

        <section aria-labelledby="help-title">
          <h2 id="help-title">Need help?</h2>
          <p>
            Visit <Link to="/support">StreamPulse Support</Link>, check the <Link to="/status">service status</Link>, or
            read the <Link to="/privacy">privacy policy</Link>.
          </p>
        </section>
      </article>
    </PublicLayout>
  )
}
