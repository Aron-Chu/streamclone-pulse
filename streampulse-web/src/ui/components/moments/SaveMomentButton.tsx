import { useId, useState } from 'react'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import type { DiscoveryMoment } from '../../../lib/discoveryMoments'
import { toggleSavedMoment, useSavedMoments } from '../../../lib/savedDiscoveryMoments'

export function SaveMomentButton({ moment, contextLabel, longLabel = false }: { moment: DiscoveryMoment; contextLabel?: string; longLabel?: boolean }) {
  const { items } = useSavedMoments()
  const [message, setMessage] = useState('')
  const statusId = useId()
  const saved = items.some(item => item.key === moment.key)
  return <span className="moment-save-control">
    <button type="button" aria-describedby={statusId} aria-label={contextLabel ? `${saved ? 'Remove saved' : 'Save'} ${contextLabel}` : undefined} aria-pressed={saved} title={saved ? 'Remove this bookmark from this browser. No media is stored.' : 'Bookmark in this browser only. Does not download media or sync with the extension.'} onClick={() => setMessage(toggleSavedMoment(moment))}>{saved ? <BookmarkCheck size={16} aria-hidden="true" /> : <Bookmark size={16} aria-hidden="true" />}<span className="moment-save-label"><span aria-hidden="true" className="moment-save-label-reserve">{longLabel ? 'Saved on this device' : 'Saved'}</span><span>{longLabel ? saved ? 'Saved on this device' : 'Save on this device' : saved ? 'Saved' : 'Save'}</span></span></button>
    <span id={statusId} role="status" aria-atomic="true" className="sr-only">{message}</span>
  </span>
}
