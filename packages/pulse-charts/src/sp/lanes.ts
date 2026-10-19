/**
 * Lanes mode (opt-in; d3-v2 session-original, chart.js layoutLanes and
 * renderLanes): stacked lanes on one time axis. Every path here is in data
 * units (x = sample index, y = plot px) for the scaled group, built per data,
 * level or settled zoom, never per frame.
 *
 * - Bars: slot averages at the bar level, one rect per slot with a measured
 *   value, standing on the lane floor (no peak caps, F3).
 * - Trend: a 3-slot moving average of the line-level slots, as a monotone curve.
 * - Area / line: the line-level slot averages; a lone point is a dot.
 * - A break narrower than minHatchPx px between two measured slots is joined
 *   (unless the lane sets bridge: false); hatches that narrow are not drawn.
 */
import { barWidthPx } from './bars.ts'
import { SP_BAND_PX } from './layout.ts'
import { niceTicks } from './scale.ts'
import type { SpChartData, SpLane, SpLaneBox, SpLayout, SpValuePanel } from './types.ts'

/** Lane head strip: room for the caption chip above the data. */
export const SP_LANE_HEAD = 20
export const SP_LANE_GAP = 12
/** Lane line weight [whole stream, zoomed in] when the lane sets none. */
export const SP_LANE_WIDTH: readonly [number, number] = [1.55, 2.15]

const fin = Number.isFinite
const r2 = (v: number) => Math.round(v * 100) / 100
const r1 = (v: number) => Math.round(v * 10) / 10

/** The series a lane reads, or null for a lane drawn from `lines`. */
export function laneSeries(d: SpChartData, L: SpLane): ArrayLike<number> | null {
  if (L.lines) return null
  if (L.key === 'chat') return d.chat
  if (L.key === 'emotes') return d.emotes
  if (L.key === 'viewers') return d.viewers
  return L.key === 'overlay' ? d.overlay ?? null : null
}

/** A lane's plotted maximum over the measured samples (its own series, or every line). */
export function laneRawMax(d: SpChartData, L: SpLane): number {
  const all = L.lines ? L.lines.map(l => l.values) : [laneSeries(d, L)]
  let m = 0
  for (const v of all) if (v) for (let i = 0; i < v.length; i += 1) if (d.coverage[i] !== 2 && v[i]! > m) m = v[i]!
  return m
}

export interface SpLaneLayoutInput {
  width: number
  height: number
  tickColumn: number
  band: boolean
  topPx: number
  gap: number
  lanes: readonly SpLane[]
  /** laneRawMax per lane. */
  raw: readonly number[]
}

/**
 * Lanes share the plot under the band row by weight, `gap` px apart (a lane's
 * own gap wins; none above the first); the last lane takes the rest. A lane's
 * data top sits min(20, 40 % of its height) under its top.
 */
export function laneLayout(i: SpLaneLayoutInput): SpLayout {
  const plotWidth = Math.max(40, i.width - i.tickColumn)
  const H = i.height
  const band = i.band ? SP_BAND_PX : 0
  const gapOf = (L: SpLane, k: number) => (k === 0 ? 0 : L.gap ?? i.gap)
  const wt = (L: SpLane) => L.weight ?? 1
  const avail = Math.max(0, H - band - i.lanes.reduce((a, L, k) => a + gapOf(L, k), 0))
  const sum = i.lanes.reduce((a, L) => a + wt(L), 0) || 1
  let y = band
  const lanes = i.lanes.map((L, k): SpLaneBox => {
    y += gapOf(L, k)
    const h = k === i.lanes.length - 1 ? Math.max(0, H - y) : Math.round((avail * wt(L)) / sum)
    const raw = i.raw[k] ?? 0
    const ticks = niceTicks(raw, 4)
    const box = { key: L.key, raw, x: 0, y, width: plotWidth, height: h, dataTop: y + Math.min(SP_LANE_HEAD, Math.round(h * 0.4)), max: ticks[ticks.length - 1]! || 1, ticks }
    y += h
    return box
  })
  const first = lanes[0], last = lanes[lanes.length - 1]
  const rates: SpValuePanel | null =
    first && last ? { x: 0, y: first.y, width: plotWidth, height: last.y + last.height - first.y, dataTop: first.dataTop, max: first.max, ticks: [] } : null
  return {
    width: i.width,
    plotWidth,
    height: H,
    tickColumn: i.tickColumn,
    top: i.topPx > 0 ? { x: 0, y: 0, width: plotWidth, height: i.topPx } : null,
    band: band ? { x: 0, y: 0, width: plotWidth, height: band } : null,
    rates,
    viewers: null,
    lanes,
  }
}

