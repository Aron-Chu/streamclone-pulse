/** StreamPulse design tokens — mirrors extension theme (WEB-003). */
export const theme = {
  bg: '#0a0a0f',
  bgCanvas: '#111117',
  bgSurface: '#14141c',
  bgElevated: '#1d1d28',
  panel: '#262633',
  panelElevated: '#2a2440',
  textPrimary: '#f4f4f7',
  textSecondary: '#a1a1b2',
  textMuted: '#8b8b9e',
  accent: '#8b5cf6',
  accentStrong: '#7c3aed',
  accentSoft: '#c4b5fd',
  heatLow: '#4c1d95',
  heatMid: '#a855f7',
  heatPeak: '#f97316',
  heatHigh: '#fbbf24',
  live: '#ef4444',
  liveAccent: '#f97316',
  border: '#3f3f50',
  borderAccent: 'rgba(139, 92, 246, 0.35)',
  error: '#f87171',
  warning: '#fdba74',
  success: '#22c55e',
  radiusPanel: 14,
  radiusButton: 9,
  radiusPill: 13,
  font: 'Inter, ui-sans-serif, system-ui, sans-serif',
} as const

export const shadowStyles = `
  @keyframes pulse-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  @keyframes live-ping {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.35); opacity: 0.55; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  .pulse-animate-in { animation: pulse-in 0.35s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .pulse-shimmer {
    background: linear-gradient(90deg, ${theme.panel} 0%, rgba(139, 92, 246, 0.18) 50%, ${theme.panel} 100%);
    background-size: 200% 100%;
    animation: shimmer 2.2s ease-in-out infinite;
  }
  .pulse-live-dot { animation: live-ping 1.8s ease-in-out infinite; }
`
