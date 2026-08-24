import { memo, useCallback, useRef } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { formatHeatOffset } from '@streampulse/pulse-core'
import {
  FOLLOW_LIVE_EPSILON_SECONDS,
  clampViewportToCoverage,
  isFollowingLive,
  jumpToOffset,
  MIN_VIEWPORT_SECONDS,
  panViewport,
  railGeometry,
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
}

/** Show a position rail for long timelines or whenever the user zooms in. */
export const LONG_STREAM_OVERVIEW_SECONDS = 90 * 60
const DEFAULT_FOCUS_SECONDS = 60 * 60
const MIN_PAN_SECONDS = 60
const SHIFT_PAN_SECONDS = 10 * 60
const RESIZE_HANDLE_PX = 8

export function shouldShowChartRail(viewport: ChartViewport, durationSeconds: number): boolean {
  const viewportDuration = viewportDurationSeconds(viewport)
  if (durationSeconds <= 0 || viewportDuration <= 0) return false
  return (
    viewportDuration < durationSeconds - FOLLOW_LIVE_EPSILON_SECONDS
    || durationSeconds >= LONG_STREAM_OVERVIEW_SECONDS
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

type DragMode = 'pan' | 'resize-start' | 'resize-end'

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
}: ChartPositionRailProps) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{
    pointerId: number
    startClientX: number
    startViewport: ChartViewport
    dragSeconds: number
    mode: DragMode
  } | null>(null)
  const normalizedViewport = clampViewportToCoverage(viewport, durationSeconds, coverageStartSeconds)
  const viewportDuration = viewportDurationSeconds(normalizedViewport)
  const showRail = shouldShowChartRail(normalizedViewport, durationSeconds)
  const geometry = railGeometry(normalizedViewport, durationSeconds, 100, coverageStartSeconds)
  const following = isFollowingLive(normalizedViewport, durationSeconds)

  const beginDrag = useCallback((
    event: ReactPointerEvent<HTMLElement>,
    mode: DragMode,
    startViewport: ChartViewport,
  ) => {
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startViewport,
      dragSeconds: 0,
      mode,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture may fail after the pointer has already been released.
    }
  }, [])

  const onTrackPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || !showRail) return
    const track = trackRef.current
    if (!track || durationSeconds <= 0) return
    event.preventDefault()
    event.stopPropagation()
    const rect = track.getBoundingClientRect()
    const offsetX = clamp(event.clientX - rect.left, 0, rect.width)
    const offsetSeconds = (offsetX / Math.max(1, rect.width)) * durationSeconds
    if (offsetSeconds < coverageStartSeconds) return

    let base = normalizedViewport
    if (viewportDuration >= durationSeconds - FOLLOW_LIVE_EPSILON_SECONDS && durationSeconds > DEFAULT_FOCUS_SECONDS) {
      base = resolveViewport({
        durationSeconds,
        zoomSeconds: DEFAULT_FOCUS_SECONDS,
        anchorSeconds: offsetSeconds,
        coverageStartSeconds,
      })
    }
    const next = clampViewportToCoverage(
      jumpToOffset(base, offsetSeconds, durationSeconds, viewportDurationSeconds(base), coverageStartSeconds),
      durationSeconds,
      coverageStartSeconds,
    )
    onViewportChange(next)
    onJumpToOffset?.(offsetSeconds)
    beginDrag(event, 'pan', next)
  }, [
    beginDrag,
    coverageStartSeconds,
    disabled,
    durationSeconds,
    onJumpToOffset,
    onViewportChange,
    showRail,
    normalizedViewport,
    viewportDuration,
  ])

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
    const state = dragStateRef.current
    const track = trackRef.current
    if (!state || state.pointerId !== event.pointerId || !track || durationSeconds <= 0) return
    event.stopPropagation()
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const deltaSeconds = (event.clientX - state.startClientX) * (durationSeconds / rect.width)
    state.dragSeconds += Math.abs(deltaSeconds)
    let next: ChartViewport
    if (state.mode === 'pan') {
      next = panViewport(state.startViewport, deltaSeconds, durationSeconds, true, coverageStartSeconds)
    } else if (state.mode === 'resize-start') {
      const start = clamp(
        state.startViewport.startSeconds + deltaSeconds,
        coverageStartSeconds,
        state.startViewport.endSeconds - Math.min(MIN_VIEWPORT_SECONDS, Math.max(0, durationSeconds - coverageStartSeconds)),
      )
      next = { startSeconds: start, endSeconds: state.startViewport.endSeconds }
    } else {
      const end = clamp(
        state.startViewport.endSeconds + deltaSeconds,
        state.startViewport.startSeconds + Math.min(MIN_VIEWPORT_SECONDS, Math.max(0, durationSeconds - coverageStartSeconds)),
        durationSeconds,
      )
      next = { startSeconds: state.startViewport.startSeconds, endSeconds: end }
    }
    onViewportChange(clampViewportToCoverage(next, durationSeconds, coverageStartSeconds))
  }, [coverageStartSeconds, durationSeconds, onViewportChange])

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    event.stopPropagation()
    if (state.mode === 'pan' && state.dragSeconds < FOLLOW_LIVE_EPSILON_SECONDS) {
      onViewportChange(state.startViewport)
    }
    dragStateRef.current = null
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Pointer capture may already have been released.
    }
  }, [onViewportChange])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled || durationSeconds <= 0) return
    let next: ChartViewport | null = null
    let jump: number | null = null
    switch (event.key) {
      case 'ArrowLeft':
        next = event.altKey
          ? { startSeconds: normalizedViewport.startSeconds - (event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS), endSeconds: normalizedViewport.endSeconds }
        : panViewport(normalizedViewport, event.shiftKey ? -SHIFT_PAN_SECONDS : -MIN_PAN_SECONDS, durationSeconds, true, coverageStartSeconds)
        break
      case 'ArrowRight':
        next = event.altKey
          ? { startSeconds: normalizedViewport.startSeconds + (event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS), endSeconds: normalizedViewport.endSeconds }
          : panViewport(normalizedViewport, event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS, durationSeconds, true, coverageStartSeconds)
        break
      case '[':
        next = { startSeconds: normalizedViewport.startSeconds + (event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS), endSeconds: normalizedViewport.endSeconds }
        break
      case ']':
        next = { startSeconds: normalizedViewport.startSeconds, endSeconds: normalizedViewport.endSeconds - (event.shiftKey ? SHIFT_PAN_SECONDS : MIN_PAN_SECONDS) }
        break
      case 'Home':
        jump = Math.max(0, coverageStartSeconds)
        next = jumpToOffset(normalizedViewport, jump, durationSeconds, viewportDuration, coverageStartSeconds)
        break
      case 'End':
        jump = durationSeconds
        next = jumpToOffset(normalizedViewport, jump, durationSeconds, viewportDuration, coverageStartSeconds)
        break
      case 'Escape':
        next = { startSeconds: coverageStartSeconds, endSeconds: durationSeconds }
        break
      default:
        return
    }
    event.preventDefault()
    onViewportChange(clampViewportToCoverage(next, durationSeconds, coverageStartSeconds))
    if (jump != null) onJumpToOffset?.(jump)
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
  const dragging = dragStateRef.current != null
  const thumbTransition = !prefersReducedMotion() && !dragging
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
        aria-valuetext={`Viewing minutes ${startLabel}–${endLabel} of ${totalLabel}. Alt+arrows or [ ] resize the window.`}
        style={{ ...styles.track, height, cursor: disabled ? 'default' : 'pointer', touchAction: 'none' }}
        data-chart-rail
        onPointerDown={onTrackPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
        >
          <div
            style={{ ...styles.resizeHandle, left: 0 }}
            data-chart-rail-resize="start"
            onPointerDown={event => onResizePointerDown(event, 'start')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <div
            style={{ ...styles.resizeHandle, right: 0 }}
            data-chart-rail-resize="end"
            onPointerDown={event => onResizePointerDown(event, 'end')}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
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
  },
  thumb: {
    borderRadius: 4,
    bottom: 0,
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.35)',
    left: 0,
    position: 'absolute',
    top: 0,
    willChange: 'transform',
  },
  resizeHandle: {
    bottom: 0,
    cursor: 'ew-resize',
    position: 'absolute',
    top: 0,
    width: RESIZE_HANDLE_PX,
    zIndex: 1,
  },
}
