import { isEmoteSpikeReason } from '@streampulse/pulse-core'
import type { ExtensionPeak, ExtensionRollup } from '../shared/messages.ts'
import { minuteEmoteTotal } from './chartRollupUtils.ts'

/**
 * How strong a moment was next to this stream's usual, for the Live now
 * "Strongest loaded moment" pill. Same definition as the website's
 * "How unusual was this reaction?": the moment minute's own signal (chat for
 * chat spikes, emotes for emote spikes, read from the per-minute rollups and
 * never from the peak's own counts) over the mean of that signal across the up
 * to 30 measured minutes immediately before it. Missing minutes are skipped,
 * not counted as zero, and the moment minute is never part of its own usual.
 */
export interface MomentStrength {
  /** Moment minute ÷ usual, rounded to the one decimal the pill shows. */
  ratio: number
  /** Pill text before "usual": "4.2×" under 10, "10×+" from 10 up. */
  label: string
  /** Tint step: 1 is neutral (under 2×), then 2×, 3×, 5× and 8×. */
  level: number
  /** True when the moment is an emote spike, so both sides count emotes. */
  emotes: boolean
  /** The moment minute's chat (or emote) count. */
  value: number
  /** Unfloored mean of the measured minutes before it. */
  mean: number
  /** Measured minutes behind that mean (10 to 30). */
  minutes: number
}

export const STRENGTH_BASELINE_MINUTES = 30
export const STRENGTH_MIN_MEASURED_MINUTES = 10
/** A near-silent stretch must not turn a handful of messages into 40×. */
export const STRENGTH_BASELINE_FLOOR = 5
/** Below this the strongest moment is not meaningfully above usual. */
export const STRENGTH_MIN_RATIO = 1.2
export const STRENGTH_STEPS = [2, 3, 5, 8] as const

const MINUTE = 60

/**
 * `rollups` must be the validated full history (plus the recent tail); a
 * recent-only window would move the usual from poll to poll. Returns null when
 * the moment minute is not loaded, fewer than 10 measured minutes precede it,
 * or the ratio is under 1.2×.
 */
export function momentStrength(
  rollups: readonly ExtensionRollup[],
  moment: Pick<ExtensionPeak, 'offsetSeconds' | 'dominantSignal' | 'reasonLabel'>,
): MomentStrength | null {
  const emotes = isEmoteSpikeReason(moment.dominantSignal) || isEmoteSpikeReason(moment.reasonLabel ?? '')
  const count = (rollup: ExtensionRollup): number => Math.max(0, (emotes ? minuteEmoteTotal(rollup) : rollup.chatCount) || 0)
  const at = moment.offsetSeconds
  let minute: ExtensionRollup | undefined
  for (const rollup of rollups) {
    const start = rollup.offsetSeconds
    if (!rollup.missing && start <= at && at - start < MINUTE && !(minute && minute.offsetSeconds > start)) minute = rollup
  }
  if (!minute) return null
  const start = minute.offsetSeconds
  const before = rollups
    .filter(rollup => !rollup.missing && rollup.offsetSeconds < start)
    .sort((a, b) => b.offsetSeconds - a.offsetSeconds)
    .slice(0, STRENGTH_BASELINE_MINUTES)
  if (before.length < STRENGTH_MIN_MEASURED_MINUTES) return null
  const mean = before.reduce((sum, rollup) => sum + count(rollup), 0) / before.length
  const value = count(minute)
  const ratio = Math.round((value / Math.max(mean, STRENGTH_BASELINE_FLOOR)) * 10) / 10
  if (ratio < STRENGTH_MIN_RATIO) return null
  return {
    ratio,
    label: ratio < 10 ? `${ratio.toFixed(1)}×` : '10×+',
    level: 1 + STRENGTH_STEPS.filter(step => ratio >= step).length,
    emotes,
    value,
    mean,
    minutes: before.length,
  }
}
