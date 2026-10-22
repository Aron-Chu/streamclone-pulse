import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { AnalyticsFind } from './AnalyticsFind'
import { BrandMark } from '../BrandMark'
import { ChromeInstallCta } from '../ChromeInstallCta'
import { discordInviteUrl } from '../../../lib/discord'
import { FEEDBACK_PATH } from '../../../lib/externalLinks'
import { AccountEntry } from '../AccountEntry'
import { useAccountSession } from '../../../lib/accountSession'
import { accountHeaderEnabled } from '../../../lib/accountHeaderFlag'

export interface AnalyticsTopNavItem {
  label: string
  to: string
  end?: boolean
  /** Other exact paths that serve this item's page (the hub at /analytics). */
  alsoCurrentOn?: string[]
}

export interface AnalyticsTopNavStatus {
  label: string
  value: string
  detail?: string
  tone?: 'checking' | 'ready' | 'degraded' | 'offline' | 'syncing' | 'muted'
}

export interface AnalyticsTopNavProps {
  items: AnalyticsTopNavItem[]
  status?: AnalyticsTopNavStatus
  navigationLabel?: string
}

export function AnalyticsTopNav({
  items,
  status,
  navigationLabel = 'Analytics navigation',
}: AnalyticsTopNavProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const location = useLocation()
  const discord = discordInviteUrl()
  const currentPath = location.pathname.replace(/\/+$/, '') || '/'

  useEffect(() => {
    setIsOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = !isOpen
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer, true)
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true)
  }, [isOpen])

  const closeMenu = (restoreFocus = false) => {
    setIsOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }

  return (
    <header className={accountHeaderEnabled() ? 'analytics-topnav analytics-topnav--account' : 'analytics-topnav'} data-analytics-build="command-center-cws-2026-07-22">
      <a href="#analytics-main" className="analytics-topnav__skip">
        Skip to analytics content
      </a>
      <Link to="/" className="analytics-topnav__brand" aria-label="StreamPulse analytics home">
        <BrandMark className="analytics-topnav__mark" size={30} />
        <span className="analytics-topnav__brand-copy">
          <strong>
            Stream<span>Pulse</span>
          </strong>
          <small>Analytics Hub</small>
        </span>
      </Link>

      {items.length > 0 ? (
        <nav className="analytics-topnav__links" aria-label={navigationLabel}>
          {items.map((item) => item.alsoCurrentOn?.includes(currentPath) ? (
            <Link key={item.to} to={item.to} className="active" aria-current="page">
              {item.label}
            </Link>
          ) : (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {item.label}
            </NavLink>
          ))}
          <div className="analytics-topnav__more" ref={menuRef} onKeyDown={event => {
            if (event.key === 'Escape' && isOpen) {
              event.preventDefault()
              event.stopPropagation()
              closeMenu(true)
            }
          }} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu()
          }}>
            <button ref={triggerRef} type="button" className="analytics-topnav__more-trigger" aria-label="Support and account" aria-expanded={isOpen} aria-controls={panelId} title="Support and account" onClick={() => setIsOpen(value => !value)}>
              <Menu size={18} aria-hidden="true" />
            </button>
            <div ref={panelRef} id={panelId} className="analytics-topnav__more-links" data-state={isOpen ? 'open' : 'closed'} aria-hidden={!isOpen}>
              <Link to={FEEDBACK_PATH} onClick={() => closeMenu()}>Send feedback</Link>
              {discord ? <a href={discord} target="_blank" rel="noopener noreferrer" aria-label="Discord (opens in a new tab)" onClick={() => closeMenu()}>Discord</a> : null}
              <Link to="/docs" onClick={() => closeMenu()}>Extension guide</Link>
              <Link to="/support" onClick={() => closeMenu()}>Support</Link>
              <Link to="/status" onClick={() => closeMenu()}>Service status</Link>
              <Link to="/supporter" onClick={() => closeMenu()}>Pulse Supporter</Link>
              {accountHeaderEnabled() ? <MenuAccountLink onNavigate={() => closeMenu()} /> : null}
              {/* No account entries until Continue with Twitch is public: the sign-in
                  page is the invited-tester bridge, sign-ups are closed, and extension
                  connection codes are tester-only. Testers reach them from account pages. */}
              <Link to="/privacy" onClick={() => closeMenu()}>Privacy</Link>
              <Link to="/terms" onClick={() => closeMenu()}>Terms</Link>
              <Link to="/refunds" onClick={() => closeMenu()}>Cancellation and refunds</Link>
            </div>
          </div>
          {/* In the links row so a phone keeps it beside the menu; centred in the bar from 1360 px. */}
          <AnalyticsFind />
        </nav>
      ) : <AnalyticsFind />}

      <div className="analytics-topnav__actions" aria-label="Analytics utilities">
        <ChromeInstallCta className="analytics-topnav__install" data-cta="chrome-install-analytics">
          <span className="chrome-mark" aria-hidden="true" />Add to Chrome
        </ChromeInstallCta>
        {status ? (
          <div
            className={`analytics-topnav__status analytics-topnav__status--${status.tone ?? 'muted'}`}
            aria-label={`${status.label}: ${status.value}${status.detail ? ` - ${status.detail}` : ''}`}
            aria-live="polite"
            title={status.detail}
          >
            <span aria-hidden="true" />
            <small>{status.label}</small>
            <strong>{status.value}</strong>
          </div>
        ) : null}
      </div>
      {accountHeaderEnabled() ? <AccountEntry variant="analytics" /> : null}
    </header>
  )
}

/** With the header account entry on, the menu's account link follows the session. */
function MenuAccountLink({ onNavigate }: { onNavigate: () => void }) {
  return useAccountSession().status === 'signed_out'
    ? <Link to="/account/sign-in" onClick={onNavigate}>Sign in</Link>
    : <Link to="/account/settings" onClick={onNavigate}>Account &amp; devices</Link>
}
