import { Link, useLocation } from 'react-router-dom'
import type { BroadcastGroup } from '../../../lib/broadcastGroups'
import { broadcastTimelineHref } from '../../../lib/momentsNavigation'

/** The catalogue supplies detections, not broadcast titles or full coverage. */
export function BroadcastCard({ group }: { group: BroadcastGroup }) {
  const location = useLocation()
  const date = group.firstAt == null ? 'Date unavailable' : new Date(group.firstAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  return <Link className="moments-broadcast-card"
    to={broadcastTimelineHref(group.login, group.streamId, location.pathname + location.search)}>
    <span className="moments-broadcast-card__identity"><strong>{group.displayName || group.login}</strong><time>{date} · UTC</time></span>
    <span>{group.categories.join(' · ') || 'Category unavailable'}</span>
    <span className="moments-muted">{group.loadedCount.toLocaleString()} indexed {group.loadedCount === 1 ? 'detection' : 'detections'} loaded</span>
    <span className="moments-broadcast-card__action">View stream timeline →</span>
  </Link>
}
