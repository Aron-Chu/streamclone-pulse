/**
 * Activity bar pyramid.
 *
 * Bars average their samples over aligned time slots. The slot size follows
 * the zoom: a wide view uses long slots so bars stay readable, a narrow view
 * uses short ones, down to one bar per sample. The aggregates for every slot
 * size are built once per data load, so a zoom or pan only picks a level
 * (pickBarLevel) and slices it (barLevelRange); no per-frame aggregation.
 *
 * Gaps stay honest. A slot with no measured sample has no bucket (a gap). A
 * slot that holds fewer measured samples than it covers inside the data
 * domain is partial (observed < expected), and callers mark it.
 */

/** Slot sizes, in samples (minutes for minute data), that bars may use. */
export const BAR_LEVEL_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240] as const

/** Narrowest slot (bar plus gap) a level may use, in plot pixels. */
export const BAR_MIN_SLOT_PX = 5

/**
 * A level change needs the slot to clear BAR_MIN_SLOT_PX by this fraction, so
 * an easing zoom never flickers between two levels.
 */
export const BAR_LEVEL_HYSTERESIS = 0.15

export interface BarBucket {
  /** Aligned slot start (ms); the slot is [startMs, startMs + slotMs). */
  startMs: number
  /** First and last measured sample time in the slot (ms); the bar spans these. */
  firstMs: number
  lastMs: number
  /** Source index range [from, to) of the samples in the slot. */
  from: number
  to: number
  /** Measured samples, and the samples the slot covers inside the data domain. */
  observed: number
  expected: number
  /** Per series: mean of the measured samples, the highest one and its source index. */
  avg: number[]
  peak: number[]
  peakAt: number[]
}

