import { PulseThemedSelect } from '../PulseThemedSelect.tsx'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { LibraryCollection, LibraryMoment, LibrarySnapshot, MomentReference } from './model.ts'
import { NOTE_LIMIT, replayUrl, timestamp, validateNote } from './model.ts'
import { LibraryIcon } from './LibraryIcon.tsx'
import { buildAnalyticsUrl, DEFAULT_WEB_ANALYTICS_BASE_URL } from '../../shared/analyticsLinks.ts'
import { MomentMedia, type MomentPresentation } from './MomentMedia.tsx'
import { MomentGlance } from './MomentStats.tsx'
import type { MomentContextState } from './MomentPreview.tsx'

export function MomentSaveButton({ moment, busy = false, onSave }: {
  moment: MomentReference & { savedAt?: number }; busy?: boolean; onSave: (moment: MomentReference) => void
}) {
  const saved = moment.savedAt !== undefined
  return <button type="button" className="pl-button" disabled={busy || saved} onClick={() => onSave(moment)}
    aria-label={saved ? `Bookmarked: ${moment.title}` : `Bookmark: ${moment.title}`}>
    <LibraryIcon name={saved ? 'check' : 'bookmark'} />{saved ? 'Bookmarked' : busy ? 'Working…' : 'Bookmark'}
  </button>
}

/** Native modal supplies focus containment and Escape. Restore focus explicitly for unmount. */
export function LibraryDialog({ title, children, onClose, canClose = true }: {
  title: string; children: ReactNode; onClose: () => void; canClose?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const closeRef = useRef(onClose); closeRef.current = onClose
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = before?.closest('main')?.querySelector<HTMLElement>('h2')
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); if (before?.isConnected) before.focus(); else fallback?.focus() }
  }, [])
  return <dialog ref={ref} className="pl-dialog pl-library" aria-labelledby={id}
    onCancel={event => { event.preventDefault(); if (canClose) closeRef.current() }}>
    <div className="pl-row pl-between"><h2 id={id}>{title}</h2>
      <button className="pl-button" type="button" disabled={!canClose} onClick={onClose} aria-label={`Close ${title}`}>Close</button></div>
    {children}
  </dialog>
}

export function MomentEditor({ moment, personalWorkspace = false, collections, supporter, busy, error, onClose, onCommit }: {
  personalWorkspace?: boolean
  moment: LibraryMoment; collections: readonly LibraryCollection[]; supporter: boolean; busy: boolean; error: string | null
  onClose: () => void; onCommit: (note: string, collectionId?: string) => Promise<boolean>
}) {
  const [note, setNote] = useState(moment.note)
  const [collection, setCollection] = useState(moment.collectionId ?? '')
  const [discard, setDiscard] = useState(false)
  const id = useId()
  const validation = validateNote(note)
  const dirty = note !== moment.note || collection !== (moment.collectionId ?? '')
  function close() { if (dirty) setDiscard(true); else onClose() }
  return <LibraryDialog title="Edit bookmark" onClose={close} canClose={!busy}>
    <p className="pl-muted">{moment.channel} · {timestamp(moment.offsetSeconds)} · {moment.title}</p>
    {discard ? <div className="pl-warning" role="alert"><p>Discard your unsaved edits?</p>
      <div className="pl-row"><button type="button" className="pl-button" onClick={() => setDiscard(false)}>Keep editing</button>
        <button type="button" className="pl-button" onClick={onClose}>Discard edits</button></div></div> : null}
    <form className="pl-stack" onSubmit={async event => { event.preventDefault(); if (!validation && await onCommit(note, collection || undefined)) onClose() }}>
      <label htmlFor={`${id}-note`}>Your note</label>
      <textarea id={`${id}-note`} value={note} rows={5} maxLength={NOTE_LIMIT + 1} disabled={busy}
        aria-invalid={!!validation} aria-describedby={`${id}-help ${id}-validation`}
        onChange={event => setNote(event.target.value)} placeholder="Why do you want to keep this moment?" />
      <p id={`${id}-help`} className="pl-muted">{note.length.toLocaleString()} / {NOTE_LIMIT.toLocaleString()} characters · Plain text only</p>
      <p id={`${id}-validation`} className="pl-error">{validation}</p>
      {!personalWorkspace ? <><label htmlFor={`${id}-collection`}>Collection</label>
      <PulseThemedSelect id={`${id}-collection`} ariaLabel="Collection" fullWidth value={collection} disabled={busy || !supporter} onChange={setCollection} options={[{ value: "", label: "No collection" }, ...collections.map(item => ({ value: item.id, label: item.name }))]} />
      {!supporter ? <p className="pl-muted">Existing collections remain readable. Creating or changing collections requires Supporter.</p> : null}</> : null}
      {error ? <p role="alert" className="pl-error">{error}</p> : null}
      <div className="pl-row"><button className="pl-button pl-primary" disabled={busy || !!validation} type="submit">{busy ? 'Saving…' : 'Save changes'}</button>
        <button className="pl-button" disabled={busy} type="button" onClick={close}>Cancel</button></div>
    </form>
  </LibraryDialog>
}

