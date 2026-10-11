import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, History } from 'lucide-react'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { AccountError, accountErrorText } from '../../lib/accountApi'
import { useAccountSession } from '../../lib/accountSession'
import { forgetHistory, listHistory, listSaves, momentAnalyticsHref, momentTimestamp, replayHref, type AccountMoment } from '../../lib/accountMoments'
import { accountSignInLabel } from '../../lib/twitchSignInFlag'
import './account.css'

type View = 'saves' | 'history'
type Load<T> = { state: 'loading' } | { state: 'unavailable' } | { state: 'error'; message: string } | { state: 'ready'; page: T; more: boolean }

const when = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * The account's moments on the website (VITE_ACCOUNT_MOMENTS=1): bookmarks
 * saved through the extension, and the watched history the extension syncs
 * when the account turned that on. Read-only apart from forgetting history;
 * notes and saves are edited in the extension.
 */
export default function AccountMoments() {
  const session = useAccountSession()
  const [view, setView] = useState<View>('saves')
  const id = useId()
  const tabs: Array<{ id: View; label: string }> = [{ id: 'saves', label: 'Saved' }, { id: 'history', label: 'History' }]
  return <PublicLayout><section className="pulse-account pulse-account-settings pulse-account-moments" aria-label="My Moments">
    <p className="pulse-account-kicker"><Bookmark size={16} aria-hidden="true" /> StreamPulse account</p>
    <h1>My Moments</h1>
    <p className="pulse-account-intro">Moments you bookmarked with the extension, and the history you watched if you sync it, from every browser signed in to this account.</p>
    {session.status === 'checking' ? <p role="status">Checking your sign-in…</p>
      : session.status === 'signed_out' ? <div className="pulse-account-empty"><p>Sign in to see the moments saved to your account.</p>
        <Link className="pulse-account-button pulse-account-primary" to="/account/sign-in">{accountSignInLabel()}</Link></div>
      : <>
        <div className="pulse-moments-tabs" role="tablist" aria-label="My Moments">
          {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`}
            aria-selected={view === tab.id} tabIndex={view === tab.id ? 0 : -1} onClick={() => setView(tab.id)}
            onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const next = view === 'saves' ? 'history' : 'saves'; setView(next); document.getElementById(`${id}-tab-${next}`)?.focus() } }}>
            {tab.id === 'saves' ? <Bookmark size={15} aria-hidden="true" /> : <History size={15} aria-hidden="true" />}{tab.label}</button>)}
        </div>
        <div role="tabpanel" id={`${id}-panel-${view}`} aria-labelledby={`${id}-tab-${view}`} tabIndex={0} className="pulse-moments-panel">
          {view === 'saves' ? <SavesPanel /> : <HistoryPanel />}
        </div>
      </>}
    <AccountFooter current="moments" />
  </section></PublicLayout>
}

/** Pages a newest-first list; a 404 means the server does not offer it yet. */
function usePaged<T extends { next?: string }>(fetchPage: (before?: string) => Promise<T>, merge: (a: T, b: T) => T) {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const turn = useRef(0)
  const reload = useCallback(() => {
    const mine = ++turn.current
    setLoad({ state: 'loading' })
    fetchPage().then(page => { if (mine === turn.current) setLoad({ state: 'ready', page, more: !!page.next }) },
      error => { if (mine === turn.current) setLoad(error instanceof AccountError && error.status === 404 ? { state: 'unavailable' } : { state: 'error', message: accountErrorText(error) }) })
  }, [fetchPage])
  useEffect(() => { reload(); return () => { turn.current++ } }, [reload])
  async function more() {
    if (load.state !== 'ready' || !load.page.next || busy) return
    setBusy(true)
    const mine = turn.current
    try {
      const next = await fetchPage(load.page.next)
      if (mine === turn.current) setLoad({ state: 'ready', page: merge(load.page, next), more: !!next.next })
    } catch (error) { if (mine === turn.current) setLoad({ state: 'error', message: accountErrorText(error) }) }
    finally { setBusy(false) }
  }
  return { load, busy, more, reload }
}

function Unavailable() {
  return <p className="pulse-account-empty">My Moments on the website is not available yet. Your bookmarks and history are still in the extension.</p>
}
function Failed({ message, retry }: { message: string; retry: () => void }) {
  return <div className="pulse-account-error"><p role="alert">{message}</p><button type="button" onClick={retry}>Retry</button></div>
}

const mergeSaves = (a: Awaited<ReturnType<typeof listSaves>>, b: Awaited<ReturnType<typeof listSaves>>) => ({ saves: [...a.saves, ...b.saves], next: b.next })
function SavesPanel() {
  const { load, busy, more, reload } = usePaged(listSaves, mergeSaves)
  if (load.state === 'loading') return <p role="status">Loading your bookmarks…</p>
  if (load.state === 'unavailable') return <Unavailable />
  if (load.state === 'error') return <Failed message={load.message} retry={reload} />
  return <>
    {load.page.saves.length ? <MomentList moments={load.page.saves} kind="save" />
      : <p className="pulse-account-empty">No bookmarks yet. Choose Bookmark on a Pulse moment in the extension while signed in, and it appears here.</p>}
    {load.more ? <button type="button" disabled={busy} onClick={() => void more()}>{busy ? 'Loading…' : 'More bookmarks'}</button> : null}
  </>
}

const mergeHistory = (a: Awaited<ReturnType<typeof listHistory>>, b: Awaited<ReturnType<typeof listHistory>>) => ({ ...b, entries: [...a.entries, ...b.entries] })
function HistoryPanel() {
  const { load, busy, more, reload } = usePaged(listHistory, mergeHistory)
  const [confirming, setConfirming] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  async function forget() {
    setForgetting(true); setError('')
    try { await forgetHistory(); setConfirming(false); setNotice('History forgotten. Each browser drops its copy the next time it syncs.'); reload() }
    catch (failure) { setError(accountErrorText(failure)) }
    finally { setForgetting(false) }
  }
  if (load.state === 'loading') return <p role="status">Loading your history…</p>
  if (load.state === 'unavailable') return <Unavailable />
  if (load.state === 'error') return <Failed message={load.message} retry={reload} />
  const { syncEnabled, retentionDays, entries } = load.page
  return <>
    <p className="pulse-account-feedback" role="status">{notice}</p>
    {!syncEnabled ? <div className="pulse-account-note"><p><strong>History sync is off.</strong> Your watched history stays in each browser.</p>
      <p>To see it here, open the extension’s settings, then My Moments › Storage &amp; privacy, and turn on <em>Sync watched history to your account</em>.</p></div>
      : <p className="pulse-account-meta">Synced from your browsers. Kept for {retentionDays} days, up to 1,000 moments.</p>}
    {entries.length ? <MomentList moments={entries} kind="history" />
      : syncEnabled ? <p className="pulse-account-empty">No history yet. Watch a Pulse moment for 10 seconds after a jump and it appears here after the next sync.</p> : null}
    {load.more ? <button type="button" disabled={busy} onClick={() => void more()}>{busy ? 'Loading…' : 'More history'}</button> : null}
    {syncEnabled && entries.length ? confirming
      ? <div className="pulse-account-review" role="group" aria-label="Confirm forgetting history"><h2>Forget all history?</h2>
        <p>This deletes the history saved to your account. Each signed-in browser drops its copy the next time it syncs. Bookmarks stay.</p>
        {error ? <p role="alert">{error}</p> : null}
        <div className="pulse-account-actions"><button className="pulse-account-revoke" type="button" disabled={forgetting} onClick={() => void forget()}>{forgetting ? 'Forgetting…' : 'Forget history'}</button>
          <button type="button" disabled={forgetting} onClick={() => setConfirming(false)}>Cancel</button></div></div>
      : <div className="pulse-account-actions"><button type="button" onClick={() => { setConfirming(true); setNotice('') }}>Forget all history…</button></div> : null}
  </>
}

function MomentList({ moments, kind }: { moments: AccountMoment[]; kind: 'save' | 'history' }) {
  return <ul className="pulse-account-devices pulse-moments-list">{moments.map(m => {
    const replay = replayHref(m)
    const analytics = momentAnalyticsHref(m)
    return <li key={m.key}>
      <div className="pulse-account-device-details">
        <strong>{m.title || 'Untitled moment'}</strong>
        <p className="pulse-account-meta">{m.login} · {momentTimestamp(m.offsetSeconds)} · {kind === 'save' ? 'Saved' : 'Watched'} {when.format(m.at)}</p>
        {m.notes ? <p className="pulse-moments-note">{m.notes}</p> : null}
      </div>
      <div className="pulse-moments-links">
        {replay ? <a href={replay} target="_blank" rel="noopener noreferrer">Replay on Twitch</a> : null}
        {analytics ? <Link to={analytics}>Open in Pulse</Link> : null}
        {!replay && !analytics ? <span className="pulse-account-meta">Replay link unavailable</span> : null}
      </div>
    </li>
  })}</ul>
}
