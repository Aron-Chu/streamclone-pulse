import { describe, expect, it } from 'vitest'
import { ACCENT_PALETTES, applyAccentTheme } from '../src/ui/overlayTheme.ts'

describe('ACCENT_PALETTES', () => {
  it('defines azure and orange Volt accent colors', () => {
    expect(ACCENT_PALETTES.azure.accent).toBe('#22d3ee')
    expect(ACCENT_PALETTES.volt.accent).toBe('#f97316')
    expect(ACCENT_PALETTES.volt.accentStrong).toBe('#ea580c')
    expect(ACCENT_PALETTES.volt.accentRgb).toBe('249, 115, 22')
    expect(ACCENT_PALETTES.aurora.accent).toBe('#8b5cf6')
  })
})

describe('applyAccentTheme', () => {
  it('is safe when document is unavailable', () => {
    expect(() => applyAccentTheme('azure')).not.toThrow()
  })
})
