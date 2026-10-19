/**
 * Chat bars on the shared pyramid: levels built once per data load, a level
 * picked per settle, and a window of at most SP_RECT_CAP rects (or
 * SpBarOptions.maxRects; the visible bars plus up to one viewport of overscan
 * per side). A bar's busiest minute
 * is kept for readouts and cards only; it is never drawn (F3).
 */
import { BAR_LEVEL_STEPS, barBucketAt, barLevelRange, buildBarPyramid, pickBarLevel, type BarBucket, type BarLevel } from '../barPyramid.ts'
import type { SpBar, SpBarOptions, SpChartData, SpRange } from './types.ts'

export const SP_RECT_CAP = 600

/**
 * Bar width in px for a slot pitch in px. Default: the slot less a gap of 2,
 * 1 or 0.5 px (0.6 px at least). 'prod': the hosted portal's rule, centred in
 * the slot: max(1, min(48, pitch - max(1.5, 18 % of pitch), 72 % of pitch)).
 */
export function barWidthPx(pitch: number, rule?: 'prod'): number {
  if (rule === 'prod') return Math.max(1, Math.min(48, pitch - Math.max(1.5, pitch * 0.18), pitch * 0.72))
  return Math.max(0.6, pitch - (pitch > 9 ? 2 : pitch > 4 ? 1 : 0.5))
}

const fin = Number.isFinite

/** Chat bar levels. Samples with coverage 2 never count; slots align to alignMs. */
export function buildSpLevels(data: SpChartData, alignMs: number, floorStep = 1): BarLevel[] {
  const n = data.chat.length
  const times = new Float64Array(n)
  const chat = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    times[i] = data.startMs + i * data.stepMs
    chat[i] = data.coverage[i] === 2 ? NaN : data.chat[i]!
  }
  const steps = [floorStep, ...BAR_LEVEL_STEPS.filter(s => s > floorStep)]
  return buildBarPyramid(times, [chat], data.stepMs, alignMs, steps)
}

/** Fixed minutes as a sample step (0 = none). */
export const fixedStep = (minutes: number | null | undefined, stepMs: number): number =>
  minutes && minutes > 0 ? Math.max(1, Math.round((minutes * 60_000) / stepMs)) : 0

/**
 * The level for a range. Without barOptions a fixed level (levels[0] when the
 * levels were built from fixedLevelMinutes) or the plain 5 px rule.
 */
export function pickSpLevel(
  levels: readonly BarLevel[],
  range: SpRange,
  plotWidth: number,
  stepMs: number,
  previousStep: number | null,
  barOptions: SpBarOptions | null | undefined,
  fixed: boolean,
): BarLevel | null {
  if (!levels.length) return null
  if (fixed && !barOptions) return levels[0]!
  return pickBarLevel(levels, (range.endIndex - range.startIndex) * stepMs, plotWidth, stepMs, previousStep, barOptions ?? {})
}

/** Coarsen until the visible bars fit the rect cap (per bar series). */
export function capLevel(levels: readonly BarLevel[], level: BarLevel, visibleSamples: number, cap = SP_RECT_CAP): BarLevel {
  let i = levels.indexOf(level)
  while (i < levels.length - 1 && Math.ceil(visibleSamples / levels[i]!.step) + 2 > cap) i += 1
  return levels[i] ?? level
}

export interface SpBarWindow {
  /** Bucket indices [from, to). */
  from: number
  to: number
  /** Sample window [u0, u1) and the margin that triggers a re-window. */
  u0: number
  u1: number
  half: number
}

export function barWindow(level: BarLevel, data: SpChartData, range: SpRange, cap = SP_RECT_CAP): SpBarWindow {
  const n = data.chat.length
  const vb = Math.ceil((range.endIndex - range.startIndex + 1) / level.step) + 2
  const over = Math.max(0, Math.min(vb, Math.floor((cap - vb) / 2) - 1)) * level.step
  const u0 = Math.max(0, Math.floor(range.startIndex) - over)
  const u1 = Math.min(n, Math.ceil(range.endIndex) + 1 + over)
  const t = (i: number) => data.startMs + i * data.stepMs
  const [from, to] = barLevelRange(level, t(u0), t(u1) - 1)
  return { from, to: Math.min(to, from + cap), u0, u1, half: Math.max(level.step, over / 2) }
}

/** True when the visual range nears the window edge (needs a new window). */
export const needsRewindow = (w: SpBarWindow, v: SpRange, n: number): boolean =>
  (w.u0 > 0 && v.startIndex < w.u0 + w.half) || (w.u1 < n && v.endIndex + 1 > w.u1 - w.half)

export function barSummary(data: SpChartData, b: BarBucket): SpBar {
  // mean, peak and peak index of a series over the bar's measured samples
  const stat = (v: ArrayLike<number> | null | undefined) => {
    let sum = 0, count = 0, peak = -Infinity, at = -1
    for (let i = b.from; v && i < b.to; i += 1) {
      const x = v[i]!
      if (data.coverage[i] === 2 || !fin(x)) continue
      sum += x
      count += 1
      if (x > peak) {
        peak = x
        at = i
      }
    }
    return count ? [sum / count, peak, at] : null
  }
  const e = stat(data.emotes)
  return {
    startMs: data.startMs + b.from * data.stepMs,
    endMs: data.startMs + b.to * data.stepMs,
    fromIndex: b.from,
    toIndex: b.to,
    chat: b.avg[0]!,
    emotes: e && e[0]!,
    viewers: stat(data.viewers)?.[0] ?? null,
    overlay: stat(data.overlay)?.[0] ?? null,
    chatPeak: b.peak[0]!,
    chatPeakIndex: b.peakAt[0]!,
    emotesPeak: e && e[1]!,
    emotesPeakIndex: e ? e[2]! : -1,
    observed: b.observed,
    expected: b.expected,
    partial: b.observed < b.expected,
  }
}

/** The bar holding sample `index` at a level, or null over a gap. */
export const barAt = (data: SpChartData, level: BarLevel, index: number): SpBar | null => {
  const b = barBucketAt(level, data.startMs + index * data.stepMs)
  return b ? barSummary(data, b) : null
}
