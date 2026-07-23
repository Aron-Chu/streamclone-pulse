import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'

export default function NotFound() {
  return (
    <PublicLayout>
      <section className="panel public-document" data-testid="not-found">
        <h1>Page not found</h1>
        <p className="muted">That URL is not a public StreamPulse page.</p>
        <p className="public-document__actions">
          <Link to="/">Return home</Link>
          <Link to="/analytics">Open Analytics</Link>
          <Link to="/support">Support</Link>
        </p>
      </section>
    </PublicLayout>
  )
}