/** Lane max tick (session-original fmtTick): 40K, 1.5K, 800. */
export const laneTick = (v: number): string =>
  v >= 1e6 ? String(Math.round(v / 1e5) / 10).replace(/\.0$/, '') + 'M' : v >= 1e3 ? String(Math.round(v / 100) / 10).replace(/\.0$/, '') + 'K' : String(v)

const en = new Intl.NumberFormat('en-US')

/** Caption figures in the stat cards' format (prod count()): 34.3K, 1.2M, 757. */
export const laneFigure = (v: number | null | undefined): string =>
  v == null || !fin(v) ? '—' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : en.format(Math.round(v))

/** Stroke width for a zoom: [far, near] eased by 1 - sqrt(visible share of the samples). */
export const laneWidth = (w: readonly [number, number], visible: number, n: number): number =>
  w[0] + (w[1] - w[0]) * (1 - Math.sqrt(Math.min(1, visible / Math.max(1, n))))

/**
 * Slots of `step` samples (the first starts `phase` samples early) that meet
 * samples [a, b): each slot's mean over its measured samples (null when none)
 * and whether it is partial (an unmeasured sample beside measured ones).
 */
export function slotWalk(
  values: ArrayLike<number>,
  coverage: ArrayLike<number>,
  step: number,
  phase: number,
  a: number,
  b: number,
  each: (i0: number, i1: number, avg: number | null, partial: boolean) => void,
): void {
  const n = values.length
  const end = Math.min(b, n)
  for (let g = Math.floor((Math.max(0, a) + phase) / step) * step - phase; g < end; g += step) {
    const i0 = Math.max(0, g), i1 = Math.min(n, g + step)
    let sum = 0, count = 0, miss = false
    for (let i = i0; i < i1; i += 1) {
      const v = values[i]!
      if (coverage[i] === 2) miss = true
      else if (fin(v)) {
        sum += v
        count += 1
      }
    }
    each(i0, i1, count ? sum / count : null, miss && count > 0)
  }
}

/** One lane bar in data units: op is its fill opacity; `i` its slot's first sample (the React key, stable across zoom). */
export interface SpLaneBar { i: number; x: number; y: number; w: number; h: number; op: number; partial: boolean }

export interface SpLaneBarArgs {
  values: ArrayLike<number>
  coverage: ArrayLike<number>
  box: SpValuePanel
  lane: SpLane
  step: number
  phase: number
  /** Sample window [a, b). */
  a: number
  b: number
  /** Px per sample at the settled view. */
  sx: number
  rule?: 'prod'
  /** Bars outside [s0, s1) dim (x 0.4). */
  sel: readonly [number, number] | null
}

export function laneBars(o: SpLaneBarArgs): SpLaneBar[] {
  const { box, lane: L, sx } = o
  const floor = box.y + box.height
  const bop = L.barOpacity ?? 1
  const thr = L.spikeAbs ?? Infinity
  const spike = L.spikeOpacity != null && thr > 0 && fin(thr)
  const minBar = L.minBarPx ?? 0
  const pitch = o.step * sx
  const wU = barWidthPx(pitch, o.rule) / sx
  const gapU = (pitch > 9 ? 2 : pitch > 4 ? 1 : 0.5) / sx
  const out: SpLaneBar[] = []
  slotWalk(o.values, o.coverage, o.step, o.phase, o.a, o.b, (i0, i1, v, partial) => {
    if (v == null) return
    const yv = floor - (v / box.max) * (floor - box.dataTop)
    const h = Math.max(minBar, floor - yv)
    const dim = o.sel != null && (i1 <= o.sel[0] || i0 >= o.sel[1])
    const op = Math.round((spike && v > thr ? L.spikeOpacity! : bop) * (partial ? 0.5 : 1) * (dim ? 0.4 : 1) * 1000) / 1000
    const x = o.rule === 'prod' ? (i0 + i1) / 2 - wU / 2 : i0 + gapU / 2
    const w = o.rule === 'prod' ? wU : Math.max(0.6 / sx, i1 - i0 - gapU)
    out.push({ i: i0, x: Math.round(x * 1e4) / 1e4, y: r1(floor - h), w: Math.round(w * 1e4) / 1e4, h: r1(h), op, partial })
  })
  return out
}

/** Slot centres and averages over the whole data at a step (NaN = no value). */
export function laneSlots(values: ArrayLike<number>, coverage: ArrayLike<number>, step: number, phase: number) {
  const x: number[] = [], x0: number[] = [], x1: number[] = [], v: number[] = []
  slotWalk(values, coverage, step, phase, 0, values.length, (i0, i1, avg) => {
    x0.push(i0)
    x1.push(i1)
    x.push((i0 + i1) / 2)
    v.push(avg ?? NaN)
  })
  return { x, x0, x1, v }
}

