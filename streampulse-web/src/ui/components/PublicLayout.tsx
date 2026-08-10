import { Link } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { ChromeInstallCta } from './ChromeInstallCta'
import { GITHUB_REPO_URL } from '../../lib/externalLinks'

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
          <Link to="/support">Support</Link>
          <Link to="/privacy">Privacy</Link>
          <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">GitHub</a>
          <ChromeInstallCta className="app-nav__install" data-cta="chrome-install-public-nav" />
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  )
}
