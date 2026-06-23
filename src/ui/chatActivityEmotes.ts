import { SPARKLINE_MAX_POINTS, formatHeatOffset } from '@streamclone/pulse-core'
import { CHART_THEME } from './chartTheme.ts'
import type { ExtensionEmote, ExtensionRollup, PulsePayload } from '../shared/messages.ts'

export const MAX_PAST_STREAM_ROWS = 3
export const CHAT_INSPECTOR_EMOTE_LIMIT = 8

export const EMOTE_OVERLAY_PALETTE = CHART_THEME.perEmotePalette

export function emoteOverlayColor(index: number): string {
  return EMOTE_OVERLAY_PALETTE[index % EMOTE_OVERLAY_PALETTE.length] ?? CHART_THEME.emoteFocus
}

export function maxSeriesValue(values: number[]): number {
  return values.reduce((max, value) => Math.max(max, value), 0)
}

export const FULL_TIMELINE_MAX_POINTS = 480

export type RollupWindow = 'recent' | 'full'

function rollupSource(payload: PulsePayload, window: RollupWindow): ExtensionRollup[] {
  if (window === 'full' && (payload.fullRollups?.length ?? 0) > 0) {
    return payload.fullRollups ?? []
  }
  if (payload.rollups.length > 0) return payload.rollups
  return payload.fullRollups ?? []
}

export function chatSeriesFromRollups(rollups: ExtensionRollup[]): number[] {
  return rollups.map(rollup => Math.max(0, rollup.chatCount ?? 0))
}

/** Average emote counts over the last N completed rollup minutes. */
export function emoteAveragesFromRollups(
  rollups: ExtensionRollup[],
  windowMinutes = 5,
): { totalPerMin: number; sevenTvPerMin: number; minutes: number } {
  const completed = rollups.filter(r =>
    !r.missing && ((r.totalEmoteCount ?? 0) > 0 || (r.sevenTvEmoteCount ?? 0) > 0),
  )
  const slice = completed.slice(-windowMinutes)
  if (slice.length === 0) {
    return { totalPerMin: 0, sevenTvPerMin: 0, minutes: 0 }
  }
  let total = 0
  let sevenTv = 0
  for (const rollup of slice) {
    total += rollup.totalEmoteCount ?? rollup.sevenTvEmoteCount ?? 0
    sevenTv += rollup.sevenTvEmoteCount ?? 0
  }
  const minutes = slice.length
  return {
    totalPerMin: Math.round(total / minutes),
    sevenTvPerMin: Math.round(sevenTv / minutes),
    minutes,
  }
}

/** Sum of 7TV emote uses across chart rollups (stream window). */
export function streamSevenTvTotal(rollups: ExtensionRollup[]): number {
  return rollups.reduce((sum, rollup) => sum + Math.max(0, rollup.sevenTvEmoteCount ?? 0), 0)
}

export function rollupSeries(payload: PulsePayload, window: RollupWindow = 'recent'): ExtensionRollup[] {
  const maxPoints = window === 'full' ? FULL_TIMELINE_MAX_POINTS : SPARKLINE_MAX_POINTS
  const source = rollupSource(payload, window)
  const filtered = source.filter(rollup => {
    if (rollup.missing) return false
    if (window === 'full') return true
    return (
      (rollup.chatCount ?? 0) > 0
      || (rollup.totalEmoteCount ?? 0) > 0
      || (rollup.sevenTvEmoteCount ?? 0) > 0
      || (rollup.topEmotes?.length ?? 0) > 0
    )
  })
  return filtered.slice(-maxPoints)
}

/** Chart rollups: prefer full-stream payload whenever the backend sends it. */
export function chartRollupSeries(payload: PulsePayload): ExtensionRollup[] {
  return rollupSeries(payload, hasFullTimelineRollups(payload) ? 'full' : 'recent')
}

