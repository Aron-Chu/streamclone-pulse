import { PulseSectionCard } from '../PulseSectionCard.tsx'
import { timestamp, type LibraryMoment } from './model.ts'
import { LibraryIcon } from './LibraryIcon.tsx'

export interface LibraryPeekProps {
  /** Supply only the worker's three-entry projection, never the full database. */
  recent: readonly LibraryMoment[]
  loading?: boolean
  historyEnabled: boolean
  onOpenLibrary: () => void
}
/** Thin sidebar entry. Intentionally does not import the full Library or its settings CSS. */
export function LibraryPeek({ recent, loading = false, historyEnabled, onOpenLibrary }: LibraryPeekProps) {
  return <PulseSectionCard title="My Moments" subtitle={historyEnabled ? 'Bookmarks + history · this device' : 'Bookmarks are ready · history is off'}
    meta={<button type="button" className="pulse-library-peek-cta" data-pulse-library-cta="true" onClick={onOpenLibrary} aria-label="Open My Moments library" title="Open your bookmarks, notes, and history">
      <LibraryIcon name="bookmark" /><span>View library</span><span aria-hidden="true" className="pulse-library-peek-cta-arrow">→</span></button>}>
    {loading ? <p role="status" style={{ margin: 0 }}>Loading recent moments…</p> : recent.length ? <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
      {recent.slice(0, 3).map(moment => <li key={moment.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8, borderLeft: '2px solid var(--pulse-accent-soft, #c4b5fd)', paddingLeft: 8 }}>
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{moment.channel}<br /><strong>{moment.title}</strong></span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timestamp(moment.offsetSeconds)}</span>
      </li>)}
    </ul> : <p style={{ margin: 0 }}>Bookmark a moment from Pulse and come back to it later. No video is downloaded.</p>}
  </PulseSectionCard>
}
