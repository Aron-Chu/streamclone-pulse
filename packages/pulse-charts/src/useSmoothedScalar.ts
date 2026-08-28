import { useEffect, useRef, useState } from 'react'

const SNAP_EPSILON = 0.25
const DEFAULT_SETTLE_MS = 180

export type ScalarMotionOptions = {
  /** Approximate time to settle without overshoot. */
  settleMs?: number
  /** Absolute distance at which the value snaps to its target. */
  snapEpsilon?: number
}

/** Exponential ease step toward `target` (0 < alpha <= 1). */
export function lerpScalar(current: number, target: number, alpha: number): number {
  return current + (target - current) * alpha
}

/**
 * RAF-smoothed scalar for chart crosshairs and band layout.
 * Snaps instantly when `enabled` is false.
 */
export function useSmoothedScalar(
  target: number,
  enabled = true,
  options: ScalarMotionOptions = {},
): number {
  const [display, setDisplay] = useState(target)
  const displayRef = useRef(target)
  const targetRef = useRef(target)
  const rafRef = useRef<number | null>(null)
  const frameTimeRef = useRef<number | null>(null)

  targetRef.current = target

  const settleMs = Math.max(1, options.settleMs ?? DEFAULT_SETTLE_MS)
  const snapEpsilon = Math.max(0.001, options.snapEpsilon ?? SNAP_EPSILON)

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      frameTimeRef.current = null
      displayRef.current = target
      setDisplay(target)
      return
    }

    const step = (now: number) => {
      const t = targetRef.current
      const c = displayRef.current
      const previousFrame = frameTimeRef.current ?? now - 16
      const deltaMs = Math.min(64, Math.max(1, now - previousFrame))
      frameTimeRef.current = now
      if (Math.abs(c - t) < snapEpsilon) {
        displayRef.current = t
        setDisplay(t)
        rafRef.current = null
        frameTimeRef.current = null
        return
      }
      // Frame-rate independent exponential settling. Unlike a per-render
      // restart, this keeps following a live playhead while preserving a
      // short, damped click/seek response with no overshoot.
      const alpha = 1 - Math.exp(-deltaMs / settleMs)
      const next = lerpScalar(c, t, alpha)
      displayRef.current = next
      setDisplay(next)
      rafRef.current = requestAnimationFrame(step)
    }

    if (Math.abs(displayRef.current - targetRef.current) < snapEpsilon) {
      displayRef.current = target
      setDisplay(target)
      return
    }

    if (rafRef.current == null) {
      frameTimeRef.current = null
      rafRef.current = requestAnimationFrame(step)
    }

    // A target update should not cancel and restart the loop. The explicit
    // unmount cleanup below owns cancellation for the component lifetime.
  }, [enabled, settleMs, snapEpsilon, target])

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    frameTimeRef.current = null
  }, [])

  return enabled ? display : target
}
