import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { PageErrorBoundary } from '../../ui/PortalErrorBoundary'

export default function DashboardShell() {
  // Same disclosure as PublicLayout: at <=960 px the links collapse behind Menu.
  const [menuOpen, setMenuOpen] = useState(false)
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
      <header className="app-nav">
        <NavLink to="/dashboard" className="app-nav__brand">
          StreamPulse Dashboard
        </NavLink>
        <button ref={menuTrigger} type="button" className="app-nav__menu" aria-expanded={menuOpen}
          aria-controls="dashboard-navigation" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? 'Close menu' : 'Menu'}
        </button>
        <nav id="dashboard-navigation" className={`app-nav__links${menuOpen ? ' is-open' : ''}`}
          aria-label="Main Navigation" onClick={(event) => {
            // The shell stays mounted between dashboard pages, so a link hidden by
            // the closing menu would otherwise strand keyboard focus on the body.
            if (menuOpen && (event.target as HTMLElement).closest('a')) {
              setMenuOpen(false)
              menuTrigger.current?.focus()
            }
          }}>
          <NavLink to="/dashboard" end>
            Home
          </NavLink>
          <NavLink to="/dashboard/clips">Clips</NavLink>
          <NavLink to="/analytics">Analytics</NavLink>
        </nav>
      </header>
      <main className="app-main">
        <p className="muted" role="note">
          Operator tools: a saved beta key only opens this interface; the server checks access for each request.
          The key is stored in this browser’s local storage and can be read by scripts on this origin. Use only a trusted browser.
        </p>
        <PageErrorBoundary>
          <Outlet />
        </PageErrorBoundary>
      </main>
    </div>
  )
}
