import { Link, NavLink } from 'react-router-dom'
import { BrandMark } from './BrandMark'
import { ChromeInstallCta } from './ChromeInstallCta'
import { GITHUB_REPO_URL } from '../../lib/externalLinks'

export function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell">
      <header className="app-nav">
        <Link to="/" className="app-nav__brand" title="StreamPulse Home">
          <BrandMark className="app-nav__mark" size={28} />
          <span>StreamPulse</span>
        </Link>
        <nav className="app-nav__links" aria-label="Main Navigation">
          <NavLink
            to="/analytics"
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Analytics
          </NavLink>
          <NavLink
            to="/docs"
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Docs
          </NavLink>
          <NavLink
            to="/status"
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Status
          </NavLink>
          <NavLink
            to="/support"
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Support
          </NavLink>
          <NavLink
            to="/privacy"
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Privacy
          </NavLink>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="app-nav__link"
          >
            GitHub
          </a>
          <ChromeInstallCta className="app-nav__install" data-cta="chrome-install-public-nav" />
        </nav>
      </header>
      <main className="app-main">{children}</main>
      <footer className="app-footer">
        <div className="app-footer__inner">
          <div className="flex items-center gap-2">
            <BrandMark size={20} />
            <span className="font-bold text-zinc-300">StreamPulse</span>
            <span className="text-zinc-600">·</span>
            <span className="text-xs text-zinc-500">Twitch Reaction & Sentiment Analytics</span>
          </div>
          <div className="app-footer__links">
            <Link to="/analytics">Analytics Hub</Link>
            <Link to="/docs">Documentation</Link>
            <Link to="/status">System Status</Link>
            <Link to="/support">Support</Link>
            <Link to="/privacy">Privacy Policy</Link>
            <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
