import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'

/** Public 404 for unknown paths and retired public placeholders (e.g. /admin). */
export default function NotFound() {
  return (
    <PublicLayout>
      <section className="panel" data-testid="not-found">
        <h1>Page not found</h1>
        <p className="muted">That URL is not a public StreamPulse page.</p>
        <p>
          <Link to="/">Return home</Link>
          {' · '}
          <Link to="/analytics">Analytics</Link>
          {' · '}
          <Link to="/privacy">Privacy</Link>
        </p>
      </section>
    </PublicLayout>
  )
}
