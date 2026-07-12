import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { TourPanelScrollState } from './types.ts'

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

const SCROLL_ROOT_SELECTOR = '.pulse-landing-scroll, .sl-ext__scroll'

export interface UseTourPanelScrollOptions {
  enabled: boolean
  scrollportRef: RefObject<HTMLElement | null>
  stepCount: number
  onStateChange: (state: TourPanelScrollState) => void
}

/**
 * Old demo scroll model: one smoothed drive value maps linearly across the full
 * panel height (virtualScroll = drive * maxScroll). Same fluid feel as the
 * committed ExtensionDemoCard tour — no per-step offset snapping.
 */
export function useTourPanelScroll({
  enabled,
  scrollportRef,
  stepCount,
  onStateChange,
}: UseTourPanelScrollOptions) {
  const scrollRef = useRef<HTMLElement | null>(null)
  const cardsRef = useRef<HTMLElement[]>([])
  const playingRef = useRef(false)
  const onStateChangeRef = useRef(onStateChange)
  onStateChangeRef.current = onStateChange

  const ensureBound = useCallback((): boolean => {
    const port = scrollportRef.current
    if (!port) return false

    const scroll = port.querySelector<HTMLElement>(SCROLL_ROOT_SELECTOR)
    if (!scroll) return false

    scrollRef.current = scroll
    cardsRef.current = Array.from(scroll.querySelectorAll<HTMLElement>('[data-tour-step]')).slice(
      0,
      stepCount,
    )
    return cardsRef.current.length > 0
  }, [scrollportRef, stepCount])

  const setPlaying = useCallback(
    (on: boolean) => {
      const port = scrollportRef.current
      const scroll = scrollRef.current
      if (!port || !scroll) return

      if (on && !playingRef.current) {
        scroll.classList.add('is-playing')
        port.classList.add('is-playing')
        playingRef.current = true
      } else if (!on && playingRef.current) {
        scroll.classList.remove('is-playing')
        port.classList.remove('is-playing')
        scroll.style.removeProperty('--panel-y')
        scroll.style.transform = ''
        playingRef.current = false
      }
    },
    [scrollportRef],
  )

  const applyProgress = useCallback(
    (smoothed: number, _raw: number) => {
      if (!ensureBound()) return

      const port = scrollportRef.current
      const scroll = scrollRef.current
      const cards = cardsRef.current
      if (!port || !scroll || cards.length === 0) return

      setPlaying(true)

      const portH = port.clientHeight
      const maxScroll = Math.max(0, scroll.scrollHeight - portH)
      const drive = clamp01((smoothed - 0.04) / 0.88)
      const virtualScroll = drive * maxScroll

      scroll.style.setProperty('--panel-y', String(virtualScroll))
      scroll.style.transform = `translate3d(0, ${-virtualScroll}px, 0)`

      const activeIndex = Math.min(cards.length - 1, Math.floor(drive * cards.length))

      const state: TourPanelScrollState = {
        activeIndex,
        activeStep: activeIndex + 1,
        virtualScroll,
        drive,
        progress: smoothed,
      }
      onStateChangeRef.current(state)
    },
    [ensureBound, scrollportRef, setPlaying],
  )

  useEffect(() => {
    if (!enabled) {
      setPlaying(false)
      return
    }

    let cancelled = false
    let raf = 0
    let resizeObserver: ResizeObserver | undefined

    const attach = () => {
      if (cancelled) return
      if (!ensureBound()) {
        raf = window.requestAnimationFrame(attach)
        return
      }

      setPlaying(true)

      const port = scrollportRef.current
      const scroll = scrollRef.current
      if (!port || !scroll) return

      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          window.dispatchEvent(new Event('resize'))
        })
        resizeObserver.observe(scroll)
      }
    }

    attach()

    return () => {
      cancelled = true
      if (raf) window.cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      setPlaying(false)
    }
  }, [enabled, ensureBound, scrollportRef, setPlaying])

  return { applyProgress, cardsRef }
}
