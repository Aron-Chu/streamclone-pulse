import { PulseThemedSelect } from '../PulseThemedSelect.tsx'
import { useEffect, useId, useRef, useState } from 'react'
import { PulseSectionCard } from '../PulseSectionCard.tsx'
import { LibraryDialog, MomentEditor, MomentListItem } from './LibraryPrimitives.tsx'
import { hasRecent, visibleMoments, type LibraryMoment, type LibraryPreferences, type LibraryRepository, type LibrarySnapshot, type LibraryView, type MomentReference } from './model.ts'
import { useLibrary } from './useLibrary.ts'
import { MomentPreview, type MomentContextState } from './MomentPreview.tsx'
import type { MomentPresentation } from './MomentMedia.tsx'
import type { BookmarksState } from '../../shared/myMoments.ts'
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
  now?: () => number
}

const views: readonly { id: LibraryView; label: string }[] = [
  { id: 'saved', label: 'Bookmarks' },
  { id: 'recent', label: 'History' },
  { id: 'storage', label: 'Storage & privacy' },
]

type Confirmation = { kind: 'remove'; moment: LibraryMoment } | { kind: 'clear' } | { kind: 'retention'; preferences: LibraryPreferences }

/**
 * Names why the hosted list is missing and what to do about it.
 *
 * The worker distinguishes these; an earlier single "could not be loaded"
 * banner covered a missing sign-in, an expired link and a dead network alike,
 * so it could never point at the one action that resolves the common case.
 */
function BookmarksNotice({ state, onRetry }: { state: BookmarksState; onRetry: () => void }) {
  if (state === 'ready') return null
  const linkable = state === 'not_linked' || state === 'expired'
  return (
    <PulseSectionCard
      title={state === 'not_linked' ? 'Bookmarks need your Pulse account' : state === 'expired' ? 'Your account link expired' : 'Could not reach StreamPulse'}
      headingLevel={3}
    >
      <p className="pl-muted">
        {linkable
          ? 'Saved moments sync through your account so they survive a reinstall. Watched history and notes stay on this device either way.'
          : 'No bookmark change was confirmed. Watched history and notes on this device are unaffected.'}
      </p>
      <div className="pl-row">
        {linkable ? <a className="pl-button pl-primary" href="#supporter">Connect account</a> : null}
        <button type="button" className="pl-button" onClick={onRetry}>Retry</button>
      </div>
    </PulseSectionCard>
  )
}

