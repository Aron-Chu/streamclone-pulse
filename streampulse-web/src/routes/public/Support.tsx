import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'

export default function Support() {
  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="support-page">
        <h1>StreamPulse Support</h1>
        <p className="muted">
          Troubleshooting for the Twitch extension and public analytics portal.
        </p>

        <h2>Extension not appearing on Twitch</h2>
        <ol>
          <li>Open <code>chrome://extensions</code> and confirm StreamPulse is enabled.</li>
          <li>Select <strong>Reload</strong> for StreamPulse.</li>
          <li>Hard-refresh the Twitch channel or VOD tab.</li>
          <li>Open Twitch chat and look for the <strong>Chat / Pulse</strong> switch above chat.</li>
        </ol>

        <h2>Pulse is loading or has limited coverage</h2>
        <p>
          StreamPulse only displays data the backend actually collected. A newly tracked stream can show collecting,
          stats-only, or partial coverage while minute rollups arrive. Check the <Link to="/status">service status</Link>{' '}
          and retry after the next update.
        </p>

        <h2>What to include in a support request</h2>
        <ul>
          <li>Chrome and StreamPulse extension versions.</li>
          <li>The Twitch channel or VOD URL.</li>
          <li>The exact error message and whether the Chat / Pulse switch appears.</li>
          <li>A screenshot with personal account information removed.</li>
        </ul>
        <p>
          Do not send Twitch cookies, authorization headers, or raw chat exports.
        </p>

        <h2>Contact</h2>
        <p>
          Email <a href="mailto:privacy@streampulse.stream">privacy@streampulse.stream</a>. The same monitored address
          handles privacy and product-support questions.
        </p>
        <p>
          You can also review the <Link to="/docs#extension">extension setup guide</Link> or the{' '}
          <Link to="/privacy">privacy policy</Link>.
        </p>
      </article>
    </PublicLayout>
  )
}
