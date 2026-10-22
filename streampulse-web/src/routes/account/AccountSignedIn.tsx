import { useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CheckCircle2, LogOut, Mail } from 'lucide-react'
import { accountErrorText } from '../../lib/accountApi'
import { accountBillingReturnFromSearch } from '../../lib/accountBillingReturn'
import { leaveAccountPagesAfterSignOut, signOutAccount, useAccountSession } from '../../lib/accountSession'
import { accountMomentsEnabled } from '../../lib/accountMoments'
import { UnsentSavesError } from '../../lib/accountSaves'

/** Someone already signed in needs a way onward from /account/sign-in, not another email form. */
export function AccountSignInGate({ children }: { children: ReactNode }) {
  const session = useAccountSession()
  if (session.status === 'checking') {
    return <><p className="pulse-account-kicker"><Mail size={16} aria-hidden="true" /> StreamPulse account</p><p role="status">Checking your account…</p></>
  }
  return session.status === 'signed_in' ? <AccountSignedIn /> : <>{children}</>
}

function AccountSignedIn() {
  // A billing continuation still applies: it names the checkout this visitor was resuming.
  const returnTo = accountBillingReturnFromSearch(useLocation().search)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function signOut() {
    if (busy) return
    setBusy(true); setError('')
    try {
      await signOutAccount()
      leaveAccountPagesAfterSignOut()
    } catch (failure) {
      if (failure instanceof UnsentSavesError && window.confirm(`${failure.count === 1 ? '1 change hasn’t' : `${failure.count} changes haven’t`} reached your account yet. You look offline. Sign out anyway and clear ${failure.count === 1 ? 'it' : 'them'} from this browser?`)) {
        try { await signOutAccount({ force: true }); leaveAccountPagesAfterSignOut(); return } catch (again) { failure = again }
      }
      setError(failure instanceof UnsentSavesError ? 'Still signed in. Your changes go to your account when you’re back online.' : accountErrorText(failure)); setBusy(false)
    }
  }
  return <><p className="pulse-account-kicker"><CheckCircle2 size={16} aria-hidden="true" /> StreamPulse account</p><h1>You’re signed in</h1>
    <p className="pulse-account-intro">This browser is already signed in to your StreamPulse account.</p>
    <div className="pulse-account-actions">
      {accountMomentsEnabled() ? <Link className="pulse-account-button pulse-account-primary" to="/account">Account</Link>
        : <Link className="pulse-account-button pulse-account-primary" to="/account/settings">Account &amp; devices</Link>}
      <Link className="pulse-account-button" to={returnTo ?? '/account/billing'}>Membership &amp; billing</Link>
      <button type="button" disabled={busy} onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" /> {busy ? 'Signing out…' : 'Sign out'}</button>
    </div>
    {error ? <p role="alert">{error}</p> : null}</>
}
