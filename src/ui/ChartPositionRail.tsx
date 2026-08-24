import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  CHART_DRAG_INTENT_PX,
  FOLLOW_LIVE_EPSILON_SECONDS,
  clampViewportToCoverage,
  isFollowingLive,
  jumpToOffset,
  panViewport,
  railGeometry,
  resizeViewportEdge,
  resolveViewport,
  viewportDurationSeconds,
  type ChartViewport,
} from './chartViewport.ts'
import { theme } from './theme.ts'
import { prefersReducedMotion } from './motion/useSmoothedScalar.ts'

export interface ChartPositionRailProps {
  viewport: ChartViewport
  durationSeconds: number
  onViewportChange: (viewport: ChartViewport) => void
  onJumpToOffset?: (offsetSeconds: number) => void
  disabled?: boolean
  height?: number
  ariaLabel?: string
  /** First covered offset. The rail never permits navigation before it. */
  coverageStartSeconds?: number
  /** Let the parent place the visible range text with the chart controls. */
  hideRangeLabel?: boolean
  /** Fires when direct pointer manipulation starts or ends. */
  onInteractionChange?: (active: boolean) => void
}

/** Keep the rail useful on short streams without mounting it for an empty chart. */
export const MIN_MEANINGFUL_CHART_DURATION_SECONDS = 60
export const LONG_STREAM_OVERVIEW_SECONDS = 90 * 60
const DEFAULT_FOCUS_SECONDS = 60 * 60
const MIN_PAN_SECONDS = 60
const SHIFT_PAN_SECONDS = 10 * 60
const RESIZE_HANDLE_PX = 8
const POINTER_CLICK_THRESHOLD_PX = CHART_DRAG_INTENT_PX

