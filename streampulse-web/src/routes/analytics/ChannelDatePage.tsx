import { Link, useParams } from 'react-router-dom'
import { useChannelSessionDay } from '../../hooks/useChannelSessionDay'
import { analyticsActionLabel, buildAnalyticsHref } from '../../lib/analyticsLinks'
import { formatSessionTime, parseSessionDateParam } from '../../lib/sessionDay'
import { AnalyticsShell, HubState } from '../../ui/components/analytics'

export default function ChannelDatePage() {
  const { login = '', sessionKey = '', date = '' } = useParams<{
    login: string
    sessionKey?: string
    date?: string
  }>()
  const sessionDate = parseSessionDateParam(sessionKey || date)
  const channelLogin = login.trim().toLowerCase()
  const data = useChannelSessionDay(channelLogin, sessionDate)

  if (!sessionDate) {
    return (
      <AnalyticsShell
        title="Invalid session day"
        description="Use a calendar date in YYYY-MM-DD format."
        actions={
          channelLogin ? (
            <Link to={`/analytics/${encodeURIComponent(channelLogin)}`} className="btn btn-secondary">
              Back to channel
            </Link>
          ) : (
            <Link to="/analytics" className="btn btn-secondary">
              Analytics home
            </Link>
          )
        }
      >
        <section className="panel">
          <p className="muted">Could not parse “{sessionKey || date}” as a session day.</p>
        </section>
      </AnalyticsShell>
    )
  }

  const actionLabel = analyticsActionLabel('recent-session')
  const emptyMessage = data.historyUnavailable
    ? 'Stream history is unavailable — try again later.'
    : `No sessions started on ${sessionDate} (UTC) for ${channelLogin}.`

  return (
    <AnalyticsShell
      title={`${channelLogin} · ${sessionDate}`}
      description="Sessions that started on this calendar day. Open a stream for full analytics."
      actions={
        <Link to={`/analytics/${encodeURIComponent(channelLogin)}`} className="btn btn-secondary">
          Back to channel
        </Link>
      }
    >
      <HubState
        loading={data.loading}
        error={data.error}
        empty={!data.loading && !data.error && data.rows.length === 0}
        emptyMessage={emptyMessage}
        onRetry={data.reload}
      >
        {data.historyUnavailable && data.rows.length > 0 ? (
          <p className="muted" style={{ marginBottom: '0.75rem' }}>
            Metadata history is partially unavailable — showing live session only.
          </p>
        ) : null}

        <section className="panel">
          <h2 className="analytics-hub__panel-title">Sessions on this day</h2>
          <ul className="analytics-hub-channel-list">
            {data.rows.map((row) => {
              const href = buildAnalyticsHref({
                login: channelLogin,
                streamId: row.streamId,
                context: 'recent-session',
              })
              const timeLabel = formatSessionTime(row.startedAt)
              return (
                <li key={row.streamId}>
                  <div>
                    <strong>{row.title}</strong>
                    <p className="muted" style={{ margin: '0.15rem 0 0', fontSize: '0.8125rem' }}>
                      {row.isLive ? 'Live' : 'Ended'}
                      {timeLabel ? ` · ${timeLabel} UTC` : ''}
                    </p>
                  </div>
                  <Link to={href}>{actionLabel}</Link>
                </li>
              )
            })}
          </ul>
        </section>
      </HubState>
    </AnalyticsShell>
  )
}
