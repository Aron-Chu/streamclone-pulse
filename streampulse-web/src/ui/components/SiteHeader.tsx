import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { BrandMark } from './BrandMark'
import { DiscordMark } from './DiscordMark'
import { InstallCta } from './InstallCta'
import { AccountEntrySlot, MenuAccountSlot } from './AccountEntrySlot'
import { accountHeaderEnabled } from '../../lib/accountHeaderFlag'
import { discordInviteUrl } from '../../lib/discord'
import { capturePublicCta } from '../../lib/productAnalytics'
import { SITE_FOOTER_ITEMS, SITE_NAV_ITEMS, type SiteNavItem } from '../../lib/siteNav'
import './site-header.css'

const DISCORD_LABEL = 'Join the StreamPulse Discord (opens in a new tab)'
const PHONE = '(max-width: 719px)'

export interface SiteHeaderProps {
  /** The id of the page's main landmark, for the skip link. */
  mainId: string
  /** The account entry's look, and the analytics id of the bar's own install button. */
  variant: 'analytics' | 'public'
  /** A page's own search in the bar (the front page's and the Hub's docked search), between the links and the buttons. */
  dock?: ReactNode
  /** A page's own buttons in place of the bar's install (they step back while the page's own install shows). */
  install?: ReactNode
}

/**
 * Lit for the page you are on: Hub on the Hub and on every channel page under it, Moments on
 * Moments and a moment's page, Help on the help pages. "page" for the page itself, "true" for a
 * page inside that section.
 */
export function siteNavCurrent(item: SiteNavItem, pathname: string): 'page' | 'true' | undefined {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === item.to) return 'page'
  if (item.to === '/analytics') {
    return path.startsWith('/analytics/') && !path.startsWith('/analytics/moments') ? 'true' : undefined
  }
  return path.startsWith(`${item.to}/`) ? 'true' : undefined
}

function onNavClick(item: SiteNavItem, pathname: string) {
  if (item.to === '/analytics' && !pathname.startsWith('/analytics')) capturePublicCta('open_analytics')
}

/**
 * One bar on every page (board one-header ★ A, 11-24): StreamPulse goes home, Hub · Moments ·
 * Help beside it, then the page's search where it has one, the install button and Discord. On
 * phones the links move into the Menu drawer and the bar scrolls away with the page.
 */
export function SiteHeader({ mainId, variant, dock, install }: SiteHeaderProps) {
  const { pathname } = useLocation()
  const discord = discordInviteUrl()
  const account = accountHeaderEnabled()
  return (
    <header
      className={account ? 'site-header site-header--account' : 'site-header'}
      data-analytics-build={variant === 'analytics' ? 'command-center-cws-2026-07-22' : undefined}
    >
      <a href={`#${mainId}`} className="sc-skip">Skip to main content</a>
      <Link to="/" className="site-header__brand">
        <BrandMark className="site-header__mark" size={28} />
        <span>StreamPulse</span>
      </Link>
      <nav className="site-header__links" aria-label="Main">
        {SITE_NAV_ITEMS.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="site-header__link"
            aria-current={siteNavCurrent(item, pathname)}
            onClick={() => onNavClick(item, pathname)}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {dock}
      <div className="site-header__actions">
        {install ?? (
          <InstallCta
            className="site-header__install"
            label="short"
            icon="mark"
            data-cta={variant === 'analytics' ? 'chrome-install-analytics' : 'chrome-install-public-nav'}
          />
        )}
        {discord ? (
          <a href={discord} target="_blank" rel="noopener noreferrer" className="site-header__discord" aria-label={DISCORD_LABEL}>
            <DiscordMark size={18} />
            <span>Discord</span>
          </a>
        ) : null}
        <SiteMenu discord={discord} pathname={pathname} />
      </div>
      <AccountEntrySlot variant={variant} />
    </header>
  )
}

/**
 * Buttons that step back while the page's own copy of them is on screen (the hero's install and
 * Open the Hub): they keep their places, so nothing beside them moves, and leave the tab order.
 */
export function SiteHeaderStepBack({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.inert = hidden
  }, [hidden])
  return (
    <span ref={ref} className="site-header__step" data-hidden={hidden ? '' : undefined}>
      {children}
    </span>
  )
}

/** The phone Menu: a drawer from the right with the site's pages, its information pages and Discord. */
function SiteMenu({ discord, pathname }: { discord: string | null; pathname: string }) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const panelId = useId()
  const openerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Close, Escape and the backdrop hand focus back to Menu; a page link leaves it to the new page.
  const restoreRef = useRef(false)

  // A new page, or a window wide enough for the bar's own links, closes it.
  useEffect(() => {
    setOpen(false)
  }, [pathname])
  useEffect(() => {
    if (!open || typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia(PHONE)
    const update = () => {
      if (!media.matches) setOpen(false)
    }
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const panel = panelRef.current
    const opener = openerRef.current
    panel?.querySelector<HTMLElement>('a[href], button:not([disabled])')?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        restoreRef.current = true
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const nodes = [...panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')]
      if (nodes.length === 0) return
      const first = nodes[0]!
      const last = nodes[nodes.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      if (restoreRef.current && opener?.isConnected) opener.focus()
      restoreRef.current = false
    }
  }, [open])

  const close = () => setOpen(false)
  const closeBack = () => {
    restoreRef.current = true
    setOpen(false)
  }
  // A link to the page already open goes nowhere, so it hands focus back to Menu like Close.
  const closeLink = (item: SiteNavItem) => {
    if (siteNavCurrent(item, pathname) === 'page') restoreRef.current = true
    setOpen(false)
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="site-header__menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <Menu size={18} aria-hidden="true" />
        <span className="site-header__menu-label">Menu</span>
      </button>
      {open
        ? createPortal(
            <div className="site-menu">
              <button type="button" className="site-menu__backdrop" aria-label="Close menu" tabIndex={-1} onClick={closeBack} />
              <div ref={panelRef} id={panelId} className="site-menu__panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="site-menu__head">
                  <p id={titleId} className="site-menu__title">StreamPulse</p>
                  <button type="button" className="site-menu__close" aria-label="Close menu" onClick={closeBack}>
                    <X size={18} aria-hidden="true" />
                    <span>Close</span>
                  </button>
                </div>
                <nav className="site-menu__main" aria-label="Pages">
                  {SITE_NAV_ITEMS.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={siteNavCurrent(item, pathname)}
                      onClick={() => {
                        onNavClick(item, pathname)
                        closeLink(item)
                      }}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
                <nav className="site-menu__more" aria-label="Site information">
                  {/* No account entries until Continue with Twitch is public; the header account entry
                      switch (VITE_ACCOUNT_HEADER=1) adds the one link. */}
                  <MenuAccountSlot onNavigate={close} />
                  {SITE_FOOTER_ITEMS.map((item) => (
                    <Link key={item.to} to={item.to} aria-current={siteNavCurrent(item, pathname)} onClick={() => closeLink(item)}>
                      {item.label}
                    </Link>
                  ))}
                </nav>
                {discord ? (
                  <a href={discord} target="_blank" rel="noopener noreferrer" className="site-header__discord site-menu__discord" aria-label={DISCORD_LABEL}>
                    <DiscordMark size={18} />
                    <span>Discord</span>
                  </a>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
