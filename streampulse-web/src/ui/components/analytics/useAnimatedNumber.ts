import { useEffect, useRef, useState } from 'react'

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/**
 * Event-driven numeric display: count-up on first paint, tween only when the
 * target changes. Instant swap when reduced motion is preferred.
 */
export function useAnimatedNumber(target: number, durationMs = 520): number {
  const [display, setDisplay] = useState(target)
  const displayRef = useRef(target)
  const firstRef = useRef(true)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (!Number.isFinite(target)) {
      setDisplay(0)
      displayRef.current = 0
      return
    }

    if (prefersReducedMotion()) {
      setDisplay(target)
      displayRef.current = target
      firstRef.current = false
      return
    }

    const from = firstRef.current ? 0 : displayRef.current
    firstRef.current = false
    if (from === target) {
      setDisplay(target)
      displayRef.current = target
      return
    }

    const start = performance.now()
    const delta = target - from

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const value = from + delta * easeOutCubic(t)
      displayRef.current = value
      setDisplay(value)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        displayRef.current = target
        setDisplay(target)
        rafRef.current = null
      }
    }

    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, durationMs])

  return display
}
