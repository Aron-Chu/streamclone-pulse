import { memo } from 'react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import type { HubTimeDomain } from '../../../lib/hubTimeScale'
import { barWidthPercent, barXPercent } from '../../../lib/hubChartGeometry'

export type HubSeriesKey = 'viewers' | 'chat' | 'emotes'

export interface HubActivityBarSeriesProps {
  points: HubActivityPoint[]
  timeDomain: HubTimeDomain
  height: number
  paddingBottom: number
  /** Chat-only scale. Unlike viewers/emotes, chat is rendered as bars. */
  chatMax: number
  focusedSeriesKey?: HubSeriesKey | null
  highlightBarT?: number | null
  selectedBarT?: number | null
  trailingBucketT?: number | null
  onBarClick?: (bucketT: number) => void
  onBarHover?: (bucketT: number | null) => void
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
  paddingBottom,
  chatMax,
  focusedSeriesKey,
  highlightBarT,
  selectedBarT,
  trailingBucketT,
  onBarClick,
  onBarHover,
}: HubActivityBarSeriesProps) {
  const widthPct = barWidthPercent(timeDomain)
  const usableHeight = Math.max(0, height - paddingBottom)
  const safeChatMax = Math.max(1, chatMax)
  return (
    <g data-component="HubActivityBarSeries" onMouseLeave={() => onBarHover?.(null)}>
      {points.map((p) => {
        const x = barXPercent(p.t, timeDomain)
        if (x == null) return null
        const isLive = trailingBucketT != null && p.t === trailingBucketT
        const opacity = isLive ? 0.4 : 1
        if (p.hasChatRollup === false || p.chat <= 0 || widthPct <= 0 || usableHeight <= 0) return null
        const barHeight = Math.min(usableHeight, (p.chat / safeChatMax) * usableHeight)
        if (barHeight <= 0) return null
        const isHighlighted = highlightBarT === p.t || selectedBarT === p.t
        const y = height - paddingBottom - barHeight
        return (
          <g
            key={p.t}
            data-bar-t={p.t}
            data-live={isLive ? 'true' : undefined}
            onMouseEnter={() => onBarHover?.(p.t)}
            onClick={() => onBarClick?.(p.t)}
            style={{ cursor: onBarClick ? 'pointer' : 'default' }}
            opacity={isHighlighted ? 1 : opacity}
          >
            <rect
              className={`hx-chat-bar hx-bar-segment hx-bar-segment--chat ${isHighlighted ? 'is-selected' : ''}`}
              x={`${x}%`}
              y={y}
              width={`${widthPct}%`}
              height={barHeight}
              fillOpacity={focusedOpacity(focusedSeriesKey, 'chat')}
            />
          </g>
        )
      })}
    </g>
  )
})
