/**
 * Navigator silhouette (d3-v2 chart.js renderNav): chat slot averages at the
 * finest level with at least 2 px per slot, as one closed path over the full
 * data. ChartNavigator stretches it to its track.
 */
import { BAR_LEVEL_STEPS } from '../barPyramid.ts'
import { mod, slotAverages } from './lines.ts'

export interface SpOverview { d: string; width: number; height: number }

export function overviewPath(
  chat: ArrayLike<number>,
  width: number,
  opts: { coverage?: ArrayLike<number> | null; height?: number; amplitude?: number; alignOffset?: number } = {},
): SpOverview | null {
  const n = chat.length
  if (!n || !(width > 0)) return null
  const H = opts.height ?? 22
  const step = BAR_LEVEL_STEPS.find(s => (width * s) / n >= 2) ?? 240
  const slots: number[] = []
  let max = 0
  slotAverages(chat, opts.coverage ?? [], step, mod(opts.alignOffset ?? 0, step), (i0, i1, avg) => {
    max = Math.max(max, avg ?? 0)
    slots.push(i0, i1, avg ?? 0)
  })
  const f = (v: number) => Math.round(v * 10) / 10
  let d = 'M0 ' + H
  for (let k = 0; k < slots.length; k += 3) {
    const y = ' ' + f(H - (slots[k + 2]! / (max || 1)) * (opts.amplitude ?? 18))
    d += 'L' + f((slots[k]! / n) * width) + y + 'L' + f((slots[k + 1]! / n) * width) + y
  }
  return { d: d + 'L' + width + ' ' + H + 'Z', width, height: H }
}
