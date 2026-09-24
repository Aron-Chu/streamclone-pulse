import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import type { SettingsHostSection } from '../shared/messages.ts'
import { POLICY_LINKS } from '../shared/portalLinks.ts'
import { PeakMark } from '../ui/PeakMark.tsx'

export interface HostNavItem {
  id: SettingsHostSection
  label: string
}

function initialSection(navItems: ReadonlyArray<HostNavItem>): SettingsHostSection {
  if (typeof window === 'undefined') return navItems[0]?.id ?? 'pulse'
  const hash = window.location.hash.replace(/^#/, '')
  return navItems.some(item => item.id === hash) ? hash as SettingsHostSection : navItems[0]?.id ?? 'pulse'
}

/** Responsive page shell for the complete extension-owned settings workspace. */
export function SettingsHostShell({
  children,
  version,
  navItems = DEFAULT_NAV,
}: {
  children: ReactNode | ((activeSection: SettingsHostSection) => ReactNode)
  version?: string
  navItems?: ReadonlyArray<HostNavItem>
}) {
  const [activeSection, setActiveSection] = useState<SettingsHostSection>(() => initialSection(navItems))
  const brandIconUrl = useMemo(() => {
    try {
      return chrome.runtime.getURL('icons/icon128.png')
    } catch {
      return ''
    }
  }, [])

  useEffect(() => {
    function syncFromHash(): void {
      const nextSection = initialSection(navItems)
      const valid = navItems.some(item => `#${item.id}` === window.location.hash)
      if (!valid) window.history.replaceState(null, '', `#${nextSection}`)
      setActiveSection(nextSection)
    }
    window.addEventListener('hashchange', syncFromHash)
    window.addEventListener('popstate', syncFromHash)
    syncFromHash()
    return () => {
      window.removeEventListener('hashchange', syncFromHash)
      window.removeEventListener('popstate', syncFromHash)
    }
  }, [navItems])

  function focusSettings(event: MouseEvent<HTMLAnchorElement>): void {
    const target = document.getElementById('settings-content')
    if (!target) return
    event.preventDefault()
    target.focus()
    target.scrollIntoView({ block: 'start' })
  }

  function selectSection(event: MouseEvent<HTMLAnchorElement>, id: SettingsHostSection): void {
    event.preventDefault()
    navigateToSection(id)
  }

  function navigateToSection(id: SettingsHostSection): void {
    if (activeSection !== id) window.history.pushState(null, '', `#${id}`)
    setActiveSection(id)
    window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  }

  return (
    <div className="pulse-host" data-host-active-section={activeSection}>
      <a className="pulse-settings-skip-link" href="#settings-content" onClick={focusSettings}>Skip to settings</a>

      <header className="pulse-host-bar">
        <div className="pulse-host-brand">
          {brandIconUrl
            ? <img className="pulse-host-mark" src={brandIconUrl} alt="" width={28} height={28} />
            : <span className="pulse-host-mark pulse-host-mark-fallback" aria-hidden="true">SP</span>}
          <span className="pulse-host-titles">
            <h1>StreamPulse</h1>
            <span>Extension settings</span>
          </span>
        </div>
        <span className="pulse-host-bar-spacer" />
        {version ? <span className="pulse-host-version">v{version}</span> : null}
      </header>

      <div className="pulse-host-body">
        <nav className="pulse-host-nav" aria-label="Settings sections">
          <span className="pulse-host-nav-label">Settings</span>
          {navItems.map(item => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={activeSection === item.id ? 'page' : undefined}
              onClick={event => selectSection(event, item.id)}
            >
              <span className="pulse-host-nav-indicator" aria-hidden="true" />
              {item.label}
            </a>
          ))}
        </nav>

        <div className="pulse-host-main">
          {activeSection !== 'supporter' ? (
            <button
              type="button"
              className="pulse-settings-supporter-banner"
              data-settings-host-banner="supporter"
              onClick={() => navigateToSection('supporter')}
            >
              <span className="pulse-settings-supporter-banner-mark" aria-hidden="true"><PeakMark size={20} /></span>
              <span className="pulse-settings-supporter-banner-copy">
                <strong>Pulse Supporter benefits</strong>
                <small>Personal finishes and private recognition. Core Pulse tools stay free.</small>
              </span>
              <span className="pulse-settings-supporter-banner-arrow">View benefits <span aria-hidden="true">→</span></span>
            </button>
          ) : null}
          {typeof children === 'function' ? children(activeSection) : children}
          <footer className="pulse-host-footer">
            <span>StreamPulse extension settings</span>
            <a href={POLICY_LINKS.support} target="_blank" rel="noopener noreferrer">Support</a>
            <a href={POLICY_LINKS.privacy} target="_blank" rel="noopener noreferrer">Privacy</a>
            <a href={POLICY_LINKS.terms} target="_blank" rel="noopener noreferrer">Terms</a>
          </footer>
        </div>
      </div>
    </div>
  )
}

export const DEFAULT_NAV: ReadonlyArray<HostNavItem> = [
  { id: 'moments', label: 'My Moments' },
  { id: 'pulse', label: 'Pulse on Twitch' },
  { id: 'supporter', label: 'Account & Supporter' },
  { id: 'privacy', label: 'Privacy & Data' },
  { id: 'updates', label: 'Updates & Changelog' },
]
