import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useHubRecentLogins } from '../../../hooks/useHubRecentLogins'
import { buildAnalyticsHref } from '../../../lib/analyticsLinks'
import { formatRelativeTime } from '../../../lib/formatStats'
import type { WatchlistEntry } from '../../../lib/pulseTypes'

export interface HubQuickReopenProps {
  pinnedEntries?: WatchlistEntry[]
  pinnedLoading?: boolean
  limit?: number
}

type QuickTab = 'recent' | 'pinned'

export function HubQuickReopen({
  pinnedEntries = [],
  pinnedLoading = false,
  limit = 6,
}: HubQuickReopenProps) {
  const recent = useHubRecentLogins()
  const [tab, setTab] = useState<QuickTab>('recent')

  const visibleRecent = recent.slice(0, limit)
  const visiblePinned = pinnedEntries.slice(0, limit)

  return (
    <section className="panel analytics-hub-quick-reopen" aria-labelledby="hub-quick-reopen-title">
      <div className="analytics-hub-quick-reopen__header">
        <div>
          <h2 id="hub-quick-reopen-title" className="analytics-hub__panel-title">
            Quick reopen
          </h2>
          <p className="muted analytics-hub-quick-reopen__desc">Personal shortcuts — not ranked like the live matrix</p>
        </div>
      </div>

      <div className="analytics-hub-quick-reopen__tabs" role="tablist" aria-label="Quick reopen source">
        <button
          type="button"
          role="tab"
          className={tab === 'recent' ? 'is-active' : undefined}
          aria-selected={tab === 'recent'}
          onClick={() => setTab('recent')}
        >
          Recently opened
        </button>
        <button
          type="button"
          role="tab"
          className={tab === 'pinned' ? 'is-active' : undefined}
          aria-selected={tab === 'pinned'}
          onClick={() => setTab('pinned')}
        >
          Pinned
        </button>
      </div>

      {tab === 'recent' ? (
        <ul className="analytics-hub-channel-list" role="tabpanel" aria-label="Recently opened channels">
          {visibleRecent.length === 0 ? (
            <li className="analytics-hub-quick-reopen__empty">
              <p className="muted analytics-hub-empty" style={{ margin: 0 }}>
                No recent channels yet — search above to open analytics.
              </p>
            </li>
          ) : (
            visibleRecent.map((entry) => (
              <li key={entry.login}>
                <Link to={buildAnalyticsHref({ login: entry.login, context: 'channel-row' })}>{entry.login}</Link>
                <span className="muted">{formatRelativeTime(entry.openedAt)}</span>
              </li>
            ))
          )}
        </ul>
      ) : (
        <ul className="analytics-hub-channel-list" role="tabpanel" aria-label="Pinned channels">
          {pinnedLoading ? (
            <li className="analytics-hub-quick-reopen__empty">
              <p className="muted" style={{ margin: 0 }}>
                Loading pins…
              </p>
            </li>
          ) : visiblePinned.length === 0 ? (
            <li className="analytics-hub-quick-reopen__empty">
              <p className="muted analytics-hub-empty" style={{ margin: 0 }}>
                No pinned channels yet — protect a channel when coverage needs help.
              </p>
            </li>
          ) : (
            visiblePinned.map((entry) => (
              <li key={entry.login}>
                <Link to={buildAnalyticsHref({ login: entry.login, context: 'channel-row' })}>{entry.login}</Link>
                {entry.alwaysTrack ? (
                  <span className="status-badge status-badge--ok">Protected</span>
                ) : (
                  <span className="muted">Pinned</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  )
}
