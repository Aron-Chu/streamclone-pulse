import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'

export default function Status() {
  return (
    <PublicLayout>
      <section className="panel">
        <h1>Status</h1>
        <p className="muted">
          Public status data from <code>/v1/public/status</code> will appear here in a later batch.
          Open <Link to="/analytics">Analytics</Link> for live hub health.
        </p>
      </section>
    </PublicLayout>
  )
}
