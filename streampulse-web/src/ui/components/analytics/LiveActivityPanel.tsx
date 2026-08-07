import { Link } from 'react-router-dom'
import {
  formatCoverageDiagnostic,
  formatLiveActivityRelativeTime,
  liveActivityKindLabel,
  liveActivityPrecisionLabel,
  liveActivitySourceLabel,
  resolveCoverageMetadataLabel,
  type LiveActivityEvent,
  type LiveActivityKindFilter,
  type LiveActivityMetadata,
  type LiveActivityMetadataState,
} from '../../../lib/liveActivity'
import type { LiveActivityUiStatus } from '../../../hooks/useLiveActivity'
import { displayName } from './hubFormat'
import { Avatar } from '../hub/primitives'

const LIVE_ACTIVITY_MAX_ROWS = 20

export interface LiveActivityPanelProps {
  events: LiveActivityEvent[]
  status: LiveActivityUiStatus
  metadata?: LiveActivityMetadata | null
  asOf?: string | null
  window?: string | null
  kindFilter: LiveActivityKindFilter
  onKindFilterChange: (kind: LiveActivityKindFilter) => void
  newIds?: Set<string>
  lastSuccessfulAt?: number | null
  loading?: boolean
  nowMs?: number
}

const FILTERS: { id: LiveActivityKindFilter; label: string; testId: string }[] = [
  { id: 'all', label: 'All', testId: 'live-activity-filter-all' },
  { id: 'went_live', label: 'Went live', testId: 'live-activity-filter-went-live' },
  { id: 'went_offline', label: 'Went offline', testId: 'live-activity-filter-went-offline' },
]

function formatWindowForEmptyCopy(window: string | null | undefined): string {
  const raw = (window ?? '6h').trim().toLowerCase()
  switch (raw) {
    case '1h':
      return '1 hour'
    case '6h':
      return '6 hours'
    case '12h':
      return '12 hours'
    case '24h':
      return '24 hours'
    default:
      return window?.trim() || '6 hours'
  }
}

function lastSeenCopy(event: LiveActivityEvent, now: number): string | null {
  if (event.kind !== 'went_offline' || !event.lastSeenLiveAt) return null
  const rel = formatLiveActivityRelativeTime(event.lastSeenLiveAt, now)
  return rel ? `Last seen live ${rel}` : null
}

export function CoverageDiagnostic({
  trackedCount,
  metadataState,
  requestStatus,
}: {
  trackedCount: number
  metadataState?: LiveActivityMetadataState | string | null
  /** Live Activity request status — when unavailable/error/loading, never show metadata current. */
  requestStatus?: LiveActivityUiStatus | null
}) {
  const honestState = resolveCoverageMetadataLabel(requestStatus, metadataState)
  const label = formatCoverageDiagnostic(trackedCount, honestState)
  return (
    <a
      href="#section-coverage"
      className="hub-coverage-diagnostic"
      data-testid="coverage-diagnostic"
      title="StreamPulse tracked channels only — not all of Twitch. Jump to Coverage."
    >
      {label}
    </a>
  )
}

