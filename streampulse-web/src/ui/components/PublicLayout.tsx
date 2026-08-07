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
          <Link to="/changelog">Changelog</Link>
          <Link to="/support">Support</Link>
        </nav>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <div className="app-footer__identity">
          <span>StreamPulse · coverage-honest Twitch analytics</span>
          <span className="app-footer__note">Private beta preview · release history is canonical</span>
        </div>
        <nav aria-label="Footer">
          <Link to="/changelog">Changelog</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/support">Support</Link>
        </nav>
      </footer>
    </div>
  )
}
