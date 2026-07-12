import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { startScrollScene } from '../scrollScene.ts'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

export function canAnimateScrollTour(): boolean {
  if (prefersReducedMotion()) return false
  if (typeof window === 'undefined') return false
  if (typeof IntersectionObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') {
    return false
  }
  if (typeof window.matchMedia === 'function' && !window.matchMedia('(min-width: 961px)').matches) {
    return false
  }
  return true
}

export interface ScrollPinnedTourProps {
  className?: string
  sceneClassName?: string
  activeStep?: number
  ariaLabelledBy?: string
  onProgress?: (smoothed: number, raw: number) => void
  children: ReactNode
}

export const ScrollPinnedTour = forwardRef<HTMLDivElement, ScrollPinnedTourProps>(
  function ScrollPinnedTour(
    {
      className = 'sl-xtour',
      sceneClassName = 'sl-xtour__scene',
      activeStep = 1,
      ariaLabelledBy = 'demo-title',
      onProgress,
      children,
    },
    ref,
  ) {
    const sceneRef = useRef<HTMLDivElement | null>(null)
    const stickyRef = useRef<HTMLDivElement | null>(null)
    const [animate, setAnimate] = useState(false)

    useEffect(() => {
      if (!canAnimateScrollTour()) return
      setAnimate(true)
    }, [])

    useEffect(() => {
      if (!animate || !onProgress) return
      const scene = sceneRef.current
      if (!scene) return

      const stop = startScrollScene({
        scene,
        sticky: stickyRef.current,
        onProgress,
      })

      return stop
    }, [animate, onProgress])

    return (
      <div
        ref={ref}
        className={className}
        role="region"
        aria-labelledby={ariaLabelledBy}
        data-step={String(activeStep)}
        {...(animate ? {} : { 'data-static': '' })}
      >
        <div className={sceneClassName} ref={sceneRef}>
          <div className="sl-xtour__sticky" ref={stickyRef}>
            {children}
          </div>
        </div>
      </div>
    )
  },
)
