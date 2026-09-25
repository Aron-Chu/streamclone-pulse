import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { accountRequest, accountErrorText, AccountError } from '../../lib/accountApi'
import { clearAccountConfirmation, getAccountConfirmation } from '../../lib/accountConfirmation'
import { accountBillingReturnFromSearch, accountBillingSignInHref, consumeAccountBillingReturn, readAccountBillingReturn, rememberAccountBillingReturn } from '../../lib/accountBillingReturn'
import { PRIVACY_PATH, SUPPORTER_PATH, TERMS_PATH } from '../../lib/externalLinks'
import './account.css'

export default function AccountPage() {
  const pathname = useLocation().pathname.replace(/\/+$/, '')
  return <PublicLayout><section className="pulse-account" aria-label="StreamPulse account">
    {pathname === '/account/sign-in' ? <SignIn /> : pathname === '/account/confirm' ? <Confirm /> : <LinkDevice />}
    <p className="pulse-account-note">
      Your free Pulse tools do not require a{' '}
      <Link to={SUPPORTER_PATH}>Supporter subscription</Link>.
    </p>
    <p><Link to="/account/settings">Account &amp; devices</Link> · <Link to="/account/billing">Membership &amp; billing</Link></p>
  </section></PublicLayout>
}

const PILOT_SIGN_IN_NOTE = 'During the private pilot, sign-in emails are sent only to invited testers. If you’re not on the list, you won’t receive an email.'

function SignIn() {
  const returnTo = accountBillingReturnFromSearch(useLocation().search)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
      await accountRequest('/auth/start', { email: email.trim() })
      rememberAccountBillingReturn(returnTo)
      setSent(true)
    }
    catch (error) { setError(accountErrorText(error)) }
    finally { setBusy(false) }
  }
  // The pilot notice is the same static text for every address, before and after
  // sending, so it never reveals whether a given address is on the tester list.
  return <><p className="pulse-account-kicker">StreamPulse account</p><h1>Sign in to Pulse</h1>
    {sent ? <div role="status"><h2>Check your email</h2><p>Open the sign-in link in this browser, then confirm. The link expires after 15 minutes.</p><p data-testid="pilot-sign-in-note">{PILOT_SIGN_IN_NOTE}</p><button onClick={() => setSent(false)}>Use another email</button></div>
      : <form onSubmit={submit}><p>We’ll email you a link. No password needed.</p><p data-testid="pilot-sign-in-note">{PILOT_SIGN_IN_NOTE}</p><label htmlFor="account-email">Email address</label>
        <input id="account-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
        <button className="pulse-account-primary" disabled={busy}>{busy ? 'Sending…' : 'Send sign-in link'}</button>
        {/* The policy has to be reachable where the address is actually asked
            for, not only from the footer. */}
        <p className="pulse-account-note">
          We use your address to sign you in and to email about your account. See the{' '}
          <Link to={PRIVACY_PATH}>privacy policy</Link> and{' '}
          <Link to={TERMS_PATH}>terms of use</Link>.
        </p>
      </form>}
    {error ? <p role="alert">{error}</p> : null}</>
}

function Confirm() {
  const [token] = useState(getAccountConfirmation)
  const [returnTo, setReturnTo] = useState(readAccountBillingReturn)
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState('')
  async function confirm() {
    if (!token || busy) return
    setBusy(true); setError('')
    try {
      await accountRequest('/auth/complete', { secret: token, confirmed: true })
      clearAccountConfirmation()
      setReturnTo(consumeAccountBillingReturn())
      setComplete(true)
    }
    catch (error) { setError(accountErrorText(error)) }
    finally { setBusy(false) }
  }
  return <><p className="pulse-account-kicker">Secure sign-in</p><h1>{complete ? 'You’re signed in' : 'Confirm your sign-in'}</h1>
    {complete ? returnTo
      ? <><p>You can now review your Supporter membership.</p><Link className="pulse-account-button pulse-account-primary" to={returnTo}>Continue to billing</Link></>
      : <><p>You can now link your StreamPulse extension.</p><Link className="pulse-account-button pulse-account-primary" to="/account/link-device">Link extension</Link></>
      : token ? <><p>Continue only if you requested this sign-in link.</p><button className="pulse-account-primary" onClick={() => void confirm()} disabled={busy}>{busy ? 'Confirming…' : 'Confirm sign-in'}</button></>
      : <p>This link is missing or expired. Request a new link in this browser.</p>}
    {error ? <p role="alert">{error}</p> : null}
    {!complete ? <Link to={accountBillingSignInHref(returnTo)}>Request another sign-in link</Link> : null}</>
}

