// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { twitchTheme } from '../src/content/mount.tsx'
import { ACCENT_PALETTES } from '../src/ui/overlayTheme.ts'
import { shadowStyles } from '../src/ui/theme.ts'

type Rgb = [number, number, number]
const hex = (value: string): Rgb => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16)) as Rgb
const over = ([r, g, b]: Rgb, alpha: number, base: Rgb): Rgb => [r * alpha + base[0] * (1 - alpha), g * alpha + base[1] * (1 - alpha), b * alpha + base[2] * (1 - alpha)]
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: Rgb, b: Rgb) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
/** Declarations of the single light-theme rule whose selector ends with `selector`. */
function lightRule(selector: string): Record<string, string> {
  const rules = [...shadowStyles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, head]) => head.split(',').some(part => part.trim() === `:host([data-twitch-theme="light"]) ${selector}`))
  expect(rules).toHaveLength(1)
  return Object.fromEntries(rules[0][2].split(';').map(d => d.split(':').map(v => v.trim())).filter(([k, v]) => k && v))
}
const rgba = (value: string): [Rgb, number] => {
  const [r, g, b, a] = value.match(/rgba\(([^)]+)\)/)![1].split(',').map(Number)
  return [[r, g, b], a]
}

describe('Twitch theme mirroring', () => {
  it('reads Twitch light and dark root classes, defaulting to dark', () => {
    const root = document.createElement('html')
    expect(twitchTheme(root)).toBe('dark')
    root.className = 'tw-root--hover tw-root--theme-light'
    expect(twitchTheme(root)).toBe('light')
    root.className = 'tw-root--theme-dark'
    expect(twitchTheme(root)).toBe('dark')
  })
})

describe('light Twitch tab row', () => {
  // Twitch light surfaces: #ffffff page, #f7f7f8 alternate. Check the darker.
  const header = hex('#f7f7f8')
  const [trackColor, trackAlpha] = rgba(lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tabs-compact').background)
  const track = over(trackColor, trackAlpha, header)

  it('scopes the overrides to the tab row', () => {
    for (const rule of shadowStyles.match(/:host\(\[data-twitch-theme="light"\]\)[^{,]*/g) ?? []) {
      expect(rule).toMatch(/\.pulse-sidebar-(header-edge|header-tabs)/)
    }
  })

  it('keeps labels at AA text contrast on the track, idle and hovered', () => {
    expect(contrast(hex(lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tab').color), track)).toBeGreaterThanOrEqual(4.5)
    const hover = lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tab:not(.active):hover:not(:disabled)')
    expect(contrast(hex(hover.color), over(...rgba(hover.background), track))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps edge icons and their states at AA non-text contrast', () => {
    expect(contrast(hex(lightRule('.pulse-sidebar-header-edge').color), header)).toBeGreaterThanOrEqual(3)
    const hover = lightRule('.pulse-sidebar-header-edge:hover')
    expect(contrast(hex(hover.color), over(...rgba(hover.background), header))).toBeGreaterThanOrEqual(3)
    const pressed = lightRule('.pulse-sidebar-header-edge-active')
    expect(pressed.color).toBe('#0e0e10')
    const ring = rgba(pressed['box-shadow'])
    for (const palette of Object.values(ACCENT_PALETTES)) {
      const fill = over(hex(palette.accent), 0.18, header)
      expect(contrast(hex(pressed.color), fill)).toBeGreaterThanOrEqual(3)
      expect(contrast(over(...ring, fill), header)).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the active accent pill readable and outlined for every accent', () => {
    const active = lightRule('.pulse-sidebar-header-tabs .pulse-sidebar-tab.active')
    expect(active.color).toContain('--pulse-on-accent')
    const ring = rgba(active['box-shadow'])
    for (const palette of Object.values(ACCENT_PALETTES)) {
      const pill = hex(palette.accentStrong)
      expect(contrast(hex(palette.onAccent), pill)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(over(...ring, pill), track)).toBeGreaterThanOrEqual(3)
    }
    expect(shadowStyles).toContain(':host([data-twitch-theme="light"]) .pulse-sidebar-header-tabs .pulse-sidebar-tab:focus-visible')
  })
})

describe('strength pill top step', () => {
  const PALETTE_VARS: Record<string, keyof (typeof ACCENT_PALETTES)['aurora']> = {
    '--pulse-accent': 'accent',
    '--pulse-accent-strong': 'accentStrong',
    '--pulse-accent-rgb': 'accentRgb',
    '--pulse-accent-strong-rgb': 'accentStrongRgb',
    '--pulse-accent-light-rgb': 'accentLightRgb',
    '--pulse-on-accent': 'onAccent',
  }
  /** Resolves a solid `rgb(var(--x-rgb, …))`, `var(--x, #hex)` or `#hex` colour for one palette. */
  const resolve = (value: string, palette: (typeof ACCENT_PALETTES)['aurora']): Rgb => {
    const rgbVar = value.match(/^rgb\(var\((--[\w-]+)/)
    if (rgbVar) return palette[PALETTE_VARS[rgbVar[1]]].split(',').map(Number) as Rgb
    const hexVar = value.match(/^var\((--[\w-]+)/)
    if (hexVar) return hex(palette[PALETTE_VARS[hexVar[1]]])
    expect(value).toMatch(/^#[0-9a-f]{6}$/i)
    return hex(value)
  }
  const rule = () => {
    const rules = [...shadowStyles.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, head]) => head.trim() === '.pulse-strength-pill[data-lvl="5"]')
    expect(rules).toHaveLength(1)
    return Object.fromEntries(rules[0][2].split(';').map(d => d.split(':').map(v => v.trim())).filter(([k, v]) => k && v))
  }

  it('fills with accentStrong under onAccent, as the design guide asks of solid text pills', () => {
    const declared = rule()
    expect(declared.background).toContain('--pulse-accent-strong-rgb')
    expect(declared.color).toContain('--pulse-on-accent')
  })

  it('keeps its 9px label at AA text contrast for every accent', () => {
    const declared = rule()
    for (const [name, palette] of Object.entries(ACCENT_PALETTES)) {
      const ratio = contrast(resolve(declared.color, palette), resolve(declared.background, palette))
      expect(ratio, name).toBeGreaterThanOrEqual(4.5)
    }
  })
})
