import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { useChartScrollZoom } from './chartScrollZoom.ts'
import { installWheelDebug, noteWheelOutcome } from './chartWheelDebug.ts'

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
const Info = navigatorIcon('info', [
  ['circle', { cx: '12', cy: '12', r: '10' }],
  ['path', { d: 'M12 16v-4' }],
  ['path', { d: 'M12 8h.01' }],
])
const LocateFixed = navigatorIcon('locate-fixed', [
  ['line', { x1: '2', x2: '5', y1: '12', y2: '12' }],
  ['line', { x1: '19', x2: '22', y1: '12', y2: '12' }],
  ['line', { x1: '12', x2: '12', y1: '2', y2: '5' }],
  ['line', { x1: '12', x2: '12', y1: '19', y2: '22' }],
  ['circle', { cx: '12', cy: '12', r: '7' }],
  ['circle', { cx: '12', cy: '12', r: '3' }],
])

export { CHART_SCROLL_ZOOM_STORAGE_KEY, useChartScrollZoom } from './chartScrollZoom.ts'

export interface ChartNavigatorRange {
  startIndex: number
  endIndex: number
}

export interface ChartNavigatorPreset {
  label: string
  pointCount: number
}

/*
 * The chart core's viewport store (pulse-charts sp core, plan §2.1), declared
 * here structurally so this package never imports pulse-charts internals. Any
 * object of this shape works.
 */
export interface SpRange { startIndex: number; endIndex: number }
export interface SpViewportSource { getTarget(): SpRange; getVisual(): SpRange; setTarget(next: SpRange, opts?: { animate?: boolean }): void; subscribeTarget(cb: () => void): () => void; subscribeFrame(cb: (visual: SpRange) => void): () => void; subscribeSettle(cb: (settled: SpRange) => void): () => void }

