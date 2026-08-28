/**
 * Four-field reaction identity helpers (chart-truth contract).
 * offsetSeconds = coarse 60s bucket. Never overwrite with seek.
 */

import { formatHeatOffset } from './liveHeat.ts'

export type ReactionIdentityFields = {
  offsetSeconds: number
  reactionOnsetOffsetSeconds?: number | null
  reactionApexOffsetSeconds?: number | null
  seekOffsetSeconds?: number | null
  precisionSeconds?: number | null
}

export type MomentClockDisplay = {
  text: string
  approximate: boolean
}

function hasSecondLevelPrecision(fields: ReactionIdentityFields): boolean {
  const precision = fields.precisionSeconds ?? 60
  return precision > 0 && precision < 60
}

/** Floor a stream-relative offset to the start of its minute (display only). */
export function floorOffsetToMinute(offsetSeconds: number): number {
  const s = Math.max(0, Math.floor(offsetSeconds))
  return s - (s % 60)
}

/** Analytical pin / announcement / select offset — never seek. */
export function reactionAnalyticalOffset(fields: ReactionIdentityFields): number {
  const onset = fields.reactionOnsetOffsetSeconds
  if (hasSecondLevelPrecision(fields) && onset != null && Number.isFinite(onset)) {
    return Math.max(0, Math.round(onset))
  }
  return Math.max(0, Math.round(fields.offsetSeconds))
}

/**
 * Top Moments / selected-moment clock. Approximation is structured metadata
 * so UI can render a readable badge instead of punctuation inside the time.
 */
export function momentClockDisplay(fields: ReactionIdentityFields): MomentClockDisplay {
  const onset = fields.reactionOnsetOffsetSeconds
  if (hasSecondLevelPrecision(fields) && onset != null && Number.isFinite(onset)) {
    return {
      text: formatHeatOffset(Math.max(0, Math.round(onset))),
      approximate: false,
    }
  }
  const floored = floorOffsetToMinute(fields.offsetSeconds)
  const s = Math.max(0, Math.floor(floored))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const pad = (n: number) => n.toString().padStart(2, '0')
  return {
    text: `${pad(hh)}:${pad(mm)}`,
    approximate: true,
  }
}

/** Legacy formatted clock for non-visual/portal callers. Prefer structured UI metadata. */
export function formatMomentClock(fields: ReactionIdentityFields): string {
  const display = momentClockDisplay(fields)
  return display.approximate ? `~${display.text}` : display.text
}

/** Playback Jump / Open Twitch only. */
export function reactionSeekOffset(fields: ReactionIdentityFields): number {
  const seek = fields.seekOffsetSeconds
  if (seek != null && Number.isFinite(seek)) {
    return Math.max(0, Math.round(seek))
  }
  return Math.max(0, Math.round(fields.offsetSeconds))
}

/**
 * Playback target with a small lead-in for human context.
 *
 * This is deliberately separate from analytical identity and chart pinning:
 * coarse minute moments stay coarse, while refined moments use their onset and
 * never seek later than five seconds before that onset. A backend-provided
 * earlier seek target is retained when it already gives at least that lead.
 */
export function reactionLeadInOffset(
  fields: ReactionIdentityFields,
  leadSeconds = 5,
): number {
  const lead = Math.max(0, Math.round(leadSeconds))
  const explicitSeek = fields.seekOffsetSeconds
  const onset = fields.reactionOnsetOffsetSeconds
  if (
    hasSecondLevelPrecision(fields)
    && onset != null
    && Number.isFinite(onset)
  ) {
    const leadTarget = Math.max(0, Math.round(onset) - lead)
    if (explicitSeek != null && Number.isFinite(explicitSeek)) {
      return Math.min(Math.max(0, Math.round(explicitSeek)), leadTarget)
    }
    return leadTarget
  }
  if (explicitSeek != null && Number.isFinite(explicitSeek)) {
    return Math.max(0, Math.round(explicitSeek))
  }
  return Math.max(0, Math.round(fields.offsetSeconds) - lead)
}

export type ChartSelectionProvenance =
  | 'chat_interval'
  | 'emote_peak'
  | 'reaction'
  | 'chart_minute'
  | 'none'

export type ChatIntervalPeak = {
  index: number
  value: number
  /** Canonical minute start of the disclosed peak. */
  offsetSeconds: number
}

/**
 * Chat bars are interval averages. Bounds are exclusive-end and must never be
 * overloaded with center, peak, or playback meanings.
 */
