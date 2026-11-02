import { useState } from 'react'
import { Link } from 'react-router-dom'
import { accountErrorText } from '../../lib/accountApi'
import { signOutAccount, useAccountSession } from '../../lib/accountSession'
import { UnsentSavesError } from '../../lib/accountSaves'
import { forgetStepUp, rememberStepUp, type StepUpAction } from '../../lib/accountStepUp'
import { beginTwitchFlow, twitchErrorCode, twitchErrorCopy, twitchReturnPath } from '../../lib/twitchSignIn'
import { twitchSignInEnabled } from '../../lib/twitchSignInFlag'
import { TwitchButton } from './TwitchSignIn'

type Props = {
  /** What needs the recent sign-in, as in "deleting your account". */
  what: string
  /** Where Twitch sends the person back: a path twitchReturnPath accepts. */
  returnTo: string
  /** Reopened on `returnTo` after signing in again (accountStepUp.ts). */
  action?: StepUpAction
  outcome?: string
  /** Billing's email sign-in with its continuation: a plain link, as before. */
  emailLink?: string
}

/**
 * The API refused an action because the sign-in isn't recent enough. A Twitch
 * account signs in again on Twitch and comes back to this page with the action
 * reopened; an email-only account signs out and signs in with email (the email
 * link can't bring the person back here).
 */
export function RecentSignInNotice({ what, returnTo, action, outcome = 'Nothing was changed.', emailLink }: Props) {
  const session = useAccountSession()
  const twitch = twitchSignInEnabled() && session.status === 'signed_in' && (session.profile.twitchLinked === true || !!session.profile.displayName)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  async function signInAgain() {
    if (busy) return
    setBusy(true); setFailure('')
    // Remember the page Twitch really returns to (twitchReturnPath may swap it).
    if (action) rememberStepUp(action, ((twitch ? twitchReturnPath(returnTo) : null) ?? returnTo).split('?')[0]!)
    try {
      if (twitch) {
        // On success the page leaves for Twitch, so the button stays busy.
        await beginTwitchFlow({ purpose: 'signin', returnTo, forceVerify: true })
        return
      }
      await signOutAccount()
      window.location.assign('/account/sign-in?method=email')
    } catch (error) {
      forgetStepUp()
      setFailure(twitch ? twitchErrorCopy(twitchErrorCode(error), 'signin').body
        : error instanceof UnsentSavesError ? 'Some changes haven’t reached your account yet. Try again when you’re back online.'
          : accountErrorText(error))
      setBusy(false)
    }
  }
  return <div className="pulse-account-note" role="alert" data-testid="recent-sign-in">
    <p>For your security, {what} needs a sign-in from the last 10 minutes. {outcome}</p>
    {twitch
      ? <TwitchButton busy={busy} busyLabel="Opening Twitch…" onClick={() => void signInAgain()}>Sign in again</TwitchButton>
      : emailLink ? <Link className="pulse-account-button pulse-account-primary" to={emailLink}>Sign in again</Link>
        : <button type="button" className="pulse-account-primary" disabled={busy} onClick={() => void signInAgain()}>{busy ? 'Signing out…' : 'Sign in again'}</button>}
    {failure ? <p>{failure}</p> : null}
  </div>
}
