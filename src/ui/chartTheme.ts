/** Muted chart palette — mirrors frontend/src/components/analytics/chartTheme.ts */
export const CHART_THEME = {
  background: '#0d0d12',
  viewer: {
    color: '#22d3ee',
    fillTop: 0.16,
    fillBottom: 0,
    line: 0.85,
    guide: 0.15,
  },
  emote: {
    color: '#34d399',
    bar: 0.4,
    barBaseline: 0.15,
    barSpike: 0.55,
    line: 0.55,
    guide: 0.28,
  },
  chat: {
    color: '#a78bfa',
    line: '#d4d4d8',
    lineOpacity: 0.72,
    whisperBar: 0.12,
    guide: 0.22,
  },
  spike: {
    color: '#fb7185',
    opacity: 0.5,
    dotRadius: 2.5,
  },
  emoteOverlay: 0.13,
  /** Primary selected emote (LO-style focus line). */
  emoteFocus: '#f97316',
  perEmotePalette: ['#f97316', '#fb7185', '#60a5fa', '#34d399', '#facc15'],
} as const

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
