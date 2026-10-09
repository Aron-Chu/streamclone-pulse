import { PulseThemedSelect } from '../PulseThemedSelect.tsx'
import { useEffect, useId, useRef, useState } from 'react'
import { PulseSectionCard } from '../PulseSectionCard.tsx'
import { DeviceSaveItem, LibraryDialog, MomentEditor, MomentListItem } from './LibraryPrimitives.tsx'
import { hasRecent, replayAvailability, visibleMoments, type HistorySyncView, type LibraryMoment, type LibraryPreferences, type LibraryRepository, type LibrarySnapshot, type LibraryView, type MomentReference } from './model.ts'
import { useLibrary } from './useLibrary.ts'
import { MomentPreview, type MomentContextState } from './MomentPreview.tsx'
import type { MomentPresentation } from './MomentMedia.tsx'
import type { BookmarksState } from '../../shared/myMoments.ts'
import type { PulseBookmark } from '../../shared/messages.ts'
import { TWITCH_SIGNIN_ENABLED } from '../../shared/twitchSignIn.ts'
import './library.css'

export interface LibraryWorkspaceProps {
  /** Account-scoped worker adapter. Never query a repository from a content script. */
  repository: LibraryRepository
  initialView?: LibraryView
  /** Device/account namespace change must remount this component or replace repository identity. */
  onExport: (json: string) => void | Promise<void>
  /** Optional display-only analysis projections keyed by canonical moment ID. */
  contexts?: Readonly<Record<string, MomentContextState>>
  presentations?: Readonly<Record<string, MomentPresentation>>
  /** Portal origin for moment Analytics links; production when omitted. */
  analyticsOrigin?: string
  /**
   * Whether this build can create an account (Continue with Twitch). With
   * sign-in compiled off nobody can make one, so nothing here offers it.
   * Fixed at build time; a prop for tests only.
   */
  accountsOpen?: boolean
  now?: () => number
}

const views: readonly { id: LibraryView; label: string }[] = [
  { id: 'saved', label: 'Bookmarks' },
  { id: 'recent', label: 'History' },
  { id: 'storage', label: 'Storage & privacy' },
]

type Confirmation = { kind: 'remove'; moment: LibraryMoment } | { kind: 'clear' } | { kind: 'retention'; preferences: LibraryPreferences } | { kind: 'sync-off' }

/** Pre-link device saves as rows, newest first. Only the worker's linked snapshot carries any. */
function deviceSaveMoments(snapshot: LibrarySnapshot | null): LibraryMoment[] {
  const saves = snapshot && 'deviceBookmarks' in snapshot ? (snapshot as { deviceBookmarks: Partial<PulseBookmark>[] }).deviceBookmarks : []
  return saves.flatMap(b => {
    if (typeof b.id !== 'string') return []
    const vodId = b.vodId ?? null
    const offsetSeconds = typeof b.offsetSeconds === 'number' ? b.offsetSeconds : null
    const savedAt = Date.parse(b.createdAt ?? '')
    return [{ id: b.id, channel: b.login ?? '', title: b.label || 'Saved moment', vodId, streamId: b.streamId, offsetSeconds,
      availability: replayAvailability({ vodId, offsetSeconds }), ...(Number.isFinite(savedAt) ? { savedAt } : {}), note: b.notes ?? '' }]
  }).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0) || a.id.localeCompare(b.id))
}

/**
 * My Moments with Sign in with Twitch compiled off (every store build today):
 * there is no account anyone can create, so the copy says where saves live
 * and what is coming, and offers no account action.
 */
export const DEVICE_ONLY_INTRO = 'Find your way back to the stream. Bookmarks are free and stay in this browser, along with your notes and watched history. Accounts are coming with Continue with Twitch.'
export const DEVICE_ONLY_COPY = 'Bookmarks, notes and watched history stay in this browser and are never uploaded. Accounts are coming with Continue with Twitch; until then there is nothing to sign up for.'

/**
 * Names why the hosted list is missing and what to do about it.
 *
 * The worker distinguishes these; an earlier single "could not be loaded"
 * banner covered a missing sign-in, an expired link and a dead network alike,
 * so it could never point at the one action that resolves the common case.
 */
