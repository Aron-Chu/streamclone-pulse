import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from 'react'

/**
 * The place a selected-moment card occupies.
 *
 * It opens by growing from zero height while the card fades in, and `exiting`
 * (from usePinnedCardHold) collapses it the same way. While open it holds the
 * tallest height it has shown, so clicking from one moment to the next never
 * moves the content below it. Two things start the hold over from the card's
 * own height, since a height held past them left an empty band below the card:
 * a new width (the card lays out again, its 16:9 picture with it), and the same
 * moment's card getting shorter (its picture gone, say Moment pictures turned
 * off), which is no click. `momentKey` names the moment the card shows.
 *
 * It clips only while it opens or closes; at rest the card's emote previews
 * may extend past it. Put any spacing the card needs inside `children` so it
 * grows and collapses with the card, and keep the slot out of gapped grids.
 */
export function MomentCardSlot({ exiting, momentKey, children, ...rest }: HTMLAttributes<HTMLDivElement> & { exiting: boolean; momentKey: string | number }) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [heldHeight, setHeldHeight] = useState(0)
  const [opening, setOpening] = useState(true)
  // The moment the hold counts as shown, and the card it last took in.
  const shownKey = useRef(momentKey)
  const seen = useRef<{ key?: string | number; width?: number; height: number }>({ height: 0 })

  // Longer than the 240 ms opening, so the clip lifts once the card is in place.
  useEffect(() => {
    const timer = window.setTimeout(() => setOpening(false), 400)
    return () => window.clearTimeout(timer)
  }, [])

  const take = useCallback(() => {
    const card = cardRef.current
    if (!card) return
    const box = card.getBoundingClientRect()
    const key = shownKey.current
    const width = Math.round(box.width)
    const height = Math.ceil(box.height)
    const last = seen.current
    seen.current = { key, width, height }
    if (width !== last.width || (key === last.key && height < last.height)) setHeldHeight(height)
    else setHeldHeight(previous => Math.max(previous, height))
  }, [])

  useEffect(() => {
    const card = cardRef.current
    if (!card || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(take)
    observer.observe(card)
    return () => observer.disconnect()
  }, [take])

  // A new moment counts once the card's own effects (its picture) have run,
  // so the picture it swaps out is never taken for this moment getting shorter.
  useEffect(() => {
    shownKey.current = momentKey
    take()
  }, [momentKey, take])

  return (
    <div {...rest} className={`pulse-moment-slot${opening ? ' pulse-moment-slot-opening' : ''}${exiting ? ' pulse-moment-slot-exit' : ''}`}>
      <div className="pulse-moment-slot-inner">
        <div style={heldHeight ? { minHeight: heldHeight } : undefined}>
          <div ref={cardRef}>{children}</div>
        </div>
      </div>
    </div>
  )
}