export function shouldShowChartRail(
  viewport: ChartViewport,
  durationSeconds: number,
  coverageStartSeconds = 0,
): boolean {
  const viewportDuration = viewportDurationSeconds(viewport)
  const coverageStart = clamp(coverageStartSeconds, 0, Math.max(0, durationSeconds))
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  return availableDuration >= MIN_MEANINGFUL_CHART_DURATION_SECONDS && viewportDuration > 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type DragMode = 'pan' | 'resize-start' | 'resize-end'

export interface RailPointerViewportResult {
  viewport: ChartViewport
  offsetSeconds: number
}

/** Resolve a rail click before a pointer drag begins, keeping it inside coverage. */
export function resolveRailPointerViewport(args: {
  clientX: number
  trackLeft: number
  trackWidth: number
  viewport: ChartViewport
  durationSeconds: number
  coverageStartSeconds?: number
}): RailPointerViewportResult | null {
  const {
    clientX,
    trackLeft,
    trackWidth,
    durationSeconds,
    coverageStartSeconds = 0,
  } = args
  if (durationSeconds <= 0 || trackWidth <= 0) return null

  const coverageStart = clamp(coverageStartSeconds, 0, durationSeconds)
  const offsetX = clamp(clientX - trackLeft, 0, trackWidth)
  const offsetSeconds = (offsetX / trackWidth) * durationSeconds
  if (offsetSeconds < coverageStart) return null

  const normalizedViewport = clampViewportToCoverage(
    args.viewport,
    durationSeconds,
    coverageStart,
  )
  const viewportDuration = viewportDurationSeconds(normalizedViewport)
  const availableDuration = Math.max(0, durationSeconds - coverageStart)
  let base = normalizedViewport
  if (
    viewportDuration >= availableDuration - FOLLOW_LIVE_EPSILON_SECONDS
    && durationSeconds > DEFAULT_FOCUS_SECONDS
  ) {
    base = resolveViewport({
      durationSeconds,
      zoomSeconds: DEFAULT_FOCUS_SECONDS,
      anchorSeconds: offsetSeconds,
      coverageStartSeconds: coverageStart,
    })
  }

  return {
    viewport: clampViewportToCoverage(
      jumpToOffset(
        base,
        offsetSeconds,
        durationSeconds,
        viewportDurationSeconds(base),
        coverageStart,
      ),
      durationSeconds,
      coverageStart,
    ),
    offsetSeconds,
  }
}

export interface RailKeyboardViewportResult {
  viewport: ChartViewport
  jumpOffsetSeconds: number | null
}

/** Resolve keyboard rail navigation through the same coverage bounds as pointer input. */
export function resolveRailKeyboardViewport(args: {
  key: string
  viewport: ChartViewport
  durationSeconds: number
  coverageStartSeconds?: number
  shiftKey?: boolean
  altKey?: boolean
}): RailKeyboardViewportResult | null {
  const {
    key,
    durationSeconds,
    coverageStartSeconds = 0,
    shiftKey = false,
    altKey = false,
  } = args
  if (durationSeconds <= 0) return null

  const normalizedViewport = clampViewportToCoverage(
    args.viewport,
    durationSeconds,
    coverageStartSeconds,
  )
  const viewportDuration = viewportDurationSeconds(normalizedViewport)
  const panSeconds = shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS
  let next: ChartViewport | null = null
  let jumpOffsetSeconds: number | null = null

  switch (key) {
    case 'ArrowLeft':
      next = altKey
        ? {
            startSeconds: normalizedViewport.startSeconds - panSeconds,
            endSeconds: normalizedViewport.endSeconds,
          }
        : panViewport(normalizedViewport, -panSeconds, durationSeconds, true, coverageStartSeconds)
      break
    case 'ArrowRight':
      next = altKey
        ? {
            startSeconds: normalizedViewport.startSeconds + panSeconds,
            endSeconds: normalizedViewport.endSeconds,
          }
        : panViewport(normalizedViewport, panSeconds, durationSeconds, true, coverageStartSeconds)
      break
    case '[':
      next = resizeViewportEdge(
        normalizedViewport,
        'start',
        panSeconds,
        durationSeconds,
        coverageStartSeconds,
      )
      break
    case ']':
      next = resizeViewportEdge(
        normalizedViewport,
        'end',
        -panSeconds,
        durationSeconds,
        coverageStartSeconds,
      )
      break
    case 'Home':
      jumpOffsetSeconds = Math.max(0, Math.min(durationSeconds, coverageStartSeconds))
      next = jumpToOffset(
        normalizedViewport,
        jumpOffsetSeconds,
        durationSeconds,
        viewportDuration,
        coverageStartSeconds,
      )
      break
    case 'End':
      jumpOffsetSeconds = durationSeconds
      next = jumpToOffset(
        normalizedViewport,
        jumpOffsetSeconds,
        durationSeconds,
        viewportDuration,
        coverageStartSeconds,
      )
      break
    case 'Escape':
      next = { startSeconds: coverageStartSeconds, endSeconds: durationSeconds }
      break
    default:
      return null
  }

  return {
    viewport: clampViewportToCoverage(next, durationSeconds, coverageStartSeconds),
    jumpOffsetSeconds,
  }
}

export const ChartPositionRail = memo(function ChartPositionRail({
  viewport,
  durationSeconds,
  onViewportChange,
  onJumpToOffset,
  disabled = false,
  height = 14,
  ariaLabel = 'Chart position',
  coverageStartSeconds = 0,
  hideRangeLabel = false,
  onInteractionChange,
}: ChartPositionRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startClientX: number
    startViewport: ChartViewport
    mode: DragMode
    active: boolean
  } | null>(null)
  const trackClickRef = useRef<{
    pointerId: number
    startClientX: number
    movedPx: number
  } | null>(null)
  const pendingViewportRef = useRef<ChartViewport | null>(null)
  const frameRef = useRef<number | null>(null)
  const interactionActiveRef = useRef(false)
  const [interacting, setInteracting] = useState(false)
  const normalizedViewport = clampViewportToCoverage(viewport, durationSeconds, coverageStartSeconds)
  const viewportDuration = viewportDurationSeconds(normalizedViewport)
  const showRail = shouldShowChartRail(normalizedViewport, durationSeconds, coverageStartSeconds)
  const geometry = railGeometry(normalizedViewport, durationSeconds, 100, coverageStartSeconds)
  const following = isFollowingLive(normalizedViewport, durationSeconds)

  const setInteractionActive = useCallback((active: boolean) => {
    if (interactionActiveRef.current === active) return
    interactionActiveRef.current = active
    setInteracting(active)
    onInteractionChange?.(active)
  }, [onInteractionChange])

  const flushPendingViewport = useCallback(() => {
    if (frameRef.current != null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(frameRef.current)
    }
    frameRef.current = null
    const next = pendingViewportRef.current
    pendingViewportRef.current = null
    if (next) onViewportChange(next)
  }, [onViewportChange])

  const queueViewportChange = useCallback((next: ChartViewport) => {
    pendingViewportRef.current = next
    if (frameRef.current != null) return
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      flushPendingViewport()
      return
    }
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const pending = pendingViewportRef.current
      pendingViewportRef.current = null
      if (pending) onViewportChange(pending)
    })
  }, [flushPendingViewport, onViewportChange])

  const releasePointerCapture = useCallback((pointerId: number) => {
    try {
      trackRef.current?.releasePointerCapture(pointerId)
    } catch {
      // The browser may already have released the pointer capture.
    }
  }, [])

  const finishPointerInteraction = useCallback((pointerId?: number) => {
    trackClickRef.current = null
    dragStateRef.current = null
    pendingViewportRef.current = null
    if (frameRef.current != null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(frameRef.current)
    }
    frameRef.current = null
    setInteractionActive(false)
    if (pointerId != null) releasePointerCapture(pointerId)
  }, [releasePointerCapture, setInteractionActive])

  useEffect(() => () => {
    finishPointerInteraction()
  }, [finishPointerInteraction])

  useEffect(() => {
    const cancel = () => finishPointerInteraction()
    document.addEventListener('streampulse:deactivate-interactions', cancel)
    return () => document.removeEventListener('streampulse:deactivate-interactions', cancel)
  }, [finishPointerInteraction])

  const beginDrag = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    mode: DragMode,
    startViewport: ChartViewport,
  ) => {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startViewport,
      mode,
      active: false,
    }
    trackClickRef.current = null
    try {
      trackRef.current?.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture may fail after the pointer has already been released.
    }
  }, [])

  const onTrackPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !showRail) return
    const track = trackRef.current
    if (!track || durationSeconds <= 0 || event.target !== track) return
    event.preventDefault()
    event.stopPropagation()
    trackClickRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      movedPx: 0,
    }
    try {
      track.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best effort; pointerup can still complete a click.
    }
  }, [disabled, durationSeconds, showRail])

  const onThumbPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !showRail) return
    event.preventDefault()
    event.stopPropagation()
    beginDrag(event, 'pan', normalizedViewport)
  }, [beginDrag, disabled, normalizedViewport, showRail])

  const resolveTrackClick = useCallback((clientX: number): RailPointerViewportResult | null => {
    const track = trackRef.current
    if (!track) return null
    const rect = track.getBoundingClientRect()
    return resolveRailPointerViewport({
      clientX,
      trackLeft: rect.left,
      trackWidth: Math.max(1, rect.width),
      viewport: normalizedViewport,
      durationSeconds,
      coverageStartSeconds,
    })
  }, [coverageStartSeconds, durationSeconds, normalizedViewport])

  const onResizePointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    edge: 'start' | 'end',
  ) => {
    if (disabled || !showRail) return
    event.preventDefault()
    event.stopPropagation()
    beginDrag(event, edge === 'start' ? 'resize-start' : 'resize-end', normalizedViewport)
  }, [beginDrag, disabled, normalizedViewport, showRail])

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const click = trackClickRef.current
    if (click && click.pointerId === event.pointerId) {
      click.movedPx = Math.max(click.movedPx, Math.abs(event.clientX - click.startClientX))
      if (click.movedPx >= POINTER_CLICK_THRESHOLD_PX) {
        trackClickRef.current = null
        releasePointerCapture(event.pointerId)
      }
      return
    }
    const state = dragStateRef.current
    const track = trackRef.current
    if (!state || state.pointerId !== event.pointerId || !track || durationSeconds <= 0) return
    event.stopPropagation()
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const deltaPixels = event.clientX - state.startClientX
    if (!state.active) {
      if (Math.abs(deltaPixels) < POINTER_CLICK_THRESHOLD_PX) return
      state.active = true
      setInteractionActive(true)
    }
    const deltaSeconds = deltaPixels * (durationSeconds / rect.width)
    let next: ChartViewport
    if (state.mode === 'pan') {
      next = panViewport(state.startViewport, deltaSeconds, durationSeconds, true, coverageStartSeconds)
    } else {
      next = resizeViewportEdge(
        state.startViewport,
        state.mode === 'resize-start' ? 'start' : 'end',
        deltaSeconds,
        durationSeconds,
        coverageStartSeconds,
      )
    }
    queueViewportChange(clampViewportToCoverage(next, durationSeconds, coverageStartSeconds))
  }, [coverageStartSeconds, durationSeconds, queueViewportChange, setInteractionActive])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const click = trackClickRef.current
    if (click && click.pointerId === event.pointerId) {
      if (click.movedPx <= POINTER_CLICK_THRESHOLD_PX) {
        const result = resolveTrackClick(event.clientX)
        if (result) {
          onViewportChange(result.viewport)
          onJumpToOffset?.(result.offsetSeconds)
        }
      }
      finishPointerInteraction(event.pointerId)
      return
    }
    const state = dragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    event.stopPropagation()
    if (state.active) flushPendingViewport()
    finishPointerInteraction(event.pointerId)
  }, [finishPointerInteraction, flushPendingViewport, onJumpToOffset, onViewportChange, resolveTrackClick])

  const onPointerCancel = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    finishPointerInteraction(event.pointerId)
  }, [finishPointerInteraction])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || durationSeconds <= 0) return
    const result = resolveRailKeyboardViewport({
      key: event.key,
      viewport: normalizedViewport,
      durationSeconds,
      coverageStartSeconds,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
    })
    if (!result) return
    event.preventDefault()
    onViewportChange(result.viewport)
    if (result.jumpOffsetSeconds != null) onJumpToOffset?.(result.jumpOffsetSeconds)
  }, [
    coverageStartSeconds,
    disabled,
    durationSeconds,
    onJumpToOffset,
    onViewportChange,
    normalizedViewport,
    viewportDuration,
  ])

  if (!showRail) return <div style={{ display: 'none' }} aria-hidden />

  const startLabel = formatHeatOffset(normalizedViewport.startSeconds)
  const endLabel = formatHeatOffset(normalizedViewport.endSeconds)
  const totalLabel = formatHeatOffset(durationSeconds)
  const coverageWidth = durationSeconds > 0
    ? `${clamp(coverageStartSeconds / durationSeconds, 0, 1) * 100}%`
    : '0%'
  // Animate thumb movement for wheel/keyboard/click jumps; skip during active
  // pointer drags and for reduced-motion users so tracking stays immediate.
  const thumbTransition = !prefersReducedMotion() && !interacting
    ? 'transform 140ms cubic-bezier(0.22, 1, 0.36, 1), width 140ms cubic-bezier(0.22, 1, 0.36, 1)'
    : undefined
  const atAvailableRange = following && normalizedViewport.startSeconds <= coverageStartSeconds + FOLLOW_LIVE_EPSILON_SECONDS
  const rangeText = atAvailableRange
    ? coverageStartSeconds > FOLLOW_LIVE_EPSILON_SECONDS
      ? `Available coverage · from ${formatHeatOffset(coverageStartSeconds)}`
      : 'Full stream'
    : `Viewing ${startLabel} – ${endLabel} of ${totalLabel}`

  return (
    <div data-chart-rail-wrap>
      {!hideRangeLabel ? <div style={styles.labelRow} aria-hidden>{rangeText}</div> : null}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={ariaLabel}
        aria-valuemin={Math.round(clamp(coverageStartSeconds, 0, durationSeconds))}
        aria-valuemax={Math.round(durationSeconds)}
        aria-valuenow={Math.round(normalizedViewport.startSeconds)}
        aria-valuetext={`Viewing minutes ${startLabel}–${endLabel} of ${totalLabel}. Arrow keys pan; Alt+arrows or [ ] resize the window.`}
        style={{
          ...styles.track,
          height,
          cursor: disabled ? 'default' : interacting ? 'grabbing' : 'pointer',
          touchAction: 'none',
        }}
        data-chart-rail
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onPointerCancel}
        onKeyDown={handleKeyDown}
      >
        {coverageStartSeconds > 0 ? (
          <div
            aria-hidden
            style={{ ...styles.uncovered, width: coverageWidth }}
            data-chart-rail-uncovered
          />
        ) : null}
        <div
          style={{
            ...styles.thumb,
            width: `${geometry.thumbWidth}%`,
            transform: `translateX(${geometry.thumbWidth > 0 ? (geometry.thumbX / geometry.thumbWidth) * 100 : 0}%)`,
            background: following ? theme.accentStrong : theme.accent,
            transition: thumbTransition,
          }}
          data-chart-rail-thumb
          aria-hidden
          onPointerDown={onThumbPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          <div
            style={{ ...styles.resizeHandle, left: 0 }}
            data-chart-rail-resize="start"
            data-chart-rail-handle="start"
            onPointerDown={event => onResizePointerDown(event, 'start')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          />
          <div
            style={{ ...styles.resizeHandle, right: 0 }}
            data-chart-rail-resize="end"
            data-chart-rail-handle="end"
            onPointerDown={event => onResizePointerDown(event, 'end')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          />
        </div>
      </div>
    </div>
  )
})

