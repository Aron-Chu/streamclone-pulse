import { Link, useParams } from 'react-router-dom'
import { AnalyticsConsole } from '@streamclone/analytics-console'
import '../../ui/tokens.css'
import '../../ui/components/analytics/analytics-hub-home.css'

/** Gated channel analytics shell — full console lands via @streamclone/analytics-console (P4). */
export default function ChannelAnalyticsPage() {
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
      <section className="hub-sec">
        <div className="hub-sec-head">
          <div className="hub-sec-head__l">
            <h1 id="channel-analytics-title">{label}</h1>
            <span className="hub-sec-head__desc">
              Beta-gated Streamclone analytics console. Charts load from the portal API with your beta key.
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
