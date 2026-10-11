import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CheckCircle2, Mail, Puzzle, ShieldCheck } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { AccountSteps, LINK_JOURNEY_STEPS, SUPPORTER_JOURNEY_STEPS, accountReference } from './AccountJourney'
import { AccountSignInGate } from './AccountSignedIn'
import { accountRequest, accountErrorText, AccountError } from '../../lib/accountApi'
import { clearAccountConfirmation, getAccountConfirmation } from '../../lib/accountConfirmation'
import { clearAccountDeviceCode, getAccountDeviceCode, getAccountDeviceContinuation } from '../../lib/accountDeviceCode'
import { ACCOUNT_LINK_DEVICE_PATH, accountBillingReturnFromSearch, accountBillingSignInHref, consumeAccountBillingReturn, readAccountBillingReturn, rememberAccountBillingReturn } from '../../lib/accountBillingReturn'
import { accountSignInAge, announceAccountSignedIn, onAccountSessionSignal, RECENT_SIGN_IN_MS } from '../../lib/accountSessionSignal'
import { PRIVACY_PATH, TERMS_PATH } from '../../lib/externalLinks'
import { refreshAccountSession } from '../../lib/accountSession'
import { twitchSignInStage } from '../../lib/twitchSignInFlag'
import { beginTwitchFlow, twitchErrorCode, type TwitchErrorCode } from '../../lib/twitchSignIn'
import { TwitchButton, TwitchErrorNotice } from './TwitchSignIn'
import './account.css'

export default function AccountPage() {
  const pathname = useLocation().pathname.replace(/\/+$/, '')
  return <PublicLayout><section className="pulse-account" aria-label="StreamPulse account">
    {pathname === '/account/sign-in' ? <AccountSignInGate><SignIn /></AccountSignInGate> : pathname === '/account/confirm' ? <Confirm /> : <LinkDevice />}
    <AccountFooter />
  </section></PublicLayout>
}

const PILOT_SIGN_IN_NOTE = 'During the private pilot, sign-in emails are sent only to invited testers. If you’re not on the list, you won’t receive an email.'
const TWITCH_PILOT_NOTE = 'During the private pilot, Continue with Twitch works for invited testers who have already linked Twitch in Account & devices. First time here? Use Tester email sign-in.'
export const FREE_TOOLS_LINE = 'Free tools work without an account.'

/**
 * /account/sign-in by stage (twitchSignInStage):
 * - off (today): "Tester sign-in", Twitch coming soon, the pilot email form.
 * - tester: still "Tester sign-in"; Continue with Twitch leads, with the tester
 *   note, and email waits under "Tester email sign-in".
 * - public: "Sign in to StreamPulse"; Continue with Twitch, email only under
 *   "Tester email sign-in".
 */
function SignIn() {
  const returnTo = accountBillingReturnFromSearch(useLocation().search)
  const navigate = useNavigate()
  // When the email is confirmed in another tab, this tab continues too, to the
  // same allowlisted destination, instead of asking the user to switch tabs.
  useEffect(() => onAccountSessionSignal(signal => {
    if (signal === 'signed-in' && returnTo) navigate(returnTo)
  }), [navigate, returnTo])
  const stage = twitchSignInStage()
  return <><p className="pulse-account-kicker"><Mail size={16} aria-hidden="true" /> StreamPulse account</p>
    <SignInForm returnTo={returnTo} heading={sent => sent ? 'Check your email' : stage === 'public' ? 'Sign in to StreamPulse' : 'Tester sign-in'} sentDetail={returnTo ? 'This tab continues by itself once you confirm.' : undefined}
      lead={stage === 'off' ? <p className="pulse-account-intro" data-testid="twitch-coming-soon">Twitch sign-in is coming soon. {FREE_TOOLS_LINE}</p> : undefined}
      withTwitch={stage === 'off' ? false : stage} /></>
}

