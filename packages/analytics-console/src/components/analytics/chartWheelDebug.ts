/*
 * Development wheel diagnostic, on only when the page URL has ?debug=wheel.
 * It lists the last 10 wheel events in a small fixed panel (bottom left):
 * their deltas, delta mode, modifier keys, which surface they were over and
 * what the chart navigator did with them, so a mouse or trackpad that still
 * misbehaves can be screenshotted. It stores nothing and sends nothing. With
 * the flag off, nothing below runs.
 */
export type WheelDebugOutcome =
  | 'zoom'
  | 'pan'
  | 'pass:off'
  | 'pass:limit'
  | 'pass:scroll-through'
  | 'pass:browser-zoom'
  | 'pass:outside-plot'
  | 'pass:no-range'

/** Read once per page load. */
export const WHEEL_DEBUG: boolean = (() => {
  try {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === 'wheel'
  } catch {
    return false
  }
})()

const outcomes: WeakMap<Event, WheelDebugOutcome> | null = WHEEL_DEBUG ? new WeakMap() : null

/** Records what a navigator did with one wheel event (no-op unless ?debug=wheel). */
export function noteWheelOutcome(event: Event, outcome: WheelDebugOutcome) {
  if (outcomes && !outcomes.has(event)) outcomes.set(event, outcome)
}

interface Row {
  event: WheelEvent
  surface: 'hub-plot' | 'stream-plot' | 'navigator' | 'page'
}

let installed = false

function surfaceOf(event: WheelEvent): Row['surface'] {
  const target = event.target instanceof Element ? event.target : null
  if (!target) return 'page'
  if (target.closest('[data-hub-chart-navigator]')) return 'navigator'
  if (target.closest('[data-hub-chart-wheel-surface]')) return 'hub-plot'
  const stack = target.closest('[data-session-chart-stack]')
  const plot = stack?.querySelector('svg[role="group"] rect[data-chart-touch-action]')
  if (plot) {
    const rect = plot.getBoundingClientRect()
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) {
      return 'stream-plot'
    }
  }
  return 'page'
}

function format(row: Row, index: number): string {
  const { event } = row
  const keys = [event.ctrlKey && 'ctrl', event.altKey && 'alt', event.shiftKey && 'shift', event.metaKey && 'meta']
    .filter(Boolean)
    .join('+') || '-'
  const outcome = outcomes?.get(event) ?? (row.surface === 'page' ? 'page' : 'unhandled')
  return `${String(index).padStart(3)} dY=${event.deltaY.toFixed(1).padStart(7)} dX=${event.deltaX.toFixed(1).padStart(6)} mode=${event.deltaMode} ${keys.padEnd(9)} ${row.surface.padEnd(11)} ${outcome}`
}

/** Installs the capture listener and panel once per page, when the flag is on. */
export function installWheelDebug() {
  if (!WHEEL_DEBUG || installed || typeof window === 'undefined') return
  installed = true
  const rows: Row[] = []
  let total = 0
  let panel: HTMLElement | null = null
  let scheduled = false
  const render = () => {
    scheduled = false
    if (!panel) {
      panel = document.createElement('div')
      panel.setAttribute('data-wheel-debug', '')
      panel.setAttribute('aria-hidden', 'true')
      Object.assign(panel.style, {
        position: 'fixed',
        left: '8px',
        bottom: '8px',
        zIndex: '2147483647',
        pointerEvents: 'none',
        maxWidth: 'calc(100vw - 16px)',
        overflow: 'hidden',
        whiteSpace: 'pre',
        padding: '6px 8px',
        borderRadius: '6px',
        background: 'rgba(9, 9, 11, 0.88)',
        color: '#e4e4e7',
        font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      })
      document.body.appendChild(panel)
    }
    const first = total - rows.length + 1
    panel.textContent = [`wheel debug · last ${rows.length} of ${total}`, ...rows.map((row, i) => format(row, first + i))].join('\n')
  }
  window.addEventListener('wheel', (event) => {
    rows.push({ event, surface: surfaceOf(event) })
    total += 1
    if (rows.length > 10) rows.shift()
    // The navigators decide after this capture listener; draw once they have.
    if (!scheduled) {
      scheduled = true
      setTimeout(render, 0)
    }
  }, { capture: true, passive: true })
}
