import { memo } from 'react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import type { HubTimeDomain } from '../../../lib/hubTimeScale'
import {
  barStackSegments,
  barWidthPercent,
  barXPercent,
} from '../../../lib/hubChartGeometry'

export type HubSeriesKey = 'viewers' | 'chat' | 'emotes'

export interface HubActivityBarSeriesProps {
  points: HubActivityPoint[]
  timeDomain: HubTimeDomain
  height: number
  paddingBottom: number
  maxes: { viewers: number; chat: number; emotes: number }
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
  maxes,
  focusedSeriesKey,
  highlightBarT,
  selectedBarT,
  trailingBucketT,
  onBarClick,
  onBarHover,
}: HubActivityBarSeriesProps) {
  const widthPct = barWidthPercent(timeDomain)
  return (
    <g data-component="HubActivityBarSeries" onMouseLeave={() => onBarHover?.(null)}>
      {points.map((p) => {
        const x = barXPercent(p.t, timeDomain)
        if (x == null) return null
        const isLive = trailingBucketT != null && p.t === trailingBucketT
        const opacity = isLive ? 0.4 : 1
        const segments = barStackSegments(p, { height, paddingBottom }, maxes)
        const isHighlighted = highlightBarT === p.t || selectedBarT === p.t
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
            {segments.map((seg, i) => {
              const stackOffset = segments.slice(0, i).reduce((sum, s) => sum + s.height, 0)
              const y = height - paddingBottom - stackOffset - seg.height
              return (
                <rect
                  key={seg.color}
                  className={`hx-bar-segment hx-bar-segment--${seg.color} ${isHighlighted ? 'is-selected' : ''}`}
                  x={`${x}%`}
                  y={y}
                  width={`${widthPct}%`}
                  height={seg.height}
                  fillOpacity={focusedOpacity(focusedSeriesKey, seg.color)}
                />
              )
            })}
          </g>
        )
      })}
    </g>
  )
})