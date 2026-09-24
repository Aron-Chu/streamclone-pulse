/**
 * Shared scroll-scene engine for the landing page's pinned, scroll-driven
 * sections (extension tour + live signal replay), so both feel identical.
 *
 * The pin itself is `position: sticky` in CSS — the compositor keeps it exactly
 * in step with scroll, which a JS-written transform cannot (it lands a frame
 * late and the stage visibly drifts on fast wheel/trackpad scrolling).
 *
 * This engine only reports progress, and reports it *smoothed*: wheel/trackpad
 * scrolling arrives in discrete steps, so applying raw progress makes reveal
 * animations look steppy. Each animation frame eases the applied progress
 * toward the raw target (exponential smoothing), and the loop keeps running
 * until it converges — short inertial settle, zero work at idle.
 *
 * SSR/reduced-motion: callers only start the engine in animated mode; the
 * static fallback stays pure CSS (`data-static`).
 */

export interface ScrollSceneOptions {
  /** Tall element that defines the scroll distance. */
  scene: HTMLElement
  /** Called each animation frame with smoothed progress (reveals) and raw scroll progress (position). */
  onProgress: (smoothed: number, raw: number) => void
  /**
   * Easing rate in 1/s — how fast applied progress chases the scroll target.
   * Higher = snappier, lower = floatier. ~14 settles in roughly a quarter second.
   */
  stiffness?: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Starts the engine; returns a cleanup function. */
export function startScrollScene({ scene, onProgress, stiffness = 14 }: ScrollSceneOptions): () => void {
  let raf = 0
  let current = -1 // -1 = snap to target on the first frame (no load-in swoosh)
  let lastTime = 0

  const frame = (time: number) => {
    raf = 0
    const vh = window.innerHeight || 1
    const rect = scene.getBoundingClientRect()
    const scrollable = scene.offsetHeight - vh
    const target = scrollable > 0 ? clamp01(-rect.top / scrollable) : 0

    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 1 / 60
    lastTime = time
    if (current < 0) {
      current = target
    } else {
      current += (target - current) * (1 - Math.exp(-stiffness * dt))
      if (Math.abs(target - current) < 0.0006) current = target
    }
    onProgress(current, target)

    if (current !== target) {
      schedule()
    } else {
      lastTime = 0 // loop idles; restart dt cleanly on the next scroll
    }
  }

  const schedule = () => {
    if (!raf) raf = window.requestAnimationFrame(frame)
  }

  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule, { passive: true })
  schedule()

  return () => {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    if (raf) window.cancelAnimationFrame(raf)
  }
}
