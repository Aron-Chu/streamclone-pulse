import { useEffect, useId, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { BrandMark } from '../BrandMark'
import { ChromeInstallCta } from '../ChromeInstallCta'

export interface AnalyticsTopNavItem {
  label: string
  to: string
  end?: boolean
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
    <header className="analytics-topnav" data-analytics-build="command-center-cws-2026-07-22">
      <a href="#analytics-main" className="analytics-topnav__skip">
        Skip to analytics content
      </a>
      <Link to="/analytics" className="analytics-topnav__brand" aria-label="StreamPulse analytics home">
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
          {items.map((item) => (
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
              <Link to="/docs" onClick={() => closeMenu()}>Extension guide</Link>
              <Link to="/support" onClick={() => closeMenu()}>Support</Link>
              <Link to="/status" onClick={() => closeMenu()}>Service status</Link>
              <Link to="/supporter" onClick={() => closeMenu()}>Pulse Supporter</Link>
              <Link to="/account/sign-in" onClick={() => closeMenu()}>Account</Link>
              <Link to="/account/billing" onClick={() => closeMenu()}>Manage membership</Link>
              <Link to="/account/link-device" onClick={() => closeMenu()}>Link extension</Link>
              <Link to="/privacy" onClick={() => closeMenu()}>Privacy</Link>
              <Link to="/terms" onClick={() => closeMenu()}>Terms</Link>
              <Link to="/refunds" onClick={() => closeMenu()}>Cancellation and refunds</Link>
            </div>
          </div>
        </nav>
      ) : null}

      <div className="analytics-topnav__actions" aria-label="Analytics utilities">
        <ChromeInstallCta className="analytics-topnav__install" data-cta="chrome-install-analytics" />
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
    </header>
  )
}