/**
 * The email sign-in form, on its own page or inside the extension-link page.
 * Embedded, the tab keeps its prepared extension code in memory while the user
 * confirms the email in another tab, then continues by itself.
 *
 * `withTwitch` (tester or public stage, sign-in page only) puts Continue with
 * Twitch first and folds the email form behind "Tester email sign-in". The
 * extension-link page never offers it: leaving for Twitch would drop the code
 * held in memory.
 */
function SignInForm({ returnTo, heading, intro = 'We’ll email you a link. No password needed.', sentDetail, withTwitch = false, lead }: {
  returnTo: string | null
  heading: (sent: boolean) => string
  intro?: string
  sentDetail?: string
  withTwitch?: false | 'tester' | 'public'
  lead?: ReactNode
}) {
  const { search } = useLocation()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [emailOpen, setEmailOpen] = useState(() => !withTwitch || new URLSearchParams(search).get('method') === 'email')
  const emailToggled = useRef(false)
  const emailInput = useRef<HTMLInputElement>(null)
  const emailFormId = useId()
  const [twitchBusy, setTwitchBusy] = useState(false)
  const [twitchError, setTwitchError] = useState<TwitchErrorCode | null>(null)
  useEffect(() => { if (emailOpen && emailToggled.current) emailInput.current?.focus() }, [emailOpen])
  async function signInWithTwitch() {
    if (twitchBusy) return
    setTwitchBusy(true); setTwitchError(null)
    // On success the page leaves for Twitch, so the button stays busy.
    try { await beginTwitchFlow({ purpose: 'signin', returnTo }) }
    catch (failure) { setTwitchError(twitchErrorCode(failure)); setTwitchBusy(false) }
  }
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
  return <><h1>{heading(sent)}</h1>
    {!sent && lead ? lead : null}
    {!sent && withTwitch ? <div className="pulse-account-twitch" data-testid="twitch-sign-in">
      <p className="pulse-account-intro">{withTwitch === 'tester' ? `Twitch sign-in is open to invited testers right now. ${FREE_TOOLS_LINE}` : FREE_TOOLS_LINE}</p>
      <TwitchButton busy={twitchBusy} busyLabel="Opening Twitch…" onClick={() => void signInWithTwitch()}>Continue with Twitch</TwitchButton>
      <p className="pulse-account-privacy">
        StreamPulse asks Twitch only to confirm who you are. It never receives your Twitch password or email, and its servers don’t keep your display name or picture. See the{' '}
        <Link to={PRIVACY_PATH}>privacy policy</Link> and <Link to={TERMS_PATH}>terms of use</Link>.
      </p>
      {withTwitch === 'tester' ? <p className="pulse-account-pilot" data-testid="twitch-pilot-note">{TWITCH_PILOT_NOTE}</p> : null}
      {twitchError ? <TwitchErrorNotice code={twitchError} purpose="signin" returnTo={returnTo} current="/account/sign-in"
        onEmail={() => { emailToggled.current = true; setEmailOpen(true) }} /> : null}
      <button type="button" className="pulse-account-disclosure" aria-expanded={emailOpen} aria-controls={emailFormId}
        onClick={() => { emailToggled.current = true; setEmailOpen(open => !open) }}>Tester email sign-in</button>
    </div> : null}
    {sent ? <div role="status"><p className="pulse-account-intro">Open the sign-in link in this browser, then confirm. The link expires after 15 minutes.</p>{sentDetail ? <p className="pulse-account-waiting" data-testid="sign-in-waiting"><span className="pulse-account-spinner" aria-hidden="true" />{sentDetail}</p> : null}<p className="pulse-account-pilot" data-testid="pilot-sign-in-note">{PILOT_SIGN_IN_NOTE}</p><button onClick={() => setSent(false)}>Use another email</button></div>
      : !emailOpen ? null
      : <form id={emailFormId} onSubmit={submit}><p className="pulse-account-intro">{intro}</p><p className="pulse-account-pilot" data-testid="pilot-sign-in-note">{PILOT_SIGN_IN_NOTE}</p><label htmlFor="account-email">Email address</label>
        <input ref={emailInput} id="account-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
        <button className="pulse-account-primary" disabled={busy}>{busy ? 'Sending…' : 'Send sign-in link'}</button>
        {/* The policy has to be reachable where the address is actually asked
            for, not only from the footer. */}
        <p className="pulse-account-privacy">
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
      // A tab waiting on this sign-in (an extension approval or billing)
      // re-checks its session and continues; nothing secret is shared.
      announceAccountSignedIn()
      void refreshAccountSession()
    }
    catch (error) { setError(accountErrorText(error)) }
    finally { setBusy(false) }
  }
  return <><p className="pulse-account-kicker">{complete ? <CheckCircle2 size={16} aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />} Secure sign-in</p><h1>{complete ? 'You’re signed in' : 'Confirm your sign-in'}</h1>
    {complete ? returnTo === ACCOUNT_LINK_DEVICE_PATH
      ? <><p className="pulse-account-intro">Go back to the StreamPulse tab where you started. It continues by itself, and you can close this tab.</p><p>That tab closed? Reopen the link from your extension’s settings, or <Link to={ACCOUNT_LINK_DEVICE_PATH}>enter the extension code here</Link>.</p></>
      : returnTo
      ? <><p className="pulse-account-intro">You can now review your Supporter membership.</p><Link className="pulse-account-button pulse-account-primary" to={returnTo}>Continue to billing</Link></>
      : <><p className="pulse-account-intro">You can now link your StreamPulse extension.</p><Link className="pulse-account-button pulse-account-primary" to="/account/link-device">Link extension</Link></>
      : token ? <><p className="pulse-account-intro">Continue only if you requested this sign-in link.</p><button className="pulse-account-primary" onClick={() => void confirm()} disabled={busy}>{busy ? 'Confirming…' : 'Confirm sign-in'}</button></>
      : <p>This link is missing or expired. Request a new link in this browser.</p>}
    {error ? <p role="alert">{error}</p> : null}
    {!complete ? <p><Link to={accountBillingSignInHref(returnTo)}>Request another sign-in link</Link></p> : null}</>
}

