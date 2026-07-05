import { Link, NavLink } from 'react-router-dom'

export interface AnalyticsTopNavItem {
  label: string
  to: string
  end?: boolean
}

export interface AnalyticsTopNavStatus {
  label: string
  value: string
  detail?: string
  tone?: 'checking' | 'ready' | 'degraded' | 'offline' | 'syncing' | 'muted'
}

export interface AnalyticsTopNavProps {
  items: AnalyticsTopNavItem[]
  status?: AnalyticsTopNavStatus
  navigationLabel?: string
}

export function AnalyticsTopNav({
  items,
  status,
  navigationLabel = 'Analytics navigation',
}: AnalyticsTopNavProps) {
  return (
    <header className="analytics-topnav">
      <a href="#analytics-main" className="analytics-topnav__skip">
        Skip to analytics content
      </a>
      <Link to="/analytics" className="analytics-topnav__brand" aria-label="StreamPulse analytics home">
        <span className="analytics-topnav__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="analytics-topnav__brand-copy">
          <strong>Stream<span>Pulse</span></strong>
          <small>Analytics Hub</small>
        </span>
      </Link>

      {items.length > 0 ? (
        <nav className="analytics-topnav__links" aria-label={navigationLabel}>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      ) : null}

      <div className="analytics-topnav__actions" aria-label="Analytics utilities">
        {status ? (
          <div
            className={`analytics-topnav__status analytics-topnav__status--${status.tone ?? 'muted'}`}
            aria-label={`${status.label}: ${status.value}${status.detail ? ` - ${status.detail}` : ''}`}
            aria-live="polite"
            title={status.detail}
          >
            <span aria-hidden="true" />
            <small>{status.label}</small>
            <strong>{status.value}</strong>
          </div>
        ) : null}
      </div>
    </header>
  )
}
