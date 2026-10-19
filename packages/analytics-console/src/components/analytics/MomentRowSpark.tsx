/**
 * The session moment row's spark (d3-v2 moment-rows.js spikeSVG, 2026-10-15):
 * the moment's own series per minute, 8 minutes either side, in a 170x60 box
 * stretched to the row. The minute that holds the moment is the highlighted
 * bar; moments are ranked by reaction score, so it need not be the tallest.
 * Decoration only: the row's text carries the figures.
 */
import type { MomentRowSeries, MomentRowSparkBar } from '../../utils/momentRowDisplay.ts'

const W0 = 170
const H0 = 60
const BW = W0 / 17

export function momentRowSparkNote(series: MomentRowSeries): string {
  return `${series === 'chat' ? 'Chat messages' : 'Emotes'} per minute, 8 minutes either side; the highlighted bar is this moment. Moments are ranked by reaction score, so it need not be the tallest.`
}

export function MomentRowSpark({
  bars,
  series,
  className = 'ssr-msp',
}: {
  bars: MomentRowSparkBar[]
  series: MomentRowSeries
  className?: string
}) {
  const max = Math.max(1, ...bars.map((bar) => bar.value || 0))
  return (
    <svg
      className={`${className} ${series}`}
      viewBox={`0 0 ${W0} ${H0}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      data-moment-row-spark
    >
      {bars.map((bar) => {
        const v = bar.value || 0
        const bh = v > 0 ? Math.max(1.5, (v / max) * H0) : 0
        if (!bh) return null
        return (
          <rect
            key={bar.slot}
            className={bar.at ? 'at' : undefined}
            x={(bar.slot * BW + 1).toFixed(1)}
            y={(H0 - bh).toFixed(1)}
            width={(BW - 2).toFixed(1)}
            height={bh.toFixed(1)}
            rx="1"
          />
        )
      })}
    </svg>
  )
}
