import { useRef } from 'react'
import type { LiveHeatPoint } from '@streampulse/pulse-core'
import type { ExtensionGameSegment } from '../shared/messages.ts'
import { MomentCardSlot } from './MomentCardSlot.tsx'
import { isRenderableGameName } from './extensionChartAdapter.ts'
import { MOMENT_CARD_GAME_LINE_HEIGHT, MOMENT_CARD_HEIGHT } from './momentCardLayout.ts'
import { prefersReducedMotion } from './motion/useSmoothedScalar.ts'
import { usePinnedCardHold } from './pinnedCardExit.ts'
import { SelectedMomentCard } from './SelectedMomentCard.tsx'

export interface TopMomentCardProps {
  /** The rows point their aria-controls here while it shows. */
  id: string
  /** The picked moment; null shows nothing. */
  point: LiveHeatPoint | null
  backendUrl: string
  jumpLabel?: string
  onJump: (point: LiveHeatPoint) => void
  onAnalytics: (point: LiveHeatPoint) => void
  onClear: () => void
  /** The stream's games, to name the one on screen at the picked moment. */
  games?: readonly ExtensionGameSegment[]
}

/**
 * The Top Moments card. Nothing shows above the list until a moment is picked
 * (a row, or a ranked moment on the chart); the pick opens this card right
 * above the list, and ×, Escape or the picked row again closes it.
 *
 * It opens and closes in a MomentCardSlot, and the panel's keep-in-place
 * (keepPressedInPlace) scrolls by the slot's height while it does, so the
 * pressed row stays under the pointer. Near the top of the panel there is not
 * always that much to scroll: the card then stays in view and the row moves
 * as little as possible. A new pick swaps the contents in place, and the slot
 * keeps its tallest height while open, so moving from pick to pick never
 * moves the list.
 *
 * Callers keep the card, the list and its Show more control in one grid
 * child, so opening and closing never adds or drops a grid gap the slot does
 * not account for.
 */
export function TopMomentCard({ id, point, onClear, ...card }: TopMomentCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const shown = usePinnedCardHold(point, prefersReducedMotion())
  if (!shown.point) return null
  // A moment between two games' segments shows no game line; the reserve keeps
  // its card the height of the others.
  const games = card.games?.some(game => isRenderableGameName(game.gameName))
  const height = MOMENT_CARD_HEIGHT + (games ? MOMENT_CARD_GAME_LINE_HEIGHT : 0)
  // Clearing hands focus back to the picked row,
  // which shares the card's grid child and stays listed while it is picked.
  // A row listed past the fold only for the pick leaves with it and hands
  // focus on to Show more (PulseMomentRow).
  const clear = (): void => {
    ref.current?.parentElement?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
    onClear()
  }
  return (
    <div
      id={id}
      ref={ref}
      data-top-moment-card={shown.exiting ? 'closing' : 'selected'}
      onKeyDown={event => { if (event.key === 'Escape') clear() }}
    >
      <MomentCardSlot exiting={shown.exiting}>
        {/* Moments with no, one or three top emotes all open to one height. The
            frames script adds a picture top's height to it (data-moment-reserve). */}
        <div data-moment-reserve={games ? 'games' : ''} style={{ minHeight: height }}>
          <SelectedMomentCard {...card} point={shown.point} onClear={clear} />
        </div>
      </MomentCardSlot>
    </div>
  )
}
