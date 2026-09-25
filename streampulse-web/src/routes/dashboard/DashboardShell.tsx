import { NavLink, Outlet } from 'react-router-dom'

export default function DashboardShell() {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <NavLink to="/dashboard" className="app-nav__brand">
          StreamPulse Dashboard
        </NavLink>
        <nav className="app-nav__links">
          <NavLink to="/dashboard" end>
            Home
          </NavLink>
          <NavLink to="/dashboard/clips">Clips</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <p className="muted" role="note">
          Operator tools: a saved beta key only opens this interface; the server checks access for each request.
          The key is stored in this browser’s local storage and can be read by scripts on this origin. Use only a trusted browser.
        </p>
        <Outlet />
      </main>
    </div>
  )
}
