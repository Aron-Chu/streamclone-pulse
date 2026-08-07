/**
 * Accent theming for the overlay.
 *
 * Brand accent hues (Aurora / Volt / Azure) are written on `document.documentElement`
 * so they cascade into Pulse shadow hosts. Scheme-aware *text/surface/border roles*
 * are applied on each Pulse host so light mode gets dark accent text and dark mode
 * gets pale accent text — without leaking Twitch styling or using opacity tricks.
 *
 * Every accent consumer references these vars via `var(--pulse-*, <fallback>)`.
 */
import type { ThemePreference } from '../shared/storage.ts'
import type { SurfaceScheme } from './surfaceTheme.ts'

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

/** Scheme-aware roles for accent text / chrome on Pulse surfaces. */
export type AccentRolePalette = {
  /** Primary accent text (links, active labels) — dark on light, pale on dark. */
  accentText: string
  /** Secondary accent text (hints, inactive accent labels). */
  accentTextSubtle: string
  /** Soft accent fill behind chips / selected rows. */
  accentSurface: string
  /** Accent outline for selected controls. */
  accentBorder: string
  onAccent: string
}

/** Canonical brand hues. Soft/ink here remain dark-mode defaults for document fallbacks. */
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
    accent: '#3ddc84',
    accentStrong: '#22c55e',
    accentSoft: '#86efac',
    accentRgb: '61, 220, 132',
    accentLightRgb: '134, 239, 172',
    accentStrongRgb: '34, 197, 94',
    accentSoftRgb: '134, 239, 172',
    accentInk: '#bbf7d0',
    onAccent: '#052e16',
  },
  azure: {
    accent: '#14b8c8',
    accentStrong: '#0e8fa0',
    accentSoft: '#67e8f9',
    accentRgb: '20, 184, 200',
    accentLightRgb: '103, 232, 249',
    accentStrongRgb: '14, 143, 160',
    accentSoftRgb: '165, 243, 252',
    accentInk: '#9fe7f0',
    onAccent: '#083344',
  },
}

const ACCENT_ROLES: Record<ThemePreference, Record<SurfaceScheme, AccentRolePalette>> = {
  aurora: {
    light: {
      accentText: '#5b21b6',
      accentTextSubtle: '#6d28d9',
      accentSurface: 'rgba(91, 33, 182, 0.1)',
      accentBorder: 'rgba(91, 33, 182, 0.38)',
      onAccent: '#ffffff',
    },
    dark: {
      accentText: '#ddd6fe',
      accentTextSubtle: '#c4b5fd',
      accentSurface: 'rgba(139, 92, 246, 0.16)',
      accentBorder: 'rgba(167, 139, 250, 0.4)',
      onAccent: '#ffffff',
    },
  },
  volt: {
    light: {
      accentText: '#166534',
      accentTextSubtle: '#15803d',
      accentSurface: 'rgba(22, 163, 74, 0.12)',
      accentBorder: 'rgba(22, 163, 74, 0.4)',
      onAccent: '#052e16',
    },
    dark: {
      accentText: '#bbf7d0',
      accentTextSubtle: '#86efac',
      accentSurface: 'rgba(61, 220, 132, 0.14)',
      accentBorder: 'rgba(134, 239, 172, 0.35)',
      onAccent: '#052e16',
    },
  },
  azure: {
    light: {
      accentText: '#0e7490',
      accentTextSubtle: '#0f766e',
      accentSurface: 'rgba(8, 145, 178, 0.12)',
      accentBorder: 'rgba(8, 145, 178, 0.4)',
      onAccent: '#083344',
    },
    dark: {
      accentText: '#9fe7f0',
      accentTextSubtle: '#67e8f9',
      accentSurface: 'rgba(20, 184, 200, 0.16)',
      accentBorder: 'rgba(103, 232, 249, 0.35)',
      onAccent: '#083344',
    },
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

const ROLE_VAR_NAMES: Record<keyof AccentRolePalette, string> = {
  accentText: '--pulse-accent-text',
  accentTextSubtle: '--pulse-accent-text-subtle',
  accentSurface: '--pulse-accent-surface',
  accentBorder: '--pulse-accent-border',
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
  { value: 'volt', label: 'Volt', hint: 'High-energy green', swatch: '#3ddc84' },
  { value: 'azure', label: 'Azure', hint: 'Cool cyan', swatch: '#14b8c8' },
]

export function accentRolesFor(
  pref: ThemePreference,
  scheme: SurfaceScheme,
): AccentRolePalette {
  const roles = ACCENT_ROLES[pref] ?? ACCENT_ROLES.aurora
  return roles[scheme]
}

/**
 * Write brand accent hues on the document root (cascades into Pulse shadows).
 * Does **not** force a dark chart background — charts use host surface tokens.
 */
export function applyAccentTheme(pref: ThemePreference): void {
  const palette = ACCENT_PALETTES[pref] ?? ACCENT_PALETTES.aurora
  const root = typeof document !== 'undefined' ? document.documentElement : null
  if (!root) return
  ;(Object.keys(VAR_NAMES) as Array<keyof AccentPalette>).forEach(key => {
    root.style.setProperty(VAR_NAMES[key], palette[key])
  })
  root.style.setProperty('--pulse-accent-border', `rgba(${palette.accentRgb}, 0.35)`)
  root.setAttribute('data-pulse-accent', pref)
}

/**
 * Host-local scheme-aware accent text/surface roles. Overrides inherited pale
 * ink/soft vars so light-mode links and chips stay readable.
 */
export function applyAccentRolesToHost(
  host: HTMLElement,
  pref: ThemePreference,
  scheme: SurfaceScheme,
): void {
  const roles = accentRolesFor(pref, scheme)
  for (const key of Object.keys(ROLE_VAR_NAMES) as Array<keyof AccentRolePalette>) {
    host.style.setProperty(ROLE_VAR_NAMES[key], roles[key])
  }
  // Remap legacy ink/soft consumers inside this host to readable scheme roles.
  host.style.setProperty('--pulse-accent-ink', roles.accentText)
  host.style.setProperty('--pulse-accent-soft', roles.accentTextSubtle)
}

export function clearAccentRolesFromHost(host: HTMLElement): void {
  for (const key of Object.keys(ROLE_VAR_NAMES) as Array<keyof AccentRolePalette>) {
    host.style.removeProperty(ROLE_VAR_NAMES[key])
  }
  host.style.removeProperty('--pulse-accent-ink')
  host.style.removeProperty('--pulse-accent-soft')
}
