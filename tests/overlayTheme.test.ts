import { describe, expect, it } from 'vitest'
import { ACCENT_PALETTES, applyAccentTheme } from '../src/ui/overlayTheme.ts'

describe('ACCENT_PALETTES', () => {
  it('defines azure and volt accent colors', () => {
    expect(ACCENT_PALETTES.azure.accent).toBe('#22d3ee')
    expect(ACCENT_PALETTES.volt.accent).toBe('#53fc18')
    expect(ACCENT_PALETTES.aurora.accent).toBe('#8b5cf6')
  })
})

describe('applyAccentTheme', () => {
  it('is safe when document is unavailable', () => {
    expect(() => applyAccentTheme('azure')).not.toThrow()
  })
})