export type ChatIntervalSelection = {
  kind: 'chat_interval'
  startIndex: number
  endExclusive: number
  /** First canonical minute represented by the interval. */
  startOffsetSeconds: number
  /** Exclusive interval end (first minute not represented). */
  endOffsetSeconds: number
  average: number
  peak: ChatIntervalPeak | null
  observedCount: number
  rangeLength: number
  /**
   * Visual/host pin only: disclosed peak minute when present, else the first
   * covered canonical minute. Never the interval center and never a seek time.
   */
  anchorOffsetSeconds: number
}

/** Discriminated selection payload for preview (hover) and committed (click). */
export type ChartSelection =
  | { kind: 'none' }
  | ChatIntervalSelection
  | {
      kind: 'emote_peak'
      sourceIndex: number
      offsetSeconds: number
      value: number
    }
  | {
      kind: 'reaction'
      moment: ReactionIdentityFields & Record<string, unknown>
      analyticalOffsetSeconds: number
    }
  | {
      kind: 'chart_minute'
      canonicalIndex: number
      offsetSeconds: number
    }

export function chartSelectionProvenance(
  selection: ChartSelection | ChartSelectionProvenance,
): ChartSelectionProvenance {
  return typeof selection === 'string' ? selection : selection.kind
}

/** Jump that uses reaction seek is only valid for reaction provenance. */
export function selectionAllowsReactionSeek(
  selection: ChartSelectionProvenance | ChartSelection,
): boolean {
  return chartSelectionProvenance(selection) === 'reaction'
}

/** Overlay VOD may open minute-start for emote_peak / chart_minute — never reaction seek. */
export function selectionAllowsMinuteJump(
  selection: ChartSelectionProvenance | ChartSelection,
): boolean {
  const kind = chartSelectionProvenance(selection)
  return kind === 'emote_peak' || kind === 'chart_minute'
}

export function formatChatIntervalClock(offsetSeconds: number): string {
  const s = Math.max(0, Math.floor(offsetSeconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (ss === 0) return `${pad(hh)}:${pad(mm)}`
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
}

export function formatChatIntervalBounds(
  startOffsetSeconds: number,
  endOffsetSeconds: number,
): string {
  return `${formatChatIntervalClock(startOffsetSeconds)}–${formatChatIntervalClock(endOffsetSeconds)}`
}

export function chatIntervalAnchorOffset(args: {
  startOffsetSeconds: number
  peak: { offsetSeconds: number } | null | undefined
}): number {
  const peak = args.peak?.offsetSeconds
  if (peak != null && Number.isFinite(peak)) return Math.max(0, Math.round(peak))
  return Math.max(0, Math.round(args.startOffsetSeconds))
}

export function buildChatIntervalSelection(args: {
  startIndex: number
  endExclusive: number
  startOffsetSeconds: number
  endOffsetSeconds: number
  average: number
  peak: ChatIntervalPeak | null
  observedCount: number
  rangeLength: number
  anchorOffsetSeconds?: number
}): ChatIntervalSelection {
  const startOffsetSeconds = Math.max(0, Math.round(args.startOffsetSeconds))
  const endOffsetSeconds = Math.max(startOffsetSeconds, Math.round(args.endOffsetSeconds))
  const peak = args.peak
    ? {
        index: args.peak.index,
        value: args.peak.value,
        offsetSeconds: Math.max(0, Math.round(args.peak.offsetSeconds)),
      }
    : null
  return {
    kind: 'chat_interval',
    startIndex: args.startIndex,
    endExclusive: args.endExclusive,
    startOffsetSeconds,
    endOffsetSeconds,
    average: args.average,
    peak,
    observedCount: args.observedCount,
    rangeLength: args.rangeLength,
    anchorOffsetSeconds: args.anchorOffsetSeconds
      ?? chatIntervalAnchorOffset({ startOffsetSeconds, peak }),
  }
}

/** Canonical minute for host callbacks that still require one offset. */
export function chartSelectionCanonicalOffset(selection: ChartSelection): number | null {
  switch (selection.kind) {
    case 'none':
      return null
    case 'chat_interval':
      return selection.anchorOffsetSeconds
    case 'emote_peak':
    case 'chart_minute':
      return selection.offsetSeconds
    case 'reaction':
      return selection.analyticalOffsetSeconds
  }
}

/** Snap continuous fraction to nearest covered rollup offset (canonical minute). */
export function snapToCoveredCanonicalMinute(
  fraction: number,
  viewportStartSeconds: number,
  viewportDuration: number,
  coveredOffsets: readonly number[],
): number | null {
  if (coveredOffsets.length === 0 || viewportDuration <= 0) return null
  const continuous = viewportStartSeconds + Math.min(1, Math.max(0, fraction)) * viewportDuration
  let best: number | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const offset of coveredOffsets) {
    const dist = Math.abs(offset - continuous)
    if (dist < bestDist) {
      bestDist = dist
      best = offset
    }
  }
  return best
}
