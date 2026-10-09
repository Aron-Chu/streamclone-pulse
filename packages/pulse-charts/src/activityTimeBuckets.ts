/**
 * Time-aligned activity buckets for long session charts.
 *
 * The default activity-bar path divides however many visible minutes there are
 * into a fixed bar budget, so a 748-minute stream ends up with buckets of
 * mixed 3 and 4 minutes and bars about 2px wide. When the console opts in,
 * minutes are grouped into whole buckets of 1, 2, 5, 10, 15, 30 or 60 minutes
 * instead. The bucket size is the smallest one that keeps each bar slot at
 * least `ACTIVITY_BUCKET_MIN_SLOT_PX` wide.
 *
 * Gaps stay honest. A bucket only ever contains consecutive *observed*
 * minutes, so a missing minute (a null value or a timestamp jump) closes the
 * current bar and the next observed minute starts a new one. No bar is drawn
 * across time that has no measurement. Every bar records the minutes it
 * actually covers so hover and selection can report the real range.
 *
 * Because a bar never spans a missing minute, every bar is fully observed over
 * its own span. A bar can still be shorter than the bucket size (cut by the
 * viewport edge, the stream start or end, or a gap in the same slot); its
 * narrower width already shows that, so it is not dimmed or announced as
 * partly observed.
 */

/** Bucket sizes the chart may choose from, in measurement cadences (minutes). */
export const ACTIVITY_BUCKET_STEPS_MINUTES = [1, 2, 5, 10, 15, 30, 60] as const

/**
 * Narrowest slot (bar plus gap) to aim for, in plot pixels. Leaving about a
 * fifth of the slot as gap gives bars of roughly 3px or wider.
 */
export const ACTIVITY_BUCKET_MIN_SLOT_PX = 4

/**
 * Smallest whole bucket size (in minutes) whose bar slot is at least
 * `minSlotPx` wide when `visibleMinutes` span `plotWidthPx`.
 */
export function activityBucketMinutesForWidth(
  visibleMinutes: number,
  plotWidthPx: number,
  minSlotPx = ACTIVITY_BUCKET_MIN_SLOT_PX,
): number {
  if (!(visibleMinutes > 0) || !(plotWidthPx > 0)) return 1
  const pxPerMinute = plotWidthPx / visibleMinutes
  for (const step of ACTIVITY_BUCKET_STEPS_MINUTES) {
    if (step * pxPerMinute >= minSlotPx) return step
  }
  return ACTIVITY_BUCKET_STEPS_MINUTES[ACTIVITY_BUCKET_STEPS_MINUTES.length - 1]
}

export interface ActivityTimeBucket {
  /** First source index in the bucket. */
  startIndex: number
  /** One past the last source index in the bucket. */
  endExclusive: number
  /** Timestamp (ms) of the first included minute. */
  firstMs: number
  /** Timestamp (ms) of the last included minute. */
  lastMs: number
  /** Start of the aligned bucket slot (ms), shared by every bar in the slot. */
  slotStartMs: number
  /** Observed minutes in the bar, always contiguous. */
  observedCount: number
  /**
   * Minutes the bar spans, first to last included minute. Bars never bridge a
   * missing minute, so this equals `observedCount`; it is not the bucket size,
   * which callers already know.
   */
  rangeLength: number
  /** Mean of the observed values. */
  average: number
  /** Highest observed minute, with its source index. */
  peak: { index: number; value: number }
}

/**
 * Group per-minute values into time-aligned buckets of `bucketMinutes`.
 *
 * `timestampsMs[i]` is the start of minute `i` (null when unparseable, which
 * is treated like a missing minute). `originMs` sets the bucket alignment,
 * normally the stream start, so bucket edges stay put while the viewport pans
 * or zooms. `include(i)` limits the result to the visible domain.
 */
export function buildActivityTimeBuckets(args: {
  values: ReadonlyArray<number | null | undefined>
  timestampsMs: ReadonlyArray<number | null>
  bucketMinutes: number
  cadenceMs?: number
  originMs?: number | null
  include?: (index: number) => boolean
}): ActivityTimeBucket[] {
  const { values, timestampsMs } = args
  const cadenceMs = args.cadenceMs && args.cadenceMs > 0 ? args.cadenceMs : 60_000
  const bucketMinutes = Math.max(1, Math.floor(args.bucketMinutes))
  const slotMs = bucketMinutes * cadenceMs
  const firstFinite = timestampsMs.find((value): value is number => value != null && Number.isFinite(value))
  const originMs = args.originMs != null && Number.isFinite(args.originMs)
    ? args.originMs
    : firstFinite ?? 0
  const buckets: ActivityTimeBucket[] = []
  let current: (ActivityTimeBucket & { sum: number; slot: number }) | null = null

  const close = () => {
    if (!current) return
    const { sum, slot: _slot, ...bucket } = current
    const spanMinutes = Math.round((bucket.lastMs - bucket.firstMs) / cadenceMs) + 1
    buckets.push({
      ...bucket,
      rangeLength: Math.max(bucket.observedCount, spanMinutes),
      average: sum / Math.max(1, bucket.observedCount),
    })
    current = null
  }

  for (let index = 0; index < values.length; index += 1) {
    if (args.include && !args.include(index)) {
      close()
      continue
    }
    const at = timestampsMs[index]
    const raw = values[index]
    if (at == null || !Number.isFinite(at) || raw == null || !Number.isFinite(raw)) {
      // Missing minute: never bridge it with a bar.
      close()
      continue
    }
    const value = Math.max(0, raw)
    const slot = Math.floor((at - originMs) / slotMs)
    const contiguous = current != null
      && current.slot === slot
      && at > current.lastMs
      && at - current.lastMs <= cadenceMs * 1.5
    if (!contiguous) {
      close()
      current = {
        startIndex: index,
        endExclusive: index + 1,
        firstMs: at,
        lastMs: at,
        slotStartMs: originMs + slot * slotMs,
        observedCount: 1,
        rangeLength: 1,
        average: value,
        peak: { index, value },
        sum: value,
        slot,
      }
      continue
    }
    const open = current!
    open.endExclusive = index + 1
    open.lastMs = at
    open.observedCount += 1
    open.sum += value
    if (value > open.peak.value) open.peak = { index, value }
  }
  close()
  return buckets
}
