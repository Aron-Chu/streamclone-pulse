import type { CSSProperties } from 'react'

/**
 * Chart colors split into two layers:
 *
 * - **Semantic lanes** (chat purple, emote green, trend stroke): fixed so the legend
 *   always matches the bars/lines regardless of Aurora/Volt/Azure accent pick.
 * - **Interaction chrome** (pin band, crosshair, marker rings): uses `--pulse-*` CSS
 *   variables from overlayTheme so selection follows the user's accent theme.
 */
export const CHART_LANE = {
  chatBar: '#a78bfa',
  emoteBar: '#34d399',
  chatTrend: '#d4d4d8',
} as const

/** @deprecated Prefer CHART_LANE + CHART_INTERACTION; kept for existing imports. */
export const CHART_THEME = {
  background: 'var(--pulse-chart-bg, #0d0d12)',
  viewer: {
    color: '#22d3ee',
    fillTop: 0.16,
    fillBottom: 0,
    line: 0.85,
    guide: 0.15,
  },
  emote: {
    color: CHART_LANE.emoteBar,
    bar: 0.34,
    barBaseline: 0.15,
    barSpike: 0.62,
    line: 0.55,
    guide: 0.28,
  },
  chat: {
    color: CHART_LANE.chatBar,
    line: CHART_LANE.chatTrend,
    lineOpacity: 0.72,
    whisperBar: 0.16,
    guide: 0.30,
  },
  spike: {
    color: '#fb7185',
    opacity: 0.5,
    dotRadius: 2.5,
  },
  emoteOverlay: 0.13,
  legendSwatch: 0.7,
  emoteFocus: '#f97316',
  perEmotePalette: ['#fb7185', '#fbbf24', '#38bdf8', '#c084fc', '#4ade80'],
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
  markerRing: 'rgba(255, 255, 255, 0.92)',
  trendMarkerFill: CHART_LANE.chatTrend,
  emoteMarkerFill: CHART_LANE.emoteBar,
} as const

export const CHART_MARKER_RADIUS = {
  pin: 3.75,
  preview: 3.25,
} as const

export function emoteChartColor(index: number): string {
  const palette = CHART_THEME.perEmotePalette
  return palette[((index % palette.length) + palette.length) % palette.length]!
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
