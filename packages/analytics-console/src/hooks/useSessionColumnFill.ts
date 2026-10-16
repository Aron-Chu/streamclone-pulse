import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Column fill for the session page (d3-v2 session-original, MOCK
 * session-original.js fitMoments, 2026-10-15).
 *
 * From 1280 px, while the three columns sit side by side and the Moments tab
 * is open, the right column shows as many whole moment rows as fit beside the
 * centre column, never fewer than 5 ("Show N more" counts the rest). When five
 * rows already run past the centre by more than PAD_ALLOW, the chart grows by
 * the difference (up to FILL_MAX) instead; when one more row needs at most
 * PAD_ALLOW px, the centre gives those px as chart-card bottom padding.
 * `maxRows` caps the rows (and the floor with them): the session page passes 3
 * (Aron 2026-10-15), so the chart only grows when those rows run past it.
 *
 * Measurements leave out this hook's own outputs (the pad and a chart growth
 * still in flight), so a result never feeds the next one: one pass per resize.
 */

export const COLUMN_FILL_MIN_ROWS = 5
/** The chart card's own bottom padding: it at most doubles for one more row. */
export const COLUMN_FILL_PAD_ALLOW = 12
/** The most the chart grows to meet the right column. */
export const COLUMN_FILL_MAX_CHART_PX = 200
/** The width from which the columns sit side by side (Tailwind `xl`). */
export const COLUMN_FILL_MIN_WIDTH = 1280

export interface ColumnFillInput {
  /** Distance from one row's top to the next row's top. */
  pitch: number
  /** Rows rendered now. */
  shownRows: number
  totalMoments: number
  /**
   * Room under the right column's own content, against the centre column
   * without this hook's pad (< 0: the rows run past the centre).
   */
  room: number
  /** Chart growth currently requested. */
  fillPx: number
  /** The chart accepts `extraPlotPx`. */
  growChart: boolean
  /** Owner switch: the centre may give up to PAD_ALLOW px as padding. */
  padAllowed: boolean
  /** The most rows the list shows collapsed (no cap by default). */
  maxRows?: number
}

export interface ColumnFillResult {
  fitCount: number
  fillPx: number
  padPx: number
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value))

/** The mockup's fitMoments as a pure function of the measured geometry. */
export function computeColumnFill(input: ColumnFillInput): ColumnFillResult {
  const { pitch, shownRows, totalMoments, room, fillPx, growChart, padAllowed, maxRows = Infinity } = input
  const floorRows = Math.min(COLUMN_FILL_MIN_ROWS, maxRows)
  const minRows = Math.min(floorRows, totalMoments)
  const pad = (px: number) => (padAllowed ? Math.round(clamp(px, 0, COLUMN_FILL_PAD_ALLOW) * 10) / 10 : 0)
  if (!(pitch > 0)) return { fitCount: Math.min(maxRows, Math.max(floorRows, shownRows)), fillPx, padPx: 0 }

  if (growChart) {
    // What the floor of rows would run past the centre.
    const overMin = (minRows - shownRows) * pitch - room
    if (fillPx > 0 || overMin > COLUMN_FILL_PAD_ALLOW) {
      const next = Math.round(clamp(fillPx + overMin, 0, COLUMN_FILL_MAX_CHART_PX))
      if (Math.abs(next - fillPx) >= 1) return { fitCount: floorRows, fillPx: next, padPx: 0 }
      if (fillPx > 0) return { fitCount: floorRows, fillPx, padPx: pad(overMin) }
    }
  }

  // Whole rows the room takes (or, below 0, rows to drop); nearly one more
  // and the centre gives the few px left.
  let k = Math.floor((room + 0.5) / pitch)
  if (room - k * pitch > pitch - COLUMN_FILL_PAD_ALLOW) k += 1
  const fitCount = Math.min(maxRows, Math.max(floorRows, Math.min(totalMoments, shownRows + k)))
  return {
    fitCount,
    fillPx: growChart ? fillPx : 0,
    padPx: pad((Math.min(fitCount, totalMoments) - shownRows) * pitch - room),
  }
}

