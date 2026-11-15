import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type Ref } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, History } from 'lucide-react'
import { formatSavedAt } from '@streampulse/pulse-core'
import { PublicLayout } from '../../ui/components/PublicLayout'
import { AccountFooter } from './AccountFooter'
import { AccountChecking } from './AccountChecking'
import { AccountError, accountErrorText } from '../../lib/accountApi'
import { useAccountSession } from '../../lib/accountSession'
import { forgetHistory, listHistory, listSaves, momentAnalyticsHref, momentTimestamp, replayHref, type AccountMoment } from '../../lib/accountMoments'
import { needsRecentSignIn, takeStepUp } from '../../lib/accountStepUp'
import { TWITCH_MOMENTS_RETURN } from '../../lib/twitchSignIn'
import { RecentSignInNotice } from './RecentSignIn'
import './account.css'

type View = 'saves' | 'history'
/** A failed read: the words to show, and whether signing in again is the way out (401). */
type Failure = { message: string; signIn: boolean }
type Load<T> = { state: 'loading' } | { state: 'unavailable' } | ({ state: 'error' } & Failure) | { state: 'ready'; page: T; more: boolean }

const failure = (error: unknown): Failure => ({ message: accountErrorText(error), signIn: error instanceof AccountError && error.status === 401 })

/**
 * The account's moments on the website (VITE_ACCOUNT_MOMENTS=1): bookmarks
 * saved through the extension, and the watched history the extension syncs
 * when the account turned that on. Read-only apart from forgetting history;
 * notes and saves are edited in the extension.
 */
export default function AccountMoments() {
  const session = useAccountSession()
  const [view, setView] = useState<View>('saves')
  // A panel mounts the first time its tab opens, then stays mounted and hidden, so a
  // switch back keeps its rows and pages instead of loading page one again (MY-MOMENTS-9).
  const [opened, setOpened] = useState<ReadonlySet<View>>(() => new Set<View>(['saves']))
  const show = useCallback((next: View) => {
    setView(next)
    setOpened(seen => seen.has(next) ? seen : new Set(seen).add(next))
  }, [])
  // Back from signing in again to forget history: reopen the confirm step.
  const [resumeForget, setResumeForget] = useState(false)
  const signedIn = session.status === 'signed_in'
  useEffect(() => {
    if (signedIn && takeStepUp(TWITCH_MOMENTS_RETURN) === 'history-forget') { show('history'); setResumeForget(true) }
  }, [signedIn, show])
  const id = useId()
  const tabs: Array<{ id: View; label: string }> = [{ id: 'saves', label: 'Saved' }, { id: 'history', label: 'History' }]
  return <PublicLayout><section className="pulse-account pulse-account-settings pulse-account-moments" aria-label="My Moments">
    <p className="pulse-account-kicker"><Bookmark size={16} aria-hidden="true" /> StreamPulse account</p>
    <h1>My Moments</h1>
    <p className="pulse-account-intro">Your saves from the site and the extension, and the history you watched if you sync it.</p>
    {session.status === 'checking' ? <AccountChecking session={session} />
      : session.status === 'signed_out' ? <div className="pulse-account-empty"><p>Sign in to see the moments saved to your account.</p>
        <Link className="pulse-account-button pulse-account-primary" to="/account/sign-in">Sign in to Pulse</Link></div>
      : <>
        <div className="pulse-moments-tabs" role="tablist" aria-label="My Moments">
          {tabs.map(tab => <button key={tab.id} type="button" role="tab" id={`${id}-tab-${tab.id}`} aria-controls={`${id}-panel-${tab.id}`}
            aria-selected={view === tab.id} tabIndex={view === tab.id ? 0 : -1} onClick={() => show(tab.id)}
            onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { const next = view === 'saves' ? 'history' : 'saves'; show(next); document.getElementById(`${id}-tab-${next}`)?.focus() } }}>
            {tab.id === 'saves' ? <Bookmark size={15} aria-hidden="true" /> : <History size={15} aria-hidden="true" />}{tab.label}</button>)}
        </div>
        {/* The site's list is read-only; say where the rest lives (Z11, MY-MOMENTS-6). */}
        <p className="pulse-account-meta pulse-moments-readonly">Notes, removing and search live in the extension’s My Moments.</p>
        {tabs.map(tab => opened.has(tab.id)
          ? <div key={tab.id} role="tabpanel" id={`${id}-panel-${tab.id}`} aria-labelledby={`${id}-tab-${tab.id}`} tabIndex={0} hidden={view !== tab.id} className="pulse-moments-panel">
            {tab.id === 'saves' ? <SavesPanel /> : <HistoryPanel resumeForget={resumeForget} />}
          </div> : null)}
      </>}
    <AccountFooter current="moments" />
  </section></PublicLayout>
}