function BookmarksNotice({ state, onRetry, accountsOpen }: { state: BookmarksState; onRetry: () => void; accountsOpen: boolean }) {
  if (state === 'ready') return null
  // Without sign-in nobody can make an account, so a missing one is not a
  // problem to fix: no Connect button, and no Retry that could change nothing.
  const deviceOnly = state === 'not_linked' && !accountsOpen
  const linkable = !deviceOnly && (state === 'not_linked' || state === 'expired')
  return (
    <PulseSectionCard
      title={state === 'not_linked' ? 'Bookmarks are saved on this device' : state === 'expired' ? 'Your account link expired' : 'Could not reach StreamPulse'}
      headingLevel={3}
    >
      <p className="pl-muted">
        {deviceOnly ? DEVICE_ONLY_COPY : state === 'not_linked'
          ? 'Connect a free Pulse account and new bookmarks follow you to any device. Bookmarks, notes and watched history saved here stay on this device.'
          : linkable
            ? 'Saved moments sync through your account so they survive a reinstall. Notes stay on this device, and so does watched history unless you turn on history sync.'
            : 'No bookmark change was confirmed. Watched history and notes on this device are unaffected.'}
      </p>
      {deviceOnly ? null : <div className="pl-row">
        {linkable ? <a className="pl-button pl-primary" href="#supporter">Connect account</a> : null}
        <button type="button" className="pl-button" onClick={onRetry}>Retry</button>
      </div>}
    </PulseSectionCard>
  )
}

