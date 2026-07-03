import { Link } from 'react-router-dom'
import '../../ui/tokens.css'
import '../../ui/components/analytics/analytics-hub-home.css'

export default function StreamsHubPlaceholder() {
  return (
    <main className="sp-hub" id="analytics-main" aria-label="Streams directory">
      <header className="hub-brand">
        <Link to="/analytics" className="hub-brand__nm" style={{ textDecoration: 'none', color: 'inherit' }}>
          Stream<b>Pulse</b>
        </Link>
        <span className="hub-brand__tag">Streams</span>
      </header>
      <section className="hub-sec">
        <div className="hub-sec-head">
          <div className="hub-sec-head__l">
            <h1>Streams directory</h1>
            <span className="hub-sec-head__desc">
              A browsable stream directory is coming soon. Search any channel from the hub to open its analytics.
            </span>
          </div>
          <Link className="hub-openbtn" to="/analytics">
            Back to hub
          </Link>
        </div>
      </section>
    </main>
  )
}
