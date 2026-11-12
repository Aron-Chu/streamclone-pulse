import { refreshAccountSession, type AccountSession } from '../../lib/accountSession'

/** The first sign-in check on an account page: still asking, or the account can't be reached right now (/me outage A, 10-22). */
export function AccountChecking({ session }: { session: Extract<AccountSession, { status: 'checking' }> }) {
  return session.unreachable
    ? <div className="pulse-account-unreachable" role="status"><p>Can’t reach your account right now.</p>
      <button type="button" className="pulse-account-button" onClick={() => void refreshAccountSession()}>Try again</button></div>
    : <p role="status">Checking your sign-in…</p>
}