export function LibraryWorkspace({ repository, initialView = 'saved', onExport, contexts, presentations, analyticsOrigin, now = Date.now, accountsOpen = TWITCH_SIGNIN_ENABLED }: LibraryWorkspaceProps) {
  const library = useLibrary(repository)
  const [view, setView] = useState<LibraryView>(initialView)
  const [query, setQuery] = useState('')
  const [watchLater, setWatchLater] = useState(false)
  const [channel, setChannel] = useState('')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<LibraryMoment | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [localNotice, setLocalNotice] = useState('')
  const [clock, setClock] = useState(now())
  const heading = useRef<HTMLHeadingElement>(null)
  const tabButtons = useRef<Array<HTMLButtonElement | null>>([])
  const id = useId()
  useEffect(() => {
    setEditing(null); setPreviewId(null); setConfirmation(null); setQuery(''); setChannel(''); setWatchLater(false); setPage(1); setLocalNotice('')
  }, [repository])
  useEffect(() => { const timer = window.setInterval(() => setClock(now()), 30_000); return () => window.clearInterval(timer) }, [now])
  useEffect(() => { setPage(1) }, [query, view, channel, watchLater])
  useEffect(() => { setLocalNotice('') }, [library.notice])
  function navigate(next: LibraryView, focus: 'heading' | 'tab' = 'heading') {
    setView(next); setQuery(''); setChannel(''); setWatchLater(false); setPage(1); setLocalNotice('')
    if (focus === 'heading') heading.current?.focus()
  }
  function navigateFromTab(index: number, key: string) {
    const next = key === 'ArrowRight' ? (index + 1) % views.length
      : key === 'ArrowLeft' ? (index + views.length - 1) % views.length
        : key === 'Home' ? 0
          : key === 'End' ? views.length - 1 : -1
    if (next === -1) return
    navigate(views[next].id, 'tab')
    tabButtons.current[next]?.focus()
  }
  const snapshot = library.snapshot
  const bookmarksState: BookmarksState = snapshot && 'bookmarksState' in snapshot
    ? (snapshot as { bookmarksState: BookmarksState }).bookmarksState
    : 'ready'
  // Saves made before an account was linked; not uploaded, so list them where
  // they are rather than only counting them.
  const deviceMoments = deviceSaveMoments(snapshot)
  const deviceSaves = deviceMoments.length
  // Unfiltered population decides whether filters are worth showing at all.
  const population = snapshot ? visibleMoments(snapshot, view, '', '', clock) : []
  const items = snapshot
    ? visibleMoments(snapshot, view, query, '', clock).filter(m => (!channel || m.channel === channel) && (view !== 'saved' || !watchLater || !hasRecent(m, clock)))
    : []
  const pageSize = 12
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, pages)
  const pageItems = items.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const previewMoment = snapshot?.moments.find(moment => moment.id === previewId)
  const modal = !!editing || !!confirmation || !!previewMoment
  const filtered = Boolean(query.trim() || channel || watchLater)
  async function exportAll() {
    setLocalNotice('')
    const json = await library.exportData()
    if (json !== null) {
      try {
        await onExport(json)
        setLocalNotice(bookmarksState === 'ready'
          ? 'Export prepared. It includes all your authorized records, not just these search results.'
          : 'Device export prepared. Cloud bookmarks were not included until your account connection is restored.')
      }
      catch { setLocalNotice('Could not prepare the download. Your data has not been changed.') }
    }
  }
  function save(reference: MomentReference) { void library.run({ kind: 'save', reference }, 'Moment saved. It will remain when history expires.') }
  const contentView = view === 'saved' || view === 'recent'
  const syncing = snapshot?.historySync?.state === 'on'
  return <main className="pl-library" id="settings-content" tabIndex={-1} aria-label="My Moments settings">
    <div className="pl-page-heading"><div><span className="pl-eyebrow">YOUR MOMENTS · FREE</span><h2 ref={heading} tabIndex={-1}>My Moments</h2>
      <p className="pl-muted">{accountsOpen ? 'Find your way back to the stream. Bookmarks are free. Without an account they stay on this device; with a free Pulse account they follow you to any device. Notes stay on this device. Watched history does too, unless you sync it to your account.' : DEVICE_ONLY_INTRO}</p></div></div>
    <div className="pl-library-intro" aria-label="How My Moments works">
      <span><strong>Bookmarks</strong><small>Keep a timestamp and note for later.</small></span>
      <span><strong>History</strong><small>{accountsOpen ? 'Optional playback memory, on this device or your account.' : 'Optional, device-only playback memory.'}</small></span>
      <span><strong>Privacy</strong><small>References only; no video downloads.</small></span>
    </div>

    <div className="pl-tabs" role="tablist" aria-label="My Moments views">{views.map((item, index) => <button type="button" key={item.id}
      ref={element => { tabButtons.current[index] = element }}
      role="tab" id={`${id}-tab-${item.id}`} aria-controls={`${id}-panel-${item.id}`} tabIndex={view === item.id ? 0 : -1}
      className="pl-tab" aria-selected={view === item.id} onClick={() => navigate(item.id)}
      onKeyDown={event => navigateFromTab(index, event.key)}>{item.label}</button>)}</div>

    <div className="pl-feedback" role="status" aria-live="polite" aria-atomic="true">{localNotice || library.notice}</div>
    {library.error && !modal ? <div role="alert" className="pl-warning"><p>{library.error}</p>
      {!snapshot ? <button type="button" className="pl-button" onClick={library.retry}>Try loading again</button> : <p className="pl-muted">Your last loaded data is still available. Retry the action when ready.</p>}</div> : null}
    {library.loading ? <section aria-busy="true" aria-label="Loading My Moments" className="pl-stack"><p role="status">Loading your moments…</p>
      {[0, 1, 2].map(n => <div className="pl-skeleton" aria-hidden="true" key={n}><span /><span /></div>)}</section> : null}
    {snapshot ? <>
      {contentView ? <BookmarksNotice state={bookmarksState} onRetry={library.retry} accountsOpen={accountsOpen} /> : null}
      {snapshot.sync.kind === 'offline' ? <p className="pl-warning">You’re offline. Local saves still work. Cloud changes have not been backed up yet.</p> : null}
      {contentView ? <>
        <section className="pl-library-results" id={`${id}-panel-${view}`} role="tabpanel" aria-labelledby={`${id}-tab-${view}`} tabIndex={-1} aria-label={views.find(v => v.id === view)?.label}>
          {view === 'recent' && !snapshot.preferences.captureHistory ? <div className="pl-callout"><strong>Automatic history is off</strong><p>Previous entries expire normally. Manual saves still work.</p>
            <button className="pl-button" type="button" onClick={() => navigate('storage')}>Choose history preferences</button></div> : null}

          {/* Filters exist to narrow a list. With nothing to narrow they are three
              controls that cannot change the outcome. */}
          {population.length ? <div className="pl-search-row">
            <label className="pl-field" htmlFor={`${id}-search`}>Search moments
              <input id={`${id}-search`} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Channel, title or your note" /></label>
            <label className="pl-field">Channel<PulseThemedSelect ariaLabel="Channel" fullWidth value={channel} onChange={setChannel} options={[{value:'',label:'All channels'}, ...[...new Set(population.map(m=>m.channel))].sort().map(value=>({value,label:value}))]} /></label>
          </div> : null}
          {population.length && view === 'saved' ? <label className="pl-check"><input type="checkbox" checked={watchLater} onChange={e=>setWatchLater(e.target.checked)} />Watch later (no retained watched history)</label> : null}
          {items.length ? <p className="pl-muted" role="status">{items.length} {items.length === 1 ? 'moment' : 'moments'}{query.trim() ? ' matching your search' : ''}</p> : null}

          {pageItems.length ? <ul className="pl-list">{pageItems.map(moment => <MomentListItem key={moment.id} moment={moment} recent={view === 'recent'} busy={library.busy}
            personalWorkspace analyticsOrigin={analyticsOrigin}
            presentation={presentations?.[moment.id]} context={contexts?.[moment.id]}
            onSave={save} onEdit={setEditing} onPreview={moment => setPreviewId(moment.id)} onRemove={moment => setConfirmation({ kind: 'remove', moment })}
            onOpenLink={() => setLocalNotice('Opened a replay link. This is not a confirmed jump and has not been added to history.')} />)}</ul>
            : <div className="pl-empty"><h3>{filtered ? 'No matching moments' : view === 'recent' ? 'No history yet' : deviceSaves ? 'No account bookmarks yet' : 'No bookmarks yet'}</h3>
              <p>{filtered ? 'Try a channel name, a word from your note, or clear the filters.'
                : view === 'recent' ? 'Watch a Pulse moment for at least 10 seconds after a jump. Opening a link alone is not recorded.'
                  : 'Choose Bookmark on a Pulse moment or recent jump. No replay is required.'}</p>
              {filtered ? <button type="button" className="pl-button" onClick={() => { setQuery(''); setChannel(''); setWatchLater(false) }}>Clear filters</button> : null}</div>}

          {pages > 1 ? <nav className="pl-row pl-between" aria-label="Moment pages"><button type="button" className="pl-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
            <span>Page {currentPage} of {pages}</span><button type="button" className="pl-button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav> : null}

          {view === 'saved' && deviceSaves ? <section className="pl-stack pl-device-saves" aria-labelledby={`${id}-device-saves`}>
            <h3 id={`${id}-device-saves`}>Saved on this device</h3>
            <p className="pl-muted">{deviceSaves === 1 ? '1 bookmark' : `${deviceSaves} bookmarks`} saved without an account {deviceSaves === 1 ? 'is' : 'are'} kept on this device, not in your account.</p>
            <ul className="pl-list">{deviceMoments.map(moment => <DeviceSaveItem key={moment.id} moment={moment} busy={library.busy} analyticsOrigin={analyticsOrigin}
              onRemove={moment => setConfirmation({ kind: 'remove', moment })}
              onOpenLink={() => setLocalNotice('Opened a replay link. This is not a confirmed jump and has not been added to history.')} />)}</ul>
          </section> : null}
        </section>
      </> : <div className="pl-library-results" id={`${id}-panel-storage`} role="tabpanel" aria-labelledby={`${id}-tab-storage`} tabIndex={-1} aria-label="Storage and privacy">
        <StorageSettings snapshot={snapshot} busy={library.busy} accountsOpen={accountsOpen} onExport={() => void exportAll()} onClear={() => setConfirmation({ kind: 'clear' })}
          exportLabel={bookmarksState === 'ready' ? 'Export all data' : 'Export device data'}
          onHistorySync={enabled => enabled
            ? void library.run({ kind: 'history-sync', enabled: true }, 'History sync is on. This browser’s history is joining your account.')
            : setConfirmation({ kind: 'sync-off' })}
          onChange={value => {
            if (value.retentionDays < snapshot.preferences.retentionDays) setConfirmation({ kind: 'retention', preferences: value })
            else void library.run({ kind: 'preferences', value }, value.captureHistory ? 'Local history enabled. Cloud sync was not changed.' : 'History paused. Existing records were not deleted.')
          }} />
      </div>}
      <p className="pl-footnote">Links and notes only · no video downloads</p>
    </> : null}
    {previewMoment ? <MomentPreview key={previewMoment.id} moment={previewMoment} context={contexts?.[previewMoment.id]} presentation={presentations?.[previewMoment.id]} busy={library.busy} error={library.error} onClose={() => setPreviewId(null)} onSave={save}
      onOpenLink={() => setLocalNotice('Opened a replay link. Playback is unconfirmed; History was not changed.')} /> : null}
    {editing && snapshot ? <MomentEditor personalWorkspace key={editing.id} moment={editing} collections={snapshot.collections} supporter={false} busy={library.busy} error={library.error}
      onClose={() => setEditing(null)} onCommit={note => library.run({ kind: 'edit', id: editing.id, note }, 'Note saved on this device.')} /> : null}
    {confirmation ? <LibraryDialog title={confirmation.kind === 'clear' ? 'Clear history?' : confirmation.kind === 'remove' ? 'Remove bookmark?' : confirmation.kind === 'sync-off' ? 'Stop syncing history?' : 'Shorten history?'} canClose={!library.busy} onClose={() => setConfirmation(null)}>
      <p>{confirmation.kind === 'clear' ? (syncing ? 'This removes history here, in your account and in your other signed-in browsers. Manual bookmarks and notes stay.' : 'This removes history. Manual bookmarks and notes stay.')
        : confirmation.kind === 'remove' ? deviceMoments.some(m => m.id === confirmation.moment.id)
          ? 'This removes the bookmark and its note from this device. Your account is not changed.'
          : 'This removes the bookmark and its note. A separately remembered jump may still appear until history expires.'
          : confirmation.kind === 'sync-off' ? 'This deletes the copy in your account, for every browser signed in to it. History kept on this device stays here.'
            : `Older history may expire${syncing ? ' in every browser signed in to your account' : ''}. Bookmarks are unaffected. Export or save anything you want to keep before continuing.`}</p>
      {library.error ? <p className="pl-error" role="alert">{library.error}</p> : null}
      <div className="pl-row"><button type="button" className="pl-button" disabled={library.busy} onClick={() => setConfirmation(null)}>Keep as is</button>
        <button type="button" className="pl-button pl-danger" disabled={library.busy} onClick={async () => {
          const command = confirmation.kind === 'clear' ? { kind: 'clear-history' as const }
            : confirmation.kind === 'remove' ? { kind: 'unsave' as const, id: confirmation.moment.id }
              : confirmation.kind === 'sync-off' ? { kind: 'history-sync' as const, enabled: false }
                : { kind: 'preferences' as const, value: confirmation.preferences }
          if (await library.run(command, confirmation.kind === 'clear' ? 'History cleared. Bookmarks were kept.'
            : confirmation.kind === 'sync-off' ? 'History sync is off. Your account’s copy was deleted; this device kept its history.' : 'Change saved.')) setConfirmation(null)
        }}>{library.busy ? 'Saving…' : 'Confirm change'}</button></div>
    </LibraryDialog> : null}
  </main>
}