/** 3-slot moving average of the measured slots; NaN where the slot itself has no value. */
export function movingAverage3(v: readonly number[]): number[] {
  return v.map((c, i) => {
    if (!fin(c)) return NaN
    let s = 0, k = 0
    for (let j = i - 1; j <= i + 1; j += 1) {
      const w = v[j]
      if (w != null && fin(w)) {
        s += w
        k += 1
      }
    }
    return s / k
  })
}

type Pt = { x: number; y: number }

/**
 * Runs of measured slots. A run of value-less slots between two measured ones
 * narrower than minU samples is stepped over (the run continues across it).
 */
export function laneRuns(s: { x: number[]; x0: number[]; x1: number[] }, v: readonly number[], y: (value: number) => number, minU: number): Pt[][] {
  const n = v.length
  const bridge = new Uint8Array(n)
  if (minU > 0) {
    let s0 = -1
    for (let i = 0; i < n; i += 1) {
      if (!fin(v[i]!)) {
        if (s0 < 0 && i > 0) s0 = i
        continue
      }
      if (s0 >= 0 && s.x1[i - 1]! - s.x0[s0]! < minU) bridge.fill(1, s0, i)
      s0 = -1
    }
  }
  const runs: Pt[][] = []
  let run: Pt[] | null = null
  for (let i = 0; i < n; i += 1) {
    const val = v[i]!
    if (!fin(val)) {
      if (!(bridge[i] && run)) run = null
      continue
    }
    if (!run) runs.push((run = []))
    run.push({ x: s.x[i]!, y: y(val) })
  }
  return runs
}

const at = (p: Pt) => r2(p.x) + ' ' + r1(p.y)

/** Monotone cubic through points (d3 curveMonotoneX slopes, flat ends): no bump past a neighbour. */
export function monoPath(P: readonly Pt[]): string {
  const n = P.length
  let d = 'M' + at(P[0]!)
  if (n < 3) return n === 2 ? d + 'L' + at(P[1]!) : d
  const h: number[] = [], s: number[] = [], t: number[] = [0]
  const sg = (v: number) => (v < 0 ? -1 : 1)
  for (let i = 0; i < n - 1; i += 1) {
    h[i] = P[i + 1]!.x - P[i]!.x
    s[i] = h[i] ? (P[i + 1]!.y - P[i]!.y) / h[i]! : 0
  }
  for (let i = 1; i < n - 1; i += 1) {
    const q = (s[i - 1]! * h[i]! + s[i]! * h[i - 1]!) / (h[i - 1]! + h[i]! || 1)
    t[i] = (sg(s[i - 1]!) + sg(s[i]!)) * Math.min(Math.abs(s[i - 1]!), Math.abs(s[i]!), 0.5 * Math.abs(q)) || 0
  }
  t[n - 1] = 0
  for (let i = 0; i < n - 1; i += 1) {
    const a = P[i]!, b = P[i + 1]!, dx = h[i]! / 3
    d += 'C' + r2(a.x + dx) + ' ' + r1(a.y + dx * t[i]!) + ' ' + r2(b.x - dx) + ' ' + r1(b.y - dx * t[i + 1]!) + ' ' + at(b)
  }
  return d
}

/** A lane series as paths: line, lone-point dots and (area lanes) the fill down to `floor`. */
export interface SpLanePaths { line: string; dots: string; fill: string }

export function lanePaths(runs: readonly Pt[][], smooth: boolean, area: boolean, floor: number, dots = true): SpLanePaths {
  let line = '', dot = '', fill = ''
  const f = r1(floor)
  for (const r of runs) {
    if (r.length === 1) {
      if (dots) dot += 'M' + at(r[0]!) + 'h0'
      continue
    }
    const d = smooth ? monoPath(r) : 'M' + r.map(at).join('L')
    line += d
    if (area) fill += d + 'L' + r2(r[r.length - 1]!.x) + ' ' + f + 'L' + r2(r[0]!.x) + ' ' + f + 'Z'
  }
  return { line, dots: dot, fill }
}

/** Samples [a, b) of the bar slots holding [u0, u1) at a level (the band snaps outward to whole bars). */
export function snapToSlots(u0: number, u1: number, step: number, phase: number, n: number): [number, number] {
  const a = Math.floor((u0 + phase) / step) * step - phase
  const b = Math.ceil((Math.max(u1, u0 + 1e-6) + phase) / step) * step - phase
  return [Math.max(0, a), Math.min(n, Math.max(b, a + 1))]
}
