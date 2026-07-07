/** Portal analytics lane colors (figma-analytics / analytics-surfaces). */
export const EXTENSION_PORTAL_CHART_THEME = {
  chat: '#8b5cf6',
  viewers: '#4ade80',
  emotes: '#22d3ee',
  moment: '#fbbf24',
  game: '#f97316',
  grid: 'rgba(255,255,255,0.06)',
  panel: 'rgba(255,255,255,0.02)',
  selection: '#fbbf24',
  live: '#4ade80',
} as const

export type BarLane = 'chat' | 'emote'

export function barAlpha(
  lane: BarLane,
  opts: { isSpike: boolean; selected: boolean; hasValue: boolean },
): number {
  if (!opts.hasValue) return 0.06
  if (lane === 'chat') {
    if (opts.selected) return opts.isSpike ? 0.9 : 0.78
    if (opts.isSpike) return 0.72
    return 0.35
  }
  if (opts.selected) return opts.isSpike ? 0.88 : 0.75
  if (opts.isSpike) return 0.68
  return 0.32
}

export function barDimOpacity(activeBucket: number | null, barIndex: number): number {
  if (activeBucket == null) return 1
  return activeBucket === barIndex ? 1 : 0.72
}
