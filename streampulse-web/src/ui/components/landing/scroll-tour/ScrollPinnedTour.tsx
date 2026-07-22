import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react'
import { startScrollScene } from '../scrollScene.ts'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Same gate as LiveSignalScrollGraph — reduced-motion / missing APIs only (no width gate). */
export function canAnimateScrollTour(): boolean {
  if (typeof window === 'undefined') return false
  if (prefersReducedMotion()) return false
  if (typeof IntersectionObserver === 'undefined' || typeof requestAnimationFrame === 'undefined') {
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
  /** Notified when animated vs static mode changes (keeps ExtensionShowcase in sync). */
  onAnimateChange?: (animate: boolean) => void
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
      onAnimateChange,
      children,
    },
    ref,
  ) {
    const sceneRef = useRef<HTMLDivElement | null>(null)
    const stickyRef = useRef<HTMLDivElement | null>(null)
    const [animate, setAnimate] = useState(false)

    useEffect(() => {
      const apply = () => {
        const next = canAnimateScrollTour()
        setAnimate(next)
        onAnimateChange?.(next)
      }

      apply()

      if (typeof window.matchMedia !== 'function') return
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
      const onChange = () => apply()
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onChange)
        return () => mq.removeEventListener('change', onChange)
      }
      mq.addListener(onChange)
      return () => mq.removeListener(onChange)
    }, [onAnimateChange])

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
