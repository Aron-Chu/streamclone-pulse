import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { analyticsActionLabel, buildAnalyticsHref } from '../../../lib/analyticsLinks'
import type { RecentSessionRow } from '../../../hooks/useAnalyticsHubData'
import { Skeleton } from '../../primitives'
import { coveragePctMeta, initial } from './hubFormat'

interface HubSessionsTableProps {
  rows: RecentSessionRow[]
  loading?: boolean
  historyUnavailable?: boolean
}

interface SessionMeta {
  tone: 'synced' | 'partial' | 'stats'
  label: string
  coverage: number
  coverageLabel: string
}

function sessionMeta(badge: RecentSessionRow['syncBadge']): SessionMeta {
  switch (badge) {
    case 'Full pulse':
    case 'Chat synced':
      return { tone: 'synced', label: 'Synced', coverage: 100, coverageLabel: '100%' }
    case 'Stats only':
      return { tone: 'stats', label: 'Stats-only', coverage: 0, coverageLabel: 'Stats' }
    case 'No pulse':
      return { tone: 'stats', label: 'No pulse', coverage: 0, coverageLabel: '0%' }
    default:
      return { tone: 'partial', label: 'Partial', coverage: 60, coverageLabel: '60%' }
  }
}

export function HubSessionsTable({ rows, loading = false, historyUnavailable = false }: HubSessionsTableProps) {
  const actionLabel = analyticsActionLabel('recent-session')

  if (loading) {
    return (
      <div className="hub-card hub-sess" aria-busy="true" style={{ padding: '1rem' }}>
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} height={44} radius="var(--sc-radius)" style={{ marginBottom: '0.5rem' }} />
        ))}
      </div>
    )
  }

  if (historyUnavailable && rows.length === 0) {
    return (
      <div className="hub-empty">
        <strong>Recent sessions unavailable</strong>
        <span>Metadata history could not be loaded right now.</span>
      </div>
    )
  }

  return (
    <div className="hub-card hub-sess">
      <table className="hub-tbl">
        <thead>
          <tr>
            <th>Channel</th>
            <th className="hide">Title / Category</th>
            <th className="hide">Date</th>
            <th>Coverage</th>
            <th>Status</th>
            <th className="r">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <p className="hub-empty" style={{ border: 'none', background: 'transparent', padding: '1.5rem 0' }}>
                  No recent sessions yet — search a channel above to open its analytics.
                </p>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const meta = sessionMeta(row.syncBadge)
              const cov = coveragePctMeta(meta.coverage)
              const href = buildAnalyticsHref({ login: row.login, streamId: row.streamId, context: 'recent-session' })
              return (
                <tr key={`${row.login}-${row.streamId}`}>
                  <td>
                    <Link className="ch" to={`/analytics/${encodeURIComponent(row.login.toLowerCase())}`}>
                      <span className="av" aria-hidden="true">
                        {initial(row.login)}
                      </span>
                      <strong>{row.login}</strong>
                    </Link>
                  </td>
                  <td className="hide title">
                    <strong>{row.title || row.streamId}</strong>
                    <small>Stream session</small>
                  </td>
                  <td className="hide date">{row.startedAt ?? '—'}</td>
                  <td>
                    <span className={`hub-cov hub-cov--${cov.cls}`}>
                      {meta.coverageLabel}
                      <i>
                        <b style={{ width: `${meta.coverage}%`, background: cov.color }} />
                      </i>
                    </span>
                  </td>
                  <td>
                    <span className={`hub-stat hub-stat--${meta.tone}`}>
                      <span className="d" />
                      {meta.label}
                    </span>
                  </td>
                  <td className="r">
                    <Link className="hub-openbtn" to={href}>
                      {actionLabel}
                      <ChevronRight size={14} aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}
