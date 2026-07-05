/**
 * Shared scroll-scene engine for the landing page's pinned, scroll-driven
 * sections (extension tour + live signal replay), so both feel identical.
 *
 * - Pins the sticky stage with an exact GPU transform that tracks scroll 1:1
 *   (easing the pin would make the stage rubber-band against the page).
 * - Exposes a *smoothed* progress value: wheel/trackpad scrolling arrives in
 *   discrete steps, so applying raw progress makes reveal animations look
 *   steppy. Each animation frame eases the applied progress toward the raw
 *   target (exponential smoothing), and the loop keeps running until it
 *   converges — short inertial settle, zero work at idle.
 *
 * SSR/reduced-motion: callers only start the engine in animated mode; the
 * static fallback stays pure CSS (`data-static`).
 */

export interface ScrollSceneOptions {
  /** Tall element that defines the scroll distance. */
  scene: HTMLElement
  /** Stage to pin while the scene scrolls past (transform-pinned). */
  sticky?: HTMLElement | null
  /** Called once per animation frame with smoothed progress 0–1. */
  onProgress: (p: number) => void
  /**
   * Easing rate in 1/s — how fast applied progress chases the scroll target.
   * Higher = snappier, lower = floatier. ~14 settles in roughly a quarter second.
   */
  stiffness?: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Starts the engine; returns a cleanup function. */
export function startScrollScene({ scene, sticky, onProgress, stiffness = 14 }: ScrollSceneOptions): () => void {
  let raf = 0
  let current = -1 // -1 = snap to target on the first frame (no load-in swoosh)
  let lastTime = 0

  const frame = (time: number) => {
    raf = 0
    const vh = window.innerHeight || 1
    const rect = scene.getBoundingClientRect()
    const scrollable = scene.offsetHeight - vh
    const target = scrollable > 0 ? clamp01(-rect.top / scrollable) : 0

    if (sticky) {
      const pin = Math.min(Math.max(-rect.top, 0), Math.max(scrollable, 0))
      sticky.style.transform = `translate3d(0, ${pin}px, 0)`
    }

    const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 1 / 60
    lastTime = time
    if (current < 0) {
      current = target
    } else {
      current += (target - current) * (1 - Math.exp(-stiffness * dt))
      if (Math.abs(target - current) < 0.0006) current = target
    }
    onProgress(current)

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