function LinkDevice() {
  const [session, setSession] = useState<'loading' | 'ready' | 'signed_out' | 'error'>('loading')
  const [code, setCode] = useState('')
  const [device, setDevice] = useState<{ code: string; label: string; expiresAt: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<'approved' | 'denied' | null>(null)
  const [error, setError] = useState('')
  const confirmationHeading = useRef<HTMLHeadingElement>(null)
  const [now, setNow] = useState(Date.now)
  const deviceExpired = device !== null && Date.parse(device.expiresAt) <= now
  useEffect(() => {
    if (!device) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [device])
  useEffect(() => {
    let live = true
    void accountRequest('/me').then(() => { if (live) setSession('ready') }).catch(error => { if (live) { setSession(error instanceof AccountError && error.status === 401 ? 'signed_out' : 'error'); setError(accountErrorText(error)) } })
    return () => { live = false }
  }, [])
  useEffect(() => { if (device) confirmationHeading.current?.focus() }, [device])
  async function inspect(event: FormEvent) {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try {
       const normalizedCode = code.replace(/-/g, '').toUpperCase()
       if (!/^[A-F0-9]{10}$/.test(normalizedCode)) { setError('Enter the ten-character code shown in the extension.'); return }
       const result = await accountRequest('/device-links/inspect', { code: normalizedCode })
      if (typeof result.label !== 'string' || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Invalid response')
       setDevice({ code: normalizedCode, label: result.label, expiresAt: result.expiresAt })
    } catch (error) { setError(accountErrorText(error)) }
    finally { setBusy(false) }
  }
  async function decide(approve: boolean) {
    if (!device || busy) return
    if (Date.parse(device.expiresAt) <= Date.now()) { setNow(Date.now()); return }
    setBusy(true); setError('')
    try { await accountRequest('/device-links/approve', { code: device.code, approve }); setDone(approve ? 'approved' : 'denied'); setDevice(null) }
    catch (error) { setError(accountErrorText(error)) }
    finally { setBusy(false) }
  }
  return <><p className="pulse-account-kicker">Account connection</p><h1>Link your extension</h1>
    {session === 'loading' ? <p role="status">Checking your account…</p> : session === 'signed_out' ? <><p>Sign in before linking a device.</p><Link className="pulse-account-button pulse-account-primary" to="/account/sign-in">Sign in</Link></>
      : session === 'ready' ? done ? <div role="status"><h2>{done === 'approved' ? 'Extension approved' : 'Request declined'}</h2><p>{done === 'approved' ? 'Return to the extension. It will finish connecting automatically.' : 'This request cannot connect to your account.'}</p></div>
        : device ? <div><h2 tabIndex={-1} ref={confirmationHeading}>Allow this extension?</h2><p className="pulse-account-device">{device.label}</p><p>It will be able to access your Pulse account. This does not connect Twitch, publish a badge, or start a subscription.</p><p>Only approve a request you started yourself.</p>
          {deviceExpired ? <p role="status">This code has expired. Start a new connection in the extension.</p> : <p>Code expires at {new Date(device.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</p>}
          <div className="pulse-account-actions"><button className="pulse-account-primary" disabled={busy || deviceExpired} onClick={() => void decide(true)}>Approve extension</button><button disabled={busy || deviceExpired} onClick={() => void decide(false)}>Decline</button></div>
          {error || deviceExpired ? <button disabled={busy} onClick={() => { setDevice(null); setCode(''); setError('') }}>Use another code</button> : null}
        </div> : <form onSubmit={inspect}><p>Enter the code shown in your StreamPulse extension.</p><label htmlFor="device-code">Extension code</label><input id="device-code" autoComplete="off" spellCheck={false} required maxLength={11} pattern="[A-Fa-f0-9]{5}-?[A-Fa-f0-9]{5}" value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="ABCDE-12345" disabled={busy} /><button className="pulse-account-primary" disabled={busy}>{busy ? 'Checking…' : 'Review extension'}</button></form>
      : null}
    {error ? <p role="alert">{error}</p> : null}</>
}