/** Zero-fill / bucket sparse full-stream rollups so the chart spans stream start → now. */
export function densifyRollupsForTimeline(
  rollups: ExtensionRollup[],
  options: { fromOffset: number; toOffset: number; maxPoints: number },
): ExtensionRollup[] {
  const { fromOffset, toOffset, maxPoints } = options
  if (rollups.length === 0 || toOffset <= fromOffset || maxPoints < 2) {
    return rollups
  }

  const byOffset = new Map<number, ExtensionRollup>()
  for (const rollup of rollups) {
    byOffset.set(rollup.offsetSeconds, rollup)
  }

  const step = 60
  const totalMinutes = Math.floor((toOffset - fromOffset) / step) + 1
  if (totalMinutes <= maxPoints) {
    const out: ExtensionRollup[] = []
    for (let off = fromOffset; off <= toOffset; off += step) {
      out.push(
        byOffset.get(off) ?? {
          offsetSeconds: off,
          chatCount: 0,
          sevenTvEmoteCount: 0,
        },
      )
    }
    return out
  }

  const bucketMinutes = totalMinutes / maxPoints
  const out: ExtensionRollup[] = []
  for (let i = 0; i < maxPoints; i += 1) {
    const bucketStart = fromOffset + Math.floor(i * bucketMinutes) * step
    const bucketEnd = fromOffset + Math.floor((i + 1) * bucketMinutes) * step
    let chatSum = 0
    let sevenTvSum = 0
    let peak: ExtensionRollup | undefined
    for (let off = bucketStart; off < bucketEnd; off += step) {
      const rollup = byOffset.get(off)
      if (!rollup) continue
      chatSum += rollup.chatCount ?? 0
      sevenTvSum += rollup.sevenTvEmoteCount ?? 0
      if (!peak || (rollup.chatCount ?? 0) > (peak.chatCount ?? 0)) {
        peak = rollup
      }
    }
    out.push({
      offsetSeconds: bucketStart,
      chatCount: chatSum,
      sevenTvEmoteCount: sevenTvSum,
      topEmotes: peak?.topEmotes,
    })
  }
  return out
}

export function prepareChartRollups(
  payload: PulsePayload,
  options: { fullTimeline: boolean; currentOffsetSeconds: number },
): ExtensionRollup[] {
  const hasFull = hasFullTimelineRollups(payload)
  const raw = hasFull ? rollupSeries(payload, 'full') : rollupSeries(payload, 'recent')
  if (!hasFull) return raw

  const lastOffset = raw.length > 0 ? raw[raw.length - 1]!.offsetSeconds : 0
  const toOffset = Math.max(options.currentOffsetSeconds, lastOffset)
  if (toOffset <= 60) return raw

  return densifyRollupsForTimeline(raw, {
    fromOffset: 0,
    toOffset,
    maxPoints: chartMaxPoints(payload),
  })
}

export function chartAlignFromStart(payload: PulsePayload): boolean {
  return hasFullTimelineRollups(payload)
}

export function chartMaxPoints(payload: PulsePayload): number {
  return hasFullTimelineRollups(payload) ? FULL_TIMELINE_MAX_POINTS : SPARKLINE_MAX_POINTS
}

export function chartEmptyMessage(options: {
  rollupCount: number
  fullTimelineRequested: boolean
  hasFullRollups: boolean
  confidence: string
  currentOffsetSeconds: number
}): string {
  const { rollupCount, fullTimelineRequested, hasFullRollups, confidence, currentOffsetSeconds } = options
  if (rollupCount >= 2) return ''
  if (rollupCount === 1) {
    return 'First minute collected — chart fills in after one more completed minute.'
  }
  if (confidence === 'Waiting for first minute') {
    return 'Collecting the first minute of chat rollups. The graph appears here automatically.'
  }
  if (fullTimelineRequested && !hasFullRollups && currentOffsetSeconds > 120) {
    return 'Full stream requested, but Streamclone has no rollups for this broadcast yet. Tracking may have started late or paused.'
  }
  if (fullTimelineRequested && !hasFullRollups) {
    return 'Loading full stream rollups from Streamclone…'
  }
  return 'No chat activity in the recent window yet.'
}

