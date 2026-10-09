import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { DiscordMark } from '../../ui/components/DiscordMark'
import { discordInviteUrl } from '../../lib/discord'
import { FeedbackFormSlot } from './FeedbackForm'
import './support.css'

/**
 * /feedback: the private feedback form on its own page. No account is needed;
 * an email is optional and only for a reply. Troubleshooting stays on /support,
 * which links here.
 */
export default function Feedback() {
  const discord = discordInviteUrl()
  return (
    <PublicLayout>
      <div data-testid="feedback-page" className="support-page">
        <header className="support-page__head">
          <span className="support-page__badge">
            <span aria-hidden="true" />
            Private feedback
          </span>
          <h1 id="feedback-title">Send feedback</h1>
          <p>Spotted a problem or have an idea? Tell the StreamPulse team here. No account needed.</p>
        </header>

        <section id="send-feedback" className="feedback-card" aria-labelledby="feedback-title">
          <p className="feedback-card__private" data-testid="feedback-private-note">
            <Lock aria-hidden="true" />
            <span>Private. Only the StreamPulse team reads it; nothing here is posted publicly.</span>
          </p>
          <FeedbackFormSlot />
        </section>

        {discord ? (
          <p className="support-discord-line" data-testid="support-discord-line">
            Ideas or just want to chat?{' '}
            <a href={discord} target="_blank" rel="noopener noreferrer" aria-label="Join the public Discord (opens in a new tab)">
              <DiscordMark size={15} /><span>Join the public Discord</span>
            </a>
            <small>Anyone there can read it, so keep account problems in this form.</small>
          </p>
        ) : null}

        <p className="support-page__aside">
          Looking for setup or troubleshooting steps? See <Link to="/support">Support &amp; Troubleshooting</Link>.
        </p>
      </div>
    </PublicLayout>
  )
}
