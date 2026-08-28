import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

export interface HubChartNavigatorRange {
  startIndex: number
  endIndex: number
}

export interface HubChartNavigatorPreset {
  label: string
  pointCount: number
}

export interface HubChartNavigatorProps {
  pointCount: number
  startIndex: number
  endIndex: number
  startLabel: string
  endLabel: string
  presets?: HubChartNavigatorPreset[]
  wheelSurfaceRef?: RefObject<HTMLElement | null>
  onChange: (range: HubChartNavigatorRange) => void
  onReset: () => void
}

interface DragState {
  pointerId: number
  mode: 'brush' | 'window' | 'start' | 'end'
  startClientX: number
  startIndex: number
  endIndex: number
  anchorIndex: number
  hasMoved: boolean
  trackLeft: number
  trackWidth: number
  captureTarget: HTMLElement
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizedRange(
  pointCount: number,
  startIndex: number,
  endIndex: number,
): HubChartNavigatorRange {
  const maxIndex = Math.max(0, pointCount - 1)
  const minimumSpan = maxIndex > 0 ? 1 : 0
  const end = clamp(Math.round(endIndex), minimumSpan, maxIndex)
  const start = clamp(Math.round(startIndex), 0, Math.max(0, end - minimumSpan))
  return { startIndex: start, endIndex: end }
}

/**
 * Keyboard- and pointer-accessible navigator for the activity payload already
 * loaded in the browser. It never changes the requested server range.
 */
export function HubChartNavigator({
  pointCount,
  startIndex,
  endIndex,
  startLabel,
  endLabel,
  presets = [],
  wheelSurfaceRef,
  onChange,
  onReset,
}: HubChartNavigatorProps) {
  const maxIndex = Math.max(0, pointCount - 1)
  const range = normalizedRange(pointCount, startIndex, endIndex)
  const span = Math.max(1, maxIndex)
  const left = (range.startIndex / span) * 100
  const right = (range.endIndex / span) * 100
  const width = Math.max(1, right - left)
  const isFullRange = range.startIndex === 0 && range.endIndex === maxIndex
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [draggingMode, setDraggingMode] = useState<DragState['mode'] | null>(null)
  const hintId = useId()

  const globalPointerIndex = (clientX: number, trackLeft: number, trackWidth: number): number =>
    clamp(Math.round(((clientX - trackLeft) / Math.max(1, trackWidth)) * maxIndex), 0, maxIndex)

  const emitFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = ((event.clientX - drag.startClientX) / Math.max(1, drag.trackWidth)) * span
    const roundedDelta = Math.round(delta)
    let next: HubChartNavigatorRange
    if (drag.mode === 'brush') {
      const pointerIndex = globalPointerIndex(event.clientX, drag.trackLeft, drag.trackWidth)
      if (!drag.hasMoved && Math.abs(event.clientX - drag.startClientX) < 2) return
      drag.hasMoved = true
      const first = Math.min(drag.anchorIndex, pointerIndex)
      const last = Math.max(drag.anchorIndex, pointerIndex)
      next = first === last
        ? first < maxIndex
          ? { startIndex: first, endIndex: first + 1 }
          : { startIndex: Math.max(0, first - 1), endIndex: first }
        : { startIndex: first, endIndex: last }
    } else if (drag.mode === 'start') {
      next = {
        startIndex: clamp(drag.startIndex + roundedDelta, 0, Math.max(0, drag.endIndex - 1)),
        endIndex: drag.endIndex,
      }
    } else if (drag.mode === 'end') {
      next = {
        startIndex: drag.startIndex,
        endIndex: clamp(
          drag.endIndex + roundedDelta,
          Math.min(maxIndex, drag.startIndex + 1),
          maxIndex,
        ),
      }
    } else {
      const currentSpan = drag.endIndex - drag.startIndex
      const nextStart = clamp(
        drag.startIndex + roundedDelta,
        0,
        Math.max(0, maxIndex - currentSpan),
      )
      next = { startIndex: nextStart, endIndex: nextStart + currentSpan }
    }
    if (next.startIndex !== range.startIndex || next.endIndex !== range.endIndex) onChange(next)
  }

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (cancelled) onChange({ startIndex: drag.startIndex, endIndex: drag.endIndex })
    else {
      emitFromPointer(event)
      if (drag.mode === 'brush' && !drag.hasMoved) {
        const currentCount = drag.endIndex - drag.startIndex + 1
        const defaultCount = presets[0]?.pointCount ?? Math.max(2, Math.round(pointCount / 4))
        const nextCount = clamp(isFullRange ? defaultCount : currentCount, 2, pointCount)
        let nextStart = Math.round(drag.anchorIndex - (nextCount - 1) / 2)
        nextStart = clamp(nextStart, 0, Math.max(0, pointCount - nextCount))
        onChange({ startIndex: nextStart, endIndex: nextStart + nextCount - 1 })
      }
    }
    dragRef.current = null
    setDraggingMode(null)
    try {
      drag.captureTarget.releasePointerCapture?.(event.pointerId)
    } catch {
      // Pointer capture is optional in jsdom and older mobile browsers.
    }
  }

  const beginPointerDrag = (
    event: ReactPointerEvent<HTMLElement>,
    mode: DragState['mode'],
  ) => {
    if (event.button !== undefined && event.button !== 0) return
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      startIndex: range.startIndex,
      endIndex: range.endIndex,
      anchorIndex: globalPointerIndex(event.clientX, rect.left, rect.width),
      hasMoved: false,
      trackLeft: rect.left,
      trackWidth: rect.width,
      captureTarget: event.currentTarget,
    }
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    } catch {
      // Root handlers still cover the gesture when capture is unavailable.
    }
    setDraggingMode(mode)
  }

  const moveHandleByKeyboard = (handle: 'start' | 'end', delta: number) => {
    if (handle === 'start') {
      onChange({
        startIndex: clamp(range.startIndex + delta, 0, Math.max(0, range.endIndex - 1)),
        endIndex: range.endIndex,
      })
    } else {
      onChange({
        startIndex: range.startIndex,
        endIndex: clamp(
          range.endIndex + delta,
          Math.min(maxIndex, range.startIndex + 1),
          maxIndex,
        ),
      })
    }
  }

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    handle: 'start' | 'end',
  ) => {
    const step = event.shiftKey ? 5 : 1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveHandleByKeyboard(handle, -step)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveHandleByKeyboard(handle, step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (handle === 'start') onChange({ startIndex: 0, endIndex: range.endIndex })
      else onChange({ startIndex: range.startIndex, endIndex: Math.min(maxIndex, range.startIndex + 1) })
    } else if (event.key === 'End') {
      event.preventDefault()
      if (handle === 'start') onChange({ startIndex: Math.max(0, range.endIndex - 1), endIndex: range.endIndex })
      else onChange({ startIndex: range.startIndex, endIndex: maxIndex })
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onReset()
    }
  }

  const handleWheel = (event: WheelEvent, surface: HTMLElement) => {
    if (maxIndex <= 1 || event.ctrlKey || event.metaKey) return
    const rect = surface.getBoundingClientRect()
    if (!rect || rect.width <= 0) return

    const deltaUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(240, rect.width) : 1
    const deltaX = event.deltaX * deltaUnit
    const deltaY = event.deltaY * deltaUnit
    const panDelta = event.shiftKey ? (deltaY || deltaX) : deltaX
    const shouldPan = event.shiftKey || Math.abs(deltaX) > Math.abs(deltaY)
    let next = range

    if (shouldPan) {
      if (panDelta === 0 || isFullRange) return
      const bucketCount = range.endIndex - range.startIndex + 1
      const panBuckets = Math.sign(panDelta) * Math.max(
        1,
        Math.round(bucketCount * clamp(Math.abs(panDelta) / 800, 0.02, 0.25)),
      )
      const nextStart = clamp(
        range.startIndex + panBuckets,
        0,
        Math.max(0, pointCount - bucketCount),
      )
      next = { startIndex: nextStart, endIndex: nextStart + bucketCount - 1 }
    } else {
      if (deltaY === 0) return
      const bucketCount = range.endIndex - range.startIndex + 1
      const scale = Math.exp(deltaY * 0.0025)
      let nextBucketCount = clamp(Math.round(bucketCount * scale), 2, pointCount)
      if (nextBucketCount === bucketCount) {
        nextBucketCount = clamp(bucketCount + Math.sign(deltaY), 2, pointCount)
      }
      const anchorRatio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1)
      const anchorIndex = range.startIndex + anchorRatio * Math.max(0, bucketCount - 1)
      let nextStart = Math.round(anchorIndex - anchorRatio * (nextBucketCount - 1))
      nextStart = clamp(nextStart, 0, Math.max(0, pointCount - nextBucketCount))
      next = { startIndex: nextStart, endIndex: nextStart + nextBucketCount - 1 }
    }

    if (next.startIndex === range.startIndex && next.endIndex === range.endIndex) return
    event.preventDefault()
    onChange(next)
  }

  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const surfaces = [track, wheelSurfaceRef?.current]
      .filter((surface): surface is HTMLElement => surface != null)
      .filter((surface, index, all) => all.indexOf(surface) === index)
    const listeners = surfaces.map((surface) => {
      const onWheel = (event: WheelEvent) => handleWheel(event, surface)
      surface.addEventListener('wheel', onWheel, { passive: false })
      return { surface, onWheel }
    })
    return () => listeners.forEach(({ surface, onWheel }) => surface.removeEventListener('wheel', onWheel))
  })

  return (
    <div
      className={`hx-chart-navigator${draggingMode ? ' is-dragging' : ''}${isFullRange ? ' is-full-range' : ''}`}
      data-hub-chart-navigator
      data-hub-chart-navigator-window={`${range.startIndex}:${range.endIndex}`}
      data-hub-chart-navigator-mode={draggingMode ?? undefined}
      role="group"
      aria-label="Chart navigator"
      aria-describedby={hintId}
      onPointerMove={emitFromPointer}
      onPointerUp={(event) => finishPointerDrag(event)}
      onPointerCancel={(event) => finishPointerDrag(event, true)}
      onLostPointerCapture={(event) => finishPointerDrag(event, true)}
    >
      <div className="hx-chart-navigator__bar">
        <div className="hx-chart-navigator__track-shell">
          <div
            ref={trackRef}
            className="hx-chart-navigator__track"
            onPointerDown={(event) => {
              if (maxIndex > 0) beginPointerDrag(event, 'brush')
            }}
            onDoubleClick={(event) => {
              event.preventDefault()
              onReset()
            }}
            aria-hidden="true"
          >
            <span className="hx-chart-navigator__track-fill" />
            <span
              className="hx-chart-navigator__window"
              style={{ left: `${left}%`, width: `${width}%` }}
              onPointerDown={(event) => {
                if (isFullRange) beginPointerDrag(event, 'brush')
                else beginPointerDrag(event, 'window')
              }}
            />
          </div>
          <div className="hx-chart-navigator__handles">
            <button
              type="button"
              role="slider"
              className="hx-chart-navigator__handle hx-chart-navigator__handle--start"
              style={{ left: `clamp(22px, ${left}%, calc(100% - 22px))` }}
              aria-label="Chart view start"
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={Math.max(0, range.endIndex - 1)}
              aria-valuenow={range.startIndex}
              aria-valuetext={`Start ${startLabel}; showing ${startLabel} to ${endLabel}`}
              onKeyDown={(event) => handleKeyDown(event, 'start')}
              onPointerDown={(event) => {
                event.stopPropagation()
                beginPointerDrag(event, 'start')
              }}
            />
            <button
              type="button"
              role="slider"
              className="hx-chart-navigator__handle hx-chart-navigator__handle--end"
              style={{ left: `clamp(22px, ${right}%, calc(100% - 22px))` }}
              aria-label="Chart view end"
              aria-orientation="horizontal"
              aria-valuemin={Math.min(maxIndex, range.startIndex + 1)}
              aria-valuemax={maxIndex}
              aria-valuenow={range.endIndex}
              aria-valuetext={`End ${endLabel}; showing ${startLabel} to ${endLabel}`}
              onKeyDown={(event) => handleKeyDown(event, 'end')}
              onPointerDown={(event) => {
                event.stopPropagation()
                beginPointerDrag(event, 'end')
              }}
            />
          </div>
        </div>
        <span className="hx-chart-navigator__range sr-only" data-hub-chart-navigator-range aria-live="polite" aria-atomic="true">
          {startLabel} – {endLabel}
        </span>
      </div>
      <span id={hintId} className="sr-only">
        Drag the purple track to select a loaded time span. Drag the selected window to pan, or use its start and end sliders to resize. Mouse wheel zooms; Shift plus wheel pans. Double-click the track or press Escape on either slider to restore the full loaded range.
      </span>
    </div>
  )
}
