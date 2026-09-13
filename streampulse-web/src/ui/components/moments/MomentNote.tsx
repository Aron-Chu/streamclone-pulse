import { useState } from 'react'
import { updateSavedMomentNote, useSavedMoments } from '../../../lib/savedDiscoveryMoments'

export function MomentNote({ momentKey }: { momentKey: string }) {
  const { items } = useSavedMoments()
  const item = items.find(row => row.key === momentKey)
  const [draft, setDraft] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  if (!item) return null
  return <section className="moment-note" aria-label="Your note">
    <label htmlFor="moment-note-text">Why keep this moment?</label>
    <textarea id="moment-note-text" rows={3} maxLength={1000} placeholder="An edit idea, the lead-in to watch, or something to remember…"
      value={draft ?? item.note ?? ''} onChange={event => { setDraft(event.target.value); setMessage('') }} />
    <div><button type="button" disabled={draft === null || draft === (item.note ?? '')} onClick={() => { setMessage(updateSavedMomentNote(momentKey, draft ?? '')); setDraft(null) }}>Save note</button>
      <span role="status">{message}</span></div>
  </section>
}
