/**
 * Accent theming for the overlay.
 *
 * The overlay renders inside a shadow DOM, but CSS custom properties inherit
 * across the shadow boundary from light-DOM ancestors (and `all: initial` on
 * `:host` does not reset custom properties). So writing `--pulse-*` variables on
 * `document.documentElement` recolors every accent surface inside both shadow
 * hosts at once, with no React re-render required.
 *
 * Every accent consumer references these vars via `var(--pulse-*, <fallback>)`,
 * where the fallback is the original "Aurora" purple — so an unthemed first paint
 * still looks correct.
 */
import type { ThemePreference } from '../shared/storage.ts'

interface AccentPalette {
  accent: string
  accentStrong: string
  accentSoft: string
  accentRgb: string
  accentLightRgb: string
  accentStrongRgb: string
  accentSoftRgb: string
  accentInk: string
  onAccent: string
}

/** Canonical accent palettes. Aurora mirrors the original purple values exactly. */
export const ACCENT_PALETTES: Record<ThemePreference, AccentPalette> = {
  aurora: {
    accent: '#8b5cf6',
    accentStrong: '#7c3aed',
    accentSoft: '#c4b5fd',
    accentRgb: '139, 92, 246',
    accentLightRgb: '167, 139, 250',
    accentStrongRgb: '124, 58, 237',
    accentSoftRgb: '196, 181, 253',
    accentInk: '#ddd6fe',
    onAccent: '#ffffff',
  },
  volt: {
    accent: '#53fc18',
    accentStrong: '#43e80f',
    accentSoft: '#b6ff8f',
    accentRgb: '83, 252, 24',
    accentLightRgb: '130, 255, 110',
    accentStrongRgb: '67, 232, 15',
    accentSoftRgb: '182, 255, 143',
    accentInk: '#d8ffc4',
    onAccent: '#07140a',
  },
  azure: {
    accent: '#22d3ee',
    accentStrong: '#0fb6d6',
    accentSoft: '#a5f0fb',
    accentRgb: '34, 211, 238',
    accentLightRgb: '103, 232, 249',
    accentStrongRgb: '15, 182, 214',
    accentSoftRgb: '165, 240, 251',
    accentInk: '#cffafe',
    onAccent: '#04181d',
  },
}

const VAR_NAMES: Record<keyof AccentPalette, string> = {
  accent: '--pulse-accent',
  accentStrong: '--pulse-accent-strong',
  accentSoft: '--pulse-accent-soft',
  accentRgb: '--pulse-accent-rgb',
  accentLightRgb: '--pulse-accent-light-rgb',
  accentStrongRgb: '--pulse-accent-strong-rgb',
  accentSoftRgb: '--pulse-accent-soft-rgb',
  accentInk: '--pulse-accent-ink',
  onAccent: '--pulse-on-accent',
}

/** Visible options for the theme picker (avoid product-specific naming). */
export const ACCENT_THEME_OPTIONS: ReadonlyArray<{
  value: ThemePreference
  label: string
  hint: string
  swatch: string
}> = [
  { value: 'aurora', label: 'Aurora', hint: 'Signature violet', swatch: '#8b5cf6' },
  { value: 'volt', label: 'Volt', hint: 'High-energy green', swatch: '#53fc18' },
  { value: 'azure', label: 'Azure', hint: 'Cool cyan', swatch: '#22d3ee' },
]

/**
 * Write the accent palette as `--pulse-*` custom properties on the document root
 * so they cascade into the overlay's shadow trees. Safe to call repeatedly.
 */
export function applyAccentTheme(pref: ThemePreference): void {
  const palette = ACCENT_PALETTES[pref] ?? ACCENT_PALETTES.aurora
  const root = typeof document !== 'undefined' ? document.documentElement : null
  if (!root) return
  ;(Object.keys(VAR_NAMES) as Array<keyof AccentPalette>).forEach(key => {
    root.style.setProperty(VAR_NAMES[key], palette[key])
  })
  root.style.setProperty('--pulse-accent-border', `rgba(${palette.accentRgb}, 0.35)`)
  root.style.setProperty('--pulse-chart-bg', '#0d0d12')
  root.setAttribute('data-pulse-accent', pref)
}