/** Pages a newest-first list; a 404 means the server does not offer it yet. */
function usePaged<T extends { next?: string }>(fetchPage: (before?: string) => Promise<T>, merge: (a: T, b: T) => T) {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  // A failed next page keeps the rows already shown and says so by the button (MY-MOMENTS-2).
  const [moreFailure, setMoreFailure] = useState<Failure | null>(null)
  const turn = useRef(0)
  const reload = useCallback(() => {
    const mine = ++turn.current
    setLoad({ state: 'loading' })
    setMoreFailure(null)
    fetchPage().then(page => { if (mine === turn.current) setLoad({ state: 'ready', page, more: !!page.next }) },
      error => { if (mine === turn.current) setLoad(error instanceof AccountError && error.status === 404 ? { state: 'unavailable' } : { state: 'error', ...failure(error) }) })
  }, [fetchPage])
  useEffect(() => { reload(); return () => { turn.current++ } }, [reload])
  /** The merged page once the next one arrives; null when it failed or was overtaken. */
  async function more(): Promise<T | null> {
    if (load.state !== 'ready' || !load.page.next || busy) return null
    setBusy(true)
    setMoreFailure(null)
    const mine = turn.current
    try {
      const next = await fetchPage(load.page.next)
      if (mine !== turn.current) return null
      const page = merge(load.page, next)
      setLoad({ state: 'ready', page, more: !!next.next })
      return page
    } catch (error) {
      if (mine === turn.current) setMoreFailure(failure(error))
      return null
    } finally { setBusy(false) }
  }
  return { load, busy, more, moreFailure, reload }
}

/**
 * After a next page: the button keeps focus while more remain; when it goes, focus moves
 * to the first new row, and either way the count is announced (J1).
 */
function useMoreFocus(noun: string) {
  const list = useRef<HTMLUListElement>(null)
  const [announce, setAnnounce] = useState('')
  const loaded = useCallback((before: number, after: number, moreLeft: boolean) => {
    const added = after - before
    setAnnounce(`${added.toLocaleString()} more ${noun}${added === 1 ? '' : 's'} loaded.`)
    if (moreLeft) return
    requestAnimationFrame(() => {
      const active = document.activeElement
      if (active && active !== document.body) return
      const row = list.current?.children[before] as HTMLElement | undefined
      const target = row?.querySelector<HTMLElement>('a, button') ?? row
      if (target && !target.matches('a, button')) target.tabIndex = -1
      target?.focus()
    })
  }, [noun])
  return { list, announce, loaded }
}

function Unavailable() {
  return <p className="pulse-account-empty">My Moments on the website is not available yet. Your bookmarks and history are still in the extension.</p>
}

/** The way out of an expired session: sign in again (MY-MOMENTS-3). */
function SignInAgain({ focus = false }: { focus?: boolean }) {
  const link = useRef<HTMLAnchorElement>(null)
  // Focus goes to it unless the visitor is already somewhere else on the page.
  useEffect(() => {
    if (!focus) return
    const active = document.activeElement
    if (!active || active === document.body) link.current?.focus()
  }, [focus])
  return <Link ref={link} className="pulse-account-button pulse-account-primary" to="/account/sign-in">Sign in again</Link>
}

