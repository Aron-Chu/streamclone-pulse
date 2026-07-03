import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'

export default function Docs() {
  return (
    <PublicLayout>
      <section className="panel">
        <h1>Docs</h1>
        <p className="muted">
          Setup guides and API reference will live here. For now, open{' '}
          <Link to="/analytics">StreamPulse Analytics</Link>.
        </p>
      </section>
    </PublicLayout>
  )
}
