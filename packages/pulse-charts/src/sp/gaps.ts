/**
 * Hatched spans. A hatch covers only samples that are not measured: coverage 2
 * for honest gaps (inside the given gap spans when there are any), and a missing
 * viewer value on a measured sample for the viewers panel. Runs are sample
 * index pairs [i0, i1); paths are in data units for the scaled group.
 */
import type { SpChartData, SpSpanMs } from './types.ts'

/** Closed box path from x a to b, y0 to y1. */
export const boxPath = (a: number, b: number, y0: number, y1: number): string => 'M' + a + ' ' + y0 + 'H' + b + 'V' + y1 + 'H' + a + 'Z'

const runs = (n: number, on: (i: number) => boolean): number[] => {
  const out: number[] = []
  for (let i = 0; i < n; i += 1) {
    if (!on(i)) continue
    let j = i + 1
    while (j < n && on(j)) j += 1
    out.push(i, j)
    i = j
  }
  return out
}

export function gapRuns(data: SpChartData, gaps?: readonly SpSpanMs[] | null): number[] {
  const n = data.chat.length
  const mark = new Uint8Array(n)
  const u = (ms: number) => (ms - data.startMs) / data.stepMs
  if (gaps) for (const g of gaps) mark.fill(1, Math.max(0, Math.floor(u(g.startMs))), Math.max(0, Math.ceil(u(g.endMs))))
  else mark.fill(1)
  return runs(n, i => !!mark[i] && data.coverage[i] === 2)
}

export const viewerGapRuns = (data: SpChartData): number[] =>
  runs(data.chat.length, i => data.coverage[i] !== 2 && !Number.isFinite(data.viewers[i]!))

/** Runs at least `min` samples wide (minHatchPx at the settled zoom). */
export const wideRuns = (r: readonly number[], min: number): number[] => {
  const out: number[] = []
  for (let k = 0; k < r.length; k += 2) if (r[k + 1]! - r[k]! >= min) out.push(r[k]!, r[k + 1]!)
  return out
}

export function runsPath(r: readonly number[], y0: number, y1: number): string {
  let d = ''
  for (let k = 0; k < r.length; k += 2) d += boxPath(r[k]!, r[k + 1]!, y0, y1)
  return d
}
