import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CHART_MOTION, chartLineWidth } from './chartTheme.ts'

export type ViewerMorphPathsProps = {
  idleLineD: string
  idleAreaD: string
  detailLineD: string
  gradientId: string
  plotStartX: number
  plotEndX: number
  plotCssWidth?: number
  cursorX: number
  inspecting: boolean
  lineOpacity: number
  areaOpacity: number
  /** Historical after-cursor selection opacity; defaults to the primary line. */
  afterCursorOpacity?: number
  activeColor?: string
  /** @deprecated retained for callers; historical selection remains activeColor. */
  afterCursorColor?: string
  /** Opacity used only for measured-live future territory. */
  futureOpacity?: number
  /**
   * X coordinate of the "now" cursor for live streams. When set and the user
   * isn't actively inspecting, the idle viewer line is rendered with a feathered
   * mask so the future portion (right of liveEdgeX) reads at `futureOpacity`.
   * Pass `null` or `undefined` to skip the future-fade (e.g. historical streams).
   */
  liveEdgeX?: number | null
  /**
   * Animated 0..1 expansion factor. Mirrors activityExpanded so the viewer line
   * grows with the activity strip and matches chat/emote line weights.
   */
  expandProgress?: number
  /** Optional host-calculated line weight (for example, viewport-adaptive portal strokes). */
  strokeWidth?: number
  animateStrokeWidth?: boolean
  motionEnabled: boolean
}

const DEFAULT_SELECTION_AFTER_OPACITY = 0.85
const DEFAULT_FUTURE_OPACITY = 0.26
const DEFAULT_AFTER_CURSOR_COLOR = '#6f9fa6'
const SEAM_FEATHER_CSS_PX = 10
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

type PathPoint = { x: number; y: number }

/**
 * Parse a polyline `d` string ("M x y L x y L x y …") into a flat array of points.
 * Stops at the first non-M/L command so we never misread curve handles.
 */
function parseLinePath(d: string): PathPoint[] {
  const points: PathPoint[] = []
  const tokens = d.split(/[,\s]+/).filter(Boolean)
  let i = 0
  let lastX = 0
  let lastY = 0
  while (i < tokens.length) {
    const cmd = tokens[i]!
    if (cmd === 'M' || cmd === 'L') {
      const x = Number(tokens[i + 1])
      const y = Number(tokens[i + 2])
      if (Number.isFinite(x) && Number.isFinite(y)) {
        lastX = x
        lastY = y
        points.push({ x: lastX, y: lastY })
      }
      i += 3
    } else if (cmd === 'm' || cmd === 'l') {
      const dx = Number(tokens[i + 1])
      const dy = Number(tokens[i + 2])
      if (Number.isFinite(dx) && Number.isFinite(dy)) {
        lastX += dx
        lastY += dy
        points.push({ x: lastX, y: lastY })
      }
      i += 3
    } else {
      // Cubic/spline paths cannot be safely interpolated by treating their
      // control handles as points. Return an empty lattice so the caller uses
      // the target path directly instead of briefly collapsing the line to a
      // single `M` command during a zoom update.
      return []
    }
  }
  return points
}

/**
 * Resample a point list to a target count by stepping along its cumulative arc length.
 * Endpoints are pinned so the line never shortens or shifts.
 */
function resamplePolyline(points: PathPoint[], targetCount: number): PathPoint[] {
  if (points.length === 0 || targetCount <= 0) return points
  if (points.length === 1) return points
  if (targetCount === 1) return [points[0]!]
  const first = points[0]!
  const last = points[points.length - 1]!
  const cumulative: number[] = [0]
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const cur = points[i]!
    const dx = cur.x - prev.x
    const dy = cur.y - prev.y
    cumulative.push(cumulative[i - 1]! + Math.sqrt(dx * dx + dy * dy))
  }
  const total = cumulative[cumulative.length - 1]!
  if (total === 0) return [first, last]
  const out: PathPoint[] = []
  for (let i = 0; i < targetCount; i++) {
    const t = total === 0 ? 0 : (i / (targetCount - 1)) * total
    let lo = 0
    let hi = cumulative.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (cumulative[mid]! < t) lo = mid
      else hi = mid
    }
    const a = points[lo]!
    const b = points[hi]!
    const span = cumulative[hi]! - cumulative[lo]!
    const k = span === 0 ? 0 : (t - cumulative[lo]!) / span
    out.push({
      x: a.x + (b.x - a.x) * k,
      y: a.y + (b.y - a.y) * k,
    })
  }
  out[0] = first
  out[out.length - 1] = last
  return out
}

