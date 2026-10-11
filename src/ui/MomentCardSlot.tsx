import { useEffect, useRef, useState, type HTMLAttributes } from 'react'

/**
 * The place a selected-moment card occupies.
 *
 * It opens by growing from zero height while the card fades in, then holds the
 * tallest height it has shown until it closes, so clicking from one moment to
 * the next never moves the content below it. `exiting` (from
 * usePinnedCardHold) collapses it the same way.
 *
 * It clips only while it opens or closes; at rest the card's emote previews
 * may extend past it. Put any spacing the card needs inside `children` so it
 * grows and collapses with the card, and keep the slot out of gapped grids.
 */
export function MomentCardSlot({ exiting, children, ...rest }: HTMLAttributes<HTMLDivElement> & { exiting: boolean }) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [heldHeight, setHeldHeight] = useState(0)
  const [opening, setOpening] = useState(true)

  // Longer than the 240 ms opening, so the clip lifts once the card is in place.
  useEffect(() => {
    const timer = window.setTimeout(() => setOpening(false), 400)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(content.getBoundingClientRect().height)
      setHeldHeight(previous => Math.max(previous, height))
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [])

  return (
    <div {...rest} className={`pulse-moment-slot${opening ? ' pulse-moment-slot-opening' : ''}${exiting ? ' pulse-moment-slot-exit' : ''}`}>
      <div className="pulse-moment-slot-inner">
        <div ref={contentRef} style={heldHeight ? { minHeight: heldHeight } : undefined}>{children}</div>
      </div>
    </div>
  )
}
