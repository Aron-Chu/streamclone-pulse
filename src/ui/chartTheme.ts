import type { CSSProperties } from 'react'

/**
 * Chart colors split into two layers:
 *
 * - **Semantic lanes** (chat purple, emote green, trend stroke): fixed meanings;
 *   host scheme overrides via `--pulse-chart-*` (deeper on light, softer on dark).
 * - **Interaction chrome** (pin band, crosshair, marker rings): uses `--pulse-*`
 *   accent variables so selection follows Aurora/Volt/Azure.
 */
export const CHART_LANE = {
  chatBar: 'var(--pulse-chart-chat, #a78bfa)',
  emoteBar: 'var(--pulse-chart-emote, #34d399)',
  chatTrend: 'var(--pulse-chart-chat-trend, #d4d4d8)',
} as const

export const CHART_LANE_LIGHT = {
  chatBar: '#7c3aed',
  emoteBar: '#059669',
  chatTrend: '#71717a',
  viewer: '#0e7490',
} as const

/** @deprecated Prefer CHART_LANE + CHART_INTERACTION; kept for existing imports. */
export const CHART_THEME = {
  background: 'var(--pulse-surface-chart-bg, var(--pulse-chart-bg, #0c0c10))',
  viewer: {
    color: 'var(--pulse-chart-viewer, #14b8c8)',
    fillTop: 0.22,
    fillBottom: 0,
    line: 0.92,
    guide: 0.2,
  },
  emote: {
    color: CHART_LANE.emoteBar,
    line: 0.72,
  },
  chat: {
    color: CHART_LANE.chatBar,
    line: CHART_LANE.chatTrend,
    lineOpacity: 0.88,
  },
  spike: {
    color: '#fb7185',
    opacity: 0.5,
    dotRadius: 2.5,
  },
  emoteOverlay: 0.13,
  legendSwatch: 0.7,
  emoteFocus: '#f97316',
  perEmotePalette: [
    'var(--pulse-chart-plot-1, #fb7185)',
    'var(--pulse-chart-plot-2, #fbbf24)',
    'var(--pulse-chart-plot-3, #38bdf8)',
    'var(--pulse-chart-plot-4, #c084fc)',
    'var(--pulse-chart-plot-5, #4ade80)',
  ],
} as const

/** Pin / preview crosshair — follows accent theme via CSS variables. */
export const CHART_INTERACTION = {
  bandFill: 'rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.14)',
  bandStroke: 'rgba(var(--pulse-accent-light-rgb, 167, 139, 250), 0.35)',
  pinLine: 'rgba(var(--pulse-accent-soft-rgb, 196, 181, 253), 0.88)',
  previewLine: 'var(--pulse-surface-crosshair, rgba(255, 255, 255, 0.28))',
  hoverLine: 'var(--pulse-surface-crosshair, rgba(255, 255, 255, 0.22))',
  activityFill: 'var(--pulse-surface-hover-fill, rgba(255, 255, 255, 0.025))',
  gridLine: 'var(--pulse-surface-chart-grid, rgba(255, 255, 255, 0.08))',
  markerRing: 'var(--pulse-surface-focus-ring-contrast, rgba(255, 255, 255, 0.92))',
  trendMarkerFill: CHART_LANE.chatTrend,
  emoteMarkerFill: CHART_LANE.emoteBar,
} as const

export const CHART_MARKER_RADIUS = {
  pin: 3.75,
  preview: 3.25,
} as const

export type ChartScheme = 'light' | 'dark'

/** Resolve solid lane hexes for the host color scheme (tests / non-CSS contexts). */
export function chartLanesFor(scheme: ChartScheme = 'dark') {
  if (scheme === 'light') {
    return {
      chatBar: CHART_LANE_LIGHT.chatBar,
      emoteBar: CHART_LANE_LIGHT.emoteBar,
      chatTrend: CHART_LANE_LIGHT.chatTrend,
      viewer: CHART_LANE_LIGHT.viewer,
      lineBoost: 1.15,
    }
  }
  return {
    chatBar: '#a78bfa',
    emoteBar: '#34d399',
    chatTrend: '#d4d4d8',
    viewer: '#14b8c8',
    lineBoost: 1,
  }
}

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
  if (hex.startsWith('var(')) {
    // Keep scheme-aware plot colors translucent in row fills and legend swatches.
    return `color-mix(in srgb, ${hex} ${Math.round(opacity * 100)}%, transparent)`
  }
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3 ? normalized.split('').map(ch => ch + ch).join('') : normalized
  const int = Number.parseInt(full, 16)
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
