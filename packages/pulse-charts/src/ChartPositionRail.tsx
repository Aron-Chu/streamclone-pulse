import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react"
import { formatHeatOffset } from "@streampulse/pulse-core"
import type { ChartMinuteRollup } from "./types.ts"
import {
  chartViewerValue,
  minuteEmoteTotal,
} from "./chartRollupUtils.ts"
import {
  CHART_DRAG_INTENT_PX,
  MIN_CHART_VIEWPORT_SECONDS,
  normalizeChartViewport,
  panChartViewport,
  viewportDurationSeconds,
  type ChartViewport,
} from "./chartViewport.ts"

export const LONG_STREAM_OVERVIEW_SECONDS = 90 * 60
export const MIN_RAIL_OVERVIEW_SECONDS = 5 * 60
export const FOLLOW_LIVE_EPSILON_SECONDS = 5
const SILHOUETTE_MAX_POINTS = 160

export function shouldShowChartRail(
  viewport: ChartViewport,
  durationSeconds: number,
  domainStartSeconds = 0,
): boolean {
  const domainDuration = Math.max(0, durationSeconds - Math.max(0, Math.min(durationSeconds, domainStartSeconds)))
  const viewportDuration = viewportDurationSeconds(viewport)
  if (domainDuration <= 0 || viewportDuration <= 0) return false
  const zoomedIn =
    viewportDuration < domainDuration - FOLLOW_LIVE_EPSILON_SECONDS
  return zoomedIn || domainDuration >= MIN_RAIL_OVERVIEW_SECONDS
}

export function isFollowingLive(
  viewport: ChartViewport,
  durationSeconds: number,
  epsilon = FOLLOW_LIVE_EPSILON_SECONDS,
): boolean {
  if (durationSeconds <= 0) return false
  return durationSeconds - viewport.endSeconds <= epsilon
}

export function railGeometry(
  viewport: ChartViewport,
  durationSeconds: number,
  railWidth: number,
  domainStartSeconds = 0,
): { thumbX: number; thumbWidth: number; totalWidth: number } {
  const coverageStart = Math.max(0, Math.min(durationSeconds, domainStartSeconds))
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  if (availableDuration <= 0 || railWidth <= 0) {
    return { thumbX: 0, thumbWidth: railWidth, totalWidth: railWidth }
  }
  const normalizedViewport = normalizeChartViewport(
    viewport,
    durationSeconds,
    MIN_CHART_VIEWPORT_SECONDS,
    coverageStart,
  )
  const viewportDuration = viewportDurationSeconds(normalizedViewport)
  if (viewportDuration <= 0) return { thumbX: 0, thumbWidth: railWidth, totalWidth: railWidth }
  // Canonical rail coordinates are stream-relative [0, duration]. The
  // unavailable prefix is rendered at the left, while all pointer math uses
  // this same full-stream coordinate system and rejects that prefix.
  const effectiveStart = viewportDuration >= availableDuration
    ? coverageStart
    : normalizedViewport.startSeconds
  const effectiveDuration = Math.min(viewportDuration, availableDuration)
  const rawThumbX = (effectiveStart / Math.max(1, durationSeconds)) * railWidth
  const rawThumbWidth = (effectiveDuration / Math.max(1, durationSeconds)) * railWidth
  const thumbWidth = Math.max(24, Math.min(railWidth, rawThumbWidth))
  const maxX = Math.max(0, railWidth - thumbWidth)
  const thumbX = Math.min(maxX, Math.max(0, rawThumbX))
  return { thumbX, thumbWidth, totalWidth: railWidth }
}

