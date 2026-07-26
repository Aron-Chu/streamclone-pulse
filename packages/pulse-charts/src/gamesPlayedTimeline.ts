import { gameSegmentOverlapsOffsetRange, gameSegmentVisibleSecondsInRange } from './gameSegments.ts'

/** Matches PulseMultiSignalChart plot insets so Games played can edge-align. */
export const CHART_PLOT_PAD_LEFT = 90
export const CHART_PLOT_PAD_RIGHT = 34

export type GamesPlayedTimelineRange = {
  startOffset: number
  endOffset: number
}

export type GamesPlayedTimelineGap = {
  kind: 'gap'
  flexGrow: number
  startOffset: number
  endOffset: number
}

export type GamesPlayedTimelineSegmentSlot<T> = {
  kind: 'segment'
  segment: T
  flexGrow: number
  visibleStart: number
  visibleEnd: number
  /** True when the segment extends outside the timeline window. */
  clipped: boolean
}

export type GamesPlayedTimelineSlot<T> = GamesPlayedTimelineGap | GamesPlayedTimelineSegmentSlot<T>

type SegmentLike = {
  offsetSeconds: number
  durationSeconds: number
}

function segmentEnd(segment: SegmentLike): number {
  return segment.offsetSeconds + Math.max(0, segment.durationSeconds)
}

/** Prefer the chart window; otherwise cover [0, duration] (or last segment end). */
export function resolveGamesPlayedTimelineRange(
  visibleRange: GamesPlayedTimelineRange | null | undefined,
  durationSeconds: number,
  segments: readonly SegmentLike[],
): GamesPlayedTimelineRange | null {
  if (
    visibleRange
    && Number.isFinite(visibleRange.startOffset)
    && Number.isFinite(visibleRange.endOffset)
    && visibleRange.endOffset > visibleRange.startOffset
  ) {
    return {
      startOffset: Math.max(0, visibleRange.startOffset),
      endOffset: Math.max(0, visibleRange.endOffset),
    }
  }

  let end = Math.max(0, durationSeconds)
  for (const segment of segments) {
    if (!Number.isFinite(segment.offsetSeconds) || !Number.isFinite(segment.durationSeconds)) continue
    end = Math.max(end, segmentEnd(segment))
  }
  if (end <= 0) return null
  return { startOffset: 0, endOffset: end }
}

/**
 * Build proportional flex slots (segments + empty gaps) for a chart-aligned Games played bar.
 * `flexGrow` is visible seconds so a single covering game spans the full plot width.
 */
export function buildGamesPlayedTimelineSlots<T extends SegmentLike>(
  segments: readonly T[],
  range: GamesPlayedTimelineRange,
): GamesPlayedTimelineSlot<T>[] {
  const rangeSpan = range.endOffset - range.startOffset
  if (!(rangeSpan > 0)) return []

  const overlapping = segments
    .filter(segment =>
      gameSegmentOverlapsOffsetRange(segment, range.startOffset, range.endOffset)
      && gameSegmentVisibleSecondsInRange(segment, range.startOffset, range.endOffset) > 0,
    )
    .slice()
    .sort((left, right) => left.offsetSeconds - right.offsetSeconds || segmentEnd(left) - segmentEnd(right))

  const slots: GamesPlayedTimelineSlot<T>[] = []
  let cursor = range.startOffset

  for (const segment of overlapping) {
    const visibleStart = Math.max(segment.offsetSeconds, range.startOffset)
    const visibleEnd = Math.min(segmentEnd(segment), range.endOffset)
    if (visibleEnd <= visibleStart) continue

    if (visibleStart > cursor) {
      slots.push({
        kind: 'gap',
        flexGrow: visibleStart - cursor,
        startOffset: cursor,
        endOffset: visibleStart,
      })
    }

    slots.push({
      kind: 'segment',
      segment,
      flexGrow: visibleEnd - visibleStart,
      visibleStart,
      visibleEnd,
      clipped:
        segment.offsetSeconds < range.startOffset
        || segmentEnd(segment) > range.endOffset,
    })
    cursor = Math.max(cursor, visibleEnd)
  }

  if (cursor < range.endOffset) {
    slots.push({
      kind: 'gap',
      flexGrow: range.endOffset - cursor,
      startOffset: cursor,
      endOffset: range.endOffset,
    })
  }

  return slots
}
