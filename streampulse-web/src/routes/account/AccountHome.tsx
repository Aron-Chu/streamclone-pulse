import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountError, accountErrorText, accountRequest, billingRequest } from '../../lib/accountApi'
import { AccountChecking } from './AccountChecking'
import { leaveAccountPagesAfterSignOut, signOutAccount, useAccountSession, type AccountProfile } from '../../lib/accountSession'
import { UnsentSavesError, useAccountSaves, type AccountSave } from '../../lib/accountSaves'
import { listHistory } from '../../lib/accountMoments'
import { apiClient } from '../../lib/apiClient'
import { isExactCategoryBoxArt } from '../../lib/momentCategoryArtwork'
import { SUPPORTER_PATH } from '../../lib/externalLinks'
import './account.css'
import './account-home.css'

/**
 * The one Account page (Aron's A1 pick, local sandbox 2026-10-21): profile,
 * My Moments, your browsers, Supporter and your data, all at a glance.
 */
export default function AccountHome() {
  const session = useAccountSession()
  return <PublicLayout><section className="pulse-account pulse-account-home" aria-label="Account">
    {session.status === 'checking' ? <AccountChecking session={session} />
      : session.status === 'signed_out' ? <div className="account-home__signed-out">
        <h1>Sign in to StreamPulse</h1>
        <p className="pulse-account-intro">Keeps your saves, notes and watched streams together, on the site and in the extension.</p>
        <Link className="pulse-account-button pulse-account-primary" to="/account/sign-in">Sign in</Link>
      </div>
      : <SignedIn profile={session.profile} />}
  </section></PublicLayout>
}

function SignedIn({ profile }: { profile: AccountProfile }) {
  const [email, setEmail] = useState('')
  useEffect(() => {
    let live = true
    accountRequest('/me').then(me => { if (live && typeof me.email === 'string') setEmail(me.email) }, () => undefined)
    return () => { live = false }
  }, [])
  const watched = useWatched()
  return <div className="account-home">
    <ProfileBlock profile={profile} email={email} />
    <MomentsBlock watched={watched} />
    <div className="account-home__pair">
      <BrowsersBlock />
      <SupporterBlock />
    </div>
    <DataBlock watched={watched} />
  </div>
}

function initials(name: string | undefined): string {
  const letters = (name ?? '').replace(/[^\p{L}\p{N}]/gu, '')
  return (letters.slice(0, 1) + (name?.match(/[_\s-](\p{L})/u)?.[1] ?? letters.slice(1, 2))).toUpperCase() || '·'
}