function Failed({ failure: { message, signIn }, retry }: { failure: Failure; retry: () => void }) {
  // Retry keeps focus in the panel, which stays while the list loads again (J1).
  const again = (event: ReactMouseEvent<HTMLButtonElement>) => {
    const panel = event.currentTarget.closest<HTMLElement>('[role="tabpanel"]')
    retry()
    panel?.focus()
  }
  return <div className="pulse-account-error"><p role="alert">{message}</p>
    {signIn ? <div className="pulse-moments-failed-actions"><SignInAgain focus /><button type="button" onClick={again}>Retry</button></div>
      : <button type="button" onClick={again}>Retry</button>}
  </div>
}

/** The next page's button. It stays focusable while it loads; a failure shows here and leaves the rows (MY-MOMENTS-2). */
function MoreButton({ label, busy, failed, onMore }: { label: string; busy: boolean; failed: Failure | null; onMore: () => void }) {
  return <div className="pulse-moments-more">
    {failed ? <p className="pulse-moments-more-error" role="alert">{failed.message}</p> : null}
    {failed?.signIn ? <SignInAgain /> : null}
    <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) onMore() }}>{busy ? 'Loading…' : label}</button>
  </div>
}

const mergeSaves = (a: Awaited<ReturnType<typeof listSaves>>, b: Awaited<ReturnType<typeof listSaves>>) => ({ saves: [...a.saves, ...b.saves], next: b.next })
function SavesPanel() {
  const { load, busy, more, moreFailure, reload } = usePaged(listSaves, mergeSaves)
  // 'save', like the tab and 'More saves': '1 more save loaded.' (11-14)
  const { list, announce, loaded } = useMoreFocus('save')
  if (load.state === 'loading') return <p role="status">Loading your saves…</p>
  if (load.state === 'unavailable') return <Unavailable />
  if (load.state === 'error') return <Failed failure={load} retry={reload} />
  const before = load.page.saves.length
  return <>
    {load.page.saves.length ? <MomentList listRef={list} moments={load.page.saves} kind="save" />
      : <p className="pulse-account-empty">No bookmarks yet. Choose Bookmark on a Pulse moment in the extension while signed in, and it appears here.</p>}
    <p className="sr-only" role="status">{announce}</p>
    {load.more ? <MoreButton label="More saves" busy={busy} failed={moreFailure}
      onMore={() => void more().then(page => { if (page) loaded(before, page.saves.length, !!page.next) })} /> : null}
  </>
}

