import { useEffect, useRef, useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { AccountEntrySlot } from './AccountEntrySlot'
import { accountHeaderEnabled } from '../../lib/accountHeaderFlag'
import { BrandMark } from './BrandMark'
import { DiscordMark } from './DiscordMark'
import { discordInviteUrl } from '../../lib/discord'
import { InstallCta } from './InstallCta'
import { capturePublicCta } from '../../lib/productAnalytics'
import { SITE_NAV_ITEMS } from '../../lib/siteNav'
import { SiteFooter } from './SiteFooter'
import { PageErrorBoundary } from '../PortalErrorBoundary'

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
          {SITE_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={item.to === '/analytics' ? () => capturePublicCta('open_analytics') : undefined}
              className={({ isActive }) => `app-nav__link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
          {discord ? (
            <a href={discord} target="_blank" rel="noopener noreferrer" className="app-nav__discord" aria-label={DISCORD_LABEL}>
              <DiscordMark size={16} />Discord
            </a>
          ) : null}
          <InstallCta className="app-nav__install" data-cta="chrome-install-public-nav" />
        </nav>
        <AccountEntrySlot variant="public" />
      </header>
      <main className="app-main" id="public-main" tabIndex={-1}><PageErrorBoundary>{children}</PageErrorBoundary></main>
      <SiteFooter />
    </div>
  )
}
