import { Link, useParams } from 'react-router-dom'
import { AnalyticsConsole } from '@streamclone/analytics-console'
import { usePortalAnalyticsConsoleApi } from '../../hooks/usePortalAnalyticsConsoleApi'
import '../../ui/tokens.css'
import '../../ui/components/analytics/analytics-hub-home.css'
import '../../ui/components/analytics/analytics-console.css'

/** Gated channel analytics — Streamclone console via portalAnalytics adapter. */
export default function ChannelAnalyticsPage() {
  usePortalAnalyticsConsoleApi()
  const { login = '' } = useParams<{ login: string }>()
  const label = login || 'channel'

  return (
    <main className="sp-hub" id="analytics-main" aria-label={`Analytics for ${label}`}>
      <header className="hub-brand">
        <Link to="/analytics" className="hub-brand__nm" style={{ textDecoration: 'none', color: 'inherit' }}>
          Stream<b>Pulse</b>
        </Link>
        <span className="hub-brand__tag">Channel analytics</span>
      </header>
      <section className="hub-sec hub-sec--console">
        <div className="hub-sec-head">
          <div className="hub-sec-head__l">
            <h1 id="channel-analytics-title">{label}</h1>
            <span className="hub-sec-head__desc">
              Streamclone minute charts via sanitized portal analytics APIs.
            </span>
          </div>
          <Link className="hub-openbtn" to="/analytics">
            Back to hub
          </Link>
        </div>
        <AnalyticsConsole />
      </section>
    </main>
  )
}