export function MomentListItem({ moment, personalWorkspace = false, recent, busy, onSave, onEdit, onRemove, onOpenLink, onPreview, presentation, context }: {
  personalWorkspace?: boolean
  moment: LibraryMoment; recent: boolean; busy: boolean; onSave: (reference: MomentReference) => void
  onEdit: (moment: LibraryMoment) => void; onRemove: (moment: LibraryMoment) => void; onOpenLink?: (reference: MomentReference) => void
  onPreview?: (moment: LibraryMoment) => void
  presentation?: MomentPresentation
  context?: MomentContextState
}) {
  // A stored VOD id is only an identity hint until the backend verifies that
  // the replay is available. Keep the list consistent with MomentPreview and
  // never turn an unresolved reference into a playable link.
  const url = replayUrl(moment)
  const replayStatus = moment.availability === 'unresolved' ? 'Replay link unavailable' : 'Source unavailable'
  const date = recent ? moment.jumpedAt : moment.savedAt
  const analytics = personalWorkspace && moment.streamId ? buildAnalyticsUrl({ webAnalyticsBaseUrl: DEFAULT_WEB_ANALYTICS_BASE_URL, channelLogin: moment.channel, streamId: moment.streamId, offsetSeconds: moment.offsetSeconds ?? undefined }) : null
  return <li className="pl-moment" data-moment-id={moment.id}>
    <MomentMedia moment={moment} presentation={presentation} compact />
    <div className="pl-moment-body"><div className="pl-row"><strong>{moment.title}</strong>
      {recent && moment.savedAt !== undefined ? <span className="pl-tag">Bookmarked</span> : null}</div>
      <p className="pl-moment-identity">{moment.channel} · {presentation?.gameAtMoment ?? 'Game at this moment unknown'}</p>
      <p className="pl-muted">{recent ? personalWorkspace ? 'Watched' : 'Jumped' : 'Bookmarked'} {date === undefined ? '—' : <time dateTime={new Date(date).toISOString()}>{new Date(date).toLocaleString()}</time>}</p>
      {moment.note ? <p className="pl-note">{moment.note}</p> : null}
      {presentation?.signal ? <span className="pl-inline-signal" title={presentation.signal.basis}>{presentation.signal.illustrative ? 'Example · ' : ''}{presentation.signal.label}</span> : null}
      {context?.kind === 'ready' ? <MomentGlance context={context.value} /> : <p className="pl-muted">{context?.kind === 'loading' ? 'Moment stats loading…' : 'No saved statistics for this moment.'}</p>}
      <div className="pl-row pl-actions" role="group" aria-label={`Actions for ${moment.title}`}>
        {onPreview ? <button className="pl-button pl-primary" type="button" onClick={() => onPreview(moment)} aria-label={`Preview: ${moment.title}`}><LibraryIcon name="preview" />Preview</button> : null}
        {url ? <a className="pl-button" href={url} target="_blank" rel="noopener noreferrer" onClick={() => onOpenLink?.(moment)} aria-label={`Watch moment: ${moment.title} (new tab)`}>{personalWorkspace ? 'Open saved Twitch link' : 'Watch moment ↗'}</a>
          : <span className="pl-replay-status" role="status">{replayStatus}</span>}
        {analytics ? <a className="pl-button" href={analytics} target="_blank" rel="noopener noreferrer" aria-label={`Open analytics for ${moment.title} (new tab)`}>Analytics</a> : null}
        {moment.savedAt === undefined ? <MomentSaveButton moment={moment} busy={busy} onSave={onSave} /> : <>
          <details className="pl-moment-more"><summary aria-label="More actions" title="More actions">More</summary><div className="pl-row">
            <button type="button" className="pl-button" disabled={busy} onClick={() => onEdit(moment)} aria-label={`Edit note: ${moment.title}`}>Edit note</button>
            <button type="button" className="pl-button pl-quiet" disabled={busy} onClick={() => onRemove(moment)} aria-label={`Remove bookmark: ${moment.title}`}>Remove bookmark</button>
          </div></details>
        </>}
      </div>
    </div>
  </li>
}