const mergeHistory = (a: Awaited<ReturnType<typeof listHistory>>, b: Awaited<ReturnType<typeof listHistory>>) => ({ ...b, entries: [...a.entries, ...b.entries] })
function HistoryPanel({ resumeForget = false }: { resumeForget?: boolean }) {
  const { load, busy, more, moreFailure, reload } = usePaged(listHistory, mergeHistory)
  const { list, announce, loaded } = useMoreFocus('moment')
  const [confirming, setConfirming] = useState(resumeForget)
  const [forgetting, setForgetting] = useState(false)
  const [error, setError] = useState('')
  const [stepUp, setStepUp] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { if (resumeForget) setConfirming(true) }, [resumeForget])
  async function forget() {
    setForgetting(true); setError(''); setStepUp(false)
    try { await forgetHistory(); setConfirming(false); setNotice('History forgotten. Each browser drops its copy the next time it syncs.'); reload() }
    catch (failure) { if (needsRecentSignIn(failure)) setStepUp(true); else setError(accountErrorText(failure)) }
    finally { setForgetting(false) }
  }
  if (load.state === 'loading') return <p role="status">Loading your history…</p>
  if (load.state === 'unavailable') return <Unavailable />
  if (load.state === 'error') return <Failed failure={load} retry={reload} />
  const { syncEnabled, retentionDays, entries } = load.page
  const before = entries.length
  return <>
    <p className="pulse-account-feedback" role="status">{notice}</p>
    {!syncEnabled ? <div className="pulse-account-note"><p><strong>History sync is off.</strong> Your watched history stays in each browser.</p>
      <p>To see it here, open the extension’s settings, then My Moments › Storage &amp; privacy, and turn on <em>Sync watched history to your account</em>.</p></div>
      : <p className="pulse-account-meta">Synced from your browsers. Kept for {retentionDays} days, up to 1,000 moments.</p>}
    {entries.length ? <MomentList listRef={list} moments={entries} kind="history" />
      : syncEnabled ? <p className="pulse-account-empty">No history yet. Watch a Pulse moment for 10 seconds after a jump and it appears here after the next sync.</p> : null}
    <p className="sr-only" role="status">{announce}</p>
    {load.more ? <MoreButton label="More history" busy={busy} failed={moreFailure}
      onMore={() => void more().then(page => { if (page) loaded(before, page.entries.length, !!page.next) })} /> : null}
    {syncEnabled && entries.length ? confirming
      ? <div className="pulse-account-review" role="group" aria-label="Confirm forgetting history"><h2>Forget all history?</h2>
        <p>This deletes the history saved to your account. Each signed-in browser drops its copy the next time it syncs. Bookmarks stay.</p>
        {error ? <p role="alert">{error}</p> : null}
        {stepUp ? <RecentSignInNotice what="forgetting watched history" action="history-forget" returnTo={TWITCH_MOMENTS_RETURN} /> : null}
        <div className="pulse-account-actions"><button className="pulse-account-revoke" type="button" disabled={forgetting} onClick={() => void forget()}>{forgetting ? 'Forgetting…' : 'Forget history'}</button>
          <button type="button" disabled={forgetting} onClick={() => { setConfirming(false); setStepUp(false) }}>Cancel</button></div></div>
      : <div className="pulse-account-actions"><button type="button" onClick={() => { setConfirming(true); setNotice('') }}>Forget all history…</button></div> : null}
  </>
}

/** The act without the feed's verb: "PJSalt", not "spammed PJSalt" (ACC-03, 10-22); older saves still carry it. */
const momentAct = (title?: string) => (title ?? '').replace(/^spammed\s+/i, '')

function MomentList({ moments, kind, listRef }: { moments: AccountMoment[]; kind: 'save' | 'history'; listRef?: Ref<HTMLUListElement> }) {
  return <ul ref={listRef} className="pulse-account-devices pulse-moments-list">{moments.map(m => {
    const replay = replayHref(m)
    const analytics = momentAnalyticsHref(m)
    const name = [m.login, momentAct(m.title)].filter(Boolean).join(' ')
    return <li key={m.key}>
      <div className="pulse-account-device-details">
        <strong>{name}</strong>
        {/* h:mm:ss through pulse-core (K1) and the saved date without seconds (Z08). */}
        <p className="pulse-account-meta">{momentTimestamp(m)} · {kind === 'save' ? 'Saved' : 'Watched'} {formatSavedAt(m.at)}</p>
        {m.notes ? <p className="pulse-moments-note">{m.notes}</p> : null}
      </div>
      {/* Each link names its moment, and the Twitch one says it opens a new tab (MY-MOMENTS-8);
          the analytics link reads 'Analytics', as on the Moments page and in the library (Z07). */}
      <div className="pulse-moments-links">
        {replay ? <a href={replay} target="_blank" rel="noopener noreferrer" aria-label={`Replay on Twitch: ${name} (opens in a new tab)`}>Replay on Twitch ↗</a> : null}
        {analytics ? <Link to={analytics} aria-label={`Analytics: ${name}`}>Analytics</Link> : null}
        {!replay && !analytics ? <span className="pulse-account-meta">Replay link unavailable</span> : null}
      </div>
    </li>
  })}</ul>
}
