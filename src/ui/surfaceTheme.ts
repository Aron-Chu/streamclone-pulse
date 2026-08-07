import type { TwitchColorScheme } from '../content/twitchTheme.ts'

export type SurfaceScheme = TwitchColorScheme

export type SurfacePalette = {
  bg: string
  bgCanvas: string
  panel: string
  panelElevated: string
  panelGlass: string
  textPrimary: string
  textSecondary: string
  textMuted: string
  border: string
  borderSubtle: string
  hoverFill: string
  inputBg: string
  chartBg: string
  chartGrid: string
  crosshair: string
  shadow: string
  focusRingContrast: string
  /** Semantic status — readable in both schemes (not opacity tricks). */
  statusOkBg: string
  statusOkBorder: string
  statusOkText: string
  statusWarnBg: string
  statusWarnBorder: string
  statusWarnText: string
  statusErrorBg: string
  statusErrorBorder: string
  statusErrorText: string
  /** Games-played chips — deep amber on light, soft amber on dark. */
  gameChipBg: string
  gameChipBorder: string
  gameChipText: string
}

const SURFACE_VAR_PREFIX = '--pulse-surface-'

/**
 * Original Streamclone obsidian neutrals (June 2026), expressed as semantic roles.
 * Keep the hierarchy neutral: the product drift came from progressively brighter,
 * violet-gray cards rather than from the Aurora accent itself.
 */
export const DARK_SURFACE_PALETTE: SurfacePalette = {
  bg: '#0e0e12',
  bgCanvas: '#050507',
  panel: '#111117',
  panelElevated: '#1a1a22',
  panelGlass: 'rgba(17, 17, 24, 0.96)',
  textPrimary: '#fafafc',
  textSecondary: '#a1a1b2',
  textMuted: '#858595',
  border: 'rgba(255, 255, 255, 0.12)',
  borderSubtle: 'rgba(255, 255, 255, 0.075)',
  hoverFill: 'rgba(255, 255, 255, 0.055)',
  inputBg: '#0b0b0f',
  chartBg: '#0d0d12',
  chartGrid: 'rgba(255, 255, 255, 0.09)',
  crosshair: 'rgba(255, 255, 255, 0.32)',
  shadow: 'rgba(0, 0, 0, 0.45)',
  focusRingContrast: '#ffffff',
  statusOkBg: 'rgba(34, 197, 94, 0.14)',
  statusOkBorder: 'rgba(34, 197, 94, 0.35)',
  statusOkText: '#86efac',
  statusWarnBg: 'rgba(245, 158, 11, 0.14)',
  statusWarnBorder: 'rgba(245, 158, 11, 0.35)',
  statusWarnText: '#fcd34d',
  statusErrorBg: 'rgba(248, 113, 113, 0.14)',
  statusErrorBorder: 'rgba(248, 113, 113, 0.35)',
  statusErrorText: '#fca5a5',
  gameChipBg: 'rgba(249, 115, 22, 0.1)',
  gameChipBorder: 'rgba(249, 115, 22, 0.28)',
  gameChipText: '#fdba74',
}

/**
 * Calm light neutrals. A cool-gray canvas and mist controls keep large sidebar
 * areas from becoming a white glare, while white cards retain clear hierarchy.
 */
export const LIGHT_SURFACE_PALETTE: SurfacePalette = {
  bg: '#f7f7f8',
  bgCanvas: '#eceef1',
  panel: '#fdfdfd',
  panelElevated: '#f3f3f6',
  panelGlass: 'rgba(255, 255, 255, 0.98)',
  textPrimary: '#18181b',
  textSecondary: '#3f3f46',
  textMuted: '#5b5b66',
  border: '#d2d3d9',
  borderSubtle: 'rgba(14, 14, 16, 0.12)',
  hoverFill: 'rgba(14, 14, 16, 0.06)',
  inputBg: '#e8e9ed',
  chartBg: '#f0f1f4',
  chartGrid: 'rgba(14, 14, 16, 0.14)',
  crosshair: 'rgba(14, 14, 16, 0.46)',
  shadow: 'rgba(14, 14, 16, 0.12)',
  focusRingContrast: '#0e0e10',
  statusOkBg: 'rgba(4, 120, 87, 0.12)',
  statusOkBorder: 'rgba(4, 120, 87, 0.35)',
  statusOkText: '#065f46',
  statusWarnBg: 'rgba(180, 83, 9, 0.12)',
  statusWarnBorder: 'rgba(180, 83, 9, 0.35)',
  statusWarnText: '#9a3412',
  statusErrorBg: 'rgba(185, 28, 28, 0.1)',
  statusErrorBorder: 'rgba(185, 28, 28, 0.35)',
  statusErrorText: '#991b1b',
  // Quiet amber — readable but not louder than metrics/chart.
  gameChipBg: 'rgba(154, 52, 18, 0.06)',
  gameChipBorder: 'rgba(154, 52, 18, 0.28)',
  gameChipText: '#9a3412',
}

