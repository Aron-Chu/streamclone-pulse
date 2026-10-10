import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'

/*
 * Shared chart navigator: the hub's Global activity chart and the channel
 * session chart both use it, so the two zoom bars look and behave the same.
 * Icons are inline copies of the Lucide glyphs the hub used (ISC licence),
 * so this package does not need lucide-react.
 */
type IconNode = ReadonlyArray<readonly [tag: 'path' | 'rect' | 'line' | 'circle', attrs: Record<string, string>]>

function navigatorIcon(name: string, nodes: IconNode) {
  function Icon({ size = 15 }: { size?: number; 'aria-hidden'?: 'true' }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`lucide lucide-${name}`}
        aria-hidden="true"
      >
        {nodes.map(([Tag, attrs], index) => <Tag key={index} {...attrs} />)}
      </svg>
    )
  }
  return Icon
}

const Plus = navigatorIcon('plus', [['path', { d: 'M5 12h14' }], ['path', { d: 'M12 5v14' }]])
const Minus = navigatorIcon('minus', [['path', { d: 'M5 12h14' }]])
const RotateCcw = navigatorIcon('rotate-ccw', [
  ['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }],
  ['path', { d: 'M3 3v5h5' }],
])
const Mouse = navigatorIcon('mouse', [
  ['rect', { x: '5', y: '2', width: '14', height: '20', rx: '7' }],
  ['path', { d: 'M12 6v4' }],
])
const LocateFixed = navigatorIcon('locate-fixed', [
  ['line', { x1: '2', x2: '5', y1: '12', y2: '12' }],
  ['line', { x1: '19', x2: '22', y1: '12', y2: '12' }],
  ['line', { x1: '12', x2: '12', y1: '2', y2: '5' }],
  ['line', { x1: '12', x2: '12', y1: '19', y2: '22' }],
  ['circle', { cx: '12', cy: '12', r: '7' }],
  ['circle', { cx: '12', cy: '12', r: '3' }],
])

export interface ChartNavigatorRange {
  startIndex: number
  endIndex: number
}

export interface ChartNavigatorPreset {
  label: string
  pointCount: number
}

export interface ChartNavigatorProps {
  pointCount: number
  startIndex: number
  endIndex: number
  /** Latest input target; repeated wheel/key events compose without waiting for easing. */
  controlRange?: ChartNavigatorRange
  /** Shared fractional viewport rendered by the plot during a short transition. */
  visualRange?: ChartNavigatorRange
  startLabel: string
  endLabel: string
  /** Bucket to keep in the viewport when the user presses Zoom in. */
  focusIndex?: number | null
  /** Locked bucket, which may be outside a panned viewport. */
  selectedIndex?: number | null
  presets?: ChartNavigatorPreset[]
  wheelSurfaceRef?: RefObject<HTMLElement | null>
  /**
   * Element whose box anchors wheel zoom over `wheelSurfaceRef` (the plot
   * area). Omitted, the wheel surface itself is the anchor.
   */
  wheelAnchor?: () => Element | null | undefined
  /**
   * Fewest steps the view can show (default 2). Zoom in disables at this
   * floor, and wheel, brush and handle gestures stop there instead of letting
   * the chart widen the view again.
   */
  minVisibleCount?: number
  scrollZoomEnabled: boolean
  onScrollZoomChange: (enabled: boolean) => void
  onChange: (range: ChartNavigatorRange, animate?: boolean) => void
  onDragStart?: () => ChartNavigatorRange
  onReset: () => void
  /** Readout heading at full range (hub: "Full loaded range"). */
  fullRangeLabel?: string
  /** Readout heading while zoomed (hub: "Zoomed view"). */
  zoomedRangeLabel?: string
  /** Plural noun for one navigator step (hub: "buckets"). */
  unitLabel?: string
  /** Label for the button that brings an off-screen selection back into view. */
  selectedLabel?: string
  /**
   * Optional extra fact shown on the count line of the readout, after " · "
   * (the session chart uses it for the activity bar bucket size). Omitted, the
   * readout markup is unchanged.
   */
  readoutNote?: ReactNode
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

/*
 * Wheel input is measured in "notch pixels": Chrome and Edge report one mouse
 * wheel notch as 100px, Firefox as 3 lines. A line therefore counts as a third
 * of a notch and a page as three notches, so one notch zooms the same amount in
 * every browser.
 */
const WHEEL_LINE_PX = 100 / 3
const WHEEL_PAGE_PX = 300
/** One 100px notch narrows the view by e^0.25 (about 22%), on the hub and the stream chart alike. */
const WHEEL_ZOOM_PER_PX = 0.0025
/** No single event zooms more than 2x either way (a page-mode wheel). */
const MAX_WHEEL_ZOOM_RATIO = 2
/** Horizontal or Shift+wheel movement of this many pixels pans one whole view. */
const WHEEL_PAN_PX_PER_VIEW = 800
/** No single event pans more than a quarter of the view. */
const MAX_WHEEL_PAN_FRACTION = 0.25
/** A gesture's sub-step remainder carries over between events at most this far apart. */
const WHEEL_GESTURE_GAP_MS = 1500
/**
 * An event at least this big is a whole wheel notch (Chrome 100px, Firefox 3
 * lines), and always moves the view at least one step.
 * Smaller high-resolution and touchpad deltas add up exactly instead.
 */
const WHEEL_NOTCH_MIN_PX = 50

/**
 * The wheel surface and the navigator can both hear one event (the stream
 * chart's surface contains its navigator). preventDefault() does not mark an
 * event that is not cancelable, so handled events are remembered here instead.
 */
const handledWheelEvents = new WeakSet<Event>()

function wheelDeltaPixels(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta)) return 0
  return deltaMode === 1 ? delta * WHEEL_LINE_PX : deltaMode === 2 ? delta * WHEEL_PAGE_PX : delta
}

