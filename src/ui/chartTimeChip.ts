import {
  formatChatIntervalBounds,
  type ChartSelection,
} from '@streampulse/pulse-core'
import type { ExtensionPeak } from '../shared/messages.ts'

const CHIP_CHAR_PX = 6.4
const CHIP_PAD_PX = 10

export function estimateTimeChipWidth(label: string): number {
  return Math.max(28, label.length * CHIP_CHAR_PX + CHIP_PAD_PX)
}

/**
 * Floor a seek/onset offset to the containing canonical minute (HH:MM chip).
 */
export function containingMinuteOffset(totalSeconds: number): number {
  if (!Number.isFinite(totalSeconds)) return 0
  return Math.max(0, Math.floor(totalSeconds / 60) * 60)
}

/**
 * Minute-bucket times for chart chrome: drop trailing `:00` so hover/axis
 * don't look more precise than the underlying rollup.
 */
export function formatChartMinuteChip(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (ss === 0) return `${pad(hh)}:${pad(mm)}`
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
}

/**
 * Clamp a centered chip so the full label stays inside the plot.
 * Uses measured/estimated label width, not a fixed 28px assumption.
 */
export function clampTimeChipX(
  x: number,
  plotWidth: number,
  padLeft: number,
  labelWidth: number,
): number {
  const half = labelWidth / 2
  const min = padLeft + half
  const max = padLeft + plotWidth - half
  if (max <= min) return padLeft + plotWidth / 2
  return Math.min(max, Math.max(min, x))
}

export function overviewTimeChipLabel(args: {
  previewSelection?: ChartSelection | null
  committedSelection?: ChartSelection | null
  previewOffsetSeconds?: number | null
  selectedOffsetSeconds?: number | null
  fallbackRollupOffsetSeconds?: number | null
  reactionPoints?: readonly ExtensionPeak[]
}): string | null {
  const typed = typedSelectionForChip(args.previewSelection, args.committedSelection)
  if (typed?.kind === 'reaction') {
    return formatChartMinuteChip(containingMinuteOffset(typed.analyticalOffsetSeconds))
  }
  if (typed?.kind === 'chat_interval') {
    return formatChatIntervalBounds(typed.startOffsetSeconds, typed.endOffsetSeconds)
  }
  if (typed?.kind === 'emote_peak' || typed?.kind === 'chart_minute') {
    return formatChartMinuteChip(containingMinuteOffset(typed.offsetSeconds))
  }

  const authoritative =
    args.previewOffsetSeconds
    ?? args.selectedOffsetSeconds
    ?? null
  if (authoritative != null && Number.isFinite(authoritative)) {
    return formatChartMinuteChip(containingMinuteOffset(authoritative))
  }

  if (
    args.fallbackRollupOffsetSeconds != null
    && Number.isFinite(args.fallbackRollupOffsetSeconds)
  ) {
    return formatChartMinuteChip(containingMinuteOffset(args.fallbackRollupOffsetSeconds))
  }
  return null
}

function typedSelectionForChip(
  preview?: ChartSelection | null,
  committed?: ChartSelection | null,
): ChartSelection | null {
  if (preview && preview.kind !== 'none') return preview
  if (committed && committed.kind !== 'none') return committed
  return null
}
