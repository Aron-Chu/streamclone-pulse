import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * One matchMedia subscription for the whole console.
 *
 * Every StatCard, moment list, and chart used to mount its own listener plus
 * its own piece of state, so a page with six stat cards carried six identical
 * subscriptions and re-rendered six components on a preference change. The
 * store below is shared; components just read from it.
 *
 * Note this gate is *not* how reduced motion is honoured — the motion CSS does
 * that via its own `@media (prefers-reduced-motion: reduce)` block. This exists
 * for the cases CSS cannot express: skipping JS-driven work (rAF loops, timers,
 * `scrollIntoView({ behavior: 'smooth' })`) that would otherwise run and then be
 * thrown away.
 */
let mediaQuery: MediaQueryList | null = null

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  if (!mediaQuery) mediaQuery = window.matchMedia(QUERY)
  return mediaQuery
}

function subscribe(onChange: () => void): () => void {
  const mq = query()
  if (!mq) return () => {}
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return query()?.matches ?? false
}

/** Server render has no media query; assume motion is allowed. */
function getServerSnapshot(): boolean {
  return false
}

/** Console motion gate — respects the OS reduced-motion preference. */
export function useConsoleMotion(): { motionEnabled: boolean } {
  const reduced = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return { motionEnabled: !reduced }
}