/**
 * Exact (fractional) view a wheel gesture has reached. Wheel zoom and pan work
 * on this, so a burst of small high-resolution or touchpad deltas moves the
 * view as far as one notch of the same total, instead of every tiny event
 * forcing at least one whole step.
 */
interface WheelGestureState {
  start: number
  end: number
  /** Whole-step range last sent for this gesture; a different input range starts a new gesture. */
  emitted: ChartNavigatorRange
  pointCount: number
  timeStamp: number
}

export interface WheelGestureResult {
  /** Exact view after the event. */
  start: number
  end: number
  /** Whole-step range to show. */
  range: ChartNavigatorRange
  /** False when the view could not move (at a zoom or pan limit): the page keeps the event. */
  moved: boolean
}

/**
 * One wheel event applied to the navigator's exact view. Zoom keeps the step
 * under `anchorRatio` (0 = left edge, 1 = right edge) in place; pan moves by the
 * pixel delta. A whole notch always shows at least one step of change. Pure,
 * so the wheel matrix can be checked without a browser.
 */
export function applyWheelGesture(args: {
  pointCount: number
  minVisibleCount?: number
  /** Whole-step range on screen now. */
  current: ChartNavigatorRange
  /** Exact view the gesture has reached (defaults to `current`). */
  start?: number
  end?: number
  mode: 'zoom' | 'pan'
  /** Pixel delta along the gesture's axis (deltaY for zoom, the pan delta for pan). */
  deltaPixels: number
  anchorRatio?: number
}): WheelGestureResult {
  const { pointCount, mode, deltaPixels, current } = args
  const maxIndex = Math.max(0, pointCount - 1)
  const minCount = minimumCount(pointCount, args.minVisibleCount ?? 2)
  const fromStart = args.start ?? current.startIndex
  const fromEnd = args.end ?? current.endIndex
  const count = clamp(fromEnd - fromStart + 1, minCount, Math.max(minCount, pointCount))
  const startLimit = (span: number) => Math.max(0, pointCount - span)
  let start = clamp(fromStart, 0, startLimit(count))
  let nextCount = count
  const anchorRatio = clamp(Number.isFinite(args.anchorRatio) ? args.anchorRatio! : 0.5, 0, 1)
  if (mode === 'pan') {
    const fullView = start <= 0 && count >= pointCount
    const shift = clamp(
      count * (deltaPixels / WHEEL_PAN_PX_PER_VIEW),
      -count * MAX_WHEEL_PAN_FRACTION,
      count * MAX_WHEEL_PAN_FRACTION,
    )
    if (!fullView && Number.isFinite(shift)) start = clamp(start + shift, 0, startLimit(count))
  } else {
    const ratio = clamp(Math.exp(deltaPixels * WHEEL_ZOOM_PER_PX), 1 / MAX_WHEEL_ZOOM_RATIO, MAX_WHEEL_ZOOM_RATIO)
    nextCount = clamp(count * (Number.isFinite(ratio) ? ratio : 1), minCount, Math.max(minCount, pointCount))
    const anchor = start + anchorRatio * Math.max(0, count - 1)
    start = clamp(anchor - anchorRatio * Math.max(0, nextCount - 1), 0, startLimit(nextCount))
  }
  const roundedCount = clamp(Math.round(nextCount), minCount, Math.max(minCount, pointCount))
  const roundedStart = clamp(Math.round(start), 0, startLimit(roundedCount))
  let range = { startIndex: roundedStart, endIndex: Math.min(maxIndex, roundedStart + roundedCount - 1) }
  const moved = Math.abs(start - fromStart) > 1e-9 || Math.abs(nextCount - count) > 1e-9
  const unchanged = range.startIndex === current.startIndex && range.endIndex === current.endIndex
  if (moved && unchanged && Math.abs(deltaPixels) >= WHEEL_NOTCH_MIN_PX) {
    // A whole notch that rounds back to the same view still takes one step.
    const currentCount = current.endIndex - current.startIndex + 1
    const direction = Math.sign(deltaPixels)
    if (mode === 'pan') {
      const stepped = clamp(current.startIndex + direction, 0, startLimit(currentCount))
      range = { startIndex: stepped, endIndex: stepped + currentCount - 1 }
    } else {
      const steppedCount = clamp(currentCount + direction, minCount, Math.max(minCount, pointCount))
      const anchor = current.startIndex + anchorRatio * Math.max(0, currentCount - 1)
      const steppedStart = clamp(Math.round(anchor - anchorRatio * (steppedCount - 1)), 0, startLimit(steppedCount))
      range = { startIndex: steppedStart, endIndex: Math.min(maxIndex, steppedStart + steppedCount - 1) }
    }
    return { start: range.startIndex, end: range.endIndex, range, moved: true }
  }
  return { start, end: start + nextCount - 1, range, moved }
}

