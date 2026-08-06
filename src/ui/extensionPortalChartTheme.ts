import { CHART_BAR_ALPHA, CHART_SIGNAL } from './chartTheme.ts'

/** Portal analytics lane colors (figma-analytics / analytics-surfaces). */
export const EXTENSION_PORTAL_CHART_THEME = {
  chat: CHART_SIGNAL.chat,
  viewers: CHART_SIGNAL.viewers,
  emotes: CHART_SIGNAL.emotes,
  moment: CHART_SIGNAL.heat,
  game: CHART_SIGNAL.game,
  grid: 'rgba(255,255,255,0.06)',
  panel: 'rgba(255,255,255,0.02)',
  selection: CHART_SIGNAL.heat,
  live: CHART_SIGNAL.live,
} as const

export function barAlpha(
  opts: { isSpike: boolean; selected: boolean; hasValue: boolean },
): number {
  if (!opts.hasValue) return CHART_BAR_ALPHA.empty
  if (opts.selected) return opts.isSpike ? CHART_BAR_ALPHA.selectedSpike : CHART_BAR_ALPHA.selected
  return opts.isSpike ? CHART_BAR_ALPHA.spike : CHART_BAR_ALPHA.resting
}

export function barDimOpacity(activeBucket: number | null, barIndex: number): number {
  if (activeBucket == null) return 1
  return activeBucket === barIndex ? 1 : 0.72
}
