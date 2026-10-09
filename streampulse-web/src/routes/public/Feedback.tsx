import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { DiscordMark } from '../../ui/components/DiscordMark'
import { discordInviteUrl } from '../../lib/discord'
import { feedbackSiteKey, supportFormAvailability } from '../../lib/supportForm'
import { FeedbackFormSlot, type FeedbackPhase } from './FeedbackForm'
import './support.css'

const OPEN_SUB = 'Spotted a problem or have an idea? Tell the StreamPulse team here. No account needed.'
const CLOSED_SUB = "Spotted a problem or have an idea? The private form isn't taking messages right now."

/**
 * /feedback: the private feedback form on its own page. No account is needed;
 * an email is optional and only for a reply. Troubleshooting stays on /support,
 * which links here.
 *
 * The "Private feedback" badge, the "tell the team here" line and the
 * "Private" note show only while the form can take a message. Once it is
 * unavailable (no site key, intake off, or the check cannot load), the header
 * says the form is closed and the card shows its own public alternatives, so
 * the page never invites a message it cannot send. The quiet Discord line
 * also hides whenever the card lists the public alternatives itself (after a
 * failed send as well), so Discord is never offered twice.
 *
 * In the prerender of a configured build the open copy hides without
 * JavaScript, where the card falls back to its unavailable panel too.
 */
export default function Feedback() {
  const discord = discordInviteUrl()
  const [phase, setPhase] = useState<FeedbackPhase>(() => (supportFormAvailability(feedbackSiteKey()) === 'ready' ? 'open' : 'unavailable'))
  const formOpen = phase !== 'unavailable'
  const prerender = typeof window === 'undefined'
  const jsOnly = prerender ? 'feedback-js-only' : undefined
  return (
    <PublicLayout>
      <div data-testid="feedback-page" className="support-page">
        <header className="support-page__head">
          {formOpen ? (
            <span className={jsOnly ? `support-page__badge ${jsOnly}` : 'support-page__badge'} data-testid="feedback-private-badge">
              <span aria-hidden="true" />
              Private feedback
            </span>
          ) : null}
          <h1 id="feedback-title">Send feedback</h1>
          {formOpen ? (
            <>
              <p className={jsOnly} data-testid="feedback-page-sub">{OPEN_SUB}</p>
              {prerender ? <noscript><p>{CLOSED_SUB}</p></noscript> : null}
            </>
          ) : <p data-testid="feedback-page-sub">{CLOSED_SUB}</p>}
        </header>

        <section id="send-feedback" className="feedback-card" aria-labelledby="feedback-title">
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

        {discord && phase === 'open' ? (
          <p className="support-discord-line feedback-js-only" data-testid="support-discord-line">
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