type Session = 'loading' | 'ready' | 'signed_out' | 'error'
type Device = { code: string; label: string; expiresAt: string }
type Phase = 'idle' | 'inspecting' | 'review' | 'needs_sign_in' | 'invalid' | 'approved' | 'denied'

const formatCode = (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`
const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
/** The API gives every extension request a fixed ten-minute life (device_links.go), so it was created ten minutes before it expires. */
const DEVICE_REQUEST_LIFETIME_MS = 10 * 60_000
function requestAge(requestedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - requestedAt) / 60_000))
  return minutes < 1 ? 'less than a minute ago' : minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
}

/**
 * Everything an approved extension's device credential can do on the API: the
 * bookmark routes accept it for saved moments and notes, and the history sync,
 * settings and clear routes accept it without a further sign-in.
 */
function DeviceAccess() {
  return <><p>If you approve, this extension can, until you sign it out in Account &amp; devices:</p>
    <ul className="pulse-account-access" data-testid="device-access">
      <li>read your Supporter status and save your Pulse appearance</li>
      <li>see, add, change and delete your saved moments and their notes</li>
      <li>turn synced watch history on or off, and read or clear that history while it’s on</li>
    </ul>
    <p>It cannot connect Twitch, publish a badge, or start a subscription.</p></>
}

function LinkDevice() {
  const navigate = useNavigate()
  const [session, setSession] = useState<Session>('loading')
  // The prepared code and its continuation stay in this tab's memory only.
  const [prepared, setPrepared] = useState(() => ({ code: getAccountDeviceCode(), then: getAccountDeviceContinuation() }))
  // Requests live ten minutes from when the extension opened this tab.
  const preparedAt = useRef(Date.now())
  // Which account the approval would go to, so a sign-in elsewhere cannot
  // silently change it without the screen saying so.
  const [accountRef, setAccountRef] = useState<string | null>(null)
  // Taken into this view's state once; the module holder is emptied so no
  // later mount or other code path can read it.
  useEffect(() => { clearAccountDeviceCode() }, [])
  const [code, setCode] = useState(prepared.code)
  const [device, setDevice] = useState<Device | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirmationHeading = useRef<HTMLHeadingElement>(null)
  // Which sign-in generation the prepared code was last reviewed under: once on
  // arrival, and once more after each new sign-in. Never on mere focus, which
  // would spend the server's small inspection allowance.
  const autoInspected = useRef(-1)
  const [signIns, setSignIns] = useState(0)
  const sessionRequest = useRef(0)
  const [now, setNow] = useState(Date.now)
  const deviceExpired = device !== null && Date.parse(device.expiresAt) <= now
  const purchase = prepared.then === 'billing'

  const checkSession = useCallback(async () => {
    const request = ++sessionRequest.current
    try {
      const me = await accountRequest('/me')
      if (request !== sessionRequest.current) return
      setAccountRef(accountReference(me.accountId))
      setSession('ready')
    } catch (error) {
      if (request !== sessionRequest.current) return
      if (error instanceof AccountError && error.status === 401) {
        // Not being signed in yet is the expected first step, not an error.
        setSession('signed_out')
      } else {
        setSession('error')
      }
    }
  }, [])

  useEffect(() => {
    void checkSession()
    // Signing in happens in the email tab; when it finishes, continue here.
    const unsubscribe = onAccountSessionSignal(signal => {
      if (signal === 'signed-in') setSignIns(count => count + 1)
      void checkSession()
    })
    const wake = () => { if (!document.hidden) void checkSession() }
    window.addEventListener('focus', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      sessionRequest.current++
      unsubscribe()
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', wake)
    }
  }, [checkSession])

  useEffect(() => {
    if (!device) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [device])
  useEffect(() => { if (device) confirmationHeading.current?.focus() }, [device])

  function rejected(error: unknown) {
    if (error instanceof AccountError && error.status === 401 && error.code === 'link_invalid_or_expired') {
      // The server cannot say whether the code expired or the sign-in is older
      // than its ten-minute window for linking. A sign-in this browser recorded
      // recently points at the code; otherwise ask for a fresh sign-in first,
      // keeping the request ready in this tab.
      const age = accountSignInAge()
      const recentSignIn = age !== null && age < RECENT_SIGN_IN_MS - 30_000
      const requestTooOld = Boolean(prepared.code) && Date.now() - preparedAt.current >= 10 * 60_000
      const invalid = recentSignIn || requestTooOld
      setPhase(invalid ? 'invalid' : 'needs_sign_in')
      // A prepared code that failed cannot work again; a typed one may just need correcting.
      if (invalid && prepared.code) {
        setCode('')
        setPrepared(current => ({ code: '', then: current.then }))
      }
      setError('')
      return
    }
    if (error instanceof AccountError && error.status === 401) {
      setSession('signed_out')
      setPhase('idle')
      setError('')
      return
    }
    setPhase(current => current === 'inspecting' ? 'idle' : current)
    setError(accountErrorText(error))
  }

  const inspect = useCallback(async (value: string) => {
    if (busy) return
    const normalizedCode = value.replace(/-/g, '').toUpperCase()
    if (!/^[A-F0-9]{10}$/.test(normalizedCode)) { setError('Enter the ten-character code shown in the extension.'); return }
    setBusy(true); setError(''); setPhase('inspecting')
    try {
      const result = await accountRequest('/device-links/inspect', { code: normalizedCode })
      if (typeof result.label !== 'string' || typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))) throw new Error('Invalid response')
      setDevice({ code: normalizedCode, label: result.label, expiresAt: result.expiresAt })
      setPhase('review')
    } catch (error) { rejected(error) }
    finally { setBusy(false) }
  // `rejected` reads the prepared code, so a reset must refresh this callback.
  }, [busy, prepared.code])

  // A code prepared by the extension is reviewed as soon as the session allows,
  // so the only thing left to do is the explicit decision below.
  useEffect(() => {
    if (session !== 'ready' || device || busy) return
    if (phase === 'needs_sign_in') {
      if (autoInspected.current === signIns) return
      // Signed in again: review the prepared request, or return to the code form.
      if (!prepared.code) { autoInspected.current = signIns; setPhase('idle'); return }
    } else if (phase !== 'idle' || !prepared.code || autoInspected.current >= 0) return
    autoInspected.current = signIns
    void inspect(prepared.code)
  }, [session, prepared.code, device, phase, busy, signIns, inspect])

  async function decide(approve: boolean) {
    if (!device || busy) return
    if (Date.parse(device.expiresAt) <= Date.now()) { setNow(Date.now()); return }
    setBusy(true); setError('')
    try {
      await accountRequest('/device-links/approve', { code: device.code, approve })
      setDevice(null)
      if (approve && purchase) {
        navigate('/account/billing', { state: { connected: true } })
        return
      }
      setPhase(approve ? 'approved' : 'denied')
    }
    catch (error) { rejected(error) }
    finally { setBusy(false) }
  }

  function startOver() {
    // A manually entered code keeps the purchase continuation it started with.
    setPrepared(current => ({ code: '', then: current.then }))
    setDevice(null); setCode(''); setError(''); setPhase('idle')
  }

  const waitingForCode = Boolean(prepared.code) && phase !== 'approved' && phase !== 'denied'
  const steps = purchase ? SUPPORTER_JOURNEY_STEPS : LINK_JOURNEY_STEPS
  const progress = session === 'ready'
    ? purchase ? ['done', 'current', 'todo'] as const : ['done', 'current'] as const
    : purchase ? ['current', 'todo', 'todo'] as const : ['current', 'todo'] as const
  const showProgress = waitingForCode && phase !== 'invalid'
  const signInWaiting = 'Keep this tab open. When you confirm in the email’s tab, this page continues by itself.'

  return <><p className="pulse-account-kicker"><Puzzle size={16} aria-hidden="true" /> {purchase ? 'Become a Supporter' : 'Account connection'}</p>
    {showProgress ? <AccountSteps labels={steps} steps={progress} /> : null}
    {session === 'loading' ? <><h1>Link your extension</h1><p role="status" className="pulse-account-waiting"><span className="pulse-account-spinner" aria-hidden="true" />Checking your account…</p></>
      : session === 'signed_out' || phase === 'needs_sign_in' ? phase === 'needs_sign_in' && session === 'ready'
        ? <SignInForm returnTo={ACCOUNT_LINK_DEVICE_PATH} heading={sent => sent ? 'Check your email' : 'Confirm it’s you'} intro="Connecting an extension needs a sign-in from the last 10 minutes. Your extension’s request stays ready in this tab." sentDetail={signInWaiting} />
        : <SignInForm returnTo={ACCOUNT_LINK_DEVICE_PATH} heading={sent => sent ? 'Check your email' : waitingForCode ? 'Sign in to connect your extension' : 'Sign in to link your extension'} intro={waitingForCode ? 'Your extension is waiting for approval. Sign in with email; no password needed.' : 'Sign in with email to link your extension. No password needed.'} sentDetail={waitingForCode ? signInWaiting : undefined} />
      : session === 'error' ? <><h1>Link your extension</h1><p>Account services could not be reached. Your extension keeps its request; try again in a moment.</p><div className="pulse-account-actions"><button className="pulse-account-primary" onClick={() => { setError(''); void checkSession() }}>Try again</button></div></>
      : phase === 'approved' ? <div role="status"><h1>Extension connected</h1><p className="pulse-account-intro">Return to your extension. It finishes connecting by itself, and you can close this tab.</p><p><Link to="/account/billing">Membership &amp; billing</Link></p></div>
      : phase === 'denied' ? <div role="status"><h1>Request declined</h1><p className="pulse-account-intro">This request cannot connect to your account.</p></div>
      : phase === 'invalid' ? <><h1>This request is no longer valid</h1><p className="pulse-account-intro">Extension requests last ten minutes and work once. Start again from your extension’s settings and this page opens with a fresh request.</p><ManualCode code={code} setCode={setCode} busy={busy} onSubmit={() => void inspect(code)} help="Or check the code and enter it again, exactly as your extension shows it." /></>
      : device ? <div className="pulse-account-review"><h1 tabIndex={-1} ref={confirmationHeading}>Allow this extension?</h1><p className="pulse-account-device">{device.label}</p><p className="pulse-account-code-check"><span>Extension code</span><samp>{formatCode(device.code)}</samp></p>{accountRef ? <p className="pulse-account-code-check" data-testid="link-account"><span>Connects to Pulse account</span><samp>{accountRef}</samp></p> : null}<p className="pulse-account-meta" data-testid="device-requested">Requested at {clockTime(Date.parse(device.expiresAt) - DEVICE_REQUEST_LIFETIME_MS)} ({requestAge(Date.parse(device.expiresAt) - DEVICE_REQUEST_LIFETIME_MS, now)})</p><p>Check that this code matches the code currently shown in your extension. Only approve a request you started yourself, just now, in your own browser. If someone sent you this link or code, decline.</p><DeviceAccess />
        {deviceExpired ? <p role="status">This code has expired. Start a new connection in the extension.</p> : <p className="pulse-account-meta">Code expires at {clockTime(Date.parse(device.expiresAt))}.</p>}
        <div className="pulse-account-actions"><button className="pulse-account-primary" disabled={busy || deviceExpired} onClick={() => void decide(true)}>{busy ? 'Approving…' : purchase ? 'Approve and continue' : 'Approve extension'}</button><button disabled={busy || deviceExpired} onClick={() => void decide(false)}>Decline</button></div>
        {error || deviceExpired ? <button className="pulse-account-text-button" disabled={busy} onClick={startOver}>Use another code</button> : null}
      </div>
      : phase === 'inspecting' || (prepared.code && autoInspected.current < 0) ? <><h1>Connect your extension</h1><p role="status" className="pulse-account-waiting"><span className="pulse-account-spinner" aria-hidden="true" />Opening your extension’s request…</p></>
      : <><h1>Link your extension</h1><ManualCode code={code} setCode={setCode} busy={busy} onSubmit={() => void inspect(code)} help="In StreamPulse settings on Twitch, open Account & Supporter and start a connection; this page then opens with the request ready. Otherwise, enter the code your extension shows." /></>}
    {error ? <p role="alert">{error}</p> : null}</>
}

function ManualCode({ code, setCode, busy, onSubmit, help }: { code: string; setCode: (value: string) => void; busy: boolean; onSubmit: () => void; help: string }) {
  return <form onSubmit={event => { event.preventDefault(); onSubmit() }}><p className="pulse-account-code-help" id="device-code-help">{help}</p><label htmlFor="device-code">Extension code</label><input id="device-code" aria-describedby="device-code-help" autoComplete="off" spellCheck={false} required maxLength={11} pattern="[A-Fa-f0-9]{5}-?[A-Fa-f0-9]{5}" value={code} onChange={event => setCode(event.target.value.toUpperCase())} placeholder="ABCDE-12345" disabled={busy} /><button className="pulse-account-primary" disabled={busy}>{busy ? 'Checking…' : 'Review extension'}</button></form>
}
