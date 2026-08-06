import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export const CHART_EXPANSION_MS = 180

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function readReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  return reduced
}

export interface ChartExpansionHeights {
  collapsed: number
  expanded: number
}

export interface ChartExpansionOptions {
  identity: string
  heights: ChartExpansionHeights
  reducedMotion?: boolean
}

export interface ChartExpansionFrame {
  height: number
  progress: number
}

export function interpolateChartExpansionFrame(
  from: ChartExpansionFrame,
  to: ChartExpansionFrame,
  elapsedMs: number,
  reducedMotion = false,
): ChartExpansionFrame {
  if (reducedMotion) return to
  const progress = Math.min(1, Math.max(0, elapsedMs / CHART_EXPANSION_MS))
  const eased = 1 - (1 - progress) ** 3
  return {
    height: progress >= 1 ? to.height : from.height + (to.height - from.height) * eased,
    progress: progress >= 1 ? to.progress : from.progress + (to.progress - from.progress) * eased,
  }
}

export interface ChartExpansionState {
  expanded: boolean
  height: number
  progress: number
  expand: () => void
  reset: () => void
}

export function useChartExpansion({
  identity,
  heights,
  reducedMotion: reducedMotionOverride,
}: ChartExpansionOptions): ChartExpansionState {
  const systemReducedMotion = usePrefersReducedMotion()
  const reducedMotion = reducedMotionOverride ?? systemReducedMotion
  const [expanded, setExpanded] = useState(false)
  const [height, setHeight] = useState(heights.collapsed)
  const [progress, setProgress] = useState(0)
  const identityRef = useRef(identity)
  const heightRef = useRef(heights.collapsed)
  const progressRef = useRef(0)
  const expandedRef = useRef(false)
  const frameRef = useRef<number | null>(null)

  const cancel = () => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }

  const settle = (nextExpanded: boolean) => {
    cancel()
    expandedRef.current = nextExpanded
    setExpanded(nextExpanded)
    const target = nextExpanded ? heights.expanded : heights.collapsed
    const targetFrame = { height: target, progress: nextExpanded ? 1 : 0 }
    if (
      reducedMotion
      || (heightRef.current === targetFrame.height && progressRef.current === targetFrame.progress)
    ) {
      heightRef.current = targetFrame.height
      progressRef.current = targetFrame.progress
      setHeight(targetFrame.height)
      setProgress(targetFrame.progress)
      return
    }
    const from = { height: heightRef.current, progress: progressRef.current }
    const startedAt = performance.now()
    const tick = (now: number) => {
      const next = interpolateChartExpansionFrame(from, targetFrame, now - startedAt)
      heightRef.current = next.height
      progressRef.current = next.progress
      setHeight(next.height)
      setProgress(next.progress)
      if (now - startedAt < CHART_EXPANSION_MS) {
        frameRef.current = requestAnimationFrame(tick)
      } else {
        frameRef.current = null
      }
    }
    frameRef.current = requestAnimationFrame(tick)
  }

  // Reset state during render so a new stream/VOD cannot commit the previous
  // identity's expanded frame before the effect that cancels its RAF runs.
  const identityChanged = identityRef.current !== identity
  if (identityChanged) {
    identityRef.current = identity
    expandedRef.current = false
    heightRef.current = heights.collapsed
    progressRef.current = 0
    setExpanded(false)
    setHeight(heights.collapsed)
    setProgress(0)
  }

  useIsomorphicLayoutEffect(() => {
    cancel()
  }, [identity])

  useEffect(() => {
    if (reducedMotion) {
      cancel()
      const target = expandedRef.current ? heights.expanded : heights.collapsed
      heightRef.current = target
      progressRef.current = expandedRef.current ? 1 : 0
      setHeight(target)
      setProgress(progressRef.current)
      return
    }
    const target = expandedRef.current ? heights.expanded : heights.collapsed
    const targetProgress = expandedRef.current ? 1 : 0
    if (heightRef.current !== target || progressRef.current !== targetProgress) {
      settle(expandedRef.current)
    }
  }, [heights.collapsed, heights.expanded, reducedMotion])

  useEffect(() => () => cancel(), [])

  return {
    expanded: identityChanged ? false : expanded,
    height: identityChanged ? heights.collapsed : height,
    progress: identityChanged ? 0 : progress,
    expand: () => settle(true),
    reset: () => settle(false),
  }
}
