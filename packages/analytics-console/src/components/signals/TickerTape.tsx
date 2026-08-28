import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

export function TickerTape({
  itemIds,
  children,
  overflowing = false,
  motionEnabled = true,
  autoScroll = 'off',
  announcement,
}: {
  itemIds: string[]
  children: ReactNode
  overflowing?: boolean
  motionEnabled?: boolean
  autoScroll?: 'off' | 'overflow'
  announcement?: string
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const announcementRef = useRef<string | undefined>()
  const [paused, setPaused] = useState(false)
  const [measuredOverflow, setMeasuredOverflow] = useState(false)
  const isOverflowing = overflowing || measuredOverflow
  const eligible = isOverflowing && motionEnabled && autoScroll === 'overflow'
  const liveAnnouncement = announcement && announcement !== announcementRef.current ? announcement : ''

  useEffect(() => {
    announcementRef.current = announcement
  }, [announcement])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const measure = () => {
      setMeasuredOverflow(scroller.scrollWidth > scroller.clientWidth + 1)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(scroller)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [itemIds, children])

  useEffect(() => {
    if (!eligible || paused) return
    const scroller = scrollerRef.current
    if (!scroller) return

    let frame = 0
    let last = performance.now()
    let direction = 1
    let dwellUntil = 0
    const step = (now: number) => {
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth)
      if (max > 0 && now >= dwellUntil) {
        const next = scroller.scrollLeft + direction * ((now - last) * 0.04)
        if (next >= max) {
          scroller.scrollLeft = max
          direction = -1
          dwellUntil = now + 550
        } else if (next <= 0) {
          scroller.scrollLeft = 0
          direction = 1
          dwellUntil = now + 550
        } else {
          scroller.scrollLeft = next
        }
      }
      last = now
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [eligible, paused, itemIds])

  const items = Children.toArray(children)
  return (
    <div className="session-signal-ticker">
      <div
        ref={scrollerRef}
        className="session-signal-scroller"
        data-testid="ticker-scroller"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.currentTarget !== event.target) return
          if (event.key === 'Home') {
            event.preventDefault()
            event.currentTarget.scrollLeft = 0
          } else if (event.key === 'End') {
            event.preventDefault()
            event.currentTarget.scrollLeft = event.currentTarget.scrollWidth
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.currentTarget.scrollBy({ left: event.key === 'ArrowLeft' ? -120 : 120 })
          }
        }}
      >
        <div className="session-signal-track" data-testid="ticker-track">
          {items.map((child, index) => (
            isValidElement(child)
              ? cloneElement(child as ReactElement<{ 'data-tape-id'?: string }>, {
                  'data-tape-id': itemIds[index],
                })
              : <span data-tape-id={itemIds[index]} key={itemIds[index]}>{child}</span>
          ))}
        </div>
      </div>
      {eligible ? (
        <button
          type="button"
          className="session-signal-pause"
          aria-pressed={paused}
          aria-label={paused ? 'Resume ticker' : 'Pause ticker'}
          onClick={() => setPaused(value => !value)}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
      ) : null}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveAnnouncement}</span>
    </div>
  )
}
