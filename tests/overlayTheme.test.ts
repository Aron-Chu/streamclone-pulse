import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../src/ui/surfaceTheme.ts'
import {
  ACCENT_PALETTES,
  accentRolesFor,
  applyAccentRolesToHost,
  applyAccentTheme,
  clearAccentRolesFromHost,
} from '../src/ui/overlayTheme.ts'

function stubHost(): HTMLElement & { __styles: Map<string, string> } {
  const styles = new Map<string, string>()
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
    __styles: styles,
  } as unknown as HTMLElement & { __styles: Map<string, string> }
}

describe('ACCENT_PALETTES', () => {
  it('defines azure and volt accent colors', () => {
    expect(ACCENT_PALETTES.azure.accent).toBe('#14b8c8')
    expect(ACCENT_PALETTES.volt.accent).toBe('#3ddc84')
    expect(ACCENT_PALETTES.aurora.accent).toBe('#8b5cf6')
    expect(ACCENT_PALETTES.azure.accentInk).toBe('#9fe7f0')
    expect(ACCENT_PALETTES.volt.accent).not.toBe('#53fc18')
    expect(ACCENT_PALETTES.azure.accent).not.toBe('#22d3ee')
  })
})

describe('applyAccentTheme', () => {
  it('is safe when document is unavailable', () => {
    expect(() => applyAccentTheme('azure')).not.toThrow()
  })

  it('does not force a global dark chart background on documentElement', () => {
    const styles = new Map<string, string>()
    const root = {
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
      setAttribute() {},
    }
    const previous = globalThis.document
    ;(globalThis as { document?: Document }).document = {
      documentElement: root,
    } as unknown as Document
    try {
      applyAccentTheme('aurora')
      expect(styles.get('--pulse-chart-bg')).toBeUndefined()
      expect(styles.get('--pulse-accent')).toBe('#8b5cf6')
    } finally {
      if (previous === undefined) {
        delete (globalThis as { document?: Document }).document
      } else {
        ;(globalThis as { document?: Document }).document = previous
      }
    }
  })
})

describe('accentRolesFor', () => {
  const themes = ['aurora', 'volt', 'azure'] as const

  it('keeps all three accents visually distinct in both schemes', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const texts = themes.map(pref => accentRolesFor(pref, scheme).accentText.toLowerCase())
      expect(new Set(texts).size).toBe(3)
      const surfaces = themes.map(pref => accentRolesFor(pref, scheme).accentSurface.toLowerCase())
      expect(new Set(surfaces).size).toBe(3)
    }
  })

  it('uses dark accent text on light surfaces and pale accent text on dark', () => {
    for (const pref of themes) {
      const light = accentRolesFor(pref, 'light')
      const dark = accentRolesFor(pref, 'dark')
      // Light-mode accent text must be darker than mid-gray (~128) in luminance terms.
      expect(contrastRatio(light.accentText, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(light.accentTextSubtle, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(dark.accentText, '#111117')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(dark.accentTextSubtle, '#111117')).toBeGreaterThanOrEqual(4.5)
      // Do not reuse pale lavender as light-mode accent text.
      expect(light.accentText.toLowerCase()).not.toBe('#ddd6fe')
      expect(light.accentText.toLowerCase()).not.toBe('#c4b5fd')
    }
  })

  it('applies host-local role overrides including legacy ink/soft remaps', () => {
    const host = stubHost()
    applyAccentRolesToHost(host, 'aurora', 'light')
    const light = accentRolesFor('aurora', 'light')
    expect(host.__styles.get('--pulse-accent-text')).toBe(light.accentText)
    expect(host.__styles.get('--pulse-accent-text-subtle')).toBe(light.accentTextSubtle)
    expect(host.__styles.get('--pulse-accent-surface')).toBe(light.accentSurface)
    expect(host.__styles.get('--pulse-accent-border')).toBe(light.accentBorder)
    expect(host.__styles.get('--pulse-accent-ink')).toBe(light.accentText)
    expect(host.__styles.get('--pulse-accent-soft')).toBe(light.accentTextSubtle)
    clearAccentRolesFromHost(host)
    expect(host.__styles.size).toBe(0)
  })
})