export function LibraryWorkspace({ repository, initialView = 'saved', onExport, contexts, presentations, now = Date.now }: LibraryWorkspaceProps) {
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
  return <main className="pl-library" id="settings-content" tabIndex={-1} aria-label="My Moments settings">
    <div className="pl-page-heading"><div><span className="pl-eyebrow">YOUR MOMENTS · FREE</span><h2 ref={heading} tabIndex={-1}>My Moments</h2>
      <p className="pl-muted">Find your way back to the stream. Bookmarks are free; connect an account when you want them to sync across devices.</p></div></div>
    <div className="pl-library-intro" aria-label="How My Moments works">
      <span><strong>Bookmarks</strong><small>Keep a timestamp and note for later.</small></span>
      <span><strong>History</strong><small>Optional, device-only playback memory.</small></span>
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
      {contentView ? <BookmarksNotice state={bookmarksState} onRetry={library.retry} /> : null}
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
            personalWorkspace
            presentation={presentations?.[moment.id]} context={contexts?.[moment.id]}
            onSave={save} onEdit={setEditing} onPreview={moment => setPreviewId(moment.id)} onRemove={moment => setConfirmation({ kind: 'remove', moment })}
            onOpenLink={() => setLocalNotice('Opened a replay link. This is not a confirmed jump and has not been added to history.')} />)}</ul>
            : <div className="pl-empty"><h3>{filtered ? 'No matching moments' : view === 'recent' ? 'No history yet' : 'No bookmarks yet'}</h3>
              <p>{filtered ? 'Try a channel name, a word from your note, or clear the filters.'
                : view === 'recent' ? 'Watch a Pulse moment for at least 10 seconds after a jump. Opening a link alone is not recorded.'
                  : 'Choose Bookmark on a Pulse moment or recent jump. No replay is required.'}</p>
              {filtered ? <button type="button" className="pl-button" onClick={() => { setQuery(''); setChannel(''); setWatchLater(false) }}>Clear filters</button> : null}</div>}

          {pages > 1 ? <nav className="pl-row pl-between" aria-label="Moment pages"><button type="button" className="pl-button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button>
            <span>Page {currentPage} of {pages}</span><button type="button" className="pl-button" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</button></nav> : null}
        </section>
      </> : <div className="pl-library-results" id={`${id}-panel-storage`} role="tabpanel" aria-labelledby={`${id}-tab-storage`} tabIndex={-1} aria-label="Storage and privacy">
        <StorageSettings snapshot={snapshot} busy={library.busy} onExport={() => void exportAll()} onClear={() => setConfirmation({ kind: 'clear' })}
          exportLabel={bookmarksState === 'ready' ? 'Export all data' : 'Export device data'}
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
    {confirmation ? <LibraryDialog title={confirmation.kind === 'clear' ? 'Clear history?' : confirmation.kind === 'remove' ? 'Remove bookmark?' : 'Shorten history?'} canClose={!library.busy} onClose={() => setConfirmation(null)}>
      <p>{confirmation.kind === 'clear' ? 'This removes history. Manual bookmarks and notes stay.'
        : confirmation.kind === 'remove' ? 'This removes the bookmark and its note. A separately remembered jump may still appear until history expires.'
          : 'Older history may expire. Bookmarks are unaffected. Export or save anything you want to keep before continuing.'}</p>
      {library.error ? <p className="pl-error" role="alert">{library.error}</p> : null}
      <div className="pl-row"><button type="button" className="pl-button" disabled={library.busy} onClick={() => setConfirmation(null)}>Keep as is</button>
        <button type="button" className="pl-button pl-danger" disabled={library.busy} onClick={async () => {
          const command = confirmation.kind === 'clear' ? { kind: 'clear-history' as const }
            : confirmation.kind === 'remove' ? { kind: 'unsave' as const, id: confirmation.moment.id }
              : { kind: 'preferences' as const, value: confirmation.preferences }
          if (await library.run(command, confirmation.kind === 'clear' ? 'History cleared. Bookmarks were kept.' : 'Change saved.')) setConfirmation(null)
        }}>{library.busy ? 'Saving…' : 'Confirm change'}</button></div>
    </LibraryDialog> : null}
  </main>
}

export function StorageSettings({ snapshot, busy, onChange, onExport, onClear, exportLabel = 'Export all data' }: {
  snapshot: LibrarySnapshot; busy: boolean; onChange: (value: LibraryPreferences) => void; onExport: () => void; onClear: () => void
  exportLabel?: string
}) {
  const id = useId(); const preferences = snapshot.preferences; const storage = snapshot.storage
  const full = storage.usedBytes >= storage.limitBytes
  return <div className="pl-stack">
    <PulseSectionCard title="Watched moments"><label className="pl-check"><input type="checkbox" checked={preferences.captureHistory} disabled={busy} onChange={event => onChange({ ...preferences, captureHistory: event.target.checked })} />
      <span><strong>Remember watched moments on this device</strong><span className="pl-muted pl-block">Requires 10 seconds of visible playback within a known moment after a Pulse jump. Private browsing is excluded. Up to 1,000 recent entries.</span></span></label>
      <label className="pl-field" htmlFor={`${id}-retention`}>Keep history for<PulseThemedSelect id={`${id}-retention`} ariaLabel="Keep history for" fullWidth value={String(preferences.retentionDays)} disabled={busy} onChange={value => onChange({ ...preferences, retentionDays: Number(value) as 7 | 30 | 90 })} options={[7,30,90].map(days=>({value:String(days),label:`${days} days`}))} /></label>
      <p className="pl-muted">Bookmarks do not expire with history. Turning history off stops new capture; it does not clear existing entries.</p>
    </PulseSectionCard>
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