export function jumpViewportToOffset(
  viewport: ChartViewport,
  offsetSeconds: number,
  durationSeconds: number,
  zoomSeconds: number,
  domainStartSeconds = 0,
): ChartViewport {
  const domainStart = Math.max(0, Math.min(durationSeconds, domainStartSeconds))
  const domainDuration = Math.max(0, durationSeconds - domainStart)
  if (domainDuration <= 0) return { startSeconds: domainStart, endSeconds: domainStart }
  if (!Number.isFinite(zoomSeconds) || zoomSeconds <= 0) {
    return { startSeconds: domainStart, endSeconds: durationSeconds }
  }
  if (domainDuration < MIN_CHART_VIEWPORT_SECONDS) {
    return { startSeconds: domainStart, endSeconds: durationSeconds }
  }
  const zoom = Math.min(
    Math.max(MIN_CHART_VIEWPORT_SECONDS, zoomSeconds),
    domainDuration,
  )
  const clampedOffset = Math.max(domainStart, Math.min(durationSeconds, offsetSeconds))
  const maxStart = Math.max(domainStart, durationSeconds - zoom)
  const startSeconds = Math.min(maxStart, Math.max(domainStart, clampedOffset - zoom / 2))
  return { startSeconds, endSeconds: startSeconds + zoom }
}

export function resizeViewportEdge(
  viewport: ChartViewport,
  edge: 'start' | 'end',
  deltaSeconds: number,
  durationSeconds: number,
  domainStartSeconds = 0,
): ChartViewport {
  const domainStart = Math.max(0, Math.min(durationSeconds, domainStartSeconds))
  if (durationSeconds <= domainStart) return { startSeconds: domainStart, endSeconds: domainStart }
  const minimumDuration = Math.min(MIN_CHART_VIEWPORT_SECONDS, durationSeconds - domainStart)
  const normalized = normalizeChartViewport(
    viewport,
    durationSeconds,
    MIN_CHART_VIEWPORT_SECONDS,
    domainStart,
  )
  if (edge === 'start') {
    const maxStart = Math.max(domainStart, normalized.endSeconds - minimumDuration)
    const startSeconds = Math.min(
      maxStart,
      Math.max(domainStart, normalized.startSeconds + deltaSeconds),
    )
    return { startSeconds, endSeconds: normalized.endSeconds }
  }
  const minEnd = normalized.startSeconds + minimumDuration
  const endSeconds = Math.min(
    durationSeconds,
    Math.max(minEnd, normalized.endSeconds + deltaSeconds),
  )
  return { startSeconds: normalized.startSeconds, endSeconds }
}

export function magnitudeActivitySeries(
  minuteRollups: ChartMinuteRollup[] | undefined,
): number[] {
  if (!minuteRollups || minuteRollups.length === 0) return []
  return minuteRollups.map((rollup) => {
    const chat = Math.max(0, rollup.chatCount ?? 0)
    const emotes = minuteEmoteTotal(rollup as ChartMinuteRollup)
    const viewers = chartViewerValue(rollup) ?? 0
    return chat * 1000 + emotes * 100 + viewers
  })
}

export function downsampleMagnitude(values: number[], maxPoints = SILHOUETTE_MAX_POINTS): number[] {
  if (values.length <= maxPoints) return values
  const bucketSize = values.length / maxPoints
  const out: number[] = []
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize)
    const end = Math.min(values.length, Math.floor((bucket + 1) * bucketSize))
    let peak = 0
    for (let i = start; i < end; i += 1) {
      peak = Math.max(peak, values[i] ?? 0)
    }
    out.push(peak)
  }
  return out
}

