import { Link, Outlet } from 'react-router-dom'

export default function DashboardShell() {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <Link to="/dashboard" className="app-nav__brand">
          StreamPulse Dashboard
        </Link>
        <nav className="app-nav__links">
          <Link to="/dashboard">Home</Link>
          <Link to="/setup">Connection</Link>
          <Link to="/login">Account</Link>
        </nav>
      </header>
      <main className="app-main">
        <section className="panel">
          <h1>Dashboard</h1>
          <p className="muted">
            Dashboard pages (watchlist, channels, moments) arrive in the next batch. Your beta key
            is stored locally and will be sent on gated API calls.
          </p>
        </section>
        <Outlet />
      </main>
    </div>
  )
}
