import { useCallback, useEffect, useRef, type ElementType, type ReactNode } from 'react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { buildDirectionalX } from '../../lib/liveWire'
import { useAnalyticsThemeOptional } from '../providers/AnalyticsThemeProvider'

let flipRegistered = false
function ensureFlipPlugin(): void {
  if (!flipRegistered) {
    gsap.registerPlugin(Flip)
    flipRegistered = true
  }
}

export function useAnalyticsMotion() {
  const ctx = useAnalyticsThemeOptional()
  const motionEnabled = ctx?.motionEnabled ?? true

  const revealSection = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !motionEnabled) return
      gsap.fromTo(
        el,
        { opacity: 0, y: 12 },
        { opacity: 1, y: 0, duration: 0.35, ease: 'power3.out' },
      )
    },
    [motionEnabled],
  )

  const revealStagger = useCallback(
    (els: HTMLElement[]) => {
      if (!motionEnabled || els.length === 0) return
      gsap.fromTo(
        els,
        { opacity: 0, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          stagger: 0.04,
          ease: 'power3.out',
        },
      )
    },
    [motionEnabled],
  )

  const transitionInspector = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !motionEnabled) return
      gsap.fromTo(
        el,
        { opacity: 0.6, scale: 0.98 },
        { opacity: 1, scale: 1, duration: 0.25, ease: 'power2.out' },
      )
    },
    [motionEnabled],
  )

  const fadeThemeCenter = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !motionEnabled) return
      gsap.fromTo(el, { opacity: 0.85 }, { opacity: 1, duration: 0.15, ease: 'none' })
    },
    [motionEnabled],
  )

  const flipFrom = useCallback(
    (state: Flip.FlipState | null | undefined) => {
      if (!state || !motionEnabled) return
      ensureFlipPlugin()
      return Flip.from(state, { duration: 0.45, ease: 'power3.out' })
    },
    [motionEnabled],
  )

  const captureFlipState = useCallback(
    (container: HTMLElement | null): Flip.FlipState | null => {
      if (!container || !motionEnabled) return null
      ensureFlipPlugin()
      return Flip.getState(container.querySelectorAll('[data-flip-key]'))
    },
    [motionEnabled],
  )

  const animateBarWidth = useCallback(
    (el: HTMLElement | null, widthPct: number) => {
      if (!el || !motionEnabled) return
      gsap.to(el, { width: `${widthPct}%`, duration: 0.5, ease: 'power2.out' })
    },
    [motionEnabled],
  )

  const animateEnter = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !motionEnabled) return
      gsap.from(el, { height: 0, opacity: 0, y: -8, duration: 0.4, ease: 'power3.out' })
    },
    [motionEnabled],
  )

  const animateEnterHorizontal = useCallback(
    (el: HTMLElement | null, opts?: { from?: 'left' | 'right' }) => {
      if (!el || !motionEnabled) return
      gsap.from(el, { x: buildDirectionalX(opts?.from), opacity: 0, duration: 0.35, ease: 'power3.out' })
    },
    [motionEnabled],
  )

  return {
    revealSection,
    revealStagger,
    transitionInspector,
    fadeThemeCenter,
    flipFrom,
    captureFlipState,
    animateBarWidth,
    animateEnter,
    animateEnterHorizontal,
    motionEnabled,
  }
}

export interface SectionRevealProps {
  children: ReactNode
  className?: string
  as?: ElementType
  id?: string
}

export function SectionReveal({ children, className = '', as = 'div', id }: SectionRevealProps) {
  const ref = useRef<HTMLElement>(null)
  const hasRevealed = useRef(false)
  const { revealSection, motionEnabled } = useAnalyticsMotion()
  const Tag = as

  useEffect(() => {
    if (hasRevealed.current) return
    const el = ref.current
    if (!el) return

    if (!motionEnabled) {
      hasRevealed.current = true
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry?.isIntersecting || hasRevealed.current) return
        hasRevealed.current = true
        revealSection(el)
        observer.disconnect()
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.05 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [revealSection, motionEnabled])

  return (
    <Tag
      ref={ref as never}
      id={id}
      className={`section-reveal${className ? ` ${className}` : ''}`}
    >
      {children}
    </Tag>
  )
}
