import { useState } from 'react'
import type { DiscoveryMoment } from '../../../lib/discoveryMoments'
import { toggleSavedMoment, useSavedMoments } from '../../../lib/savedDiscoveryMoments'

export function SaveMomentButton({ moment, contextLabel }: { moment: DiscoveryMoment; contextLabel?: string }) {
  const { items } = useSavedMoments()
  const [message, setMessage] = useState('')
  const saved = items.some(item => item.key === moment.key)
  return <span className="moment-save-control">
    <button type="button" aria-label={contextLabel ? `${saved ? 'Remove saved' : 'Save'} ${contextLabel}` : undefined} aria-pressed={saved} title={saved ? 'Remove this bookmark from this browser. No media is stored.' : 'Bookmark in this browser only. Does not download media or sync with the extension.'} onClick={() => setMessage(toggleSavedMoment(moment))}>{saved ? 'Saved' : 'Save'}</button>
    <span role="status" className="sr-only">{message}</span>
  </span>
}
