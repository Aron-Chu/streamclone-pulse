import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { DiscordMark } from '../../ui/components/DiscordMark'
import { buttonClass } from '../../ui/primitives'
import { FEEDBACK_PATH } from '../../lib/externalLinks'
import { discordInviteUrl } from '../../lib/discord'

function leaveFor(url: string) {
  window.location.replace(url)
}

/**
 * /discord — the stable address the extension's "Join Discord" opens. The invite
 * itself is a build-time input, so changing it never needs an extension release.
 * Without a valid invite the page says so plainly and points at /support.
 */
export default function Discord({ redirect = leaveFor }: { redirect?: (url: string) => void }) {
  const invite = discordInviteUrl()

  useEffect(() => {
    if (invite) redirect(invite)
  }, [invite, redirect])

  return (
    <PublicLayout>
      <article className="panel public-document" data-testid="discord-page">
        {invite ? (
          <>
            <h1>Opening the StreamPulse Discord</h1>
            <p>If Discord doesn&apos;t open on its own, use the button below.</p>
            <div className="public-document__actions">
              <a className={buttonClass('default', 'lg', { className: 'discord-join' })} href={invite} rel="noopener noreferrer">
                <DiscordMark size={18} />Join the Discord
              </a>
            </div>
            <p className="muted">The server is public, so keep account problems for the <Link to={FEEDBACK_PATH}>private feedback form</Link>.</p>
          </>
        ) : (
          <>
            <h1>The StreamPulse Discord isn&apos;t open yet</h1>
            <p>There is no community server to join right now. To report a problem or share an idea, send private feedback.</p>
            <div className="public-document__actions">
              <Link className={buttonClass('default', 'lg')} to={FEEDBACK_PATH}>Send feedback</Link>
            </div>
          </>
        )}
      </article>
    </PublicLayout>
  )
}
