import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { accountErrorText } from '../../lib/accountApi'
import { signOutAccount } from '../../lib/accountSession'
import {
  beginTwitchFlow,
  twitchErrorCode,
  twitchErrorCopy,
  type TwitchErrorCode,
  type TwitchPurpose,
} from '../../lib/twitchSignIn'

/**
 * The Twitch Glitch mark, single colour, unmodified proportions (Twitch brand
 * guidelines: purple #9146FF, black or white; never recoloured or stretched).
 */
export function TwitchGlitch({ size = 18 }: { size?: number }) {
  return <svg className="pulse-account-twitch-glitch" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path fill="currentColor" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
  </svg>
}

/** Twitch-purple button with the white Glitch, per the Twitch brand kit. */
export function TwitchButton({ busy, busyLabel, onClick, children }: { busy: boolean; busyLabel: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" className="pulse-account-twitch-button" disabled={busy} onClick={onClick}>
    <TwitchGlitch /> {busy ? busyLabel : children}
  </button>
}

type NoticeProps = {
  code: TwitchErrorCode
  purpose: TwitchPurpose
  returnTo?: string | null
  /** Renders the title as the page heading (the callback page). */
  page?: boolean
  /** On the sign-in page, "Tester email sign-in" opens the form in place instead of linking to it. */
  onEmail?: () => void
  /** A next step that would only link to this page is left out. */
  current?: string
}

/** Explains one outcome in plain words and offers its single next step. */
export function TwitchErrorNotice({ code, purpose, returnTo, page = false, onEmail, current }: NoticeProps) {
  const copy = twitchErrorCopy(code, purpose)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  async function restart(forceVerify: boolean) {
    if (busy) return
    setBusy(true); setFailure('')
    try { await beginTwitchFlow({ purpose, returnTo, forceVerify }) }
    catch (error) { setFailure(twitchErrorCopy(twitchErrorCode(error), purpose).body); setBusy(false) }
  }
  async function signInAgain() {
    if (busy) return
    setBusy(true); setFailure('')
    try {
      await signOutAccount()
      window.location.assign('/account/sign-in?method=email')
    } catch (error) { setFailure(accountErrorText(error)); setBusy(false) }
  }
  let action: ReactNode = null
  switch (copy.next) {
    case 'twitch':
      action = <TwitchButton busy={busy} busyLabel="Opening Twitch…" onClick={() => void restart(false)}>{purpose === 'link' ? 'Link Twitch' : 'Continue with Twitch'}</TwitchButton>
      break
    case 'switch_account':
      action = <button type="button" disabled={busy} onClick={() => void restart(true)}>{busy ? 'Opening Twitch…' : 'Use a different Twitch account'}</button>
      break
    case 'email':
      action = onEmail
        ? <button type="button" onClick={onEmail}>Tester email sign-in</button>
        : <Link className="pulse-account-button pulse-account-primary" to="/account/sign-in?method=email">Tester email sign-in</Link>
      break
    case 'settings':
      action = current === '/account/settings' ? null : <Link className="pulse-account-button" to="/account/settings">Back to Account &amp; devices</Link>
      break
    case 'reauth':
      action = <button type="button" className="pulse-account-primary" disabled={busy} onClick={() => void signInAgain()}>{busy ? 'Signing out…' : 'Sign out and sign in again'}</button>
      break
    case 'support':
      action = <Link className="pulse-account-button" to="/support">Contact support</Link>
      break
    case 'later': {
      const target = purpose === 'link' ? '/account/settings' : '/account/sign-in'
      action = current === target ? null : <Link className="pulse-account-button" to={target}>{purpose === 'link' ? 'Back to Account & devices' : 'Back to sign-in'}</Link>
      break
    }
  }
  return <div className="pulse-account-twitch-notice" data-twitch-error={code}>
    {page ? <h1>{copy.title}</h1> : <h2>{copy.title}</h2>}
    <p role="alert">{copy.body}</p>
    {action ? <div className="pulse-account-actions">{action}</div> : null}
    {failure ? <p role="alert">{failure}</p> : null}
  </div>
}