export function LiveActivityPanel({
  events,
  status,
  metadata = null,
  asOf = null,
  window: activityWindow = '6h',
  kindFilter,
  onKindFilterChange,
  newIds,
  lastSuccessfulAt = null,
  loading,
  nowMs,
}: LiveActivityPanelProps) {
  const now = nowMs ?? Date.now()
  const rows = events.slice(0, LIVE_ACTIVITY_MAX_ROWS)
  const windowLabel = formatWindowForEmptyCopy(activityWindow)
  const showUnavailable = status === 'unavailable' || status === 'error'
  const showDelayed = status === 'degraded' || status === 'stale'
  const showEmpty =
    !showUnavailable && rows.length === 0 && !loading && (status === 'empty' || status === 'ready')
  const checkedAt = asOf ?? (lastSuccessfulAt != null ? new Date(lastSuccessfulAt).toISOString() : null)
  const metadataUpdated =
    metadata?.lastSuccessfulPollAt ??
    (lastSuccessfulAt != null ? new Date(lastSuccessfulAt).toISOString() : null)

  return (
    <section className="hub-live-activity" aria-label="Live Activity" data-testid="live-activity">
      <header className="hub-live-activity__head">
        <div className="hub-live-activity__titles">
          <h2 className="hub-live-activity__title">Live Activity</h2>
          <p className="hub-live-activity__sub">Recent streamer status changes</p>
        </div>
        <div
          className="hub-live-activity__filters"
          role="group"
          aria-label="Filter live activity"
        >
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`hub-live-activity__filter${kindFilter === filter.id ? ' is-active' : ''}`}
              data-testid={filter.testId}
              aria-pressed={kindFilter === filter.id}
              onClick={() => onKindFilterChange(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      {showDelayed ? (
        <p className="hub-live-activity__banner hub-live-activity__banner--warn" role="status">
          Live activity may be delayed
          {metadataUpdated ? (
            <>
              {' '}
              · Metadata last updated{' '}
              <time dateTime={metadataUpdated} title={metadataUpdated}>
                {formatLiveActivityRelativeTime(metadataUpdated, now)}
              </time>
            </>
          ) : null}
        </p>
      ) : null}

      {showUnavailable ? (
        <p
          className="hub-live-activity__banner hub-live-activity__banner--error"
          role="status"
          data-testid="live-activity-unavailable"
        >
          Live activity unavailable
          {lastSuccessfulAt != null ? (
            <>
              {' '}
              · Last successful update{' '}
              <time
                dateTime={new Date(lastSuccessfulAt).toISOString()}
                title={new Date(lastSuccessfulAt).toISOString()}
              >
                {formatLiveActivityRelativeTime(new Date(lastSuccessfulAt).toISOString(), now)}
              </time>
            </>
          ) : null}
        </p>
      ) : null}

      {loading && rows.length === 0 && !showUnavailable ? (
        <p className="hub-live-activity__empty hub-live-activity__empty--quiet" role="status">
          Loading live activity…
        </p>
      ) : showEmpty || (showUnavailable && rows.length === 0) ? (
        showUnavailable && rows.length === 0 ? null : (
          <p
            className="hub-live-activity__empty"
            role="status"
            data-testid="live-activity-empty"
          >
            No confirmed stream changes in the last {windowLabel}.
            {checkedAt ? (
              <>
                {' '}
                Last checked{' '}
                <time dateTime={checkedAt} title={checkedAt}>
                  {formatLiveActivityRelativeTime(checkedAt, now)}
                </time>
              </>
            ) : null}
          </p>
        )
      ) : rows.length > 0 ? (
        <ul className="hub-live-activity__list">
          {rows.map((event) => {
            const login = event.channel.login
            const name = displayName(login, event.channel.displayName)
            const isNew = newIds?.has(event.id) ?? false
            const precision = liveActivityPrecisionLabel(event.timestampPrecision, event.kind)
            const seen = lastSeenCopy(event, now)
            return (
              <li key={event.id} className="hub-live-activity__row-wrap">
                <Link
                  to={`/analytics/${encodeURIComponent(login)}`}
                  className={`hub-live-activity__row hub-live-activity__row--${event.kind}${
                    isNew ? ' hub-live-activity__row--new' : ''
                  }`}
                  data-testid="live-activity-row"
                  data-kind={event.kind}
                >
                  <Avatar
                    login={login}
                    src={event.channel.avatarUrl}
                    alt=""
                    className="hub-live-activity__av"
                  />
                  <div className="hub-live-activity__body">
                    <div className="hub-live-activity__line">
                      <span className="hub-live-activity__name">{name}</span>
                      <span className="hub-live-activity__action">
                        {liveActivityKindLabel(event.kind)}
                      </span>
                      {isNew ? (
                        <span className="hub-live-activity__new" aria-label="New">
                          New
                        </span>
                      ) : null}
                      <time
                        className="hub-live-activity__time"
                        dateTime={event.occurredAt}
                        title={event.occurredAt}
                      >
                        {formatLiveActivityRelativeTime(event.occurredAt, now)}
                      </time>
                    </div>
                    {event.title || event.category ? (
                      <div className="hub-live-activity__snapshot">
                        {event.title ? <span>{event.title}</span> : null}
                        {event.title && event.category ? (
                          <span aria-hidden="true"> · </span>
                        ) : null}
                        {event.category ? <span>{event.category}</span> : null}
                      </div>
                    ) : null}
                    <div className="hub-live-activity__meta">
                      <span>{precision}</span>
                      {seen ? (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span title={event.lastSeenLiveAt ?? undefined}>{seen}</span>
                        </>
                      ) : null}
                      <span aria-hidden="true"> · </span>
                      <span className="hub-live-activity__source">
                        {liveActivitySourceLabel(event.source)}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}
