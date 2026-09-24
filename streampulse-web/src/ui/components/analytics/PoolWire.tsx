import { useState } from 'react'
import { poolWireEventLabel, type PoolWireEvent } from '../../../lib/poolWireReducer'
import { displayName } from './hubFormat'

const DEFAULT_VISIBLE_EVENTS = 2

function relativeTime(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return ''
  const deltaSec = Math.max(0, Math.round((now - at) / 1000))
  if (deltaSec < 60) return `${deltaSec}s ago`
  const min = Math.round(deltaSec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}

function stableDurationLabel(stableSinceMs: number | undefined, now: number): string {
  if (stableSinceMs == null || !Number.isFinite(stableSinceMs) || stableSinceMs <= 0) {
    return 'POOL  Stable'
  }
  const deltaSec = Math.max(0, Math.round((now - stableSinceMs) / 1000))
  if (deltaSec < 60) return `POOL  Stable for ${deltaSec}s`
  const min = Math.round(deltaSec / 60)
  if (min < 60) return `POOL  Stable for ${min}m`
  const hr = Math.round(min / 60)
  return `POOL  Stable for ${hr}h`
}

export interface PoolWireProps {
  events: PoolWireEvent[]
  loading?: boolean
  initialized?: boolean
  unavailable?: boolean
  stale?: boolean
  nowMs?: number
  /** Wall time of last known lifecycle change — enables "Stable for Xm". */
  stableSinceMs?: number
}

export function PoolWire({
  events,
  loading,
  initialized,
  unavailable = false,
  stale = false,
  nowMs,
  stableSinceMs,
}: PoolWireProps) {
  const now = nowMs ?? Date.now()
  const [showAllEvents, setShowAllEvents] = useState(false)
  const visibleEvents = showAllEvents ? events : events.slice(0, DEFAULT_VISIBLE_EVENTS)

  return (
    <section className="hub-pool-wire" aria-label="Pool Wire" data-testid="pool-wire">
      <header className="hub-pool-wire__head">
        <h2 className="hub-pool-wire__title">Pool Wire</h2>
        <p className="hub-pool-wire__sub">Tracked live set</p>
      </header>

      {loading && !initialized ? (
        <p className="hub-pool-wire__empty hub-pool-wire__empty--quiet" role="status">
          Loading pool…
        </p>
      ) : unavailable || stale || initialized === false ? (
        <p className="hub-pool-wire__empty hub-pool-wire__empty--quiet" role="status">
          {unavailable ? 'Pool state unavailable' : stale ? 'Pool updates paused · last snapshot is stale' : 'Pool changes not yet observed'}
        </p>
      ) : events.length === 0 ? (
        <p
          className="hub-pool-wire__empty hub-pool-wire__empty--quiet"
          role="status"
          data-testid="pool-wire-stable"
        >
          {stableDurationLabel(stableSinceMs, now)}
        </p>
      ) : (
        <>
        <ul className="hub-pool-wire__list">
          {visibleEvents.map((event) => (
            <li
              key={event.id}
              className={`hub-pool-wire__row hub-pool-wire__row--${event.kind}`}
              data-kind={event.kind}
              data-derived={event.derived ? 'true' : 'false'}
            >
              <span
                className={`hub-pool-wire__dot${event.derived ? ' hub-pool-wire__dot--derived' : ''}`}
                aria-hidden="true"
              />
              <div className="hub-pool-wire__body">
                <div className="hub-pool-wire__line">
                  <span className="hub-pool-wire__name">
                    {displayName(event.login, event.displayName)}
                  </span>
                  <span className="hub-pool-wire__action">{poolWireEventLabel(event.kind)}</span>
                  {event.derived ? (
                    <abbr
                      className="hub-pool-wire__approx"
                      title="Derived from live-pool polling"
                    >
                      ≈
                    </abbr>
                  ) : null}
                </div>
                <div className="hub-pool-wire__meta">
                  <span>{relativeTime(event.at, now)}</span>
                  {event.category ? (
                    <>
                      <span aria-hidden="true"> · </span>
                      <span>{event.category}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {events.length > DEFAULT_VISIBLE_EVENTS ? (
          <button
            type="button"
            className="hub-pool-wire__toggle"
            aria-expanded={showAllEvents}
            onClick={() => setShowAllEvents((current) => !current)}
          >
            {showAllEvents
              ? 'Show fewer pool changes'
              : `Show ${events.length - DEFAULT_VISIBLE_EVENTS} more pool changes`}
          </button>
        ) : null}
        </>
      )}
    </section>
  )
}