const styles: Record<string, CSSProperties> = {
  labelRow: {
    color: theme.textMuted,
    display: 'flex',
    fontSize: 10,
    justifyContent: 'flex-end',
    letterSpacing: 0.2,
    lineHeight: '12px',
    marginBottom: 2,
    padding: '0 2px',
    userSelect: 'none',
  },
  track: {
    background: 'rgba(255, 255, 255, 0.04)',
    border: `1px solid ${theme.border}`,
    borderRadius: 6,
    margin: '6px 0',
    minWidth: 0,
    overflow: 'hidden',
    position: 'relative',
    userSelect: 'none',
    width: '100%',
  },
  uncovered: {
    background: theme.border,
    bottom: 0,
    left: 0,
    opacity: 0.45,
    position: 'absolute',
    top: 0,
    pointerEvents: 'none',
  },
  thumb: {
    borderRadius: 4,
    bottom: 0,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.35)',
    left: 0,
    position: 'absolute',
    top: 0,
  },
  resizeHandle: {
    background: 'rgba(255, 255, 255, 0.72)',
    border: '1px solid rgba(17, 17, 23, 0.45)',
    borderRadius: 2,
    bottom: 2,
    boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.12)',
    cursor: 'ew-resize',
    height: 8,
    opacity: 0.9,
    position: 'absolute',
    top: 2,
    width: RESIZE_HANDLE_PX - 2,
    zIndex: 1,
  },
}