function pointsToLineD(points: PathPoint[]): string {
  if (points.length === 0) return ''
  const head = points[0]!
  let out = `M ${head.x.toFixed(3)} ${head.y.toFixed(3)}`
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    out += ` L ${p.x.toFixed(3)} ${p.y.toFixed(3)}`
  }
  return out
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/**
 * Persistent viewer layers. Hover only changes opacity, clip rectangles, and
 * the cursor coordinate; the three path `d` attributes are never interpolated.
 */
export function ViewerMorphPaths({
  idleLineD,
  idleAreaD,
  detailLineD,
  gradientId,
  plotStartX,
  plotEndX,
  plotCssWidth = 0,
  cursorX,
  inspecting,
  lineOpacity,
  areaOpacity,
  afterCursorOpacity = DEFAULT_SELECTION_AFTER_OPACITY,
  activeColor = '#22d3ee',
  afterCursorColor = DEFAULT_AFTER_CURSOR_COLOR,
  futureOpacity,
  liveEdgeX,
  expandProgress = 0,
  strokeWidth,
  animateStrokeWidth = false,
  motionEnabled,
}: ViewerMorphPathsProps) {
  const id = useId().replace(/:/g, '')
  const beforeClipId = `${id}-viewer-before-clip`
  const afterClipId = `${id}-viewer-after-clip`
  const beforeMaskId = `${id}-viewer-before-mask`
  const afterMaskId = `${id}-viewer-after-mask`
  const beforeFadeId = `${id}-viewer-before-fade`
  const afterFadeId = `${id}-viewer-after-fade`
  const idleFutureFadeId = `${id}-viewer-idle-future-fade`
  const idleFutureMaskId = `${id}-viewer-idle-future-mask`
  const safeCursorX = clamp(cursorX, plotStartX, plotEndX)
  const safeLiveEdgeX = liveEdgeX != null ? clamp(liveEdgeX, plotStartX, plotEndX) : null
  const futureFadeActive = !inspecting && safeLiveEdgeX !== null

  // Smooth-to-complex tween: when a simple polyline changes, animate the visible
  // `d` from the currently displayed shape to the new one. Curved paths are
  // applied directly because interpolating only their first point would make
  // the line disappear. The short settle keeps wheel zoom responsive.
  // Memoize parseLinePath so we don't re-split and re-scan the same string on every render
  // (idleLineD is a stable reference unless the chart geometry recomputes).
  const idlePoints = useMemo(() => parseLinePath(idleLineD), [idleLineD])
  const idleStartRef = useRef<PathPoint[]>(idlePoints)
  const rafRef = useRef<number | null>(null)
  const [animatedIdleD, setAnimatedIdleD] = useState(idleLineD)
  useEffect(() => {
    const target = idlePoints
    const start = idleStartRef.current
    // Always reset the running tween — leaving a stale rAF corrupts the displayed path.
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (!motionEnabled) {
      idleStartRef.current = target
      setAnimatedIdleD(idleLineD)
      return
    }
    if (start.length === 0 || target.length === 0) {
      idleStartRef.current = target
      setAnimatedIdleD(idleLineD)
      return
    }
    const len = Math.max(start.length, target.length)
    const resampledStart = resamplePolyline(start, len)
    const resampledTarget = resamplePolyline(target, len)
    idleStartRef.current = resampledStart
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / CHART_MOTION.pathSettleMs)
      const eased = easeOutCubic(t)
      const blended: PathPoint[] = []
      for (let i = 0; i < len; i++) {
        const a = resampledStart[i]!
        const b = resampledTarget[i]!
        blended.push({
          x: a.x + (b.x - a.x) * eased,
          y: a.y + (b.y - a.y) * eased,
        })
      }
      // Retargeting during a wheel gesture should continue from the frame the
      // user is currently seeing, not jump back to the prior target shape.
      idleStartRef.current = blended
      setAnimatedIdleD(pointsToLineD(blended))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        rafRef.current = null
        idleStartRef.current = resampledTarget
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [idleLineD, idlePoints, motionEnabled])
  // Inspection keeps measured history in the active hue while lowering its
  // optical weight after the cursor. Gaps remain data-authored; opacity alone
  // communicates the user's temporal focus.
  const selectionAfterOpacity = clamp(afterCursorOpacity, 0.12, 1)
  const mutedOpacity = clamp(futureOpacity ?? DEFAULT_FUTURE_OPACITY, 0.12, 0.45)
  // This legacy color remains source-compatible; inspection keeps one hue.
  void afterCursorColor
  // Mirror the chat/emote line weights: thin when collapsed, thicker when the
  // activity strip is expanded. Activity line weights use {expand >= 0.5 ? heavy : light},
  // so we keep the same threshold for the viewer line to avoid silhouette drift.
  const viewerStrokeWidth = strokeWidth ?? chartLineWidth(expandProgress)
  const strokeTransition = animateStrokeWidth && motionEnabled
    ? { transition: 'stroke-width 140ms cubic-bezier(.16, 1, .3, 1)' }
    : undefined
  const plotWidth = Math.max(0, plotEndX - plotStartX)
  const cssPlotWidth = plotCssWidth > 0 ? plotCssWidth : plotWidth
  const seamFeatherX = cssPlotWidth > 0
    ? (SEAM_FEATHER_CSS_PX / cssPlotWidth) * plotWidth
    : 0
  const halfStrokeX = cssPlotWidth > 0
    ? (viewerStrokeWidth / 2 / cssPlotWidth) * plotWidth
    : 0
  const seamStartX = clamp(safeCursorX - seamFeatherX / 2, plotStartX, plotEndX)
  const seamEndX = clamp(safeCursorX + seamFeatherX / 2, plotStartX, plotEndX)
  const seamStartPercent = plotWidth > 0 ? ((seamStartX - plotStartX) / plotWidth) * 100 : 0
  const seamEndPercent = plotWidth > 0 ? ((seamEndX - plotStartX) / plotWidth) * 100 : 0
  // Live-edge future-fade: same feather approach but anchored at safeLiveEdgeX.
  // The mask goes full-white up to the seam, then ramps to mutedOpacity past it.
  const liveSeamStartX = safeLiveEdgeX !== null
    ? clamp(safeLiveEdgeX - seamFeatherX / 2, plotStartX, plotEndX)
    : plotStartX
  const liveSeamEndX = safeLiveEdgeX !== null
    ? clamp(safeLiveEdgeX + seamFeatherX / 2, plotStartX, plotEndX)
    : plotStartX
  const liveSeamStartPercent = plotWidth > 0 ? ((liveSeamStartX - plotStartX) / plotWidth) * 100 : 0
  const liveSeamEndPercent = plotWidth > 0 ? ((liveSeamEndX - plotStartX) / plotWidth) * 100 : 0

  return (
    <>
      <defs>
        <clipPath id={beforeClipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={plotStartX}
            y="0"
            width={Math.max(0, Math.min(plotEndX, safeCursorX + halfStrokeX) - plotStartX)}
            height="100%"
          />
        </clipPath>
        <clipPath id={afterClipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={Math.max(plotStartX, safeCursorX - halfStrokeX)}
            y="0"
            width={Math.max(0, plotEndX - Math.max(plotStartX, safeCursorX - halfStrokeX))}
            height="100%"
          />
        </clipPath>
        <linearGradient
          id={beforeFadeId}
          gradientUnits="userSpaceOnUse"
          x1={plotStartX}
          x2={plotEndX}
          y1="0"
          y2="0"
        >
          <stop offset="0%" stopColor="white" />
          <stop offset={`${seamStartPercent}%`} stopColor="white" />
          <stop offset={`${seamEndPercent}%`} stopColor="black" />
          <stop offset="100%" stopColor="black" />
        </linearGradient>
        <linearGradient
          id={afterFadeId}
          gradientUnits="userSpaceOnUse"
          x1={plotStartX}
          x2={plotEndX}
          y1="0"
          y2="0"
        >
          <stop offset="0%" stopColor="black" />
          <stop offset={`${seamStartPercent}%`} stopColor="black" />
          <stop offset={`${seamEndPercent}%`} stopColor="white" />
          <stop offset="100%" stopColor="white" />
        </linearGradient>
        <mask id={beforeMaskId} maskUnits="userSpaceOnUse" x={plotStartX} y="0" width={plotWidth} height="100%">
          <rect x={plotStartX} y="0" width={plotWidth} height="100%" fill={`url(#${beforeFadeId})`} />
        </mask>
        <mask id={afterMaskId} maskUnits="userSpaceOnUse" x={plotStartX} y="0" width={plotWidth} height="100%">
          <rect x={plotStartX} y="0" width={plotWidth} height="100%" fill={`url(#${afterFadeId})`} />
        </mask>
        <linearGradient
          id={idleFutureFadeId}
          gradientUnits="userSpaceOnUse"
          x1={plotStartX}
          x2={plotEndX}
          y1="0"
          y2="0"
        >
          <stop offset="0%" stopColor="white" />
          <stop offset={`${liveSeamStartPercent}%`} stopColor="white" />
          <stop offset={`${liveSeamEndPercent}%`} stopColor={`rgba(255,255,255,${mutedOpacity})`} />
          <stop offset="100%" stopColor={`rgba(255,255,255,${mutedOpacity})`} />
        </linearGradient>
        <mask id={idleFutureMaskId} maskUnits="userSpaceOnUse" x={plotStartX} y="0" width={plotWidth} height="100%">
          <rect x={plotStartX} y="0" width={plotWidth} height="100%" fill={`url(#${idleFutureFadeId})`} />
        </mask>
      </defs>

      <path
        data-viewer-layer="area"
        className={`sc-viewer-area${motionEnabled ? ' sc-viewer-layer-motion' : ''}`}
        d={idleAreaD}
        fill={`url(#${gradientId})`}
        opacity={inspecting ? 0 : areaOpacity}
        pointerEvents="none"
      />
      <path
        data-viewer-layer="idle"
        className={`sc-viewer-idle-line${motionEnabled ? ' sc-viewer-layer-motion' : ''}`}
        d={animatedIdleD}
        fill="none"
        stroke={activeColor}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={viewerStrokeWidth}
        style={strokeTransition}
        opacity={inspecting ? 0 : lineOpacity}
        mask={futureFadeActive ? `url(#${idleFutureMaskId})` : undefined}
        pointerEvents="none"
      />
      <path
        data-viewer-layer="before-cursor"
        className={`sc-viewer-before-line${motionEnabled ? ' sc-viewer-layer-motion' : ''}`}
        d={detailLineD}
        clipPath={`url(#${beforeClipId})`}
        mask={`url(#${beforeMaskId})`}
        fill="none"
        stroke={activeColor}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={viewerStrokeWidth}
        style={strokeTransition}
        opacity={inspecting ? lineOpacity : 0}
        pointerEvents="none"
      />
      <path
        data-viewer-layer="after-cursor"
        className={`sc-viewer-after-line${motionEnabled ? ' sc-viewer-layer-motion' : ''}`}
        d={detailLineD}
        clipPath={`url(#${afterClipId})`}
        mask={`url(#${afterMaskId})`}
        fill="none"
        // Keep historical data in the active viewer hue. `afterCursorColor` is
        // retained for source compatibility but is intentionally not used for
        // selection because grey would falsely imply missing data.
        stroke={activeColor}
        vectorEffect="non-scaling-stroke"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={viewerStrokeWidth}
        style={strokeTransition}
        opacity={inspecting ? selectionAfterOpacity : 0}
        pointerEvents="none"
      />
      <line
        data-viewer-layer="cursor"
        className={`sc-viewer-cursor${motionEnabled ? ' sc-viewer-layer-motion' : ''}`}
        x1={safeCursorX}
        x2={safeCursorX}
        y1="0"
        y2="100%"
        stroke={activeColor}
        vectorEffect="non-scaling-stroke"
        strokeWidth="1.25"
        strokeDasharray="2 5"
        strokeLinecap="round"
        opacity={inspecting ? 1 : 0}
        pointerEvents="none"
      />
    </>
  )
}