export function buildSilhouettePath(
  values: number[],
  width: number,
  height: number,
): string {
  if (values.length === 0 || width <= 0 || height <= 0) return ''
  const max = Math.max(...values, 1)
  const stepX = width / Math.max(1, values.length - 1)
  return values.map((value, index) => {
    const x = index * stepX
    const y = height - (value / max) * (height - 1) - 0.5
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
}

export { panChartViewport }


const DEFAULT_FOCUS_SECONDS = 60 * 60
const MIN_PAN_SECONDS = 1 * 60
const SHIFT_PAN_SECONDS = 10 * 60
const RESIZE_HANDLE_PX = 14
const RAIL_TRACK_BG = 'rgba(255, 255, 255, 0.035)'
const RAIL_TRACK_BORDER = 'rgba(167, 139, 250, 0.24)'
const RAIL_WINDOW_FILL = 'rgba(139, 92, 246, 0.82)'
const RAIL_WINDOW_BORDER = 'rgba(196, 181, 253, 0.98)'
const RAIL_WINDOW_FILL_PANNED = 'rgba(139, 92, 246, 0.62)'
const RAIL_SELECTION = 'rgba(251, 191, 36, 0.95)'
export const RAIL_HEIGHT_PX = 20

export type ChartPositionRailProps = {
  viewport: ChartViewport
  durationSeconds: number
  minuteRollups?: ChartMinuteRollup[]
  onViewportChange: (viewport: ChartViewport) => void
  /** Fires when direct rail manipulation starts/ends so consumers can disable viewport easing. */
  onInteractionChange?: (active: boolean) => void
  onJumpToOffset?: (offsetSeconds: number) => void
  /** Stream-relative selected/pinned bucket. Rendered on the full-timeline rail. */
  selectedOffsetSeconds?: number | null
  disabled?: boolean
  height?: number
  ariaLabel?: string
  coverageStartSeconds?: number
  plotInsetLeft?: CSSProperties['marginLeft']
  plotInsetRight?: CSSProperties['marginRight']
}

type DragMode = 'pan' | 'resize-start' | 'resize-end'

export const ChartPositionRail = memo(function ChartPositionRail({
  viewport,
  durationSeconds,
  minuteRollups,
  onViewportChange,
  onInteractionChange,
  onJumpToOffset,
  selectedOffsetSeconds = null,
  disabled = false,
  height = RAIL_HEIGHT_PX,
  ariaLabel = 'Chart position',
  coverageStartSeconds = 0,
  plotInsetLeft = 0,
  plotInsetRight = 0,
}: ChartPositionRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [railWidth, setRailWidth] = useState(320)
  const dragStateRef = useRef<{
    pointerId: number
    startClientX: number
    startViewport: ChartViewport
    mode: DragMode
    active: boolean
  } | null>(null)
  const pendingViewportRef = useRef<ChartViewport | null>(null)
  const framePendingRef = useRef(false)
  const frameHandleRef = useRef<number | null>(null)
  const interactionActiveRef = useRef(false)
  const [interacting, setInteracting] = useState(false)

  const coverageStart = Math.max(0, Math.min(durationSeconds, coverageStartSeconds))
  const normalizedViewport = normalizeChartViewport(
    viewport,
    durationSeconds,
    MIN_CHART_VIEWPORT_SECONDS,
    coverageStart,
  )
  const viewportDuration = viewportDurationSeconds(normalizedViewport)
  const domainDuration = Math.max(0, durationSeconds - coverageStart)
  const showRail = shouldShowChartRail(normalizedViewport, durationSeconds, coverageStart)

  useEffect(() => {
    const node = trackRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const apply = () => {
      const next = Math.round(node.clientWidth)
      if (next > 0) setRailWidth(next)
    }
    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(node)
    return () => observer.disconnect()
  }, [showRail])

  const flushPendingViewport = useCallback(() => {
    if (frameHandleRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameHandleRef.current)
    }
    frameHandleRef.current = null
    framePendingRef.current = false
    const next = pendingViewportRef.current
    pendingViewportRef.current = null
    if (next) onViewportChange(next)
  }, [onViewportChange])

  const cancelPendingViewport = useCallback(() => {
    if (frameHandleRef.current !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameHandleRef.current)
    }
    frameHandleRef.current = null
    framePendingRef.current = false
    pendingViewportRef.current = null
  }, [])

  const queueViewportChange = useCallback((next: ChartViewport) => {
    pendingViewportRef.current = next
    if (framePendingRef.current) return
    framePendingRef.current = true
    const flush = () => {
      frameHandleRef.current = null
      framePendingRef.current = false
      const pending = pendingViewportRef.current
      pendingViewportRef.current = null
      if (pending) onViewportChange(pending)
    }
    if (typeof requestAnimationFrame === 'function') {
      frameHandleRef.current = requestAnimationFrame(flush)
    } else {
      // SSR/tests do not provide RAF; a microtask still coalesces a burst.
      void Promise.resolve().then(flush)
    }
  }, [onViewportChange])

  useEffect(() => () => {
    dragStateRef.current = null
    cancelPendingViewport()
    if (interactionActiveRef.current) {
      interactionActiveRef.current = false
      onInteractionChange?.(false)
    }
  }, [cancelPendingViewport, onInteractionChange])

  const silhouette = useMemo(() => {
    const values = downsampleMagnitude(magnitudeActivitySeries(minuteRollups))
    if (values.length === 0) return ''
    return buildSilhouettePath(values, Math.max(1, railWidth), height)
  }, [minuteRollups, railWidth, height])

  const geo = useMemo(
    () => railGeometry(normalizedViewport, durationSeconds, railWidth, coverageStart),
    [coverageStart, normalizedViewport, durationSeconds, railWidth],
  )
  const following = isFollowingLive(normalizedViewport, durationSeconds)
  const uncoveredWidthPx = useMemo(() => {
    if (coverageStart <= 0 || durationSeconds <= 0) return 0
    return Math.min(railWidth, (coverageStart / durationSeconds) * railWidth)
  }, [coverageStart, durationSeconds, railWidth])

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, mode: DragMode, nextViewport: ChartViewport) => {
      dragStateRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startViewport: nextViewport,
        mode,
        active: false,
      }
      try {
        const captureTarget = trackRef.current ?? event.currentTarget
        captureTarget.setPointerCapture(event.pointerId)
      } catch {
        /* already released */
      }
    },
    [],
  )

  const onTrackPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !showRail) return
      const track = trackRef.current
      if (!track) return
      event.preventDefault()
      event.stopPropagation()
      const rect = track.getBoundingClientRect()
      const offsetX = Math.min(rect.width, Math.max(0, event.clientX - rect.left))
      // Rail coordinates are always stream-relative. The unavailable prefix
      // occupies the left side and is intentionally not clickable.
      const offsetSeconds = (offsetX / Math.max(1, rect.width)) * durationSeconds
      if (offsetSeconds < coverageStart) return
      let base = normalizedViewport
      const fullView =
        viewportDuration >= domainDuration - FOLLOW_LIVE_EPSILON_SECONDS
      if (fullView && domainDuration > DEFAULT_FOCUS_SECONDS) {
        base = jumpViewportToOffset(
          normalizedViewport,
          offsetSeconds,
          durationSeconds,
          DEFAULT_FOCUS_SECONDS,
          coverageStart,
        )
      }
      const next = jumpViewportToOffset(
        base,
        offsetSeconds,
        durationSeconds,
        viewportDurationSeconds(base),
        coverageStart,
      )
      onViewportChange(next)
      onJumpToOffset?.(offsetSeconds)
    },
    [
      disabled,
      showRail,
      normalizedViewport,
      durationSeconds,
      domainDuration,
      viewportDuration,
      coverageStart,
      onViewportChange,
      onJumpToOffset,
    ],
  )

  const onThumbPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled || !showRail) return
      event.preventDefault()
      event.stopPropagation()
      beginDrag(event, 'pan', normalizedViewport)
    },
    [beginDrag, disabled, normalizedViewport, showRail],
  )

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, edge: 'start' | 'end') => {
      if (disabled || !showRail) return
      event.preventDefault()
      event.stopPropagation()
      beginDrag(event, edge === 'start' ? 'resize-start' : 'resize-end', normalizedViewport)
    },
    [disabled, showRail, beginDrag, normalizedViewport],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = dragStateRef.current
      if (!state || state.pointerId !== event.pointerId) return
      const track = trackRef.current
      if (!track) return
      const rect = track.getBoundingClientRect()
      if (rect.width <= 0) return
      const deltaPixels = event.clientX - state.startClientX
      if (!state.active) {
        if (Math.abs(deltaPixels) < CHART_DRAG_INTENT_PX) return
        state.active = true
        interactionActiveRef.current = true
        setInteracting(true)
        onInteractionChange?.(true)
      }
      const deltaSeconds = (deltaPixels / rect.width) * durationSeconds
      if (state.mode === 'pan') {
        queueViewportChange(panChartViewport(state.startViewport, deltaSeconds, durationSeconds, MIN_CHART_VIEWPORT_SECONDS, coverageStart))
        return
      }
      queueViewportChange(
        resizeViewportEdge(
          state.startViewport,
          state.mode === 'resize-start' ? 'start' : 'end',
          deltaSeconds,
          durationSeconds,
          coverageStart,
        ),
      )
    },
    [coverageStart, durationSeconds, onInteractionChange, queueViewportChange],
  )

  const finishPointerInteraction = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    cancelled = false,
  ) => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    if (cancelled || !state.active) cancelPendingViewport()
    else flushPendingViewport()
    dragStateRef.current = null
    if (interactionActiveRef.current) {
      interactionActiveRef.current = false
      setInteracting(false)
      onInteractionChange?.(false)
    }
    try {
      const captureTarget = trackRef.current ?? event.currentTarget
      captureTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* already released */
    }
  }, [cancelPendingViewport, flushPendingViewport, onInteractionChange])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    finishPointerInteraction(event)
  }, [finishPointerInteraction])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    finishPointerInteraction(event, true)
  }, [finishPointerInteraction])

  const jumpToEnd = useCallback(() => {
    onViewportChange(
      jumpViewportToOffset(normalizedViewport, durationSeconds, durationSeconds, viewportDuration, coverageStart),
    )
    onJumpToOffset?.(durationSeconds)
  }, [coverageStart, durationSeconds, onJumpToOffset, onViewportChange, normalizedViewport, viewportDuration])

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const pan = event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onViewportChange(panChartViewport(normalizedViewport, -pan, durationSeconds, MIN_CHART_VIEWPORT_SECONDS, coverageStart))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onViewportChange(panChartViewport(normalizedViewport, pan, durationSeconds, MIN_CHART_VIEWPORT_SECONDS, coverageStart))
      } else if (event.key === 'Home') {
        event.preventDefault()
        onViewportChange(jumpViewportToOffset(normalizedViewport, coverageStart, durationSeconds, viewportDuration, coverageStart))
      } else if (event.key === 'End') {
        event.preventDefault()
        jumpToEnd()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        onViewportChange({ startSeconds: coverageStart, endSeconds: durationSeconds })
      }
    },
    [coverageStart, disabled, durationSeconds, jumpToEnd, normalizedViewport, onViewportChange, viewportDuration],
  )

  if (!showRail) {
    return <div ref={trackRef} style={{ display: 'none' }} aria-hidden />
  }

  const thumbPct = railWidth > 0 ? (geo.thumbWidth / railWidth) * 100 : 100
  const thumbShift = geo.thumbWidth > 0 ? (geo.thumbX / geo.thumbWidth) * 100 : 0
  const startLabel = formatHeatOffset(normalizedViewport.startSeconds)
  const endLabel = formatHeatOffset(normalizedViewport.endSeconds)
  const totalLabel = formatHeatOffset(durationSeconds)
  const selectedMarkerPercent = selectedOffsetSeconds != null
    && Number.isFinite(selectedOffsetSeconds)
    && domainDuration > 0
    && selectedOffsetSeconds >= coverageStart
    && selectedOffsetSeconds <= durationSeconds
    ? (selectedOffsetSeconds / Math.max(1, durationSeconds)) * 100
    : null
  const selectedInViewport = selectedOffsetSeconds != null
    && Number.isFinite(selectedOffsetSeconds)
    && selectedOffsetSeconds >= normalizedViewport.startSeconds
    && selectedOffsetSeconds <= normalizedViewport.endSeconds

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={Math.round(coverageStart)}
      aria-valuemax={Math.round(durationSeconds)}
      aria-valuenow={Math.round(normalizedViewport.startSeconds)}
      aria-valuetext={`Viewing minutes ${startLabel}–${endLabel} of ${totalLabel}${selectedOffsetSeconds != null && !selectedInViewport ? '; selected minute is outside the window' : ''}`}
      title="Click the rail to center the current window. Drag the purple window to pan; drag its edges to resize."
      style={{
        ...styles.track,
        height,
        marginLeft: plotInsetLeft,
        marginRight: plotInsetRight,
        cursor: disabled ? 'default' : interacting ? 'grabbing' : 'pointer',
        touchAction: 'none',
      }}
      data-chart-position-rail="true"
      data-chart-rail
      data-chart-rail-action="click-to-center-drag-thumb"
      data-chart-rail-interacting={interacting ? 'true' : 'false'}
      data-chart-selection-state={selectedOffsetSeconds == null ? 'none' : selectedInViewport ? 'in-view' : 'off-screen'}
      onPointerDown={onTrackPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onPointerCancel}
      onKeyDown={handleKeyDown}
    >
      <svg
        viewBox={`0 0 ${Math.max(1, railWidth)} ${height}`}
        preserveAspectRatio="none"
        width="100%"
        height={height}
        aria-hidden
        style={styles.silhouette}
      >
        {uncoveredWidthPx > 0 ? (
          <rect
            x={0}
            y={0}
            width={uncoveredWidthPx}
            height={height}
            fill="rgba(255,255,255,0.08)"
            opacity={0.55}
          />
        ) : null}
        {silhouette ? (
          <path
            d={silhouette}
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1.25"
          />
        ) : null}
      </svg>
      {selectedMarkerPercent != null ? (
        <div
          data-chart-rail-selection-marker="true"
          data-chart-rail-selection-offscreen={selectedInViewport ? 'false' : 'true'}
          aria-hidden
          title="Selected minute"
          style={{ ...styles.selectionMarker, left: `${selectedMarkerPercent}%` }}
        />
      ) : null}
      <div
        data-chart-rail-thumb
        style={{
          ...styles.thumb,
          width: `${thumbPct}%`,
          transform: `translateX(${thumbShift}%)`,
          background: following ? RAIL_WINDOW_FILL : RAIL_WINDOW_FILL_PANNED,
          transition: interacting ? undefined : 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1), width 140ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
        onPointerDown={onThumbPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          data-chart-rail-resize="start"
          style={{
            ...styles.resizeHandle,
            borderLeft: `1px solid ${interacting ? 'rgba(221, 214, 254, 0.95)' : 'rgba(196, 181, 253, 0.55)'}`,
            left: 0,
          }}
          onPointerDown={(event) => onResizePointerDown(event, 'start')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
        <div
          data-chart-rail-resize="end"
          style={{
            ...styles.resizeHandle,
            borderRight: `1px solid ${interacting ? 'rgba(221, 214, 254, 0.95)' : 'rgba(196, 181, 253, 0.55)'}`,
            right: 0,
          }}
          onPointerDown={(event) => onResizePointerDown(event, 'end')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        />
      </div>
    </div>
  )
})

const styles: Record<string, CSSProperties> = {
  track: {
    background: RAIL_TRACK_BG,
    border: `1px solid ${RAIL_TRACK_BORDER}`,
    borderRadius: 7,
    boxSizing: 'border-box',
    minWidth: 96,
    overflow: 'hidden',
    position: 'relative',
    userSelect: 'none',
  },
  silhouette: {
    display: 'block',
    left: 0,
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
  },
  thumb: {
    border: `1px solid ${RAIL_WINDOW_BORDER}`,
    borderRadius: 6,
    bottom: 1,
    boxSizing: 'border-box',
    left: 0,
    position: 'absolute',
    top: 1,
  },
  resizeHandle: {
    background: 'transparent',
    boxSizing: 'border-box',
    bottom: 0,
    cursor: 'ew-resize',
    position: 'absolute',
    top: 0,
    width: RESIZE_HANDLE_PX,
    zIndex: 1,
  },
  selectionMarker: {
    background: RAIL_SELECTION,
    bottom: 0,
    boxShadow: '0 0 0 1px rgba(24, 24, 27, 0.8), 0 0 8px rgba(251, 191, 36, 0.8)',
    pointerEvents: 'none',
    position: 'absolute',
    top: 0,
    transform: 'translateX(-50%)',
    width: 2,
    zIndex: 3,
  },
}
