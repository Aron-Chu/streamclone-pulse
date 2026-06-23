import { Link } from 'react-router-dom'

export default function AdminShell() {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <span className="app-nav__brand">StreamPulse Admin</span>
        <nav className="app-nav__links">
          <Link to="/">Exit</Link>
        </nav>
      </header>
      <main className="app-main">
        <section className="panel">
          <h1>Operator console</h1>
          <p className="muted">
            Admin metrics and actions are gated behind Cloudflare Access in production. This shell is
            a lazy-loaded placeholder for P3 work.
          </p>
        </section>
      </main>
    </div>
  )
}
