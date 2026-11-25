import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { requestDemoPlay } from './demoPlayEvent'

/** The cue stays until the page has scrolled at least this far... */
const GONE_AFTER_PX = 48
/** ...and its foot has risen above this share of the screen, where the demo is coming into view. */
const RISEN_TO = 0.6

/**
 * Under the hero (board extension-brainchat 11-22, ★ A1): a label over a round arrow that takes the visitor to the
 * demo beside Twitch chat and starts it from the top. A plain link to #demo without JavaScript.
 */
export function LandingScrollCue({ target = 'demo' }: { target?: string }) {
  const [gone, setGone] = useState(false)
  const link = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    const el = link.current
    if (!el) return undefined
    // It fades by where it is, not by how far the page scrolled: on a short screen it starts below the fold and stays
    // until the visitor has scrolled to it and past. It never fades while it has the keyboard's focus.
    const update = () => {
      const focused = document.activeElement === el
      const risen = el.getBoundingClientRect().bottom < window.innerHeight * RISEN_TO
      setGone(!focused && window.scrollY > GONE_AFTER_PX && risen)
    }
    update()
    window.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    el.addEventListener('focus', update)
    el.addEventListener('blur', update)
    return () => {
      window.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      el.removeEventListener('focus', update)
      el.removeEventListener('blur', update)
    }
  }, [])

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const section = document.getElementById(target)
    if (!section || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    section.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    section.focus({ preventScroll: true })
    requestDemoPlay()
  }

  return (
    <a ref={link} className="sl-cue" href={`#${target}`} data-gone={gone ? '' : undefined} onClick={onClick}>
      <span className="sl-cue__label">See the extension beside Twitch chat</span>
      <span className="sl-cue__btn" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 4v15" />
          <path d="m5 12 7 7 7-7" />
        </svg>
      </span>
    </a>
  )
}