export interface SessionColumnFillOptions {
  /** Side-by-side layout (not chart focus, right column in the grid). */
  enabled: boolean
  /** Another tab is open: keep the last result. */
  hold?: boolean
  totalMoments: number
  growChart?: boolean
  padAllowed?: boolean
  /** The most rows the list shows collapsed (`computeColumnFill`). */
  maxRows?: number
  /** Changes that must trigger a fresh pass (stream id, data revision). */
  revision?: unknown
}

export interface SessionColumnFill {
  /** Rows the Moments list shows collapsed; undefined below 1280 px or when off. */
  fitCount: number | undefined
  /** Extra chart plot height in px (0 unless `growChart`). */
  extraPlotPx: number
  /** Chart-card bottom padding in px (0 unless `padAllowed`). */
  padPx: number
}

export interface SessionColumnFillRefs {
  center: RefObject<HTMLElement | null>
  right: RefObject<HTMLElement | null>
  /** The Moments tab panel (rows are `[data-moment-row]` inside it). */
  momentsPanel: RefObject<HTMLElement | null>
}

function bottomOf(el: Element, origin: number): number {
  return el.getBoundingClientRect().bottom - origin
}

/** Space a flex-stretched box adds below its content, inside its padding. */
function stretchBelow(box: HTMLElement, contentBottom: number, origin: number): number {
  const cs = getComputedStyle(box)
  const inner = bottomOf(box, origin) - (parseFloat(cs.paddingBottom) || 0) - (parseFloat(cs.borderBottomWidth) || 0)
  return Math.max(0, inner - contentBottom)
}

const SETTLE_FRAMES = 3
const SETTLE_TIMEOUT_MS = 700

