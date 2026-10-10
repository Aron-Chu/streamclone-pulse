import { memo, useRef } from 'react'
import type { HubActivityPoint } from '../../../lib/publicHub'
import type { HubTimeDomain } from '../../../lib/hubTimeScale'
import { barWidthPercent, barXPercent } from '../../../lib/hubChartGeometry'

export type HubSeriesKey = 'viewers' | 'chat' | 'emotes'

/**
 * One chat bar that averages `span` server buckets (a slot of the bar
 * pyramid). Only used when a bar slot holds more than one bucket.
 */
export interface HubMergedBar {
  /** Slot start (UTC-aligned) and length; the slot holds `span` server buckets. */
  slotStartMs: number
  slotMs: number
  /** First and last measured bucket in the slot; the bar spans these. */
  firstMs: number
  lastMs: number
  /** Mean and highest chat per minute of the measured buckets. */
  avg: number
  peak: number
  /** Measured buckets, and the buckets the slot covers inside the loaded range. */
  observed: number
  expected: number
}

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
  /**
   * Bars that each average several server buckets, when the plot is too narrow
   * for one bar per bucket. Omitted, every bucket is its own bar.
   */
  bars?: HubMergedBar[] | null
  /** Server buckets per merged bar (1 = one bar per bucket). */
  barSpan?: number
  /** Height of a peak cap in SVG units (about 1.5 CSS px). */
  peakCapHeight?: number
  /** Fade bars in briefly when the bar size changes. */
  animateLevelChange?: boolean
}

const FOCUS_DIM_FACTOR = 0.14
/** A cap marks a merged bar whose busiest bucket stands this far above its average. */
const PEAK_CAP_RATIO = 1.25

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
  bars,
  barSpan = 1,
  peakCapHeight = 0.7,
  animateLevelChange = false,
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
  const merged = bars != null && barSpan > 1
  // A bar size change swaps the bars at once (sizes nest, so it reads as a
  // split or a merge) and fades them in from 55%.
  const levelRef = useRef<{ span: number; entering: number | null }>({ span: barSpan, entering: null })
  if (levelRef.current.span !== barSpan) {
    levelRef.current = { span: barSpan, entering: animateLevelChange ? barSpan : null }
  }
  const entering = levelRef.current.entering === barSpan
  return (
    <g
      data-component="HubActivityBarSeries"
      data-activity-lane-top={laneTop}
      data-activity-lane-bottom={laneBottom}
      data-hub-bar-span={merged ? barSpan : undefined}
      className={entering ? 'is-level-enter' : undefined}
      onAnimationEnd={(event) => {
        event.currentTarget.classList.remove('is-level-enter')
        levelRef.current.entering = null
      }}
      onMouseLeave={() => onBarHover?.(null)}
    >
      {merged ? bars.map((bar) => {
        if (widthPct <= 0 || usableHeight <= 0 || !(bar.avg > 0)) return null
        const domainSpan = timeDomain.endExclusive - timeDomain.start
        if (!(domainSpan > 0)) return null
        const buckets = Math.max(1, Math.round((bar.lastMs - bar.firstMs) / timeDomain.bucketDurationMs) + 1)
        // Centred on the measured buckets and as wide as they span, less the
        // slot's gutter, so a gap at either end of the slot stays empty.
        const extentLeft = ((bar.firstMs - timeDomain.start) / domainSpan) * 100
        const extentWidth = buckets * widthPct
        const gutter = barSpan * widthPct * 0.28
        const barWidth = Math.max(Math.min(extentWidth, widthPct) * 0.72, extentWidth - gutter)
        const x = extentLeft + (extentWidth - barWidth) / 2
        const paintedX = clipPartialBuckets ? Math.max(0, x) : x
        const paintedWidth = clipPartialBuckets ? Math.max(0, Math.min(100, x + barWidth) - paintedX) : barWidth
        if (paintedWidth <= 0) return null
        const slotEnd = bar.slotStartMs + bar.slotMs
        const contains = (t: number | null | undefined) => t != null && t >= bar.slotStartMs && t < slotEnd
        const isLive = contains(trailingBucketT)
        const partial = bar.observed < bar.expected
        const isHighlighted = contains(highlightBarT) || contains(selectedBarT)
        const opacity = isHighlighted ? 1 : (isLive ? 0.4 : 1) * (partial ? Math.max(0.35, bar.observed / bar.expected) : 1)
        const barHeight = Math.min(usableHeight, (bar.avg / safeChatMax) * usableHeight)
        if (barHeight <= 0) return null
        const peakY = laneBottom - Math.min(usableHeight, (bar.peak / safeChatMax) * usableHeight)
        const showCap = bar.peak > bar.avg * PEAK_CAP_RATIO
        return (
          <g
            key={`${barSpan}:${bar.slotStartMs}`}
            data-bar-t={bar.slotStartMs}
            data-bar-span={barSpan}
            data-bar-observed={bar.observed}
            data-bar-expected={bar.expected}
            data-bar-partial={partial ? 'true' : undefined}
            data-live={isLive ? 'true' : undefined}
            onClick={onBarClick ? () => onBarClick(bar.firstMs) : undefined}
            style={onBarClick ? { cursor: 'pointer' } : undefined}
            opacity={opacity}
          >
            <rect
              className={`hx-chat-bar hx-bar-segment hx-bar-segment--chat ${isHighlighted ? 'is-selected' : ''}`}
              x={`${paintedX}%`}
              y={laneBottom - barHeight}
              width={`${paintedWidth}%`}
              height={barHeight}
              fillOpacity={focusedOpacity(focusedSeriesKey, 'chat')}
            />
            {showCap ? (
              <rect
                className="hx-chat-bar-peak"
                data-activity-bar-peak="chat"
                x={`${paintedX}%`}
                y={Math.max(laneTop, peakY - peakCapHeight / 2)}
                width={`${paintedWidth}%`}
                height={peakCapHeight}
                fillOpacity={focusedOpacity(focusedSeriesKey, 'chat')}
                pointerEvents="none"
              />
            ) : null}
          </g>
        )
      }) : points.map((p) => {
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
