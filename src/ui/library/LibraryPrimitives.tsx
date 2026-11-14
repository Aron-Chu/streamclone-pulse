import { formatSavedAt } from '@streampulse/pulse-core'
import { PulseThemedSelect } from '../PulseThemedSelect.tsx'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { LibraryCollection, LibraryMoment, LibrarySnapshot, MomentReference } from './model.ts'
import { NOTE_LIMIT, replayUrl, rowReplay, timestamp, validateNote, videoUrl } from './model.ts'
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
    aria-label={saved ? `Saved: ${moment.title}` : `Save: ${moment.title}`}>
    <LibraryIcon name={saved ? 'check' : 'bookmark'} />{saved ? 'Saved' : busy ? 'Working…' : 'Save'}
  </button>
}

/**
 * Native modal supplies focus containment and Escape. Restore focus explicitly for unmount.
 * `bare` leaves out the title row for a dialog that draws its own header and Close; `title` still names it.
 */
export function LibraryDialog({ title, children, onClose, canClose = true, bare = false, className }: {
  title: string; children: ReactNode; onClose: () => void; canClose?: boolean; bare?: boolean; className?: string
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
  return <dialog ref={ref} className={`pl-dialog pl-library${className ? ` ${className}` : ''}`} aria-labelledby={bare ? undefined : id} aria-label={bare ? title : undefined}
    onCancel={event => { event.preventDefault(); if (canClose) closeRef.current() }}>
    {bare ? null : <div className="pl-row pl-between"><h2 id={id}>{title}</h2>
      <button className="pl-button" type="button" disabled={!canClose} onClick={onClose} aria-label={`Close ${title}`}>Close</button></div>}
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

/**
 * One row for Saved and History (H2): a chip says whether the replay still
 * plays, and the main button follows it: Watch a replay that plays, Preview
 * one not linked yet, open the channel when it may be gone. Notes and
 * Analytics sit under ⋯; ✕ removes, with Undo on the page.
 */
export function MomentListItem({ moment, personalWorkspace = false, analyticsOrigin = DEFAULT_WEB_ANALYTICS_BASE_URL, recent, busy, onSave, onEdit, onRemove, onOpenLink, onPreview, presentation, context }: {
  personalWorkspace?: boolean
  /** Portal origin for the Analytics link, derived from the configured API (dev → local portal). */
  analyticsOrigin?: string
  moment: LibraryMoment; recent: boolean; busy: boolean; onSave: (reference: MomentReference) => void
  onEdit: (moment: LibraryMoment) => void
  /** ✕: drops the save, or on History the visit. Absent: the row cannot be removed here. */
  onRemove?: (moment: LibraryMoment) => void
  onOpenLink?: (reference: MomentReference) => void
  onPreview?: (moment: LibraryMoment) => void
  presentation?: MomentPresentation
  context?: MomentContextState
}) {
  // A stored VOD id is only an identity hint until the worker resolves the
  // replay as available. Keep the list consistent with MomentPreview and
  // never turn an unresolved reference into a playable link.
  const url = replayUrl(moment)
  const replay = rowReplay(moment)
  const saved = moment.savedAt !== undefined
  const date = recent ? moment.jumpedAt : moment.savedAt
  const analytics = personalWorkspace && moment.streamId ? buildAnalyticsUrl({ webAnalyticsBaseUrl: analyticsOrigin, channelLogin: moment.channel, streamId: moment.streamId, offsetSeconds: moment.offsetSeconds ?? undefined }) : null
  // A replay that may be gone can still be tried; it is not offered as Watch.
  const tryUrl = replay.main === 'channel' ? videoUrl(moment) : null
  const more = [
    replay.main !== 'preview' && onPreview ? <button key="preview" type="button" className="pl-button" onClick={() => onPreview(moment)} aria-label={`Preview: ${moment.title}`}><LibraryIcon name="preview" />Preview</button> : null,
    tryUrl ? <a key="try" className="pl-button" href={tryUrl} target="_blank" rel="noopener noreferrer" onClick={() => onOpenLink?.(moment)} aria-label={`Try the replay: ${moment.title} (new tab)`}>Try the replay ↗</a> : null,
    saved ? <button key="note" type="button" className="pl-button" disabled={busy} onClick={() => onEdit(moment)} aria-label={`${moment.note ? 'Edit note' : 'Add note'}: ${moment.title}`}>{moment.note ? 'Edit note' : 'Add note'}</button> : null,
    analytics ? <a key="analytics" className="pl-button" href={analytics} target="_blank" rel="noopener noreferrer" aria-label={`Open analytics for ${moment.title} (new tab)`}>Analytics</a> : null,
  ].filter(Boolean)
  return <li className="pl-moment" data-moment-id={moment.id} data-replay={replay.tone}>
    <MomentMedia moment={moment} presentation={presentation} />
    <div className="pl-moment-body"><div className="pl-row"><strong>{moment.title}</strong>
      {recent && saved ? <span className="pl-tag">Saved</span> : null}</div>
      <p className="pl-moment-identity">{moment.channel}{presentation?.gameAtMoment ? ` · ${presentation.gameAtMoment}` : ''}</p>
      <p className="pl-muted">{recent ? personalWorkspace ? 'Watched' : 'Jumped' : 'Saved'} {date === undefined ? '—' : <time dateTime={new Date(date).toISOString()}>{formatSavedAt(date)}</time>}</p>
      {moment.note ? <p className="pl-note">{moment.note}</p> : null}
      {presentation?.signal ? <span className="pl-inline-signal" title={presentation.signal.basis}>{presentation.signal.illustrative ? 'Example · ' : ''}{presentation.signal.label}</span> : null}
      {context?.kind === 'ready' ? <MomentGlance context={context.value} /> : context?.kind === 'loading' ? <p className="pl-muted">Moment stats loading…</p> : null}
      <span className={`pl-chip pl-chip-${replay.tone}`}>{replay.chip}</span>
      <div className="pl-row pl-actions" role="group" aria-label={`Actions for ${moment.title}`}>
        {replay.main === 'watch' && url ? <a className="pl-button pl-primary" href={url} target="_blank" rel="noopener noreferrer" onClick={() => onOpenLink?.(moment)} aria-label={`Watch: ${moment.title} (new tab)`}><LibraryIcon name="play" />Watch</a>
          : replay.main === 'preview' && onPreview ? <button className="pl-button" type="button" onClick={() => onPreview(moment)} aria-label={`Preview: ${moment.title}`}><LibraryIcon name="preview" />Preview</button>
            : replay.main === 'channel' ? <a className="pl-button" href={`https://www.twitch.tv/${moment.channel}`} target="_blank" rel="noopener noreferrer" aria-label={`Open channel: ${moment.channel} (new tab)`}>Open channel</a> : null}
        {saved ? null : <MomentSaveButton moment={moment} busy={busy} onSave={onSave} />}
        {more.length ? <details className="pl-moment-more"><summary aria-label={`More actions: ${moment.title}`} title="More actions">⋯</summary><div className="pl-row">{more}</div></details> : null}
        {onRemove ? <button type="button" className="pl-button pl-quiet pl-icon-button" disabled={busy} onClick={() => onRemove(moment)}
          aria-label={recent ? `Remove from History: ${moment.title}` : `Remove: ${moment.title}`} title={recent ? 'Remove from History' : 'Remove'}>✕</button> : null}
      </div>
    </div>
  </li>
}

/**
 * A save kept on this device from before an account was linked. Listed beside
 * the account's bookmarks so it stays reachable until an import exists: it can
 * be opened and removed here, but not edited, previewed or uploaded. A
 * stream-only save (no resolved replay) keeps the same Analytics link it had
 * before the account linked, so it never becomes remove-only.
 */
export function DeviceSaveItem({ moment, analyticsOrigin = DEFAULT_WEB_ANALYTICS_BASE_URL, busy, onRemove, onImport, onOpenLink }: {
  /** Portal origin for the Analytics link, as on MomentListItem (dev → local portal). */
  analyticsOrigin?: string
  moment: LibraryMoment; busy: boolean; onRemove: (moment: LibraryMoment) => void
  /** Offered only while the account's bookmarks are reachable. */
  onImport?: (moment: LibraryMoment) => void
  onOpenLink?: (reference: MomentReference) => void
}) {
  const url = replayUrl(moment)
  const replay = rowReplay(moment)
  // A replay that may be gone is still offered, as a try (H2).
  const tryUrl = replay.main === 'channel' ? videoUrl(moment) : null
  const analytics = moment.streamId ? buildAnalyticsUrl({ webAnalyticsBaseUrl: analyticsOrigin, channelLogin: moment.channel, streamId: moment.streamId, offsetSeconds: moment.offsetSeconds ?? undefined }) : null
  return <li className="pl-moment pl-moment-device" data-moment-id={moment.id} data-device-save="true" data-replay={replay.tone}>
    <div className="pl-moment-body"><div className="pl-row"><strong>{moment.title}</strong><span className="pl-tag">On this device</span></div>
      <p className="pl-moment-identity">{moment.channel} · {timestamp(moment.offsetSeconds)}</p>
      <p className="pl-muted">Saved {moment.savedAt === undefined ? '—' : <time dateTime={new Date(moment.savedAt).toISOString()}>{formatSavedAt(moment.savedAt)}</time>}</p>
      {moment.note ? <p className="pl-note">{moment.note}</p> : null}
      <span className={`pl-chip pl-chip-${replay.tone}`}>{replay.chip}</span>
      <div className="pl-row pl-actions" role="group" aria-label={`Actions for ${moment.title}`}>
        {url ? <a className="pl-button pl-primary" href={url} target="_blank" rel="noopener noreferrer" onClick={() => onOpenLink?.(moment)} aria-label={`Watch: ${moment.title} (new tab)`}><LibraryIcon name="play" />Watch</a>
          : tryUrl ? <a className="pl-button" href={tryUrl} target="_blank" rel="noopener noreferrer" onClick={() => onOpenLink?.(moment)} aria-label={`Try the replay: ${moment.title} (new tab)`}>Try the replay ↗</a> : null}
        {analytics ? <a className="pl-button" href={analytics} target="_blank" rel="noopener noreferrer" aria-label={`Open analytics for ${moment.title} (new tab)`}>Analytics</a> : null}
        {onImport ? <button type="button" className="pl-button" disabled={busy} onClick={() => onImport(moment)} aria-label={`Add to your account: ${moment.title}`}>Add to account</button> : null}
        <button type="button" className="pl-button pl-quiet" disabled={busy} onClick={() => onRemove(moment)} aria-label={`Remove from this device: ${moment.title}`}>Remove</button>
      </div>
    </div>
  </li>
}
