import type { CSSProperties } from 'react'

/**
 * Chart colors split into two layers:
 *
 * - **Semantic lanes** (chat purple, emote green, trend stroke): fixed so the legend
 *   always matches the bars/lines regardless of Aurora/Volt/Azure accent pick.
 * - **Interaction chrome** (pin band and crosshair): uses `--pulse-*` CSS
 *   variables from overlayTheme so selection follows the user's accent theme.
 */
export const CHART_SIGNAL = {
  chat: '#c4b5fd',
  emotes: '#34d399',
  viewers: '#22d3ee',
  heat: '#fbbf24',
  game: '#f97316',
  live: '#4ade80',
} as const

export const CHART_LANE = {
  chatBar: CHART_SIGNAL.chat,
  emoteBar: CHART_SIGNAL.emotes,
  chatTrend: '#d4d4d8',
} as const

/** Shared visual ladder for every chat/emote bar surface. */
export const CHART_BAR_ALPHA = {
  empty: 0.06,
  resting: 0.34,
  spike: 0.7,
  selected: 0.78,
  selectedSpike: 0.9,
} as const

/** @deprecated Prefer CHART_LANE + CHART_INTERACTION; kept for existing imports. */
export const CHART_THEME = {
  background: 'var(--pulse-chart-bg, #0d0d12)',
  viewer: {
    color: CHART_SIGNAL.viewers,
    fillTop: 0.16,
    fillBottom: 0,
    line: 0.85,
    guide: 0.15,
  },
  emote: {
    color: CHART_LANE.emoteBar,
    bar: CHART_BAR_ALPHA.resting,
    barBaseline: CHART_BAR_ALPHA.empty,
    barSpike: CHART_BAR_ALPHA.spike,
    line: 0.55,
    guide: 0.28,
  },
  chat: {
    color: CHART_LANE.chatBar,
    line: CHART_LANE.chatTrend,
    lineOpacity: 0.72,
    whisperBar: CHART_BAR_ALPHA.resting,
    guide: CHART_BAR_ALPHA.spike,
  },
  spike: {
    color: '#fb7185',
    opacity: 0.5,
    dotRadius: 2.5,
  },
  emoteOverlay: 0.13,
  legendSwatch: 0.7,
  emoteFocus: CHART_SIGNAL.game,
  perEmotePalette: ['#fb7185', '#fbbf24', '#38bdf8', '#c084fc', '#4ade80'],
  perEmoteDashes: ['7 3', '2 3', '7 2 2 2', '1 3', '10 3 2 3', '4 2 1 2 1 2'],
} as const

/** Pin / preview crosshair — follows accent theme via CSS variables. */
export const CHART_INTERACTION = {
  bandFill: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14)',
  bandStroke: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35)',
  pinLine: 'rgba(var(--pulse-accent-soft-rgb, 196, 181, 253), 0.88)',
  previewLine: 'rgba(255, 255, 255, 0.28)',
  hoverLine: 'rgba(255, 255, 255, 0.22)',
  activityFill: 'rgba(255, 255, 255, 0.025)',
  gridLine: 'rgba(255, 255, 255, 0.08)',
} as const

export function emoteChartColor(index: number): string {
  const palette = CHART_THEME.perEmotePalette
  return palette[((index % palette.length) + palette.length) % palette.length]!
}

export function emoteChartDash(index: number): string {
  const dashes = CHART_THEME.perEmoteDashes
  return dashes[((index % dashes.length) + dashes.length) % dashes.length]!
}

export function emoteLegendSwatchStyle(color: string): CSSProperties {
  return {
    backgroundColor: hexToRgba(color, 0.85),
    borderRadius: 1,
    flexShrink: 0,
    height: 12,
    width: 2,
  }
}

export function hexToRgba(hex: string, opacity: number): string {
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3 ? normalized.split('').map(ch => ch + ch).join('') : normalized
  const int = Number.parseInt(full, 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
