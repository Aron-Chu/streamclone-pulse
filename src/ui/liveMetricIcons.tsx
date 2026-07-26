import type { CSSProperties } from 'react'

const ICON_SIZE = 14

export type LiveMetricIconKind = 'viewers' | 'chat' | 'emotes'

const ICON_COLORS: Record<LiveMetricIconKind, string> = {
  viewers: '#22d3ee',
  chat: '#a78bfa',
  emotes: '#34d399',
}

export function LiveMetricIcon({
  kind,
  size = ICON_SIZE,
  style,
}: {
  kind: LiveMetricIconKind
  size?: number
  style?: CSSProperties
}) {
  const color = ICON_COLORS[kind]
  const common = { width: size, height: size, fill: 'none', stroke: color, strokeWidth: 1.6, 'aria-hidden': true as const }

  if (kind === 'viewers') {
    return (
      <svg viewBox="0 0 16 16" style={style} {...common}>
        <circle cx="8" cy="5.5" r="2.5" />
        <path d="M3.5 13.5c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" strokeLinecap="round" />
      </svg>
    )
  }

  if (kind === 'chat') {
    return (
      <svg viewBox="0 0 16 16" style={style} {...common}>
        <path
          d="M3 4.5h10a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H7l-2.5 2v-2H3a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 16 16" style={style} {...common}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M5.5 9.5c.7 1 1.8 1.5 2.5 1.5s1.8-.5 2.5-1.5" strokeLinecap="round" />
      <circle cx="6.2" cy="7" r="0.65" fill={color} stroke="none" />
      <circle cx="9.8" cy="7" r="0.65" fill={color} stroke="none" />
    </svg>
  )
}