export function useSessionColumnFill(
  refs: SessionColumnFillRefs,
  options: SessionColumnFillOptions,
): SessionColumnFill {
  const { enabled, hold = false, totalMoments, growChart = false, padAllowed = false, maxRows, revision } = options
  const [state, setState] = useState<SessionColumnFill>({ fitCount: undefined, extraPlotPx: 0, padPx: 0 })
  const stateRef = useRef(state)
  stateRef.current = state
  const optsRef = useRef({ enabled, hold, totalMoments, growChart, padAllowed, maxRows })
  optsRef.current = { enabled, hold, totalMoments, growChart, padAllowed, maxRows }
  const frame = useRef(0)
  // A chart growth in flight: wait until the centre column stops changing.
  const settle = useRef<{ until: number; lastH: number; stable: number } | null>(null)

  const measure = useCallback(() => {
    frame.current = 0
    const opts = optsRef.current
    const current = stateRef.current
    const wide = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(`(min-width: ${COLUMN_FILL_MIN_WIDTH}px)`).matches
    if (!wide || !opts.enabled) {
      if (current.fitCount !== undefined || current.extraPlotPx || current.padPx) {
        setState({ fitCount: undefined, extraPlotPx: 0, padPx: 0 })
      }
      return
    }
    const center = refs.center.current
    const right = refs.right.current
    const panel = refs.momentsPanel.current
    if (!center || !right || !panel || opts.hold) return
    // An open row or "show all" makes the column taller on purpose: hold.
    if (panel.querySelector('[aria-expanded="true"]')) return

    if (settle.current) {
      const h = center.getBoundingClientRect().height
      const s = settle.current
      s.stable = Math.abs(h - s.lastH) < 0.5 ? s.stable + 1 : 0
      s.lastH = h
      if (s.stable < SETTLE_FRAMES && performance.now() < s.until) {
        frame.current = requestAnimationFrame(measure)
        return
      }
      settle.current = null
    }

    const rows = [...panel.querySelectorAll<HTMLElement>('[data-moment-row]')]
    if (rows.length < 2) return
    const origin = center.getBoundingClientRect().top
    const pitch = rows[1]!.getBoundingClientRect().top - rows[0]!.getBoundingClientRect().top
    const last = rows[rows.length - 1]!
    // The stretch the right column takes from the grid row, wherever it lands:
    // inside the rows' own list, or below the list's last element in the panel.
    const list = last.parentElement
    let slack = list && list !== panel ? stretchBelow(list, bottomOf(last, origin), origin) : 0
    const panelContent = panel.lastElementChild
    if (panelContent && panelContent !== last) slack += stretchBelow(panel, bottomOf(panelContent, origin), origin)
    else if (!list || list === panel) slack += stretchBelow(panel, bottomOf(last, origin), origin)
    const room = (bottomOf(center, origin) - current.padPx) - (bottomOf(right, origin) - slack)

    const next = computeColumnFill({
      pitch,
      shownRows: rows.length,
      totalMoments: opts.totalMoments,
      room,
      fillPx: current.extraPlotPx,
      growChart: opts.growChart,
      padAllowed: opts.padAllowed,
      maxRows: opts.maxRows,
    })
    if (
      next.fitCount === current.fitCount
      && next.fillPx === current.extraPlotPx
      && Math.abs(next.padPx - current.padPx) < 0.1
    ) return
    if (next.fillPx !== current.extraPlotPx) {
      settle.current = {
        until: performance.now() + SETTLE_TIMEOUT_MS,
        lastH: center.getBoundingClientRect().height,
        stable: 0,
      }
    }
    setState({ fitCount: next.fitCount, extraPlotPx: next.fillPx, padPx: next.padPx })
  }, [refs.center, refs.right, refs.momentsPanel])

  const schedule = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(measure)
  }, [measure])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(schedule)
    for (const el of [refs.center.current, refs.right.current, refs.momentsPanel.current]) {
      if (el) observer.observe(el)
    }
    // The rows' list resizes when a row is added or removed.
    const list = refs.momentsPanel.current?.querySelector('[data-moment-row]')?.parentElement
    if (list) observer.observe(list)
    window.addEventListener('resize', schedule)
    const mq = typeof window.matchMedia === 'function'
      ? window.matchMedia(`(min-width: ${COLUMN_FILL_MIN_WIDTH}px)`)
      : null
    mq?.addEventListener?.('change', schedule)
    void document.fonts?.ready?.then(schedule)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      mq?.removeEventListener?.('change', schedule)
      if (frame.current) cancelAnimationFrame(frame.current)
      frame.current = 0
    }
  }, [schedule, refs.center, refs.right, refs.momentsPanel, enabled, hold, totalMoments, growChart, padAllowed, maxRows, revision])

  return enabled ? state : { fitCount: undefined, extraPlotPx: 0, padPx: 0 }
}

/**
 * Edge fades for a scroller with a hidden scrollbar: sets `--ft` / `--fb` to
 * the distance scrolled from each end, capped at `fade` px (MOCK
 * session-original.js edgeFade). CSS turns them into a mask. Returns a
 * callback ref for the scroller.
 */
export function useEdgeFade<T extends HTMLElement>(fade = 24): (el: T | null) => void {
  const detach = useRef<(() => void) | null>(null)
  useEffect(() => () => {
    detach.current?.()
    detach.current = null
  }, [])
  return useCallback((el: T | null) => {
    detach.current?.()
    detach.current = null
    if (!el) return
    const update = () => {
      const top = el.scrollTop
      const rest = el.scrollHeight - el.clientHeight - top
      el.style.setProperty('--ft', `${Math.round(clamp(top, 0, fade))}px`)
      el.style.setProperty('--fb', `${Math.round(clamp(rest, 0, fade))}px`)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    resize?.observe(el)
    // Rows added or removed change the scroll height without resizing the box.
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(update)
    mutations?.observe(el, { childList: true, subtree: true })
    detach.current = () => {
      el.removeEventListener('scroll', update)
      resize?.disconnect()
      mutations?.disconnect()
    }
  }, [fade])
}
