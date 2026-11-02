import { useState } from 'react'
import type { DiscoveryMoment } from '../../../lib/discoveryMoments'
import { toggleSavedMoment, useSavedMoments } from '../../../lib/savedDiscoveryMoments'
import { accountMomentsEnabled } from '../../../lib/accountMoments'

export function SaveMomentButton({ moment, contextLabel }: { moment: DiscoveryMoment; contextLabel?: string }) {
  const { items } = useSavedMoments()
  const [message, setMessage] = useState('')
  const saved = items.some(item => item.key === moment.key)
  // With My Moments on, a signed-in save goes to the account, so "this browser only" no longer holds.
  const title = accountMomentsEnabled() ? undefined
    : saved ? 'Remove this bookmark from this browser. No media is stored.' : 'Bookmark in this browser only. Does not download media or sync with the extension.'
  return <span className="moment-save-control">
    <button type="button" aria-label={contextLabel ? `${saved ? 'Remove saved' : 'Save'} ${contextLabel}` : undefined} aria-pressed={saved} title={title} onClick={() => setMessage(toggleSavedMoment(moment))}>{saved ? 'Saved' : 'Save'}</button>
    <span role="status" className="sr-only">{message}</span>
  </span>
}