export function surfacePaletteFor(scheme: SurfaceScheme): SurfacePalette {
  return scheme === 'light' ? LIGHT_SURFACE_PALETTE : DARK_SURFACE_PALETTE
}

export function surfaceCssVar(name: keyof SurfacePalette): string {
  const dark = DARK_SURFACE_PALETTE[name]
  return `var(${SURFACE_VAR_PREFIX}${kebab(name)}, ${dark})`
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
}

/** Apply namespaced surface variables to a Pulse host only — never Twitch root. */
export function applySurfaceThemeToHost(host: HTMLElement, scheme: SurfaceScheme): void {
  const palette = surfacePaletteFor(scheme)
  host.setAttribute('data-pulse-color-scheme', scheme)
  for (const key of Object.keys(palette) as Array<keyof SurfacePalette>) {
    host.style.setProperty(`${SURFACE_VAR_PREFIX}${kebab(key)}`, palette[key])
  }
  // Charts historically read --pulse-chart-bg; keep it host-local and scheme-aware.
  host.style.setProperty('--pulse-chart-bg', palette.chartBg)
  if (scheme === 'light') {
    host.style.setProperty('--pulse-chart-viewer', '#0e7490')
    host.style.setProperty('--pulse-chart-chat', '#7c3aed')
    host.style.setProperty('--pulse-chart-emote', '#059669')
    host.style.setProperty('--pulse-chart-chat-trend', '#71717a')
    host.style.setProperty('--pulse-chart-plot-1', '#be123c')
    host.style.setProperty('--pulse-chart-plot-2', '#a16207')
    host.style.setProperty('--pulse-chart-plot-3', '#0369a1')
    host.style.setProperty('--pulse-chart-plot-4', '#7e22ce')
    host.style.setProperty('--pulse-chart-plot-5', '#15803d')
  } else {
    host.style.setProperty('--pulse-chart-viewer', '#14b8c8')
    host.style.setProperty('--pulse-chart-chat', '#a78bfa')
    host.style.setProperty('--pulse-chart-emote', '#34d399')
    host.style.setProperty('--pulse-chart-chat-trend', '#d4d4d8')
    host.style.setProperty('--pulse-chart-plot-1', '#fb7185')
    host.style.setProperty('--pulse-chart-plot-2', '#fbbf24')
    host.style.setProperty('--pulse-chart-plot-3', '#38bdf8')
    host.style.setProperty('--pulse-chart-plot-4', '#c084fc')
    host.style.setProperty('--pulse-chart-plot-5', '#4ade80')
  }
}

export function clearSurfaceThemeFromHost(host: HTMLElement): void {
  host.removeAttribute('data-pulse-color-scheme')
  for (const key of Object.keys(DARK_SURFACE_PALETTE) as Array<keyof SurfacePalette>) {
    host.style.removeProperty(`${SURFACE_VAR_PREFIX}${kebab(key)}`)
  }
  host.style.removeProperty('--pulse-chart-bg')
  host.style.removeProperty('--pulse-chart-viewer')
  host.style.removeProperty('--pulse-chart-chat')
  host.style.removeProperty('--pulse-chart-emote')
  host.style.removeProperty('--pulse-chart-chat-trend')
  for (let index = 1; index <= 5; index += 1) {
    host.style.removeProperty(`--pulse-chart-plot-${index}`)
  }
}

/** WCAG relative luminance for #rrggbb (or #rgb). Ignores alpha in rgba(). */
export function relativeLuminance(color: string): number {
  const rgb = parseRgb(color)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(channel => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground: string, background: string): number {
  const l1 = relativeLuminance(foreground)
  const l2 = relativeLuminance(background)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function parseRgb(color: string): [number, number, number] | null {
  const hex = color.trim()
  const short = /^#([0-9a-f]{3})$/i.exec(hex)
  if (short) {
    const [r, g, b] = short[1]!.split('').map(ch => parseInt(ch + ch, 16)) as [number, number, number]
    return [r, g, b]
  }
  const full = /^#([0-9a-f]{6})$/i.exec(hex)
  if (full) {
    const n = full[1]!
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
  }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(hex)
  if (rgba) {
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])]
  }
  return null
}
