import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

export interface HubChartNavigatorRange {
  startIndex: number
  endIndex: number
}

export interface HubChartNavigatorProps {
  pointCount: number
  startIndex: number
  endIndex: number
  startLabel: string
  endLabel: string
  onChange: (range: HubChartNavigatorRange) => void
  onReset: () => void
}

interface DragState {
  pointerId: number
  mode: 'window' | 'start' | 'end'
  startClientX: number
  startIndex: number
  endIndex: number
  trackWidth: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizedRange(pointCount: number, startIndex: number, endIndex: number): HubChartNavigatorRange {
  const maxIndex = Math.max(0, pointCount - 1)
  const minimumSpan = maxIndex > 0 ? 1 : 0
  const end = clamp(Math.round(endIndex), minimumSpan, maxIndex)
  const start = clamp(Math.round(startIndex), 0, Math.max(0, end - minimumSpan))
  return { startIndex: start, endIndex: end }
}

/**
 * Small, keyboard-accessible navigator for the already-loaded chart grid.
 * It changes only the local viewport; range selection and server requests stay
 * owned by the activity range menu above the chart.
 */
export function HubChartNavigator({
  pointCount,
  startIndex,
  endIndex,
  startLabel,
  endLabel,
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
  const [dragging, setDragging] = useState(false)

  const emitFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const track = trackRef.current
    if (!drag || !track || drag.pointerId !== event.pointerId) return
    const delta = ((event.clientX - drag.startClientX) / Math.max(1, drag.trackWidth)) * span
    const roundedDelta = Math.round(delta)
    let next: HubChartNavigatorRange
    if (drag.mode === 'start') {
      next = normalizedRange(pointCount, drag.startIndex + roundedDelta, drag.endIndex)
    } else if (drag.mode === 'end') {
      next = normalizedRange(pointCount, drag.startIndex, drag.endIndex + roundedDelta)
    } else {
      const currentSpan = drag.endIndex - drag.startIndex
      const nextStart = clamp(drag.startIndex + roundedDelta, 0, Math.max(0, maxIndex - currentSpan))
      next = { startIndex: nextStart, endIndex: nextStart + currentSpan }
    }
    if (next.startIndex !== range.startIndex || next.endIndex !== range.endIndex) onChange(next)
  }

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    try {
      trackRef.current?.releasePointerCapture(event.pointerId)
    } catch {
      /* Pointer capture can be absent in jsdom and older mobile browsers. */
    }
    dragRef.current = null
    setDragging(false)
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
      trackWidth: rect.width,
    }
    try {
      trackRef.current?.setPointerCapture(event.pointerId)
    } catch {
      /* Ignore capture failures; pointer events still update while over track. */
    }
    setDragging(true)
  }

  const moveHandleByKeyboard = (handle: 'start' | 'end', delta: number) => {
    if (handle === 'start') {
      onChange(normalizedRange(pointCount, range.startIndex + delta, range.endIndex))
    } else {
      onChange(normalizedRange(pointCount, range.startIndex, range.endIndex + delta))
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
      if (handle === 'start') onChange(normalizedRange(pointCount, 0, range.endIndex))
      else onChange(normalizedRange(pointCount, range.startIndex, maxIndex))
    } else if (event.key === 'End') {
      event.preventDefault()
      if (handle === 'start') onChange(normalizedRange(pointCount, maxIndex, range.endIndex))
      else onChange(normalizedRange(pointCount, range.startIndex, maxIndex))
    }
  }

  const handleTrackPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || maxIndex <= 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const clickedIndex = clamp(
      Math.round(((event.clientX - rect.left) / rect.width) * maxIndex),
      0,
      maxIndex,
    )
    const currentSpan = range.endIndex - range.startIndex
    const nextStart = clamp(
      clickedIndex - Math.round(currentSpan / 2),
      0,
      Math.max(0, maxIndex - currentSpan),
    )
    onChange({ startIndex: nextStart, endIndex: nextStart + currentSpan })
  }

  return (
    <div
      className={`hx-chart-navigator${dragging ? ' is-dragging' : ''}`}
      data-hub-chart-navigator
      data-hub-chart-navigator-window={`${range.startIndex}:${range.endIndex}`}
      role="group"
      aria-label="Chart navigator"
    >
      <div className="hx-chart-navigator__head">
        <span className="hx-chart-navigator__label">Chart view</span>
        <span className="hx-chart-navigator__range" data-hub-chart-navigator-range>
          {startLabel} – {endLabel}
        </span>
        <button
          type="button"
          className="hx-chart-navigator__reset"
          onClick={onReset}
          disabled={isFullRange}
          aria-label="Reset chart view to the full requested range"
        >
          Reset
        </button>
      </div>
      <div
        ref={trackRef}
        className="hx-chart-navigator__track"
        onPointerDown={handleTrackPointerDown}
        onPointerMove={emitFromPointer}
        onPointerUp={finishPointerDrag}
        onPointerCancel={finishPointerDrag}
        aria-hidden="true"
      >
        <span className="hx-chart-navigator__track-fill" />
        <span
          className="hx-chart-navigator__window"
          style={{ left: `${left}%`, width: `${width}%` }}
          onPointerDown={(event) => beginPointerDrag(event, 'window')}
        />
        <span
          className="hx-chart-navigator__preview"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
      <div className="hx-chart-navigator__handles">
        <button
          type="button"
          role="slider"
          className="hx-chart-navigator__handle hx-chart-navigator__handle--start"
          style={{ left: `${left}%` }}
          aria-label="Chart view start"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={maxIndex}
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
          style={{ left: `${right}%` }}
          aria-label="Chart view end"
          aria-orientation="horizontal"
          aria-valuemin={0}
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
      <p className="hx-chart-navigator__hint">Drag the view or use the handles to inspect a smaller span. The requested server range is unchanged.</p>
    </div>
  )
}