/** Activity silhouette behind the navigator track: a path `d` drawn in a `width` x `height` box, stretched to the track. */
export interface ChartNavigatorOverview {
  d: string
  width: number
  height: number
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
  /**
   * The chart's card: its header and focus rows, the plot and its lanes, the
   * time axis and this navigator with its buttons and hint. A wheel anywhere
   * over it zooms (see `wheelZoneContains`), except over an inner list that can
   * still scroll that way. It should contain the navigator, so one listener
   * hears every part of the card, including the gaps between its rows. Do not
   * pass the plot here: Chrome decides from the listening element's box whether
   * a wheel event can be cancelled, so outside it the browser scrolls the page
   * before this code runs, whatever the zone check says.
   */
  wheelSurfaceRef?: RefObject<HTMLElement | null>
  /**
   * The plot box. Wheel zoom keeps the step under the pointer's x position on
   * it in place; it never limits where the wheel zooms. Omitted, the wheel
   * surface itself is the anchor.
   */
  wheelAnchor?: () => Element | null | undefined
  /**
   * Fewest steps the view can show (default 2). Zoom in disables at this
   * floor, and wheel, brush and handle gestures stop there instead of letting
   * the chart widen the view again.
   */
  minVisibleCount?: number
  /**
   * Whether a plain wheel over the plot zooms. Omitted, the navigator uses the
   * remembered site-wide preference (useChartScrollZoom), which is on by default.
   */
  scrollZoomEnabled?: boolean
  onScrollZoomChange?: (enabled: boolean) => void
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
  /**
   * d3 variant only. 'screen-reader' reads "<range> · <note>" on screen (d3-v2
   * session-original: "Full stream · 10-min bars") and keeps the step counts
   * for assistive tech only. Default 'visible' keeps the count line.
   */
  readoutCount?: 'visible' | 'screen-reader'
  /**
   * The chart's viewport store. When given, the navigator reads the target
   * range from it (one render per target change), moves the purple window
   * and writes `data-chart-viewport-start/end` on every store frame without a
   * React render, and sends wheel, drag, zoom button and track-click changes
   * to `setTarget`. `onChange` still fires, once per settle, so a host keeps
   * only the settled range in its state. `startIndex`, `endIndex`,
   * `controlRange` and `visualRange` are then ignored. Omitted, nothing changes.
   */
  viewportSource?: SpViewportSource
  /** Activity silhouette drawn behind the track (fill #8e8e96 at 28%). */
  overview?: ChartNavigatorOverview | null
  /**
   * 'd3' adds `.spc-nav` (styled only by the site's sp-navigator.css): a flat
   * purple track with grips and one control row of - / + / Reset / Scroll zoom
   * with its hint. Omitted, the markup is unchanged.
   */
  variant?: 'd3'
  /**
   * The session chart (d3-v2 session-original, 2026-10-14/15 declutter C21),
   * with variant 'd3' only: the hint and Scroll zoom move into an (i) at the
   * end of the control row (opened by click or Enter, never hover), and Reset
   * keeps its place but hides while the whole range shows. Omitted (the hub),
   * the row is unchanged.
   */
  infoDisclosure?: boolean
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

/**
 * Scroll-through guard. A page scroll that sweeps a plot under the pointer
 * (including trackpad momentum) keeps scrolling the page: while the last wheel
 * event that no chart took is less than this old, a plain wheel over a plot
 * goes to the page too, and extends the window. After this much quiet, the
 * first wheel over the plot zooms. Alt+wheel is never held back.
 */
export const WHEEL_SCROLL_THROUGH_MS = 400
let lastPassedWheelAt = Number.NEGATIVE_INFINITY
let scrollThroughInstalled = false

/**
 * Wheel gestures read the chart's boxes once, at their first event, and reuse
 * them until the gesture gap (WHEEL_GESTURE_GAP_MS) or until this number moves:
 * a scroll anywhere (the page or any list), a window resize, a chart card
 * resize, or a wheel event the page took (it is about to scroll).
 */
let wheelLayoutGeneration = 0
function bumpWheelLayout() {
  wheelLayoutGeneration += 1
}

function installScrollThroughGuard() {
  if (scrollThroughInstalled || typeof window === 'undefined') return
  scrollThroughInstalled = true
  // Bubble phase on window: every navigator listener has already decided.
  window.addEventListener('wheel', (event) => {
    // Taken by a chart, or not a page scroll (browser zoom, or cancelled by
    // some other handler): the page did not move.
    if (handledWheelEvents.has(event) || event.defaultPrevented || event.ctrlKey || event.metaKey) return
    lastPassedWheelAt = event.timeStamp
    bumpWheelLayout()
  }, { passive: true })
  window.addEventListener('scroll', bumpWheelLayout, { capture: true, passive: true })
  window.addEventListener('resize', bumpWheelLayout, { passive: true })
}

function scrollingThrough(timeStamp: number): boolean {
  const since = timeStamp - lastPassedWheelAt
  return since >= 0 && since < WHEEL_SCROLL_THROUGH_MS
}

/** Test hook: forget the last page-scrolling wheel event (and any boxes a gesture cached). */
export function resetChartWheelGuard() {
  lastPassedWheelAt = Number.NEGATIVE_INFINITY
  bumpWheelLayout()
}

/**
 * Marks an element whose wheel is never the chart's: an open bucket card
 * (callout, dock or sheet) placed over or beside the plot. Inside it the wheel
 * scrolls the card's own list or the page, and never zooms.
 */
export const CHART_WHEEL_EXEMPT_ATTRIBUTE = 'data-chart-wheel-exempt'

/** Whether a wheel target sits inside a [data-chart-wheel-exempt] element. */
export function isChartWheelExempt(target: EventTarget | null | undefined): boolean {
  return typeof Element !== 'undefined' && target instanceof Element && target.closest(`[${CHART_WHEEL_EXEMPT_ATTRIBUTE}]`) != null
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
  width: number
}

/**
 * Chrome reports a wheel event's clientX/clientY as whole pixels while boxes
 * sit on fractional ones, so the box is rounded outwards: the first pixel row
 * of a box whose top is at 250.2 reports clientY 250 and still counts.
 */
function pointInRect(rect: Box | undefined, x: number, y: number): boolean {
  return rect != null && rect.width > 0
    && x >= Math.floor(rect.left) && x <= Math.ceil(rect.right)
    && y >= Math.floor(rect.top) && y <= Math.ceil(rect.bottom)
}

/**
 * Whether a wheel at (x, y) is over the chart, so it zooms. The zone is the
 * wheel surface's whole box: the chart's card, from its header and focus rows,
 * through the plot, every lane and the time axis, down to the navigator with
 * its buttons, readout and hint, edge to edge. The plot box always counts too.
 * It is decided by position, not by the event target: labels, lanes, markers,
 * buttons and overlays inside the card all count. (`bar` is kept for callers;
 * the zone no longer stops at the navigator bar.)
 *
 * Do not narrow this again. The plot box alone made the label band and the
 * time axis scroll the page (2026-10-12); stopping at the navigator bar made
 * the card's header and footer scroll it (2026-10-13). Owner rule: the wheel
 * zooms anywhere over a chart card. Only an inner list that can still scroll
 * the way the wheel goes keeps it (see `innerScrollerTakesWheel`), and so does
 * anything inside [data-chart-wheel-exempt] (an open bucket card), when the
 * event target is passed.
 */
export function wheelZoneContains(
  surface: Element,
  _bar: Element | null | undefined,
  plot: Element | null | undefined,
  x: number,
  y: number,
  target?: EventTarget | null,
): boolean {
  return zoneContains(readBox, surface, plot, x, y, target)
}

function readBox(element: Element): Box {
  return element.getBoundingClientRect()
}

function zoneContains(
  rectOf: (element: Element) => Box,
  surface: Element,
  plot: Element | null | undefined,
  x: number,
  y: number,
  target?: EventTarget | null,
): boolean {
  if (isChartWheelExempt(target)) return false
  return pointInRect(rectOf(surface), x, y) || (plot != null && pointInRect(rectOf(plot), x, y))
}

/**
 * Whether a scrollable list inside the chart card (the measured-minute table,
 * a row of focus chips that overflows) should scroll with this wheel instead
 * of the chart zooming: it lies between the event target and the card, it can
 * still move the way the wheel goes, and it is not the chart's own wrapper (one
 * that holds the plot never counts, so the plot always zooms).
 */
export function innerScrollerTakesWheel(event: WheelEvent, surface: Element, plot: Element | null | undefined): boolean {
  if (typeof getComputedStyle !== 'function') return false
  const { horizontal, delta } = wheelScrollIntent(event)
  if (delta === 0) return false
  for (let element = event.target instanceof Element ? event.target : null; element && element !== surface; element = element.parentElement) {
    if (plot && element.contains(plot)) continue
    const style = getComputedStyle(element)
    if (!/(auto|scroll)/.test(horizontal ? style.overflowX : style.overflowY)) continue
    const room = horizontal ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight
    if (room <= 1) continue
    const position = horizontal ? element.scrollLeft : element.scrollTop
    if (delta < 0 ? position > 0.5 : position < room - 0.5) return true
  }
  return false
}

/** Which axis a wheel event scrolls a list along (Shift turns a vertical wheel sideways), and by how much. */
function wheelScrollIntent(event: WheelEvent): { horizontal: boolean; delta: number } {
  const deltaX = wheelDeltaPixels(event.deltaX, event.deltaMode)
  const deltaY = wheelDeltaPixels(event.deltaY, event.deltaMode)
  const horizontal = event.shiftKey || Math.abs(deltaX) > Math.abs(deltaY)
  return { horizontal, delta: horizontal ? (event.shiftKey ? (deltaY || deltaX) : deltaX) : deltaY }
}

function wheelDeltaPixels(delta: number, deltaMode: number): number {
  if (!Number.isFinite(delta)) return 0
  return deltaMode === 1 ? delta * WHEEL_LINE_PX : deltaMode === 2 ? delta * WHEEL_PAGE_PX : delta
}

/**
 * One navigator's layout reads for the current wheel gesture. The first event
 * reads each box it needs (card, plot, track) and the inner-list check; later
 * events reuse them until the gesture gap passes or wheelLayoutGeneration
 * moves (scroll, resize, a wheel the page took). A list that could take the
 * wheel is never cached, because it moves as it scrolls.
 */
interface WheelLayoutCache {
  begin(event: WheelEvent): void
  rectOf(element: Element): Box
  innerScrollerTakes(event: WheelEvent, surface: Element, plot: Element | null | undefined): boolean
}

function createWheelLayoutCache(): WheelLayoutCache {
  let generation = Number.NaN
  let lastAt = Number.NEGATIVE_INFINITY
  const rects = new Map<Element, Box>()
  const noInnerScroller = new Map<EventTarget, Set<string>>()
  return {
    begin(event) {
      const since = event.timeStamp - lastAt
      if (generation !== wheelLayoutGeneration || !(since >= 0 && since <= WHEEL_GESTURE_GAP_MS)) {
        rects.clear()
        noInnerScroller.clear()
      }
      generation = wheelLayoutGeneration
      lastAt = event.timeStamp
    },
    rectOf(element) {
      let rect = rects.get(element)
      if (!rect) {
        rect = element.getBoundingClientRect()
        rects.set(element, rect)
      }
      return rect
    },
    innerScrollerTakes(event, surface, plot) {
      const target = event.target
      if (!target) return false
      const { horizontal, delta } = wheelScrollIntent(event)
      if (delta === 0) return false
      const key = `${horizontal ? 'x' : 'y'}${delta < 0 ? '-' : '+'}`
      if (noInnerScroller.get(target)?.has(key)) return false
      const takes = innerScrollerTakesWheel(event, surface, plot)
      if (!takes) {
        const known = noInnerScroller.get(target) ?? new Set<string>()
        known.add(key)
        noInnerScroller.set(target, known)
      }
      return takes
    },
  }
}

/** The purple window's left edge, right edge and width, in percent of the track. */
function brushPercents(startIndex: number, endIndex: number, span: number): { left: number; right: number; width: number } {
  const left = (startIndex / span) * 100
  const right = (endIndex / span) * 100
  return { left, right, width: Math.max(1, right - left) }
}

/** A viewport index for data-chart-viewport-*: fractional while the view eases, at most 3 decimals. */
function formatViewportIndex(value: number): string {
  return String(Math.round(value * 1000) / 1000)
}

const noSourceSubscribe = () => () => {}

/**
 * The silhouette fills the track unless the site's navigator styles place it
 * (sp-navigator.css sets the d3 track's 22px band through these variables).
 */
const OVERVIEW_STYLE: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 'var(--spc-nav-overview-top, 0)',
  width: '100%',
  height: 'var(--spc-nav-overview-height, 100%)',
  display: 'block',
  overflow: 'visible',
  pointerEvents: 'none',
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
  scrollZoomEnabled: scrollZoomProp,
  onScrollZoomChange: onScrollZoomChangeProp,
  onChange,
  onDragStart,
  onReset,
  fullRangeLabel = 'Full loaded range',
  zoomedRangeLabel = 'Zoomed view',
  unitLabel = 'buckets',
  selectedLabel = 'Show selected bucket',
  readoutNote,
  readoutCount = 'visible',
  viewportSource,
  overview,
  variant,
  infoDisclosure = false,
}: ChartNavigatorProps) {
  const [storedScrollZoom, setStoredScrollZoom] = useChartScrollZoom()
  const scrollZoomEnabled = scrollZoomProp ?? storedScrollZoom
  const onScrollZoomChange = onScrollZoomChangeProp ?? setStoredScrollZoom
  const maxIndex = Math.max(0, pointCount - 1)
  const minCount = minimumCount(pointCount, minVisibleCount)
  // Steps between the first and last visible step at the floor.
  const minSpan = Math.min(maxIndex, minCount - 1)
  // With a viewport store, its target is the range (one render per target
  // change); its eased visual range moves the window per frame, below.
  const sourceTargetRef = useRef<SpRange | null>(null)
  const subscribeSourceTarget = useCallback(
    (onStoreChange: () => void) => viewportSource ? viewportSource.subscribeTarget(onStoreChange) : noSourceSubscribe(),
    [viewportSource],
  )
  const getSourceTarget = useCallback((): SpRange | null => {
    if (!viewportSource) return null
    const target = viewportSource.getTarget()
    const cached = sourceTargetRef.current
    if (cached && cached.startIndex === target.startIndex && cached.endIndex === target.endIndex) return cached
    sourceTargetRef.current = { startIndex: target.startIndex, endIndex: target.endIndex }
    return sourceTargetRef.current
  }, [viewportSource])
  const sourceTarget = useSyncExternalStore(subscribeSourceTarget, getSourceTarget, getSourceTarget)
  const range = normalizedRange(
    pointCount,
    sourceTarget?.startIndex ?? startIndex,
    sourceTarget?.endIndex ?? endIndex,
    minVisibleCount,
  )
  const inputRangeRef = useRef(controlRange ?? range)
  useLayoutEffect(() => {
    inputRangeRef.current = controlRange ?? range
  }, [controlRange?.startIndex, controlRange?.endIndex, range.startIndex, range.endIndex])
  /** The range input composes on: the store's target, or the latest emitted / controlled range. */
  const readInputRange = (): ChartNavigatorRange => {
    if (!viewportSource) return inputRangeRef.current
    const target = viewportSource.getTarget()
    return normalizedRange(pointCount, target.startIndex, target.endIndex, minVisibleCount)
  }
  const emitRange = (next: ChartNavigatorRange, animate = true) => {
    if (viewportSource) {
      // The store eases to it; onChange follows on settle.
      viewportSource.setTarget(next, { animate })
      return
    }
    inputRangeRef.current = next
    onChange(next, animate)
  }
  const resetView = () => {
    viewportSource?.setTarget({ startIndex: 0, endIndex: maxIndex }, { animate: true })
    onReset()
  }
  const span = Math.max(1, maxIndex)
  const brushRange = viewportSource ? viewportSource.getVisual() : (visualRange ?? range)
  const { left, right, width } = brushPercents(brushRange.startIndex, brushRange.endIndex, span)
  const isFullRange = range.startIndex === 0 && range.endIndex === maxIndex
  const visibleCount = range.endIndex - range.startIndex + 1
  const selectedOutsideView = selectedIndex != null && selectedIndex >= 0 && selectedIndex < pointCount &&
    (selectedIndex < range.startIndex || selectedIndex > range.endIndex)
  const trackRef = useRef<HTMLDivElement>(null)
  const trackShellRef = useRef<HTMLDivElement>(null)
  /** The bar row (track and range label): the bottom edge of the chart's wheel zone. */
  const barRef = useRef<HTMLDivElement>(null)
  const navigatorRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [draggingMode, setDraggingMode] = useState<DragState['mode'] | null>(null)
  const hintId = useId()
  const windowRef = useRef<HTMLSpanElement>(null)
  const startHandleRef = useRef<HTMLButtonElement>(null)
  const endHandleRef = useRef<HTMLButtonElement>(null)
  const startGripRef = useRef<HTMLSpanElement>(null)
  const endGripRef = useRef<HTMLSpanElement>(null)

  // Per store frame: move the window, its handles and grips, and the
  // data-chart-viewport-* attributes by direct writes (no React render).
  const paintBrushRef = useRef<(visual: SpRange) => void>(() => {})
  paintBrushRef.current = (visual) => {
    const brush = brushPercents(visual.startIndex, visual.endIndex, span)
    const windowElement = windowRef.current
    if (windowElement) {
      windowElement.style.left = `${brush.left}%`
      windowElement.style.width = `${brush.width}%`
    }
    startHandleRef.current?.style.setProperty('left', `clamp(22px, ${brush.left}%, calc(100% - 22px))`)
    endHandleRef.current?.style.setProperty('left', `clamp(22px, ${brush.right}%, calc(100% - 22px))`)
    startGripRef.current?.style.setProperty('left', `${brush.left}%`)
    endGripRef.current?.style.setProperty('left', `${brush.right}%`)
    const root = navigatorRef.current
    if (root) {
      root.setAttribute('data-chart-viewport-start', formatViewportIndex(visual.startIndex))
      root.setAttribute('data-chart-viewport-end', formatViewportIndex(visual.endIndex))
    }
  }
  useLayoutEffect(() => {
    if (!viewportSource) return
    paintBrushRef.current(viewportSource.getVisual())
    return viewportSource.subscribeFrame((visual) => paintBrushRef.current(visual))
  }, [viewportSource, span])
  // The host keeps only the settled range: onChange fires once per settle.
  const settleRef = useRef<(settled: SpRange) => void>(() => {})
  settleRef.current = (settled) => {
    onChange(normalizedRange(pointCount, settled.startIndex, settled.endIndex, minVisibleCount), false)
  }
  useEffect(() => {
    if (!viewportSource) return
    return viewportSource.subscribeSettle((settled) => settleRef.current(settled))
  }, [viewportSource])

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
    const shown = viewportSource ? readInputRange() : range
    if (next.startIndex !== shown.startIndex || next.endIndex !== shown.endIndex) emitRange(next, false)
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
    // With a store, the drag starts from its target (onDragStart is still told).
    const hostDragRange = onDragStart?.()
    const dragRange = viewportSource ? readInputRange() : (hostDragRange ?? range)
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
    const inputRange = readInputRange()
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
    const inputRange = readInputRange()
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
    const inputRange = readInputRange()
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
      resetView()
    }
  }

  // A plain wheel anywhere over the chart (see wheelZoneContains) or the
  // navigator track zooms around the pointer while Scroll zoom is on, which is
  // the default. Everywhere else the page scrolls. Alt+wheel zooms in either
  // mode; Shift+wheel and horizontal swipes pan a zoomed view. Ctrl+wheel (also
  // how a touchpad pinch arrives) and Meta+wheel always stay the browser's
  // page zoom.
  const wheelGestureRef = useRef<WheelGestureState | null>(null)
  /** Time of the last wheel event this navigator took, for the zoom-in floor rule. */
  const lastHandledWheelAtRef = useRef(Number.NEGATIVE_INFINITY)
  /** This navigator's layout reads for the current wheel gesture. */
  const wheelLayoutRef = useRef<WheelLayoutCache | null>(null)
  wheelLayoutRef.current ??= createWheelLayoutCache()
  const handleWheel = (
    event: WheelEvent,
    inZone: (x: number, y: number) => boolean,
    anchor: Element | null | undefined,
    rectOf: (element: Element) => Box,
  ) => {
    // A chart inside the wheel surface may already have zoomed for this event,
    // or the navigator inside this surface already took it.
    if (event.defaultPrevented || handledWheelEvents.has(event)) return
    // An open bucket card over or beside the plot keeps its own wheel.
    if (isChartWheelExempt(event.target)) return noteWheelOutcome(event, 'pass:exempt')
    if (event.ctrlKey || event.metaKey) return noteWheelOutcome(event, 'pass:browser-zoom')
    if (maxIndex <= 1) return noteWheelOutcome(event, 'pass:no-range')
    // By the pointer's position, not the event target.
    if (!anchor || !inZone(event.clientX, event.clientY)) return noteWheelOutcome(event, 'pass:outside-chart')
    const rect = rectOf(anchor)

    const deltaX = wheelDeltaPixels(event.deltaX, event.deltaMode)
    const deltaY = wheelDeltaPixels(event.deltaY, event.deltaMode)
    const horizontalIntent = Math.abs(deltaX) > Math.abs(deltaY)
    const shouldPan = event.shiftKey || horizontalIntent
    if (!shouldPan && !scrollZoomEnabled && !event.altKey) return noteWheelOutcome(event, 'pass:off')
    const deltaPixels = shouldPan ? (event.shiftKey ? (deltaY || deltaX) : deltaX) : deltaY
    if (deltaPixels === 0) return noteWheelOutcome(event, 'pass:limit')
    // A page scroll sweeping the plot under the pointer keeps scrolling.
    if (!shouldPan && !event.altKey && scrollingThrough(event.timeStamp)) {
      return noteWheelOutcome(event, 'pass:scroll-through')
    }

    const inputRange = readInputRange()
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
    const sinceHandled = event.timeStamp - lastHandledWheelAtRef.current
    const take = () => {
      handledWheelEvents.add(event)
      event.preventDefault()
      lastHandledWheelAtRef.current = event.timeStamp
      noteWheelOutcome(event, shouldPan ? 'pan' : 'zoom')
    }
    if (!result.moved) {
      // A zoom-in that reaches the floor in the middle of a gesture is taken,
      // so the page does not jump; a fresh one after a pause goes to the page.
      // Zooming out at the full range, and panning at an end, always do.
      if (!shouldPan && deltaPixels < 0 && sinceHandled >= 0 && sinceHandled <= WHEEL_GESTURE_GAP_MS) return take()
      return noteWheelOutcome(event, 'pass:limit')
    }
    take()
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
  // Listeners stay bound across renders and always call the latest handler.
  const wheelHandlerRef = useRef(handleWheel)
  wheelHandlerRef.current = handleWheel
  const wheelAnchorRef = useRef(wheelAnchor)
  wheelAnchorRef.current = wheelAnchor

  useEffect(() => {
    installScrollThroughGuard()
    installWheelDebug()
    const navigator = navigatorRef.current
    if (!navigator) return
    // The track zooms around the step under the pointer on the track. Elsewhere
    // in the navigator, the chart's wheel surface (when it holds the navigator)
    // decides.
    const onWheel = (event: WheelEvent) => {
      const layout = wheelLayoutRef.current!
      layout.begin(event)
      wheelHandlerRef.current(
        event,
        (x, y) => {
          const shell = trackShellRef.current
          return shell != null && pointInRect(layout.rectOf(shell), x, y)
        },
        trackRef.current,
        layout.rectOf,
      )
    }
    navigator.addEventListener('wheel', onWheel, { passive: false })
    return () => navigator.removeEventListener('wheel', onWheel)
  }, [])

  // The chart surface can be swapped by its chart; rebind only when it is.
  const boundSurfaceRef = useRef<{ surface: HTMLElement; release: () => void } | null>(null)
  useEffect(() => {
    const surface = wheelSurfaceRef?.current ?? null
    if (boundSurfaceRef.current?.surface === surface) return
    boundSurfaceRef.current?.release()
    boundSurfaceRef.current = null
    if (!surface || surface === navigatorRef.current) return
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || handledWheelEvents.has(event)) return
      if (isChartWheelExempt(event.target)) return noteWheelOutcome(event, 'pass:exempt')
      const layout = wheelLayoutRef.current!
      layout.begin(event)
      const plot = wheelAnchorRef.current?.() ?? surface
      if (layout.innerScrollerTakes(event, surface, plot)) return noteWheelOutcome(event, 'pass:inner-scroll')
      wheelHandlerRef.current(
        event,
        (x, y) => zoneContains(layout.rectOf, surface, plot, x, y, event.target),
        plot,
        layout.rectOf,
      )
    }
    surface.addEventListener('wheel', onWheel, { passive: false })
    // A card that changes size (a lane opens, the page reflows) re-measures.
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(bumpWheelLayout) : null
    resizeObserver?.observe(surface)
    boundSurfaceRef.current = {
      surface,
      release: () => {
        surface.removeEventListener('wheel', onWheel)
        resizeObserver?.disconnect()
      },
    }
  })
  useEffect(() => () => {
    boundSurfaceRef.current?.release()
    boundSurfaceRef.current = null
  }, [])

  const isD3 = variant === 'd3'
  const withInfo = isD3 && infoDisclosure
  const [infoOpen, setInfoOpen] = useState(false)
  const infoButtonRef = useRef<HTMLButtonElement>(null)
  const infoPanelRef = useRef<HTMLDivElement>(null)
  const scrollToggleRef = useRef<HTMLButtonElement>(null)
  const resetButtonRef = useRef<HTMLButtonElement>(null)
  const zoomInButtonRef = useRef<HTMLButtonElement>(null)
  const infoPanelId = useId()
  const closeInfo = useCallback((focusButton: boolean) => {
    setInfoOpen(false)
    if (focusButton) infoButtonRef.current?.focus()
  }, [])
  useEffect(() => {
    if (!infoOpen) return
    // Capture, ahead of the chart's own Escape (which restores the full range).
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      const active = document.activeElement
      closeInfo(!!active && (infoPanelRef.current?.contains(active) || active === infoButtonRef.current))
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (infoPanelRef.current?.contains(target) || infoButtonRef.current?.contains(target))) return
      closeInfo(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [closeInfo, infoOpen])
  // Reset hides at the full range; if it had focus (it was just used), focus
  // moves to Zoom in before the hidden button drops it to the page.
  useLayoutEffect(() => {
    if (withInfo && isFullRange && document.activeElement === resetButtonRef.current) zoomInButtonRef.current?.focus()
  }, [isFullRange, withInfo])
  const scrollHint = scrollZoomEnabled
    ? 'Scroll over the chart to zoom · Shift + scroll to pan · Drag the purple bar to pick a span'
    : 'Scroll zoom is off: the wheel scrolls the page · Hold Alt and scroll to zoom · Shift + scroll to pan'
  const hint = <small className="hx-chart-navigator__hint">{scrollHint}</small>
  const selectedButton = selectedOutsideView
    ? <button type="button" onClick={(event) => { event.stopPropagation(); showSelectedBucket() }}><LocateFixed size={isD3 ? 16 : 15} aria-hidden="true" />{selectedLabel}</button>
    : null
  const scrollToggle = (
    <button
      ref={scrollToggleRef}
      type="button"
      className="hx-chart-navigator__scroll-toggle"
      aria-pressed={scrollZoomEnabled}
      title="Remembered in this browser"
      disabled={pointCount <= 2}
      onClick={() => onScrollZoomChange(!scrollZoomEnabled)}
    >{isD3 ? null : <Mouse size={15} aria-hidden="true" />}Scroll zoom<span className="hx-chart-navigator__scroll-state" aria-hidden="true">{scrollZoomEnabled ? 'On' : 'Off'}</span></button>
  )

  return (
    <div
      ref={navigatorRef}
      className={`hx-chart-navigator${isD3 ? ' spc-nav' : ''}${draggingMode ? ' is-dragging' : ''}${isFullRange ? ' is-full-range' : ''}`}
      data-hub-chart-navigator
      data-chart-navigator-variant={variant}
      data-hub-chart-navigator-window={`${range.startIndex}:${range.endIndex}`}
      data-hub-chart-navigator-mode={draggingMode ?? undefined}
      data-chart-viewport-start={viewportSource ? formatViewportIndex(brushRange.startIndex) : undefined}
      data-chart-viewport-end={viewportSource ? formatViewportIndex(brushRange.endIndex) : undefined}
      role="group"
      aria-label="Chart navigator"
      aria-describedby={hintId}
      onPointerMove={emitFromPointer}
      onPointerUp={(event) => finishPointerDrag(event)}
      onPointerCancel={(event) => finishPointerDrag(event, true)}
      onLostPointerCapture={(event) => finishPointerDrag(event, true)}
    >
      <div ref={barRef} className="hx-chart-navigator__bar">
        <div ref={trackShellRef} className="hx-chart-navigator__track-shell">
          <div
            ref={trackRef}
            className="hx-chart-navigator__track"
            onPointerDown={(event) => {
              if (maxIndex > 0) beginPointerDrag(event, 'brush')
            }}
            onDoubleClick={(event) => {
              event.preventDefault()
              resetView()
            }}
            aria-hidden="true"
          >
            {overview && overview.width > 0 && overview.height > 0 ? (
              <svg
                className="hx-chart-navigator__overview"
                data-chart-navigator-overview
                viewBox={`0 0 ${overview.width} ${overview.height}`}
                preserveAspectRatio="none"
                aria-hidden="true"
                focusable="false"
                style={OVERVIEW_STYLE}
              >
                <path d={overview.d} fill="#8e8e96" fillOpacity={0.28} />
              </svg>
            ) : null}
            <span className="hx-chart-navigator__track-fill" />
            <span
              ref={windowRef}
              className="hx-chart-navigator__window"
              style={{ left: `${left}%`, width: `${width}%` }}
              onPointerDown={(event) => {
                if (isFullRange) beginPointerDrag(event, 'brush')
                else beginPointerDrag(event, 'window')
              }}
            />
            {isD3 ? (
              <>
                <span ref={startGripRef} className="spc-nav__grip spc-nav__grip--start" style={{ left: `${left}%` }} />
                <span ref={endGripRef} className="spc-nav__grip spc-nav__grip--end" style={{ left: `${right}%` }} />
              </>
            ) : null}
          </div>
          <div className="hx-chart-navigator__handles">
            <button
              ref={startHandleRef}
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
              ref={endHandleRef}
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
      {isD3 ? (
        // One row, as the d3 design: readout, hint, then - / + / Reset / Scroll zoom.
        <div className="hx-chart-navigator__actions">
          <div className="hx-chart-navigator__readout" role="status" aria-live="polite">
            <strong>{isFullRange ? fullRangeLabel : zoomedRangeLabel}</strong>
            <span className="hx-chart-navigator__time-range">{startLabel} – {endLabel}</span>
            {readoutCount === 'screen-reader' ? (
              <>
                {readoutNote != null ? <><span className="spc-nav__sep" aria-hidden="true"> · </span>{readoutNote}</> : null}
                <span className="hx-chart-navigator__bucket-count sr-only">, {visibleCount} of {pointCount} {unitLabel}</span>
              </>
            ) : (
              <>
                <span className="spc-nav__sep" aria-hidden="true"> · </span>
                <span className="hx-chart-navigator__bucket-count">{visibleCount} of {pointCount} {unitLabel}{readoutNote != null ? <> · {readoutNote}</> : null}</span>
              </>
            )}
          </div>
          {withInfo ? null : hint}
          <div className="hx-chart-navigator__toolbar" role="group" aria-label="Chart view controls">
            {selectedButton}
            <div className="hx-chart-navigator__zoom-buttons">
              {/* As the design: the buttons never grey out. One that cannot act says so
                  to assistive tech (aria-disabled) and does nothing. */}
              <button type="button" className="spc-nav__icon-button" aria-label="Zoom out" aria-disabled={isFullRange || undefined} onClick={() => { if (!isFullRange) zoomFromCenter('out') }}><Minus size={18} aria-hidden="true" /></button>
              <button ref={zoomInButtonRef} type="button" className="spc-nav__icon-button" aria-label="Zoom in" aria-disabled={visibleCount <= minCount || undefined} onClick={() => { if (visibleCount > minCount) zoomFromCenter('in') }}><Plus size={18} aria-hidden="true" /></button>
              <button ref={resetButtonRef} type="button" className={withInfo ? 'spc-nav__reset' : undefined} aria-label="Reset zoom" aria-disabled={isFullRange || undefined} onClick={() => { if (!isFullRange) resetView() }}>Reset</button>
            </div>
            {withInfo ? (
              <span className="spc-nav__info">
                <button
                  ref={infoButtonRef}
                  type="button"
                  className="spc-nav__info-button"
                  aria-label="How to zoom and pan the chart"
                  aria-expanded={infoOpen}
                  aria-controls={infoPanelId}
                  data-chart-navigator-info=""
                  onClick={(event) => {
                    if (infoOpen) {
                      closeInfo(false)
                      return
                    }
                    setInfoOpen(true)
                    // Opened from the keyboard: the toggle is next.
                    if (event.detail === 0) requestAnimationFrame(() => scrollToggleRef.current?.focus())
                  }}
                ><Info size={16} aria-hidden="true" /></button>
                <div
                  ref={infoPanelRef}
                  id={infoPanelId}
                  className="spc-nav__pop"
                  role="group"
                  aria-label="Zoom and pan"
                  hidden={!infoOpen}
                  data-chart-navigator-info-panel=""
                  onBlur={(event) => {
                    const to = event.relatedTarget as Node | null
                    if (to && !infoPanelRef.current?.contains(to) && to !== infoButtonRef.current) closeInfo(false)
                  }}
                >
                  {hint}
                  {scrollToggle}
                </div>
              </span>
            ) : scrollToggle}
          </div>
        </div>
      ) : (
        <>
          <div className="hx-chart-navigator__actions">
            <div className="hx-chart-navigator__readout" role="status" aria-live="polite">
              <strong>{isFullRange ? fullRangeLabel : zoomedRangeLabel}</strong>
              <span className="hx-chart-navigator__time-range">{startLabel} – {endLabel}</span>
              <span className="hx-chart-navigator__bucket-count">{visibleCount} of {pointCount} {unitLabel}{readoutNote != null ? <> · {readoutNote}</> : null}</span>
            </div>
            <div className="hx-chart-navigator__toolbar" role="group" aria-label="Chart view controls">
              {selectedButton}
              <div className="hx-chart-navigator__zoom-buttons">
                <button type="button" disabled={visibleCount <= minCount} onClick={() => zoomFromCenter('in')}><Plus size={15} aria-hidden="true" />Zoom in</button>
                <button type="button" disabled={isFullRange} onClick={() => zoomFromCenter('out')}><Minus size={15} aria-hidden="true" />Zoom out</button>
                <button type="button" disabled={isFullRange} onClick={resetView}><RotateCcw size={15} aria-hidden="true" />Reset zoom</button>
              </div>
              {scrollToggle}
            </div>
          </div>
          {hint}
        </>
      )}
      <span id={hintId} className="sr-only">
        Scroll anywhere over the chart, from its labels down to this bar, to zoom around the pointer while Scroll zoom is on. It is on by default, and your choice is remembered in this browser. When it is off, the wheel scrolls the page and Alt plus wheel zooms. At the full range, scrolling down scrolls the page. Shift plus wheel or a horizontal swipe pans a zoomed view. Ctrl or Command plus wheel zooms the page. With the plot focused, plus, minus and zero zoom in, zoom out and reset. Drag the purple track to select a span, drag the window to pan, or use the start and end sliders. Double-click the track, use Reset zoom, or press Escape to restore the full range.
      </span>
    </div>
  )
}
