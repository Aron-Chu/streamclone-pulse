import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { buttonClass } from '../../primitives'

type LandingMobileNavProps = {
  analyticsHref?: string
  docsHref?: string
}

/**
 * Landing-only mobile drawer. Not shared with analytics section nav —
 * focus/dismissal needs differ (route links vs in-page section jumps).
 */
export function LandingMobileNav({
  analyticsHref = '/analytics',
  docsHref = '/docs',
}: LandingMobileNavProps) {
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const openerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const panel = panelRef.current
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusables = panel?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled])',
    )
    focusables?.[0]?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
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
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      ;(previouslyFocused ?? openerRef.current)?.focus()
    }
  }, [open])

  return (
    <div className="sl-mobile-nav">
      <button
        ref={openerRef}
        type="button"
        className="sl-mobile-nav__toggle"
        aria-expanded={open}
        aria-controls="landing-mobile-nav-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
        <span className="sl-mobile-nav__toggle-label">{open ? 'Close' : 'Menu'}</span>
      </button>

      {open ? (
        <div className="sl-mobile-nav__layer">
          <button
            type="button"
            className="sl-mobile-nav__backdrop"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            id="landing-mobile-nav-panel"
            className="sl-mobile-nav__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <p id={titleId} className="sl-mobile-nav__title">
              StreamPulse
            </p>
            <nav className="sl-mobile-nav__links" aria-label="Mobile">
              <a href="#demo" onClick={() => setOpen(false)}>
                Pulse tab
              </a>
              <a href="#analysis" onClick={() => setOpen(false)}>
                Signals
              </a>
              <a href="#roadmap" onClick={() => setOpen(false)}>
                Roadmap
              </a>
              <Link to={docsHref} onClick={() => setOpen(false)}>
                Docs
              </Link>
              <Link
                to={analyticsHref}
                className={buttonClass('default', 'sm')}
                onClick={() => setOpen(false)}
              >
                Open Analytics
              </Link>
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  )
}
