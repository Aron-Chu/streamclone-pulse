/**
 * Line paths in data units (x = sample index, y = plot px), built once per
 * level and data and drawn inside the scaled group with non-scaling strokes.
 * A slot without a measured value breaks the line; a lone point is a dot.
 */
import type { SpChartData } from './types.ts'

export interface SpLinePaths { solid: string; dashed: string; dots: string }

const f = (v: number) => Math.round(v * 100) / 100
export const mod = (a: number, m: number): number => ((a % m) + m) % m

/** Slot phase so slots align to alignMs (as the bar pyramid does). */
export const slotPhase = (data: SpChartData, alignMs: number, step: number): number =>
  mod(Math.round((data.startMs - alignMs) / data.stepMs), step)

/**
 * Walks slots of `step` samples (the first starts `phase` samples early) and
 * reports each slot's mean over measured samples (null when none) and whether
 * it holds a partly measured sample. Coverage 2 never counts.
 */
export function slotAverages(
  values: ArrayLike<number>,
  coverage: ArrayLike<number>,
  step: number,
  phase: number,
  each: (i0: number, i1: number, avg: number | null, partial: boolean) => void,
): void {
  const n = values.length
  for (let g = -phase; g < n; g += step) {
    const i0 = Math.max(0, g), i1 = Math.min(n, g + step)
    let sum = 0, count = 0, partial = false
    for (let i = i0; i < i1; i += 1) {
      const c = coverage[i], v = values[i]!
      if (c === 2) continue
      if (c === 1) partial = true
      if (Number.isFinite(v)) {
        sum += v
        count += 1
      }
    }
    each(i0, i1, count ? sum / count : null, partial)
  }
}

export function linePaths(
  values: ArrayLike<number>,
  coverage: ArrayLike<number>,
  step: number,
  phase: number,
  y: (value: number) => number,
  dashPartial = false,
): SpLinePaths {
  const out = ['', '', '']
  let has = false, joined = false, chain = -1, px = 0, py = 0, pd = false
  const at = (x: number, yy: number) => f(x) + ' ' + f(yy)
  const dot = () => {
    if (has && !joined) out[2] += 'M' + at(px, py) + 'h0'
  }
  slotAverages(values, coverage, step, phase, (i0, i1, avg, partial) => {
    if (avg == null) {
      dot()
      has = false
      chain = -1
      return
    }
    const x = (i0 + i1) / 2, yy = y(avg)
    joined = has
    if (has) {
      const k = dashPartial && (pd || partial) ? 1 : 0
      out[k] += (chain === k ? '' : 'M' + at(px, py)) + 'L' + at(x, yy)
      chain = k
    }
    has = true
    px = x
    py = yy
    pd = partial
  })
  dot()
  return { solid: out[0]!, dashed: out[1]!, dots: out[2]! }
}
