/**
 * The top bar's "Search a streamer" button and its search window (R5-14,
 * mockup hub.js / hub-r5d.css; board session-who-r1 "Dock it"). A 340 px field
 * centred in the bar from 1360 px, an icon below that. On the hub it docks
 * once the hero field scrolls under the bar; on pages without a hero it is
 * always there. It, / and Ctrl/⌘K open the hub's search in a centred window
 * over the page; closing it leaves the page where it was.
 * Styles: figma-analytics.css (.analytics-find), hub-v5.css (the search).
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Search } from 'lucide-react'
import { IS_MAC, isFindShortcut, useAnalyticsFind } from './analyticsFindContext'

const AnalyticsFindWindow = lazy(() => import('./AnalyticsFindWindow'))

export function AnalyticsFind() {
  const hero = useAnalyticsFind()?.hero ?? null
  const docked = !hero || !hero.inView
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { pathname } = useLocation()

  useEffect(() => setMounted(true), [])
  useEffect(() => setOpen(false), [pathname])

  // Window-level, after the page's own handlers: a page that takes / for its own search (Moments) wins.
  useEffect(() => {
    if (!docked) return
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isFindShortcut(event)) return
      event.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
      inputRef.current?.focus()
      inputRef.current?.select()
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open, mounted])

  return (
    <>
      <button
        type="button"
        className="analytics-find"
        data-docked={docked ? 'true' : 'false'}
        aria-label="Search a Twitch channel"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Search size={16} aria-hidden="true" />
        <span className="analytics-find__l">Search a streamer</span>
        <span className="analytics-find__kbd" aria-hidden="true">{IS_MAC ? '⌘K' : 'Ctrl K'}</span>
      </button>
      {mounted ? createPortal(
        <dialog
          ref={dialogRef}
          className="hv5-layer hub-d3-layer analytics-find-pal"
          aria-label="Search a Twitch channel"
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          {open ? (
            <Suspense fallback={null}>
              <AnalyticsFindWindow heroLive={hero?.live} inputRef={inputRef} onNavigate={() => setOpen(false)} />
            </Suspense>
          ) : null}
        </dialog>,
        document.body,
      ) : null}
    </>
  )
}
