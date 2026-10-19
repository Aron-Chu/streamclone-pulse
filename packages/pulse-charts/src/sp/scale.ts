/** Value ticks, number labels and time-axis ticks (d3-v2 chart.js rules). */

/** Round ticks from 0 to at least max: steps 1, 2, 2.5, 5, 10 x 10^k. */
export function niceTicks(max: number, count: number): number[] {
  if (!(max > 0)) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = Math.max(1, [1, 2, 2.5, 5, 10].find(m => m * mag >= raw)! * mag)
  const out: number[] = []
  for (let v = 0; v < max + step * 0.999; v += step) out.push(Math.round(v))
  return out
}

const nf = new Intl.NumberFormat('en-US')

/** 20K, 1.2M; plain grouped digits under 10,000. */
export const compact = (v: number): string =>
  v >= 1e6 ? Math.round(v / 1e5) / 10 + 'M' : v >= 1e4 ? Math.round(v / 100) / 10 + 'K' : nf.format(v)

export const formatInt = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '—' : nf.format(Math.round(value))

/** Seconds per tick for elapsed (session) axes; minutes for clock (hub) axes. */
const ELAPSED_S = [300, 600, 900, 1800, 3600, 7200, 10800, 21600]
const CLOCK_MIN = [10, 15, 30, 60, 120, 180, 360, 720, 1440]

/** Multiples of the first step that leaves gapPx, counted from baseMs. */
const ticksFrom = (baseMs: number, steps: number[], unitMs: number, startMs: number, endMs: number, plotWidth: number, gapPx: number) => {
  const step = (steps.find(s => (plotWidth * s * unitMs) / Math.max(1, endMs - startMs) >= gapPx) ?? steps[steps.length - 1]!) * unitMs
  const out: number[] = []
  for (let t = baseMs + Math.ceil((startMs - baseMs) / step) * step; t <= endMs; t += step) out.push(t)
  return out
}

/** Elapsed ticks (multiples of the step from originMs). */
export const elapsedTicks = (startMs: number, endMs: number, plotWidth: number, originMs: number, gapPx = 80): number[] =>
  ticksFrom(originMs, ELAPSED_S, 1000, startMs, endMs, plotWidth, gapPx)

/** Local clock ticks (on the step since local midnight). */
export const clockTicks = (startMs: number, endMs: number, plotWidth: number, gapPx = 96): number[] =>
  ticksFrom(new Date(startMs).setHours(0, 0, 0, 0), CLOCK_MIN, 60_000, startMs, endMs, plotWidth, gapPx)

/** h:mm since originMs. */
export const formatElapsed = (ms: number, originMs: number): string => {
  const min = Math.floor(Math.max(0, Math.round((ms - originMs) / 1000)) / 60)
  return Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0')
}

/** Local clock; with day ticks (multi-day windows) the date instead. */
export const formatClock = (ms: number, days = false): string =>
  days
    ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })
    : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
