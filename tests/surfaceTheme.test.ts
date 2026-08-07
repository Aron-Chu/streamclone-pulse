import { describe, expect, it } from 'vitest'
import {
  applySurfaceThemeToHost,
  clearSurfaceThemeFromHost,
  contrastRatio,
  DARK_SURFACE_PALETTE,
  LIGHT_SURFACE_PALETTE,
  surfacePaletteFor,
  type SurfacePalette,
} from '../src/ui/surfaceTheme.ts'

function stubHost(): HTMLElement {
  const styles = new Map<string, string>()
  const attrs = new Map<string, string>()
  return {
    style: {
      setProperty(name: string, value: string) {
        styles.set(name, value)
      },
      removeProperty(name: string) {
        styles.delete(name)
      },
      getPropertyValue(name: string) {
        return styles.get(name) ?? ''
      },
    },
    setAttribute(name: string, value: string) {
      attrs.set(name, value)
    },
    removeAttribute(name: string) {
      attrs.delete(name)
    },
    getAttribute(name: string) {
      return attrs.get(name) ?? null
    },
    __styles: styles,
    __attrs: attrs,
  } as unknown as HTMLElement & {
    __styles: Map<string, string>
    __attrs: Map<string, string>
  }
}

describe('surface palettes', () => {
  it('keeps identical semantic keys for light and dark', () => {
    const darkKeys = Object.keys(DARK_SURFACE_PALETTE).sort()
    const lightKeys = Object.keys(LIGHT_SURFACE_PALETTE).sort()
    expect(lightKeys).toEqual(darkKeys)
  })

  it('applies namespaced host variables, scheme attribute, and host-local chart tokens', () => {
    const host = stubHost() as HTMLElement & {
      __styles: Map<string, string>
      __attrs: Map<string, string>
    }
    applySurfaceThemeToHost(host, 'light')
    expect(host.getAttribute('data-pulse-color-scheme')).toBe('light')
    for (const key of Object.keys(LIGHT_SURFACE_PALETTE) as Array<keyof SurfacePalette>) {
      const kebab = key.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
      expect(host.__styles.get(`--pulse-surface-${kebab}`)).toBe(LIGHT_SURFACE_PALETTE[key])
    }
    expect(host.__styles.get('--pulse-chart-bg')).toBe(LIGHT_SURFACE_PALETTE.chartBg)
    expect(host.__styles.get('--pulse-chart-viewer')).toBe('#0e7490')
    expect(host.__styles.get('--pulse-chart-plot-2')).toBe('#a16207')
    for (const name of host.__styles.keys()) {
      expect(
        name.startsWith('--pulse-surface-') || name.startsWith('--pulse-chart-'),
        name,
      ).toBe(true)
    }

    applySurfaceThemeToHost(host, 'dark')
    expect(host.getAttribute('data-pulse-color-scheme')).toBe('dark')
    expect(host.__styles.get('--pulse-chart-bg')).toBe(DARK_SURFACE_PALETTE.chartBg)
    expect(host.__styles.get('--pulse-chart-viewer')).toBe('#14b8c8')
    expect(host.__styles.get('--pulse-chart-plot-2')).toBe('#fbbf24')
    clearSurfaceThemeFromHost(host)
    expect(host.getAttribute('data-pulse-color-scheme')).toBeNull()
    expect(host.__styles.size).toBe(0)
  })

  it('uses glare-reducing light neutrals and the original obsidian dark foundation', () => {
    const light = LIGHT_SURFACE_PALETTE
    const dark = DARK_SURFACE_PALETTE
    expect(light.bgCanvas).toBe('#eceef1')
    expect(light.panel).toBe('#fdfdfd')
    expect(light.panelElevated).toBe('#f3f3f6')
    expect(light.inputBg).toBe('#e8e9ed')
    expect(light.chartBg).toBe('#f0f1f4')
    expect(light.border).toBe('#d2d3d9')
    expect(light.textPrimary).toBe('#18181b')
    expect(light.textSecondary).toBe('#3f3f46')
    expect(light.textMuted).toBe('#5b5b66')
    expect(light.gameChipText).toBe('#9a3412')
    expect(dark.textSecondary).toBe('#a1a1b2')
    expect(dark.bg).toBe('#0e0e12')
    expect(dark.bgCanvas).toBe('#050507')
    expect(dark.panel).toBe('#111117')
    expect(dark.panelElevated).toBe('#1a1a22')
    expect(dark.textMuted).toBe('#858595')
    expect(dark.gameChipText).toBe('#fdba74')
  })

  it('keeps elevated surfaces cool-neutral with clear canvas contrast', () => {
    const dark = DARK_SURFACE_PALETTE
    const light = LIGHT_SURFACE_PALETTE
    expect(dark.panelElevated.toLowerCase()).not.toBe('#2a2440')
    expect(dark.panel.toLowerCase()).not.toBe('#262633')
    expect(dark.panelElevated).not.toBe(dark.bgCanvas)
    expect(dark.panel).not.toBe(dark.panelElevated)
    expect(contrastRatio('#000000', dark.panelElevated)).toBeGreaterThan(
      contrastRatio('#000000', dark.bgCanvas),
    )
    // Light: near-white cards sit on a calm gray canvas; controls and chart wells
    // have their own visible but low-contrast layers.
    expect(light.panel).not.toBe(light.bgCanvas)
    expect(light.chartBg).not.toBe(light.bgCanvas)
    expect(light.chartBg).not.toBe(light.panel)
    expect(light.inputBg).toBe('#e8e9ed')
    expect(contrastRatio(light.textPrimary, light.panel)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.textPrimary, dark.panelElevated)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(light.gameChipText, light.bg)).toBeGreaterThanOrEqual(4.5)
  })

  it('meets WCAG AA for primary/secondary/muted text on canvas and panel', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const p = surfacePaletteFor(scheme)
      expect(contrastRatio(p.textPrimary, p.bgCanvas), `${scheme} primary/canvas`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.textPrimary, p.panel), `${scheme} primary/panel`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.textSecondary, p.bgCanvas), `${scheme} secondary/canvas`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.textMuted, p.bgCanvas), `${scheme} muted/canvas`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.textSecondary, p.panelElevated), `${scheme} secondary/elevated`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.textMuted, p.panelElevated), `${scheme} muted/elevated`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('provides scheme-readable status and game chip text', () => {
    for (const scheme of ['dark', 'light'] as const) {
      const p = surfacePaletteFor(scheme)
      expect(contrastRatio(p.statusOkText, p.bgCanvas), `${scheme} ok/canvas`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.statusWarnText, p.bgCanvas), `${scheme} warn/canvas`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.statusErrorText, p.bgCanvas), `${scheme} error/canvas`).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(p.gameChipText, p.panel), `${scheme} game/panel`).toBeGreaterThanOrEqual(4.5)
    }
  })
})
