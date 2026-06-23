import { Link } from 'react-router-dom'

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <Link to="/" className="app-nav__brand">
          StreamPulse
        </Link>
        <nav className="app-nav__links">
          <Link to="/setup">Setup</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/status">Status</Link>
          <Link to="/login">Login</Link>
          <Link to="/dashboard">Dashboard</Link>
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  )
}
