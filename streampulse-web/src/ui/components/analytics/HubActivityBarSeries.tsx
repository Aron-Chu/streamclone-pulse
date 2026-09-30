import { memo } from 'react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import type { HubTimeDomain } from '../../../lib/hubTimeScale'
import { barWidthPercent, barXPercent } from '../../../lib/hubChartGeometry'

export type HubSeriesKey = 'viewers' | 'chat' | 'emotes'

export interface HubActivityBarSeriesProps {
  points: HubActivityPoint[]
  timeDomain: HubTimeDomain
  height: number
  /** Top edge of the activity lane in SVG units. */
  paddingTop?: number
  paddingBottom: number
  /** Chat-only scale. Unlike viewers/emotes, chat is rendered as bars. */
  chatMax: number
  focusedSeriesKey?: HubSeriesKey | null
  highlightBarT?: number | null
  selectedBarT?: number | null
  trailingBucketT?: number | null
  onBarClick?: (bucketT: number) => void
  onBarHover?: (bucketT: number | null) => void
  /** Include the intersecting edge of a bucket during a fractional local viewport transition. */
  clipPartialBuckets?: boolean
}

const FOCUS_DIM_FACTOR = 0.14

function focusedOpacity(focused: HubSeriesKey | null | undefined, color: HubSeriesKey): number {
  if (!focused) return 1
  if (focused === color) return 1
  return FOCUS_DIM_FACTOR
}

export const HubActivityBarSeries = memo(function HubActivityBarSeries({
  points,
  timeDomain,
  height,
  paddingTop = 0,
  paddingBottom,
  chatMax,
  focusedSeriesKey,
  highlightBarT,
  selectedBarT,
  trailingBucketT,
  onBarClick,
  onBarHover,
  clipPartialBuckets = false,
}: HubActivityBarSeriesProps) {
  const widthPct = barWidthPercent(timeDomain)
  // Keep a small gutter between buckets so the chat bars remain legible as
  // discrete bars instead of collapsing into one low-contrast filled block.
  const visualWidthPct = widthPct * 0.72
  const visualInsetPct = (widthPct - visualWidthPct) / 2
  const laneTop = Math.max(0, Math.min(height - paddingBottom, paddingTop))
  const laneBottom = height - paddingBottom
  const usableHeight = Math.max(0, laneBottom - laneTop)
  const safeChatMax = Math.max(1, chatMax)
  return (
    <g
      data-component="HubActivityBarSeries"
      data-activity-lane-top={laneTop}
      data-activity-lane-bottom={laneBottom}
      onMouseLeave={() => onBarHover?.(null)}
    >
      {points.map((p) => {
        const x = clipPartialBuckets && p.t < timeDomain.endExclusive && p.t + timeDomain.bucketDurationMs > timeDomain.start
          ? ((p.t - timeDomain.start) / (timeDomain.endExclusive - timeDomain.start)) * 100
          : barXPercent(p.t, timeDomain)
        if (x == null) return null
        const visualX = x + visualInsetPct
        const paintedX = clipPartialBuckets ? Math.max(0, visualX) : visualX
        const paintedWidth = clipPartialBuckets ? Math.max(0, Math.min(100, visualX + visualWidthPct) - paintedX) : visualWidthPct
        if (paintedWidth <= 0) return null
        const isLive = trailingBucketT != null && p.t === trailingBucketT
        const opacity = isLive ? 0.4 : 1
        if (p.hasChatRollup === false || p.chat <= 0 || widthPct <= 0 || usableHeight <= 0) return null
        const barHeight = Math.min(usableHeight, (p.chat / safeChatMax) * usableHeight)
        if (barHeight <= 0) return null
        const isHighlighted = highlightBarT === p.t || selectedBarT === p.t
        const y = laneBottom - barHeight
        return (
          <g
            key={p.t}
            data-bar-t={p.t}
            data-live={isLive ? 'true' : undefined}
            onMouseEnter={() => onBarHover?.(p.t)}
            onClick={() => onBarClick?.(p.t)}
            style={onBarClick ? { cursor: 'pointer' } : undefined}
            opacity={isHighlighted ? 1 : opacity}
          >
            <rect
              className={`hx-chat-bar hx-bar-segment hx-bar-segment--chat ${isHighlighted ? 'is-selected' : ''}`}
              x={`${paintedX}%`}
              y={y}
              width={`${paintedWidth}%`}
              height={barHeight}
              fillOpacity={focusedOpacity(focusedSeriesKey, 'chat')}
            />
          </g>
        )
      })}
    </g>
  )
})
