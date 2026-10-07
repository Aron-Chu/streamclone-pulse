/**
 * Scroll handling for in-app navigation. The portal uses a declarative
 * BrowserRouter, which has no <ScrollRestoration>, so without this a pushed
 * route keeps the previous page's offset and a `#section` link never lands:
 * the browser looks for the fragment before React has rendered it.
 */

/** A lazy route chunk plus its first render, when no page holds the landing. */
const WAIT_MS = 15_000
/** A page holding the landing for its first read, which can be a slow read followed by a recovery read. */
const HELD_WAIT_MS = 35_000
/** A background tab runs no frames; one frame never counts for more than this. */
const MAX_FRAME_MS = 1_000
/** Keep the target aligned briefly while fonts and late rows settle above it. */
const SETTLE_FRAMES = 60
/** Wider than the 12 px section reveal, so motion is not mistaken for a layout shift. */
const DRIFT_PX = 16
/** Reader input ends any pending landing: never pull the page away from them. */
const STOP_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

const holds = new Set<symbol>()

/**
 * How a navigation treats the reader's place, sent as its location state. A
 * pushed page opens at the top unless it keeps the reader's context on screen
 * (`keep`); a replaced page keeps the reader's place unless it is another page
 * the reader did not choose (`top`).
 */
export type RouteScrollIntent = 'top' | 'keep'

export function routeScrollState(intent: RouteScrollIntent): { routeScroll: RouteScrollIntent } {
  return { routeScroll: intent }
}

export function routeScrollIntent(state: unknown): RouteScrollIntent | null {
  const intent = (state as { routeScroll?: unknown } | null | undefined)?.routeScroll
  return intent === 'top' || intent === 'keep' ? intent : null
}

/**
 * The element id a location hash names, or null. Deep-link fragments such as
 * `#t=120` and malformed percent-encoding are not anchors.
 */
export function hashTargetId(hash: string): string | null {
  if (hash.length < 2) return null
  let id: string
  try {
    id = decodeURIComponent(hash.slice(1))
  } catch {
    return null
  }
  return /^[A-Za-z][\w:.-]*$/.test(id) ? id : null
}

/**
 * Defer hash landing while a page is still rendering its sections; returns the
 * release. Landing on a loading skeleton would leave the target far from where
 * it ends up once real content above it has its height.
 */
export function holdHashScroll(): () => void {
  const hold = Symbol('hash-scroll-hold')
  holds.add(hold)
  return () => {
    holds.delete(hold)
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The closed <details> elements that hide the target. */
function closedDetails(target: HTMLElement): HTMLDetailsElement[] {
  const closed: HTMLDetailsElement[] = []
  for (let node = target.parentElement; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement && !node.open) closed.push(node)
  }
  return closed
}

/** Whether the target has moved off its place: `top`, or else its scroll margin. */
function drifted(target: HTMLElement, top?: number): boolean {
  const place = top ?? (Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0)
  const offset = target.getBoundingClientRect().top - place
  // A target near either end of the page cannot reach its place; that is not drift.
  const atEnd = window.scrollY >= document.documentElement.scrollHeight - window.innerHeight - 1
  return Math.abs(offset) > DRIFT_PX && !(offset > 0 && atEnd) && !(offset < 0 && window.scrollY <= 0)
}

/**
 * Scroll the element with `id` into view once it exists and no page holds the
 * landing, then keep it aligned for a short settle window. `scrollIntoView`
 * honours each target's CSS `scroll-margin-top` under the sticky headers. With
 * `top`, the target instead returns to that viewport offset, where the reader
 * left it, and only moves if it is not already there. Returns a cancel function.
 */
export function scrollToHashTarget(id: string, { smooth = false, top }: { smooth?: boolean; top?: number } = {}): () => void {
  let frame = 0
  let waited = 0
  let last = performance.now()
  let settled = 0
  let landed = false
  let stopped = false
  const stop = () => {
    stopped = true
    cancelAnimationFrame(frame)
    for (const type of STOP_EVENTS) window.removeEventListener(type, stop)
  }
  const align = (target: HTMLElement) => {
    if (top === undefined) target.scrollIntoView({ block: 'start' })
    else window.scrollTo(0, window.scrollY + target.getBoundingClientRect().top - top)
  }
  const step = (now = performance.now()) => {
    if (stopped) return
    // Wall-clock time, so the wait does not shrink on a 120 Hz screen, but a
    // link opened in a background tab still lands once the reader shows it.
    waited += Math.min(Math.max(now - last, 0), MAX_FRAME_MS)
    last = now
    const held = holds.size > 0
    const target = held ? null : document.getElementById(id)
    if (!target) {
      if (waited >= (held ? HELD_WAIT_MS : WAIT_MS)) return stop()
    } else if (!landed) {
      landed = true
      if (top !== undefined) {
        // Back returns the reader to a place; it does not open a <details> they
        // left closed, and a target that one hides has no place to return to.
        if (closedDetails(target).length > 0) return stop()
        if (drifted(target, top)) align(target)
      } else {
        // Match native fragment navigation, which expands a closed <details> to show its target.
        for (const details of closedDetails(target)) details.open = true
        target.scrollIntoView({ block: 'start', behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' })
        // An animated in-page jump is already final; correcting it would fight the animation.
        if (smooth) return stop()
      }
    } else {
      if (drifted(target, top)) align(target)
      if (++settled >= SETTLE_FRAMES) return stop()
    }
    frame = requestAnimationFrame(step)
  }
  for (const type of STOP_EVENTS) window.addEventListener(type, stop, { passive: true })
  // A microtask, not a frame: every layout effect of the committing render has
  // registered its hold by then, and an already rendered target lands before paint.
  queueMicrotask(() => step())
  return stop
}