export function AccountAvatar({ profile, size }: { profile: AccountProfile; size: number }) {
  return profile.avatarUrl
    ? <img className="account-home__avatar" src={profile.avatarUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" />
    : <span className="account-home__avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{initials(profile.displayName)}</span>
}

function ProfileBlock({ profile, email }: { profile: AccountProfile; email: string }) {
  const [busy, setBusy] = useState(false)
  const [unsent, setUnsent] = useState(0)
  const [error, setError] = useState('')
  async function signOut(force = false) {
    if (busy) return
    setBusy(true); setError('')
    try {
      await signOutAccount({ force })
      leaveAccountPagesAfterSignOut()
    } catch (failure) {
      if (failure instanceof UnsentSavesError) setUnsent(failure.count)
      else setError(accountErrorText(failure))
      setBusy(false)
    }
  }
  const twitch = profile.twitchLinked || !!profile.displayName
  return <div className="account-home__block account-home__profile">
    <div className="account-home__row">
      <AccountAvatar profile={profile} size={44} />
      <div className="account-home__who">
        <h1>{profile.displayName || email || 'Your account'}</h1>
        <p>{twitch ? 'Signed in with Twitch · name and picture come from Twitch' : 'Signed in with email'}</p>
      </div>
      <button type="button" className="account-home__ghost" disabled={busy} onClick={() => void signOut()}>{busy ? 'Signing out…' : 'Sign out'}</button>
    </div>
    {unsent ? <div className="account-home__warn" role="alert">
      <p><strong>{unsent === 1 ? '1 change hasn’t' : `${unsent} changes haven’t`} reached your account yet.</strong> You look offline. Signing out now clears {unsent === 1 ? 'it' : 'them'} from this browser.</p>
      <div className="account-home__actions">
        <button type="button" className="account-home__ghost account-home__danger" disabled={busy} onClick={() => void signOut(true)}>Sign out anyway</button>
        <button type="button" className="account-home__ghost" disabled={busy} onClick={() => setUnsent(0)}>Stay signed in</button>
      </div>
    </div> : null}
    {error ? <p className="account-home__error" role="alert">{error}</p> : null}
  </div>
}

/** "2:18:20": hours without padding, as the board and the extension show a moment's time. */
function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

type Game = { name: string; boxArtUrl?: string }
const games = new Map<string, Promise<Array<{ gameName: string; categoryId?: string; boxArtUrl?: string; offsetSeconds: number; durationSeconds: number }>>>()
/** The category playing at that second, from the stream's game segments (public, cached for the page). */
function useGame(save: AccountSave): Game | null {
  const [game, setGame] = useState<Game | null>(null)
  useEffect(() => {
    if (!save.streamId) return
    let live = true
    let work = games.get(save.streamId)
    if (!work) {
      work = apiClient<unknown>(`/v1/portal/analytics/streams/${encodeURIComponent(save.streamId)}/games`, { timeoutMs: 3500, maxResponseBytes: 256 * 1024, credentials: 'omit' })
        .then(({ data }) => Array.isArray(data) ? data as never[] : [], () => [])
      games.set(save.streamId, work)
    }
    work.then(rows => {
      const row = rows.find(seg => typeof seg.gameName === 'string' && save.offsetSeconds >= seg.offsetSeconds
        && (!seg.durationSeconds || save.offsetSeconds < seg.offsetSeconds + seg.durationSeconds))
      if (!live || !row) return
      const art = row.boxArtUrl && row.categoryId && isExactCategoryBoxArt(row.boxArtUrl, row.categoryId) ? row.boxArtUrl : undefined
      setGame({ name: row.gameName.slice(0, 80), ...(art ? { boxArtUrl: art } : {}) })
    })
    return () => { live = false }
  }, [save.streamId, save.offsetSeconds])
  return game
}

function MomentRow({ save }: { save: AccountSave }) {
  const game = useGame(save)
  return <li className="account-home__moment">
    {game?.boxArtUrl
      ? <img src={game.boxArtUrl} alt="" width={27} height={36} loading="lazy" referrerPolicy="no-referrer" />
      : <span className="account-home__thumb" aria-hidden="true">{save.login.slice(0, 2).toUpperCase()}</span>}
    <div className="account-home__moment-text">
      <span><b>{clock(save.offsetSeconds)}</b> · {game?.name ?? save.login}</span>
      {save.notes ? <span className="account-home__note">✎ {save.notes}</span> : null}
    </div>
    <span className="account-home__source">{save.source === 'extension' ? 'saved in Chrome' : 'saved on the site'}</span>
  </li>
}

type Watched = { streams: number | null; syncEnabled: boolean | null; retentionDays: number; reload: () => void }
function useWatched(): Watched {
  const [state, setState] = useState<{ streams: number | null; syncEnabled: boolean | null; retentionDays: number }>({ streams: null, syncEnabled: null, retentionDays: 30 })
  const [turn, setTurn] = useState(0)
  useEffect(() => {
    let live = true
    ;(async () => {
      const streams = new Set<string>()
      let before: string | undefined
      let settings: { syncEnabled: boolean; retentionDays: number } | null = null
      // The account keeps up to 1,000 watched moments, 100 a page.
      for (let page = 0; page < 10; page++) {
        const result = await listHistory(before)
        settings = { syncEnabled: result.syncEnabled, retentionDays: result.retentionDays }
        for (const entry of result.entries) streams.add(`${entry.login}|${entry.streamId ?? entry.vodId}`)
        before = result.next
        if (!before) break
      }
      if (live && settings) setState({ streams: streams.size, ...settings })
    })().catch(() => { if (live) setState(previous => ({ ...previous, streams: null })) })
    return () => { live = false }
  }, [turn])
  return { ...state, reload: () => setTurn(n => n + 1) }
}

function MomentsBlock({ watched }: { watched: Watched }) {
  const { status, saves } = useAccountSaves()
  const notes = saves.filter(save => save.notes).length
  const headingId = useId()
  return <section className="account-home__block" aria-labelledby={headingId}>
    <h2 id={headingId}>My Moments</h2>
    {status === 'error' && !saves.length ? <p className="account-home__muted">Your saves couldn’t load. They’re safe in your account; this page tries again when you come back to it.</p>
      : status !== 'ready' && !saves.length ? <p className="account-home__muted" role="status">Loading your saves…</p>
        : <>
          <dl className="account-home__stats">
            <div><dt>saves</dt><dd>{saves.length.toLocaleString()}</dd></div>
            <div><dt>notes</dt><dd>{notes.toLocaleString()}</dd></div>
            <div><dt>watched streams</dt><dd>{watched.streams == null ? '–' : watched.streams.toLocaleString()}</dd></div>
          </dl>
          {saves.length ? <ul className="account-home__moments">{saves.slice(0, 3).map(save => <MomentRow key={save.id} save={save} />)}</ul>
            : <p className="account-home__muted">Nothing saved yet. Save a moment on the site or in the extension and it shows here.</p>}
        </>}
    <Link className="account-home__more" to="/account/moments">Open My Moments →</Link>
  </section>
}

type Device = { id: string; label: string; createdAt?: string; lastUsedAt?: string; revokedAt?: string }
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
function since(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (minutes < 1) return 'synced just now'
  if (minutes < 60) return `synced ${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `synced ${relative.format(-hours, 'hour')}`
  return `synced ${relative.format(-Math.round(hours / 24), 'day')}`
}
/** "Chrome · extension" from a label like "Chrome extension". */
function browserName(label: string): string {
  const name = label.replace(/\s*extension\s*$/i, '').trim()
  return name ? `${name} · extension` : 'Browser · extension'
}

function BrowsersBlock() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const headingId = useId()
  useEffect(() => {
    let live = true
    accountRequest('/devices').then(result => {
      if (!live) return
      const list = Array.isArray(result.devices) ? result.devices as Device[] : []
      setDevices(list.filter(device => device && typeof device.label === 'string' && !device.revokedAt))
    }, () => { if (live) setDevices([]) })
    return () => { live = false }
  }, [])
  return <section className="account-home__block" aria-labelledby={headingId}>
    <h2 id={headingId}>Your browsers</h2>
    {devices == null ? <p className="account-home__muted" role="status">Loading…</p>
      : devices.length ? <ul className="account-home__browsers">{devices.map(device => <li key={device.id}>
        <span className="chrome-mark" aria-hidden="true" />
        <span>{browserName(device.label)}</span>
        <span className="account-home__source">{device.lastUsedAt ? since(device.lastUsedAt) : device.createdAt ? `linked ${new Date(device.createdAt).toLocaleDateString()}` : ''}</span>
      </li>)}</ul>
        : <p className="account-home__muted">No browsers yet. Sign in to the extension and your saves follow you.</p>}
    <Link className="account-home__more" to="/account/settings">Manage browsers →</Link>
  </section>
}

type Membership = { state: 'loading' } | { state: 'member' } | { state: 'closed' }
function SupporterBlock() {
  const [membership, setMembership] = useState<Membership>({ state: 'loading' })
  const headingId = useId()
  useEffect(() => {
    let live = true
    billingRequest('/supporter').then(result => {
      if (live) setMembership(result.schemaVersion === 1 && (result.status === 'active' || result.status === 'grace') ? { state: 'member' } : { state: 'closed' })
    }, () => { if (live) setMembership({ state: 'closed' }) })
    return () => { live = false }
  }, [])
  return <section className="account-home__block" aria-labelledby={headingId}>
    <h2 id={headingId}>Supporter</h2>
    {membership.state === 'loading' ? <p className="account-home__muted" role="status">Loading…</p>
      : membership.state === 'member' ? <>
        <p className="account-home__member"><b>Supporter</b><span className="account-home__muted">Status from the account</span></p>
        <Link className="account-home__more" to={SUPPORTER_PATH}>Manage subscription →</Link>
      </> : <>
        <p className="account-home__muted">Not open yet</p>
        <Link className="account-home__more" to={SUPPORTER_PATH}>Supporter page →</Link>
      </>}
  </section>
}

function DataBlock({ watched }: { watched: Watched }) {
  const headingId = useId()
  const consentId = useId()
  const [consenting, setConsenting] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState<'' | 'history' | 'export' | 'delete'>('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [phrase, setPhrase] = useState('')

  async function setHistory(syncEnabled: boolean) {
    setBusy('history'); setError(''); setNotice('')
    try {
      await accountRequest('/history/settings', { syncEnabled })
      setConsenting(false); setAgreed(false)
      setNotice(syncEnabled ? 'Watched history is kept on your account.' : 'Watched history is no longer kept. Each browser keeps its own again.')
      watched.reload()
    } catch (failure) { setError(accountErrorText(failure)) }
    finally { setBusy('') }
  }
  async function exportData() {
    setBusy('export'); setError(''); setNotice('')
    try {
      const data = await accountRequest('/export')
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = 'streampulse-account-export.json'
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setNotice('Your data is downloading as streampulse-account-export.json.')
    } catch (failure) { setError(accountErrorText(failure)) }
    finally { setBusy('') }
  }
  async function deleteAccount() {
    setBusy('delete'); setError(''); setNotice('')
    try {
      await accountRequest('/delete', { confirm: phrase.trim() })
      // The account is gone, so nothing here is still owed to it.
      await signOutAccount({ force: true }).catch(() => undefined)
      window.location.assign('/')
    } catch (failure) {
      setError(failure instanceof AccountError && failure.code === 'recent_auth_required'
        ? 'For safety, deleting needs a sign-in from the last few minutes. Sign out, sign in again, then delete.'
        : failure instanceof AccountError && failure.code === 'confirmation_required' ? 'Type delete my account to confirm.'
          : accountErrorText(failure))
      setBusy('')
    }
  }
  const on = watched.syncEnabled === true
  return <section className="account-home__block" aria-labelledby={headingId}>
    <h2 id={headingId}>Your data</h2>
    <div className="account-home__toggle-row">
      <span id={`${consentId}-label`}>Keep watched history</span>
      <button type="button" role="switch" className="account-home__switch" aria-checked={on} aria-labelledby={`${consentId}-label`}
        disabled={watched.syncEnabled == null || busy !== ''}
        onClick={() => { if (on) void setHistory(false); else { setConsenting(true); setNotice('') } }} />
    </div>
    {consenting && !on ? <div className="account-home__consent">
      <label className="account-home__check">
        <input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} />
        <span>Keep the moments I watch on my account, so every browser signed in to it shows the same history. Up to 1,000 recent moments, kept for {watched.retentionDays} days. I can turn this off and forget them at any time.</span>
      </label>
      <div className="account-home__actions">
        <button type="button" className="account-home__ghost account-home__primary" disabled={!agreed || busy !== ''} onClick={() => void setHistory(true)}>Turn on</button>
        <button type="button" className="account-home__ghost" disabled={busy !== ''} onClick={() => { setConsenting(false); setAgreed(false) }}>Cancel</button>
      </div>
    </div> : null}
    <div className="account-home__actions">
      <button type="button" className="account-home__ghost" disabled={busy !== ''} onClick={() => void exportData()}>{busy === 'export' ? 'Preparing…' : 'Export my data'}</button>
      <button type="button" className="account-home__ghost account-home__danger" disabled={busy !== ''} onClick={() => { setDeleting(true); setNotice('') }}>Delete account</button>
    </div>
    {deleting ? <div className="account-home__warn" role="group" aria-label="Confirm deleting your account">
      <p><strong>Delete your account?</strong> This deletes your saves, notes, watched history and sign-in from StreamPulse. Each browser keeps nothing of it after its next sign-in check. It can’t be undone.</p>
      <label className="account-home__phrase">Type <b>delete my account</b> to confirm
        <input value={phrase} onChange={event => setPhrase(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <div className="account-home__actions">
        <button type="button" className="account-home__ghost account-home__danger" disabled={busy !== '' || phrase.trim() !== 'delete my account'} onClick={() => void deleteAccount()}>{busy === 'delete' ? 'Deleting…' : 'Delete account'}</button>
        <button type="button" className="account-home__ghost" disabled={busy !== ''} onClick={() => { setDeleting(false); setPhrase('') }}>Cancel</button>
      </div>
    </div> : null}
    <p className="account-home__feedback" role="status">{notice}</p>
    {error ? <p className="account-home__error" role="alert">{error}</p> : null}
  </section>
}