/** Fewest visible steps for a navigator, never more than it has. */
function minimumCount(pointCount: number, minVisibleCount = 2): number {
  return clamp(Math.round(minVisibleCount), 2, Math.max(2, pointCount))
}

function normalizedRange(
  pointCount: number,
  startIndex: number,
  endIndex: number,
  minVisibleCount = 2,
): ChartNavigatorRange {
  const maxIndex = Math.max(0, pointCount - 1)
  const minimumSpan = maxIndex > 0 ? Math.min(maxIndex, minimumCount(pointCount, minVisibleCount) - 1) : 0
  const end = clamp(Math.round(endIndex), minimumSpan, maxIndex)
  const start = clamp(Math.round(startIndex), 0, Math.max(0, end - minimumSpan))
  return { startIndex: start, endIndex: end }
}

/** Zoom the loaded viewport without changing the requested server range. */
export function zoomNavigatorRange(
  pointCount: number,
  currentRange: ChartNavigatorRange,
  focusIndex: number | null | undefined,
  direction: 'in' | 'out',
  minVisibleCount = 2,
): ChartNavigatorRange {
  const range = normalizedRange(pointCount, currentRange.startIndex, currentRange.endIndex, minVisibleCount)
  if (pointCount < 2) return range
  const visibleCount = range.endIndex - range.startIndex + 1
  const nextCount = clamp(
    direction === 'in' ? Math.ceil(visibleCount / 2) : visibleCount * 2,
    minimumCount(pointCount, minVisibleCount),
    pointCount,
  )
  if (nextCount === visibleCount) return range
  const focusVisible = focusIndex != null && focusIndex >= range.startIndex && focusIndex <= range.endIndex
  const center = direction === 'in' && focusVisible ? focusIndex : (range.startIndex + range.endIndex) / 2
  const nextStart = clamp(Math.round(center - (nextCount - 1) / 2), 0, pointCount - nextCount)
  return { startIndex: nextStart, endIndex: nextStart + nextCount - 1 }
}

/**
 * Keyboard- and pointer-accessible navigator for the activity payload already
 * loaded in the browser. It never changes the requested server range.
 */
