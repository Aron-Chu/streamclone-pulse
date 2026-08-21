import { CHART_MOTION, CHART_THEME } from './chartTheme.ts'

export type ChartBandRect = {
  x: number
  width: number
}

export type ChartBandBar = ChartBandRect & {
  bucketStartIndex: number
  bucketEndExclusive: number
  sourceIndex: number
}

const CHIP_CHAR_PX = 6.4
const CHIP_PAD_PX = 10

export function estimateTimeChipWidth(label: string): number {
  return Math.max(28, label.length * CHIP_CHAR_PX + CHIP_PAD_PX)
}

export function formatChartMinuteChip(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (ss === 0) return `${pad(hh)}:${pad(mm)}`
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
}

export function clampTimeChipX(
  x: number,
  plotWidth: number,
  padLeft: number,
  labelWidth: number,
): number {
  const half = labelWidth / 2
  const min = padLeft + half
  const max = padLeft + plotWidth - half
  if (max <= min) return padLeft + plotWidth / 2
  return Math.min(max, Math.max(min, x))
}

export function hoverBandFromBars(
  bars: readonly ChartBandBar[],
  sourceIndex: number | null,
): ChartBandRect | null {
  if (sourceIndex == null || sourceIndex < 0) return null
  const containing = bars.find(
    (bar) => sourceIndex >= bar.bucketStartIndex && sourceIndex < bar.bucketEndExclusive,
  )
  const fallback = containing ?? bars.find((bar) => bar.sourceIndex === sourceIndex)
  if (!fallback) return null
  return { x: fallback.x, width: Math.max(1, fallback.width) }
}

export function intervalBandFromTimestamps(args: {
  startIndex: number
  endExclusive: number
  timestamps: readonly string[]
  xForIndex: (index: number) => number
}): ChartBandRect | null {
  const { startIndex, endExclusive, timestamps, xForIndex } = args
  if (timestamps.length === 0 || startIndex < 0) return null
  const start = Math.max(0, Math.min(timestamps.length, startIndex))
  const end = Math.max(start + 1, endExclusive)
  const startX = xForIndex(start)
  const endX = xForIndex(Math.min(end, timestamps.length))
  const extra = end > timestamps.length && timestamps.length >= 2
    ? xForIndex(timestamps.length - 1) - xForIndex(timestamps.length - 2)
    : 0
  const resolvedEndX = end > timestamps.length
    ? xForIndex(timestamps.length - 1) + Math.max(1, extra)
    : endX
  return { x: startX, width: Math.max(1, resolvedEndX - startX) }
}

export function xForPresentationMidIndex(
  midIndex: number,
  timestamps: readonly string[],
  xForIndex: (index: number) => number,
): number {
  const n = timestamps.length
  if (n === 0) return 0
  if (midIndex <= 0) return xForIndex(0)
  if (midIndex >= n - 1) return xForIndex(n - 1)
  const lo = Math.floor(midIndex)
  const hi = Math.ceil(midIndex)
  const t = midIndex - lo
  return xForIndex(lo) + (xForIndex(hi) - xForIndex(lo)) * t
}


import { useSmoothedScalar } from './useSmoothedScalar.ts'

export type ChartMotionChromeProps = {
  motionEnabled: boolean
  padLeft: number
  padTop: number
  plotWidth: number
  plotBottom: number
  hoverX: number | null
  pinX: number | null
  hoverBand: ChartBandRect | null
  pinBand: ChartBandRect | null
  timeChipLabel: string | null
  timeChipWidth: number
  previewX?: number | null
  previewTimeChipLabel?: string | null
  previewTimeChipWidth?: number
  selectedMarkerKey?: string
  previewMarkerKey?: string
}