/** Largest hole between rollup minutes — surfaces when IRC tracking dropped mid-stream. */
export function describeRollupGap(rollups: ExtensionRollup[]): string | null {
  if (rollups.length < 2) return null
  let maxGap = 0
  let gapAfter = 0
  let gapBefore = 0
  for (let i = 1; i < rollups.length; i += 1) {
    const prev = rollups[i - 1]?.offsetSeconds ?? 0
    const next = rollups[i]?.offsetSeconds ?? 0
    const gap = next - prev
    if (gap > maxGap) {
      maxGap = gap
      gapAfter = prev
      gapBefore = next
    }
  }
  if (maxGap <= 120) return null
  return `Missing chat data from ${formatHeatOffset(gapAfter + 60)} to ${formatHeatOffset(gapBefore)}`
}

export function hasFullTimelineRollups(payload: PulsePayload | null | undefined): boolean {
  return (payload?.fullRollups?.length ?? 0) > 0
}

export function isSevenTvProvider(provider?: string): boolean {
  const value = provider?.trim().toLowerCase() ?? ''
  return value === '7tv' || value === 'seventv'
}

export function emoteSelectionKey(emote: Pick<ExtensionEmote, 'id' | 'name' | 'provider'>): string {
  const provider = isSevenTvProvider(emote.provider) ? 'seventv' : (emote.provider ?? 'seventv')
  const id = emote.id?.trim() || emote.name
  return `${provider}:${id}:${emote.name}`
}

export function sevenTvEmotesFromRollup(rollup: ExtensionRollup): ExtensionEmote[] {
  return (rollup.topEmotes ?? []).filter(emote => isSevenTvProvider(emote.provider))
}

export function emoteCountAtRollup(rollup: ExtensionRollup, emote: ExtensionEmote): number {
  const targetKey = emoteSelectionKey(emote)
  for (const top of rollup.topEmotes ?? []) {
    if (emoteSelectionKey(top) === targetKey) {
      return Math.max(0, top.count ?? 0)
    }
  }
  return 0
}

export function buildSelectedEmoteSeries(rollups: ExtensionRollup[], emote: ExtensionEmote): number[] {
  return rollups.map(rollup => emoteCountAtRollup(rollup, emote))
}

export function aggregateChartEmotes(
  rollups: ExtensionRollup[],
  limit = CHAT_INSPECTOR_EMOTE_LIMIT,
): ExtensionEmote[] {
  const totals = new Map<string, ExtensionEmote>()
  for (const rollup of rollups) {
    for (const emote of rollup.topEmotes ?? []) {
      const key = emoteSelectionKey(emote)
      const existing = totals.get(key)
      if (existing) {
        totals.set(key, { ...existing, count: existing.count + Math.max(0, emote.count ?? 0) })
      } else {
        totals.set(key, { ...emote, count: Math.max(0, emote.count ?? 0) })
      }
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/** @deprecated use aggregateChartEmotes */
export const aggregateSevenTvEmotes = aggregateChartEmotes

export function sparklineIndexFromClick(
  clientX: number,
  canvasRect: DOMRect,
  pointCount: number,
  maxPoints: number = SPARKLINE_MAX_POINTS,
  alignFromStart = false,
): number {
  if (pointCount <= 0) return 0
  const width = Math.max(1, canvasRect.width)
  const x = Math.min(Math.max(0, clientX - canvasRect.left), width)
  const effectiveMax = alignFromStart ? pointCount : maxPoints
  const step = width / Math.max(1, effectiveMax - 1)
  const offset = alignFromStart ? 0 : maxPoints - pointCount
  const raw = Math.round(x / step) - offset
  return Math.min(pointCount - 1, Math.max(0, raw))
}

export interface EmoteOverlaySeries {
  key: string
  label: string
  color: string
  values: number[]
  primary?: boolean
}

export function buildEmoteOverlaySeries(
  rollups: ExtensionRollup[],
  emotes: ExtensionEmote[],
): EmoteOverlaySeries[] {
  return emotes.map((emote, index) => ({
    key: emoteSelectionKey(emote),
    label: emote.name,
    color: emoteOverlayColor(index),
    values: buildSelectedEmoteSeries(rollups, emote),
    primary: index === 0,
  }))
}
