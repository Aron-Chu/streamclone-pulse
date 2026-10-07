import { useLayoutEffect, useRef, useState } from 'react'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import { MOMENT_CARD_HEIGHT } from './momentCardLayout.ts'
import { SelectedMomentCard } from './SelectedMomentCard.tsx'

export interface TopMomentCardProps {
  /** The rows point their aria-controls here. */
  id: string
  point: LiveHeatPoint
  /** The moment was picked; otherwise the card shows the strongest one. */
  selected: boolean
  backendUrl: string
  jumpLabel?: string
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onClear: () => void
}

/**
 * The Top Moments card. It always sits right above the list and shows the
 * strongest moment until one is picked; a pick swaps its contents in place
 * and × goes back to the strongest. It never gets shorter, so neither the
 * picked row nor the list ever moves.
 */
export function TopMomentCard({ id, point, selected, onClear, ...card }: TopMomentCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(MOMENT_CARD_HEIGHT)
  // A taller card (lines wrapping in a narrow panel) raises the floor for good.
  useLayoutEffect(() => {
    const next = ref.current!.offsetHeight
    if (next > height) setHeight(next)
  })
  // Clearing hands focus back to the picked row, or past the list when the
  // fold hides that row.
  const clear = (): void => {
    const list = ref.current!.nextElementSibling!
    ;(list.querySelector<HTMLElement>('[aria-pressed="true"]') ?? list.nextElementSibling as HTMLElement | null)?.focus()
    onClear()
  }
  return (
    <div
      id={id}
      ref={ref}
      data-top-moment-card={selected ? 'selected' : 'strongest'}
      style={{ minHeight: height }}
      onKeyDown={event => { if (event.key === 'Escape' && selected) clear() }}
    >
      <SelectedMomentCard
        {...card}
        point={point}
        label={selected ? 'Selected moment' : 'Strongest moment'}
        onClear={selected ? clear : undefined}
      />
    </div>
  )
}
