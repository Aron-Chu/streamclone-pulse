import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <Link to="/" className="app-nav__brand">
          <BrandMark className="app-nav__mark" size={28} />
          StreamPulse
        </Link>
        <nav className="app-nav__links">
          <Link to="/analytics">Analytics</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/status">Status</Link>
          <Link to="/privacy">Privacy</Link>
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  )
}
