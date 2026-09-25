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
  /**
   * Hex form of `accentLightRgb`. Focus rings and hover borders in both
   * settings surfaces read `var(--pulse-accent-light)`; without this the
   * variable was never defined and they stayed Aurora purple under every
   * other accent.
   */
  accentLight: string
  accentRgb: string
  accentLightRgb: string
  accentStrongRgb: string
  accentSoftRgb: string
  accentInk: string
  onAccent: string
}

/** Canonical accent palettes. Aurora mirrors the original purple values exactly. */
export const ACCENT_PALETTES: Record<ThemePreference, AccentPalette> = {
  emerald: {
    accent: '#34d399',
    accentStrong: '#10b981',
    accentSoft: '#a7f3d0',
    accentLight: '#6ee7b7',
    accentRgb: '52, 211, 153',
    accentLightRgb: '110, 231, 183',
    accentStrongRgb: '16, 185, 129',
    accentSoftRgb: '167, 243, 208',
    accentInk: '#d1fae5',
    onAccent: '#04181d',
  },
  aurora: {
    accent: '#8b5cf6',
    accentStrong: '#7c3aed',
    accentSoft: '#c4b5fd',
    accentLight: '#a78bfa',
    accentRgb: '139, 92, 246',
    accentLightRgb: '167, 139, 250',
    accentStrongRgb: '124, 58, 237',
    accentSoftRgb: '196, 181, 253',
    accentInk: '#ddd6fe',
    onAccent: '#ffffff',
  },
  volt: {
    accent: '#f97316',
    accentStrong: '#ea580c',
    accentSoft: '#fdba74',
    accentLight: '#fb923c',
    accentRgb: '249, 115, 22',
    accentLightRgb: '251, 146, 60',
    accentStrongRgb: '234, 88, 12',
    accentSoftRgb: '253, 186, 116',
    accentInk: '#ffedd5',
    onAccent: '#04181d',
  },
  azure: {
    accent: '#22d3ee',
    accentStrong: '#0fb6d6',
    accentSoft: '#a5f0fb',
    accentLight: '#67e8f9',
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
  accentLight: '--pulse-accent-light',
  accentRgb: '--pulse-accent-rgb',
  accentLightRgb: '--pulse-accent-light-rgb',
  accentStrongRgb: '--pulse-accent-strong-rgb',
  accentSoftRgb: '--pulse-accent-soft-rgb',
  accentInk: '--pulse-accent-ink',
  onAccent: '--pulse-on-accent',
}

export interface AccentThemeOption {
  value: ThemePreference
  label: string
  /** Optional page-only cue; compact pickers never render it. */
  description?: string
  /** Derived from the palette so a swatch can never drift from its accent. */
  swatch: string
}

/**
 * Visible options for the theme picker (avoid product-specific naming). Labels live here
 * rather than in each picker so every surface agrees; descriptions are
 * page-only (see options/preferenceDescriptions.ts).
 */
export const ACCENT_THEME_OPTIONS: ReadonlyArray<AccentThemeOption> = (
  [
    { value: 'aurora', label: 'Aurora' },
    { value: 'volt', label: 'Volt' },
    { value: 'emerald', label: 'Emerald' },
    { value: 'azure', label: 'Azure' },
  ] as const
).map(option => ({ ...option, swatch: ACCENT_PALETTES[option.value].accent }))

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
