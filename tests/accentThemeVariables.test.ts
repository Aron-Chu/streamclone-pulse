// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { listSourceFiles } from './helpers/sourceFiles.ts'
import { ACCENT_PALETTES, ACCENT_THEME_OPTIONS, applyAccentTheme } from '../src/ui/overlayTheme.ts'
import type { ThemePreference } from '../src/shared/storage.ts'

const ACCENTS = Object.keys(ACCENT_PALETTES) as ThemePreference[]

function sourceFilesReferencingPulseVars(): string[] {
  return listSourceFiles()
}

describe('accent theme custom properties', () => {
  // Regression guard: `--pulse-accent-light` was referenced by focus rings and
  // hover borders in both settings surfaces but never defined, so those stayed
  // Aurora purple under every other accent. Any new var(--pulse-*) reference
  // must resolve to something the runtime actually sets.
  it('defines every --pulse-* variable that source CSS references', () => {
    const declared = new Set<string>()
    const referenced = new Map<string, string[]>()

    for (const file of sourceFilesReferencingPulseVars()) {
      const text = readFileSync(file, 'utf8')
      // Declarations: `--pulse-x: value` in a CSS block, or 'name' in the
      // applyAccentTheme variable table / setProperty calls.
      for (const match of text.matchAll(/(--pulse-[a-z-]+)\s*:/g)) declared.add(match[1])
      for (const match of text.matchAll(/'(--pulse-[a-z-]+)'/g)) declared.add(match[1])
      for (const match of text.matchAll(/var\((--pulse-[a-z-]+)/g)) {
        const list = referenced.get(match[1]) ?? []
        list.push(file)
        referenced.set(match[1], list)
      }
    }

    expect(referenced.size).toBeGreaterThan(5)
    const undefinedVars = [...referenced.keys()].filter(name => !declared.has(name)).sort()
    expect(undefinedVars, `referenced but never defined: ${undefinedVars.join(', ')}`).toEqual([])
  })

  it('writes a value for every palette key on every accent', () => {
    for (const accent of ACCENTS) {
      applyAccentTheme(accent)
      const style = document.documentElement.style
      for (const key of Object.keys(ACCENT_PALETTES[accent])) {
        const cssName = key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
        const value = style.getPropertyValue(`--pulse-${cssName}`)
        expect(value, `${accent} is missing --pulse-${cssName}`).not.toBe('')
      }
      expect(document.documentElement.getAttribute('data-pulse-accent')).toBe(accent)
    }
  })

  it('keeps accentLight consistent with accentLightRgb', () => {
    for (const accent of ACCENTS) {
      const palette = ACCENT_PALETTES[accent]
      const channels = [1, 3, 5]
        .map(index => parseInt(palette.accentLight.slice(index, index + 2), 16))
        .join(', ')
      expect(channels, `${accent} accentLight and accentLightRgb disagree`).toBe(palette.accentLightRgb)
    }
  })

  it('derives every picker swatch from its own palette accent', () => {
    expect(ACCENT_THEME_OPTIONS).toHaveLength(ACCENTS.length)
    for (const option of ACCENT_THEME_OPTIONS) {
      expect(option.swatch).toBe(ACCENT_PALETTES[option.value].accent)
      expect(option.label.length).toBeGreaterThan(0)
    }
  })

  // Every selectable accent needs documented contrast, so a new one cannot ship
  // without being considered in the design guide's WCAG table.
  it('documents every selectable accent in the UI design guide', () => {
    const guide = readFileSync('docs/pulse-extension/ui-design-guide.md', 'utf8')
    for (const option of ACCENT_THEME_OPTIONS) {
      expect(guide, `${option.label} is selectable but absent from the design guide`)
        .toContain(option.label)
    }
  })
})
