const STOP_EVENTS = ['wheel', 'touchstart', 'keydown'] as const
let active: (() => void) | null = null

/** Browser scroll anchoring would fight a managed adjustment; pause it meanwhile. */
function pauseScrollAnchoring(): () => void {
  const root = document.documentElement
  const previous = root.style.overflowAnchor
  root.style.overflowAnchor = 'none'
  return () => { root.style.overflowAnchor = previous }
}

/**
 * Hold one element at its current place on screen while content around it opens
 * or collapses: each frame, scroll the page by however far the element drifted.
 * Call it before the change, from the event that causes it. The reader's own
 * scrolling (wheel, touch, keys) ends the hold at once; a newer hold replaces it.
 */
export function keepInPlace(element: Element | null | undefined, durationMs = 600): () => void {
  active?.()
  if (!element || typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return () => {}
  const start = element.getBoundingClientRect().top
  const resume = pauseScrollAnchoring()
  const until = performance.now() + durationMs
  let frame = 0
  const stop = () => {
    cancelAnimationFrame(frame)
    resume()
    for (const type of STOP_EVENTS) window.removeEventListener(type, stop)
    if (active === stop) active = null
  }
  const step = () => {
    if (!element.isConnected) return stop()
    const drift = element.getBoundingClientRect().top - start
    if (Math.abs(drift) > 0.5) window.scrollBy(0, drift)
    if (performance.now() < until) frame = requestAnimationFrame(step)
    else stop()
  }
  for (const type of STOP_EVENTS) window.addEventListener(type, stop, { passive: true })
  frame = requestAnimationFrame(step)
  active = stop
  return stop
}

/**
 * One immediate correction, for a change that has already been committed but not
 * yet painted (call it from a layout effect): scroll so `element`'s top returns to
 * `top`, the viewport position it should keep.
 */
export function alignTop(element: Element | null | undefined, top: number): void {
  if (!element || typeof window === 'undefined') return
  active?.()
  const resume = pauseScrollAnchoring()
  const drift = element.getBoundingClientRect().top - top
  if (Math.abs(drift) > 0.5) window.scrollBy(0, drift)
  requestAnimationFrame(resume)
}
