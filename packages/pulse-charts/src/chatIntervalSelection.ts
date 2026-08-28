import {
  buildChatIntervalSelection,
  type ChatIntervalSelection,
} from '@streampulse/pulse-core'

/**
 * Map an activity-chat bar to explicit interval identity.
 * Average belongs to [startOffset, endOffset); the host pin is the disclosed
 * peak minute when present, otherwise the first covered minute.
 */
export function chatIntervalSelectionFromActivityBar(args: {
  startIndex: number
  endExclusive: number
  average: number
  peak: { index: number; value: number } | null
  observedCount: number
  rangeLength: number
  offsetForIndex: (index: number) => number | undefined
}): ChatIntervalSelection {
  const lastIndex = Math.max(args.startIndex, args.endExclusive - 1)
  const startOffsetSeconds = args.offsetForIndex(args.startIndex) ?? args.startIndex * 60
  const lastOffsetSeconds = args.offsetForIndex(lastIndex) ?? lastIndex * 60
  const peakOffsetSeconds = args.peak
    ? (args.offsetForIndex(args.peak.index) ?? args.peak.index * 60)
    : undefined
  return buildChatIntervalSelection({
    startIndex: args.startIndex,
    endExclusive: args.endExclusive,
    startOffsetSeconds,
    endOffsetSeconds: lastOffsetSeconds + 60,
    average: args.average,
    peak: args.peak && peakOffsetSeconds != null
      ? {
          index: args.peak.index,
          value: args.peak.value,
          offsetSeconds: peakOffsetSeconds,
        }
      : null,
    observedCount: args.observedCount,
    rangeLength: args.rangeLength,
  })
}