function syncedLabel(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  if (minutes < 1) return 'Synced just now.'
  if (minutes < 60) return `Synced ${minutes} min ago.`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `Synced ${hours} h ago.` : `Synced ${Math.round(hours / 24)} days ago.`
}

/** The account half of history: the switch, what it shares, and how the last sync went. */
export function HistorySyncCard({ sync, busy, onChange, now = Date.now(), accountsOpen = TWITCH_SIGNIN_ENABLED }: { sync: HistorySyncView; busy: boolean; onChange: (enabled: boolean) => void; now?: number; accountsOpen?: boolean }) {
  if (sync.state === 'unavailable') return null
  return <PulseSectionCard title="Sync with your account">
    {sync.state === 'signed_out' && !accountsOpen
      // No account can be made with sign-in compiled off: say so, offer nothing.
      ? <p className="pl-muted">History stays in this browser. Syncing it across browsers arrives with accounts, which are coming with Continue with Twitch.</p>
      : sync.state === 'signed_out'
      ? <><p className="pl-muted">Connect a free Pulse account to see this history in your other browsers and on streampulse.stream. History kept while signed out stays on this device.</p>
        <div className="pl-row"><a className="pl-button" href="#supporter">Connect account</a></div></>
      : <>
        <label className="pl-check"><input type="checkbox" checked={sync.state === 'on'} disabled={busy} onChange={event => onChange(event.target.checked)} />
          <span><strong>Sync watched history to your account</strong><span className="pl-muted pl-block">Every browser signed in to your account, and My Moments on streampulse.stream, shows the same history, and browsers that sign in later remember watched moments too (each can turn that off above). Up to 1,000 recent moments, kept for the period above. Notes stay on each device.</span></span></label>
        {sync.state === 'on' ? <p className="pl-muted" role="status">{sync.failed ? 'The last sync did not finish. It retries on its own; history on this device is safe.'
          : sync.syncedAt ? syncedLabel(sync.syncedAt, now) : 'Waiting for the first sync.'}{sync.pending ? ` ${sync.pending === 1 ? '1 moment is' : `${sync.pending} moments are`} waiting to be sent.` : ''}</p>
          : <p className="pl-muted">Off. Only this browser keeps its history, and removing the extension removes it. Turn sync on to keep it through a reinstall.</p>}
      </>}
  </PulseSectionCard>
}

