import { Link } from 'react-router-dom'

/**
 * Quarantined private workspace landing — not a second public hub.
 * Canonical analytics live at /analytics (beta-key not required).
 */
export default function DashboardHome() {
  return (
    <section className="clips-page" aria-labelledby="dashboard-home-title">
      <div className="clips-page__header">
        <div>
          <p className="clips-page__eyebrow">Private workspace</p>
          <h1 id="dashboard-home-title">StreamPulse workspace</h1>
          <p className="muted">
            Beta-key area for clip queue and operator tools. Public analytics hub:{' '}
            <Link to="/analytics">/analytics</Link>.
          </p>
        </div>
        <Link to="/dashboard/clips" className="sc-btn sc-btn--primary">
          Open clip queue
        </Link>
      </div>
    </section>
  )
}