export interface BarLevel {
  step: number
  slotMs: number
  /** Ascending. A slot with no measured sample has no bucket. */
  buckets: BarBucket[]
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/**
 * Build every level. `timesMs` are ascending sample starts (null = unparseable,
 * skipped); `series[k][i]` is sample i of series k, measured when finite.
 * Slots align to `originMs` (stream start for stream charts, 0 = UTC for the
 * hub), so bucket edges never move while the view pans or zooms.
 */
export function buildBarPyramid(
  timesMs: ArrayLike<number | null>,
  series: ReadonlyArray<ArrayLike<number | null | undefined>>,
  cadenceMs: number,
  originMs = 0,
  steps: readonly number[] = BAR_LEVEL_STEPS,
): BarLevel[] {
  // Sample positions run from the first sample in whole cadences to the last;
  // a slot expects the positions it holds, so edge slots are short, not partial.
  let domainStart = Infinity
  let domainLast = -Infinity
  for (let i = 0; i < timesMs.length; i += 1) {
    const t = timesMs[i]
    if (finite(t)) {
      domainStart = Math.min(domainStart, t)
      domainLast = Math.max(domainLast, t)
    }
  }
  const lastPosition = Math.round((domainLast - domainStart) / cadenceMs)
  const positionsIn = (startMs: number, endMs: number) =>
    Math.min(lastPosition, Math.ceil((endMs - domainStart) / cadenceMs) - 1)
    - Math.max(0, Math.ceil((startMs - domainStart) / cadenceMs)) + 1
  return steps.map(step => {
    const slotMs = step * cadenceMs
    const buckets: BarBucket[] = []
    let open: (BarBucket & { sum: number[]; count: number[] }) | null = null
    const close = () => {
      if (open && open.observed > 0) {
        const { sum, count, ...bucket } = open
        bucket.avg = sum.map((total, k) => (count[k] ? total / count[k]! : 0))
        bucket.expected = Math.max(bucket.observed, positionsIn(bucket.startMs, bucket.startMs + slotMs))
        buckets.push(bucket)
      }
      open = null
    }
    for (let i = 0; i < timesMs.length; i += 1) {
      const t = timesMs[i]
      if (!finite(t)) continue
      const startMs = originMs + Math.floor((t - originMs) / slotMs) * slotMs
      if (!open || open.startMs !== startMs) {
        close()
        open = {
          startMs, firstMs: t, lastMs: t, from: i, to: i + 1, observed: 0, expected: 0,
          avg: [], peak: series.map(() => 0), peakAt: series.map(() => -1),
          sum: series.map(() => 0), count: series.map(() => 0),
        }
      }
      const bucket: BarBucket & { sum: number[]; count: number[] } = open
      bucket.to = i + 1
      let measured = false
      series.forEach((values, k) => {
        const value = values[i]
        if (!finite(value)) return
        measured = true
        bucket.sum[k]! += value
        bucket.count[k]! += 1
        if (bucket.peakAt[k]! < 0 || value > bucket.peak[k]!) {
          bucket.peak[k] = value
          bucket.peakAt[k] = i
        }
      })
      if (measured) {
        if (!bucket.observed) bucket.firstMs = t
        bucket.lastMs = t
        bucket.observed += 1
      }
    }
    close()
    return { step, slotMs, buckets }
  })
}

/**
 * Optional density rules for pickBarLevel. Leaving every field out keeps the
 * plain rule above (5 px floor, no cap, no tolerance, no ceiling).
 */
export interface BarLevelOptions {
  /** Narrowest slot in plot pixels (default BAR_MIN_SLOT_PX). */
  minSlotPx?: number
  /** At most about this many bars across the plot: the floor rises to plotWidthPx / maxBars. */
  maxBars?: number
  /**
   * With no level on screen (first paint, resize, full range), a level may
   * sit at this fraction of the floor (default 1, i.e. no tolerance).
   */
  tolerance?: number
  /** Longest slot in minutes. Lifted only when minSlotPx alone forces a longer one. */
  maxLevelMinutes?: number
}

/**
 * The level for a view: the shortest slot at least BAR_MIN_SLOT_PX wide, with
 * hysteresis around `previousStep` (the level on screen now).
 */
export function pickBarLevel(
  levels: readonly BarLevel[],
  visibleSpanMs: number,
  plotWidthPx: number,
  cadenceMs: number,
  previousStep?: number | null,
  opts: BarLevelOptions = {},
): BarLevel | null {
  if (levels.length === 0) return null
  const pxPerSample = plotWidthPx / Math.max(1, visibleSpanMs / cadenceMs + 1)
  const fits = (level: BarLevel, px: number) => level.step * pxPerSample >= px
  const floorPx = opts.minSlotPx ?? BAR_MIN_SLOT_PX
  const minSlotPx = Math.max(floorPx, opts.maxBars ? plotWidthPx / opts.maxBars : 0)
  const finest = (px: number) => levels.find(level => fits(level, px)) ?? levels[levels.length - 1]!
  const ideal = finest(minSlotPx)
  const previous = levels.find(level => level.step === previousStep)
  let pick: BarLevel
  if (!previous) pick = finest(minSlotPx * (opts.tolerance ?? 1))
  else if (previous === ideal) pick = ideal
  else if (ideal.step < previous.step) {
    pick = levels.find(level => level.step < previous.step && fits(level, minSlotPx * (1 + BAR_LEVEL_HYSTERESIS))) ?? previous
  } else pick = fits(previous, minSlotPx * (1 - BAR_LEVEL_HYSTERESIS)) ? previous : ideal
  const maxSlotMs = (opts.maxLevelMinutes ?? Infinity) * 60_000
  if (pick.slotMs <= maxSlotMs) return pick
  const capped = levels.filter(level => level.slotMs <= maxSlotMs).pop()
  return capped && fits(capped, floorPx) ? capped : finest(floorPx)
}

/** Index range [from, to) of the buckets whose slots meet [startMs, endMs]. */
export function barLevelRange(level: BarLevel, startMs: number, endMs: number): [number, number] {
  const { buckets, slotMs } = level
  const lowerBound = (test: (bucket: BarBucket) => boolean) => {
    let lo = 0
    let hi = buckets.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (test(buckets[mid]!)) hi = mid
      else lo = mid + 1
    }
    return lo
  }
  return [
    lowerBound(bucket => bucket.startMs + slotMs > startMs),
    lowerBound(bucket => bucket.startMs > endMs),
  ]
}

/** The bucket whose slot holds `atMs`, if it has a measured sample. */
export function barBucketAt(level: BarLevel, atMs: number): BarBucket | null {
  const [from, to] = barLevelRange(level, atMs, atMs)
  const bucket = from < to ? level.buckets[from] : undefined
  return bucket && bucket.startMs <= atMs ? bucket : null
}