export function StorageSettings({ snapshot, busy, onChange, onExport, onClear, onHistorySync, exportLabel = 'Export all data', accountsOpen = TWITCH_SIGNIN_ENABLED }: {
  snapshot: LibrarySnapshot; busy: boolean; onChange: (value: LibraryPreferences) => void; onExport: () => void; onClear: () => void
  onHistorySync?: (enabled: boolean) => void
  accountsOpen?: boolean
  exportLabel?: string
}) {
  const id = useId(); const preferences = snapshot.preferences; const storage = snapshot.storage
  const full = storage.usedBytes >= storage.limitBytes
  const syncing = snapshot.historySync?.state === 'on'
  return <div className="pl-stack">
    <PulseSectionCard title="Watched moments"><label className="pl-check"><input type="checkbox" checked={preferences.captureHistory} disabled={busy} onChange={event => onChange({ ...preferences, captureHistory: event.target.checked })} />
      <span><strong>Remember watched moments on this device</strong><span className="pl-muted pl-block">Requires 10 seconds of visible playback within a known moment after a Pulse jump. Private browsing is excluded. Up to 1,000 recent entries.</span></span></label>
      <label className="pl-field" htmlFor={`${id}-retention`}>Keep history for<PulseThemedSelect id={`${id}-retention`} ariaLabel="Keep history for" fullWidth value={String(preferences.retentionDays)} disabled={busy} onChange={value => onChange({ ...preferences, retentionDays: Number(value) as 7 | 30 | 90 })} options={[7,30,90].map(days=>({value:String(days),label:`${days} days`}))} /></label>
      <p className="pl-muted">Bookmarks do not expire with history. Turning history off stops new capture; it does not clear existing entries.{syncing ? ' While history syncs, how long it is kept applies to your whole account.' : ''}</p>
    </PulseSectionCard>
    {snapshot.historySync && onHistorySync ? <HistorySyncCard sync={snapshot.historySync} busy={busy} onChange={onHistorySync} accountsOpen={accountsOpen} /> : null}
    <PulseSectionCard title="On this device" meta={<span>{(storage.usedBytes / 1048576).toFixed(2)} / {(storage.limitBytes / 1048576).toFixed(0)} MiB</span>}>
      <label className="pl-field" htmlFor={`${id}-usage`}>Moment data allowance<meter id={`${id}-usage`} min={0} max={storage.limitBytes} value={Math.min(storage.usedBytes, storage.limitBytes)} /></label>
      <p>{full ? 'Storage limit reached. Remove bookmark items or clear eligible history before adding more. Existing items stay available.' : 'References and notes only. No downloaded videos or cached thumbnails.'}</p>
      <p className="pl-muted">{storage.persistence === 'granted' ? 'Browser persistence granted. Uninstalling or losing this profile can still remove local data.' : 'Local persistence is not guaranteed. Export regularly; this device is not a backup.'}</p>
      <div className="pl-row"><button type="button" className="pl-button" disabled={busy} onClick={onExport}>{busy ? 'Working…' : exportLabel}</button>
        <button type="button" className="pl-button" disabled={busy || !snapshot.moments.some(m => m.jumpedAt !== undefined)} onClick={onClear}>Clear history…</button></div>
      <details><summary>Does the settings page have more storage?</summary><p>No. The panel and this settings page share the extension’s database. This larger page gives you more room to search and organize. Runtime saves do not grow the ZIP package.</p></details>
    </PulseSectionCard>
  </div>
}