export function ChartMotionChrome({
  motionEnabled,
  padLeft,
  padTop,
  plotWidth,
  plotBottom,
  hoverX,
  pinX,
  hoverBand,
  pinBand,
  timeChipLabel,
  timeChipWidth,
  previewX = null,
  previewTimeChipLabel = null,
  previewTimeChipWidth = 28,
  selectedMarkerKey,
  previewMarkerKey,
}: ChartMotionChromeProps) {
  const pinSettle = motionEnabled && pinX != null
  const pinBandSettle = motionEnabled && pinBand != null
  const smoothPinX = useSmoothedScalar(
    pinX ?? padLeft,
    pinSettle,
    { settleMs: CHART_MOTION.selectionSettleMs },
  )
  const smoothPinBandX = useSmoothedScalar(
    pinBand?.x ?? padLeft,
    pinBandSettle,
    { settleMs: CHART_MOTION.selectionSettleMs },
  )
  const smoothPinBandWidth = useSmoothedScalar(
    pinBand?.width ?? 1,
    pinBandSettle,
    { settleMs: CHART_MOTION.selectionSettleMs },
  )

  const displayPinX = pinX != null ? smoothPinX : null
  const displayPinBand = pinBand
    ? { x: smoothPinBandX, width: Math.max(1, smoothPinBandWidth) }
    : null
  const hoverLineX = hoverX
  const hoverMuted = hoverLineX != null && pinX != null
  const timeChipX = hoverLineX ?? displayPinX
  const timeChipClampedX =
    timeChipX != null
      ? clampTimeChipX(timeChipX, plotWidth, padLeft, timeChipWidth)
      : null
  const previewVisible =
    previewX != null
    && previewTimeChipLabel != null
    && hoverLineX == null
    && (pinX == null || Math.abs(previewX - pinX) > 0.5)
  const previewTimeChipClampedX = previewVisible
    ? clampTimeChipX(previewX, plotWidth, padLeft, previewTimeChipWidth)
    : null
  const previewChipOverlapsSelection =
    previewVisible
    && timeChipClampedX != null
    && previewTimeChipClampedX != null
    && Math.abs(previewTimeChipClampedX - timeChipClampedX)
      < (previewTimeChipWidth + timeChipWidth) / 2 + 6
  const previewChipY = padTop + (previewChipOverlapsSelection ? 18 : 1)
  const hoverBandVisible = hoverBand != null && (pinBand == null || hoverMuted)
  const selectedBand = pinX != null && displayPinX != null
    ? (displayPinBand ?? { x: displayPinX - 0.75, width: 1.5 })
    : null

  return (
    <g pointerEvents="none" data-chart-motion-chrome="true">
      {hoverBandVisible && hoverBand ? (
        <rect
          x={hoverBand.x}
          y={padTop}
          width={Math.max(1, hoverBand.width)}
          height={Math.max(0, plotBottom - padTop)}
          fill="rgba(255,255,255,0.045)"
          data-chart-hover-band="true"
        />
      ) : null}
      {selectedBand ? (
        <g
          data-moment-selected-marker="true"
          data-chart-marker-key={selectedMarkerKey}
        >
          <rect
            x={selectedBand.x}
            y={padTop}
            width={selectedBand.width}
            height={Math.max(0, plotBottom - padTop)}
            fill="rgba(245,158,11,0.105)"
            stroke="rgba(245,158,11,0.5)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
            data-chart-pin-band="true"
          />
        </g>
      ) : null}
      {hoverLineX != null ? (
        <line
          x1={hoverLineX}
          x2={hoverLineX}
          y1={padTop}
          y2={plotBottom}
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="1"
          opacity={hoverMuted ? 0.35 : 0.7}
          className="sc-hover-line"
          data-chart-hover-line={hoverMuted ? 'muted' : 'solo'}
        />
      ) : null}
      {previewVisible && previewTimeChipClampedX != null ? (
        <g
          data-moment-preview-marker="true"
          data-chart-marker-key={previewMarkerKey}
        >
          <line
            x1={previewX}
            x2={previewX}
            y1={padTop}
            y2={plotBottom}
            stroke={CHART_THEME.moment.preview}
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          <rect
            x={previewTimeChipClampedX - previewTimeChipWidth / 2}
            y={previewChipY}
            width={previewTimeChipWidth}
            height={14}
            rx={7}
            ry={7}
            fill="#18181b"
            stroke="rgba(34, 211, 238, 0.55)"
            strokeWidth="1"
            data-preview-time-chip="true"
          />
          <text
            x={previewTimeChipClampedX}
            y={previewChipY + 10}
            textAnchor="middle"
            fill="#a5f3fc"
            fontSize="9"
            fontWeight={800}
          >
            {previewTimeChipLabel}
          </text>
        </g>
      ) : null}
      {timeChipLabel != null && timeChipClampedX != null ? (
        <g data-time-chip="true">
          <rect
            x={timeChipClampedX - timeChipWidth / 2}
            y={padTop + 1}
            width={timeChipWidth}
            height={14}
            rx={7}
            ry={7}
            fill="#18181b"
            stroke={
              hoverMuted
                ? 'rgba(255, 255, 255, 0.28)'
                : 'rgba(245, 158, 11, 0.45)'
            }
            strokeWidth="1"
          />
          <text
            x={timeChipClampedX}
            y={padTop + 11}
            textAnchor="middle"
            fill="#e4e4e7"
            fontSize="9"
            fontWeight={800}
          >
            {timeChipLabel}
          </text>
        </g>
      ) : null}
    </g>
  )
}
