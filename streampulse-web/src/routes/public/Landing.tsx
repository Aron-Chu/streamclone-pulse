import { Link } from 'react-router-dom'
import { PublicLayout } from '../../ui/components/PublicLayout'

export default function Landing() {
  return (
    <PublicLayout>
      <section className="panel panel--elevated text-center">
        <p className="live-badge" style={{ justifyContent: 'center' }}>
          <span className="live-badge__dot pulse-live-dot" />
          StreamPulse
        </p>
        <h1 style={{ margin: '0.75rem 0', fontSize: '2rem' }}>
          Never miss the moment that mattered.
        </h1>
        <p className="muted" style={{ maxWidth: '42rem', margin: '0 auto 1.5rem' }}>
          StreamPulse is the hosted portal for Streamclone Pulse — connect your extension, review
          channels, and manage saved moments off Twitch.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/setup" className="btn btn-primary">
            Get started
          </Link>
          <Link to="/dashboard" className="btn btn-secondary">
            Open dashboard
          </Link>
          <Link to="/login" className="btn btn-secondary">
            Sign in
          </Link>
        </div>
      </section>
    </PublicLayout>
  )
}
