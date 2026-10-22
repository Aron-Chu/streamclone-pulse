import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { AccountEntry } from './AccountEntry'
import { accountHeaderEnabled } from '../../lib/accountHeaderFlag'
import { BrandMark } from './BrandMark'
import { DiscordMark } from './DiscordMark'
import { discordInviteUrl } from '../../lib/discord'
import { ChromeInstallCta } from './ChromeInstallCta'
import { capturePublicCta } from '../../lib/productAnalytics'
import { AnalyticsPreferences } from './AnalyticsPreferences'
import { PageErrorBoundary } from '../PortalErrorBoundary'
import {
  FEEDBACK_PATH,
  GITHUB_REPO_URL,
  PRIVACY_PATH,
  REFUNDS_PATH,
  SUPPORTER_PATH,
  TERMS_PATH,
} from '../../lib/externalLinks'

const DISCORD_LABEL = 'Join the StreamPulse Discord (opens in a new tab)'

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const discord = discordInviteUrl()
  const menuTrigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuTrigger.current?.focus()
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])
  return (
    <div className="app-shell">
      <a className="public-skip-link" href="#public-main">Skip to main content</a>
      <header className={accountHeaderEnabled() ? 'app-nav app-nav--account' : 'app-nav'}>
        <Link to="/" className="app-nav__brand" title="StreamPulse Home">
          <BrandMark className="app-nav__mark" size={28} />
          <span>StreamPulse</span>
        </Link>
        {/* At Menu widths the header Discord button collapses to this 44px mark beside Menu. */}
        {discord ? (
          <a href={discord} target="_blank" rel="noopener noreferrer" className="app-nav__discord-icon" aria-label={DISCORD_LABEL}>
            <DiscordMark size={22} />
          </a>
        ) : null}
        <button ref={menuTrigger} type="button" className="app-nav__menu" aria-expanded={menuOpen}
          aria-controls="public-navigation" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? 'Close menu' : 'Menu'}
        </button>
        <nav id="public-navigation" className={`app-nav__links${menuOpen ? ' is-open' : ''}`}
          aria-label="Main Navigation" onClick={(event) => {
            if ((event.target as HTMLElement).closest('a')) setMenuOpen(false)
          }}>
          {/* The site's top bar, as on the hub. Status, Support, Privacy and
              GitHub stay in the footer. */}
          <NavLink
            to="/"
            end
            onClick={() => capturePublicCta('open_analytics')}
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Hub
          </NavLink>
          <NavLink
            to="/analytics/moments"
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Moments
          </NavLink>
          <NavLink
            to="/extension"
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Extension
          </NavLink>
          <NavLink
            to="/docs"
            className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
          >
            Docs
          </NavLink>
          {discord ? (
            <a href={discord} target="_blank" rel="noopener noreferrer" className="app-nav__discord" aria-label={DISCORD_LABEL} title="Discord">
              <DiscordMark size={17} />
            </a>
          ) : null}
          {/* The one filled button in the bar (Aron's H2 pick, 10-21): Discord is an icon beside it. */}
          <ChromeInstallCta className="app-nav__install" data-cta="chrome-install-public-nav">
            <span className="chrome-mark" aria-hidden="true" />Add to Chrome
          </ChromeInstallCta>
        </nav>
        {accountHeaderEnabled() ? <AccountEntry variant="public" /> : null}
      </header>
      <main className="app-main" id="public-main" tabIndex={-1}><PageErrorBoundary>{children}</PageErrorBoundary></main>
      <footer className="app-footer">
        <div className="app-footer__inner">
          <div className="flex items-center gap-2">
            <BrandMark size={20} />
            <span className="font-bold text-zinc-300">StreamPulse</span>
            <span className="text-zinc-600">·</span>
            <span className="text-xs text-zinc-500">Twitch reaction analytics</span>
          </div>
          {/* Two rows rather than nine links in one: product destinations and
              policy documents are different errands. Both rows keep the same
              colour and size — dimming the legal row would drop it below the
              contrast floor for small text. */}
          <nav className="app-footer__nav" aria-label="Footer">
            <div className="app-footer__links">
              <Link to="/" onClick={() => capturePublicCta('open_analytics')}>Analytics Hub</Link>
              <Link to="/docs">Documentation</Link>
              <Link to="/status">System Status</Link>
              <Link to="/support">Support</Link>
              <Link to={FEEDBACK_PATH}>Send feedback</Link>
              {discord ? (
                <a href={discord} target="_blank" rel="noopener noreferrer" className="app-footer__discord" aria-label="Discord (opens in a new tab)">
                  <DiscordMark size={15} />Discord
                </a>
              ) : null}
              <a href={GITHUB_REPO_URL} target="_blank" rel="noreferrer noopener">
                GitHub
              </a>
            </div>
            <div className="app-footer__links">
              <Link to={SUPPORTER_PATH}>Supporter</Link>
              <Link to={PRIVACY_PATH}>Privacy Policy</Link>
              <Link to={TERMS_PATH}>Terms of Use</Link>
              <Link to={REFUNDS_PATH}>Cancellation &amp; Refunds</Link>
              <AnalyticsPreferences />
            </div>
          </nav>
        </div>
      </footer>
    </div>
  )
}