export function ChartNavigator({
  pointCount,
  startIndex,
  endIndex,
  controlRange,
  visualRange,
  startLabel,
  endLabel,
  focusIndex = null,
  selectedIndex = null,
  presets = [],
  wheelSurfaceRef,
  wheelAnchor,
  minVisibleCount = 2,
  scrollZoomEnabled,
  onScrollZoomChange,
  onChange,
  onDragStart,
  onReset,
  fullRangeLabel = 'Full loaded range',
  zoomedRangeLabel = 'Zoomed view',
  unitLabel = 'buckets',
  selectedLabel = 'Show selected bucket',
  readoutNote,
}: ChartNavigatorProps) {
  const maxIndex = Math.max(0, pointCount - 1)
  const minCount = minimumCount(pointCount, minVisibleCount)
  // Steps between the first and last visible step at the floor.
  const minSpan = Math.min(maxIndex, minCount - 1)
  const range = normalizedRange(pointCount, startIndex, endIndex, minVisibleCount)
  const inputRangeRef = useRef(controlRange ?? range)
  useLayoutEffect(() => {
    inputRangeRef.current = controlRange ?? range
  }, [controlRange?.startIndex, controlRange?.endIndex, range.startIndex, range.endIndex])
  const emitRange = (next: ChartNavigatorRange, animate = true) => {
    inputRangeRef.current = next
    onChange(next, animate)
  }
  const span = Math.max(1, maxIndex)
  const left = ((visualRange ?? range).startIndex / span) * 100
  const right = ((visualRange ?? range).endIndex / span) * 100
  const width = Math.max(1, right - left)
  const isFullRange = range.startIndex === 0 && range.endIndex === maxIndex
  const visibleCount = range.endIndex - range.startIndex + 1
  const selectedOutsideView = selectedIndex != null && selectedIndex >= 0 && selectedIndex < pointCount &&
    (selectedIndex < range.startIndex || selectedIndex > range.endIndex)
  const trackRef = useRef<HTMLDivElement>(null)
  const navigatorRef = useRef<HTMLDivElement>(null)
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
    let next: ChartNavigatorRange
    if (drag.mode === 'brush') {
      const pointerIndex = globalPointerIndex(event.clientX, drag.trackLeft, drag.trackWidth)
      if (!drag.hasMoved && Math.abs(event.clientX - drag.startClientX) < 2) return
      drag.hasMoved = true
      const first = Math.min(drag.anchorIndex, pointerIndex)
      const last = Math.max(drag.anchorIndex, pointerIndex)
      if (last - first >= minSpan) next = { startIndex: first, endIndex: last }
      else {
        // Below the floor the brush grows from its anchor towards the pointer.
        const nextStart = pointerIndex >= drag.anchorIndex
          ? clamp(first, 0, maxIndex - minSpan)
          : clamp(last - minSpan, 0, maxIndex - minSpan)
        next = { startIndex: nextStart, endIndex: nextStart + minSpan }
      }
    } else if (drag.mode === 'start') {
      next = {
        startIndex: clamp(drag.startIndex + roundedDelta, 0, Math.max(0, drag.endIndex - minSpan)),
        endIndex: drag.endIndex,
      }
    } else if (drag.mode === 'end') {
      next = {
        startIndex: drag.startIndex,
        endIndex: clamp(
          drag.endIndex + roundedDelta,
          Math.min(maxIndex, drag.startIndex + minSpan),
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
    if (next.startIndex !== range.startIndex || next.endIndex !== range.endIndex) emitRange(next, false)
  }

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    if (cancelled) emitRange({ startIndex: drag.startIndex, endIndex: drag.endIndex }, false)
    else {
      emitFromPointer(event)
      if (drag.mode === 'brush' && !drag.hasMoved) {
        const currentCount = drag.endIndex - drag.startIndex + 1
        const defaultCount = presets[0]?.pointCount ?? Math.max(2, Math.round(pointCount / 4))
        const nextCount = clamp(isFullRange ? defaultCount : currentCount, minCount, pointCount)
        let nextStart = Math.round(drag.anchorIndex - (nextCount - 1) / 2)
        nextStart = clamp(nextStart, 0, Math.max(0, pointCount - nextCount))
        emitRange({ startIndex: nextStart, endIndex: nextStart + nextCount - 1 })
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
    const dragRange = onDragStart?.() ?? range
    inputRangeRef.current = dragRange
    dragRef.current = {
      pointerId: event.pointerId,
      mode,
      startClientX: event.clientX,
      startIndex: dragRange.startIndex,
      endIndex: dragRange.endIndex,
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
    const inputRange = inputRangeRef.current
    if (handle === 'start') {
      emitRange({
        startIndex: clamp(inputRange.startIndex + delta, 0, Math.max(0, inputRange.endIndex - minSpan)),
        endIndex: inputRange.endIndex,
      })
    } else {
      emitRange({
        startIndex: inputRange.startIndex,
        endIndex: clamp(
          inputRange.endIndex + delta,
          Math.min(maxIndex, inputRange.startIndex + minSpan),
          maxIndex,
        ),
      })
    }
  }

  const zoomFromCenter = (direction: 'in' | 'out') => {
    const inputRange = inputRangeRef.current
    const next = zoomNavigatorRange(pointCount, inputRange, focusIndex, direction, minVisibleCount)
    if (next.startIndex !== inputRange.startIndex || next.endIndex !== inputRange.endIndex) emitRange(next)
  }

  const showSelectedBucket = () => {
    if (!selectedOutsideView || selectedIndex == null) return
    const nextStart = clamp(Math.round(selectedIndex - (visibleCount - 1) / 2), 0, pointCount - visibleCount)
    emitRange({ startIndex: nextStart, endIndex: nextStart + visibleCount - 1 })
  }

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    handle: 'start' | 'end',
  ) => {
    const inputRange = inputRangeRef.current
    const step = event.shiftKey ? 5 : 1
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveHandleByKeyboard(handle, -step)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveHandleByKeyboard(handle, step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      if (handle === 'start') emitRange({ startIndex: 0, endIndex: inputRange.endIndex })
      else emitRange({ startIndex: inputRange.startIndex, endIndex: Math.min(maxIndex, inputRange.startIndex + minSpan) })
    } else if (event.key === 'End') {
      event.preventDefault()
      if (handle === 'start') emitRange({ startIndex: Math.max(0, inputRange.endIndex - minSpan), endIndex: inputRange.endIndex })
      else emitRange({ startIndex: inputRange.startIndex, endIndex: maxIndex })
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onReset()
    }
  }

  // Plain scrolling stays available until the user explicitly enables Scroll
  // zoom. Alt+wheel works without that mode. Ctrl+wheel (also how a touchpad
  // pinch arrives) and Meta+wheel always stay the browser's page zoom.
  const wheelGestureRef = useRef<WheelGestureState | null>(null)
  const handleWheel = (event: WheelEvent, surface: Element) => {
    // A chart inside the wheel surface may already have zoomed for this event,
    // or the navigator inside this surface already took it.
    if (event.defaultPrevented || handledWheelEvents.has(event)) return
    if (maxIndex <= 1 || event.ctrlKey || event.metaKey) return
    const zoomMode = scrollZoomEnabled || event.altKey
    const rect = surface.getBoundingClientRect()
    if (!rect || rect.width <= 0) return

    const deltaX = wheelDeltaPixels(event.deltaX, event.deltaMode)
    const deltaY = wheelDeltaPixels(event.deltaY, event.deltaMode)
    const horizontalIntent = Math.abs(deltaX) > Math.abs(deltaY)
    const shouldPan = event.shiftKey || horizontalIntent
    if (!zoomMode && !shouldPan) return
    const deltaPixels = shouldPan ? (event.shiftKey ? (deltaY || deltaX) : deltaX) : deltaY
    if (deltaPixels === 0) return

    const inputRange = inputRangeRef.current
    const previous = wheelGestureRef.current
    const continues = previous != null
      && previous.pointCount === pointCount
      && previous.emitted.startIndex === inputRange.startIndex
      && previous.emitted.endIndex === inputRange.endIndex
      && Math.abs(event.timeStamp - previous.timeStamp) <= WHEEL_GESTURE_GAP_MS
    const result = applyWheelGesture({
      pointCount,
      minVisibleCount,
      current: inputRange,
      start: continues ? previous.start : undefined,
      end: continues ? previous.end : undefined,
      mode: shouldPan ? 'pan' : 'zoom',
      deltaPixels,
      anchorRatio: (event.clientX - rect.left) / Math.max(1, rect.width),
    })
    // At a zoom or pan limit nothing can move: leave the event to the page.
    if (!result.moved) return
    handledWheelEvents.add(event)
    event.preventDefault()
    const changed = result.range.startIndex !== inputRange.startIndex || result.range.endIndex !== inputRange.endIndex
    wheelGestureRef.current = {
      start: result.start,
      end: result.end,
      emitted: changed ? result.range : inputRange,
      pointCount,
      timeStamp: event.timeStamp,
    }
    if (changed) emitRange(result.range)
  }

  useEffect(() => {
    const navigator = navigatorRef.current
    if (!navigator) return
    const surfaces = [navigator, wheelSurfaceRef?.current]
      .filter((surface): surface is HTMLElement => surface != null)
      .filter((surface, index, all) => all.indexOf(surface) === index)
    const listeners = surfaces.map((surface) => {
      const onWheel = (event: WheelEvent) => handleWheel(
        event,
        surface === navigator ? trackRef.current ?? surface : wheelAnchor?.() ?? surface,
      )
      surface.addEventListener('wheel', onWheel, { passive: false })
      return { surface, onWheel }
    })
    return () => listeners.forEach(({ surface, onWheel }) => surface.removeEventListener('wheel', onWheel))
  })

  return (
    <div
      ref={navigatorRef}
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
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && scrollZoomEnabled) {
          event.preventDefault()
          event.stopPropagation()
          onReset()
        }
      }}
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
              aria-valuemax={Math.max(0, range.endIndex - minSpan)}
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
              aria-valuemin={Math.min(maxIndex, range.startIndex + minSpan)}
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
        <span className="hx-chart-navigator__range" data-hub-chart-navigator-range aria-live="polite" aria-atomic="true">
          {startLabel} – {endLabel}
        </span>
      </div>
      <div className="hx-chart-navigator__actions">
        <div className="hx-chart-navigator__readout" role="status" aria-live="polite">
          <strong>{isFullRange ? fullRangeLabel : zoomedRangeLabel}</strong>
          <span className="hx-chart-navigator__time-range">{startLabel} – {endLabel}</span>
          <span className="hx-chart-navigator__bucket-count">{visibleCount} of {pointCount} {unitLabel}{readoutNote != null ? <> · {readoutNote}</> : null}</span>
        </div>
        <div className="hx-chart-navigator__toolbar" role="group" aria-label="Chart view controls">
          {selectedOutsideView ? <button type="button" onClick={(event) => { event.stopPropagation(); showSelectedBucket() }}><LocateFixed size={15} aria-hidden="true" />{selectedLabel}</button> : null}
          <div className="hx-chart-navigator__zoom-buttons">
            <button type="button" disabled={visibleCount <= minCount} onClick={() => zoomFromCenter('in')}><Plus size={15} aria-hidden="true" />Zoom in</button>
            <button type="button" disabled={isFullRange} onClick={() => zoomFromCenter('out')}><Minus size={15} aria-hidden="true" />Zoom out</button>
            <button type="button" disabled={isFullRange && !scrollZoomEnabled} onClick={onReset}><RotateCcw size={15} aria-hidden="true" />Reset zoom</button>
          </div>
          <button
            type="button"
            className="hx-chart-navigator__scroll-toggle"
            aria-pressed={scrollZoomEnabled}
            disabled={pointCount <= 2}
            onClick={() => onScrollZoomChange(!scrollZoomEnabled)}
          ><Mouse size={15} aria-hidden="true" />Scroll zoom<span className="hx-chart-navigator__scroll-state" aria-hidden="true">{scrollZoomEnabled ? 'On' : 'Off'}</span></button>
        </div>
      </div>
      <small className="hx-chart-navigator__hint">{scrollZoomEnabled
        ? 'Scroll zoom is on · Scroll over the chart to zoom · Escape or Reset zoom restores page scrolling'
        : 'Drag the purple bar to select a time span · Turn on Scroll zoom or hold Alt to zoom with the wheel'} · Shift + scroll to pan</small>
      <span id={hintId} className="sr-only">
        Drag the purple track to select a loaded time span. Drag the selected window to pan, or use its start and end sliders to resize. Enable Scroll zoom to zoom with the mouse wheel over this chart; otherwise hold Alt while scrolling. Shift plus wheel or a horizontal trackpad swipe pans a zoomed view. Double-click the track, use Reset zoom, or press Escape on either slider to restore the full loaded range and turn Scroll zoom off. Ctrl and Meta wheel gestures remain available for browser zoom.
      </span>
    </div>
  )
}
