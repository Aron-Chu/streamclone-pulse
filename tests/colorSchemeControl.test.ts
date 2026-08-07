import { describe, expect, it } from 'vitest'
import { computeSelectMenuPosition } from '../src/ui/pulseSelectPosition.ts'
import {
  DEFAULT_COLOR_SCHEME_PREFERENCE,
  normalizeColorSchemePreference,
} from '../src/shared/storage.ts'

const COLOR_SCHEME_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

const ACCENT_OPTIONS = [
  { value: 'aurora', label: 'Aurora' },
  { value: 'volt', label: 'Volt' },
  { value: 'azure', label: 'Azure' },
] as const

describe('color scheme control contract', () => {
  it('exposes Auto/Light/Dark separately from accent options', () => {
    expect(COLOR_SCHEME_OPTIONS.map(o => o.value)).toEqual(['auto', 'light', 'dark'])
    expect(DEFAULT_COLOR_SCHEME_PREFERENCE).toBe('auto')
    const accentValues = new Set(ACCENT_OPTIONS.map(o => o.value))
    for (const option of COLOR_SCHEME_OPTIONS) {
      expect(accentValues.has(option.value as never)).toBe(false)
      expect(normalizeColorSchemePreference(option.value)).toBe(option.value)
    }
  })
})

describe('computeSelectMenuPosition', () => {
  it('opens below when there is room', () => {
    const pos = computeSelectMenuPosition(
      { top: 100, bottom: 124, left: 40, right: 160, width: 120, height: 24 },
      180,
      { width: 800, height: 600 },
    )
    expect(pos.top).toBe(128)
    expect(pos.placement).toBe('below')
  })

  it('flips above when space below is insufficient', () => {
    const pos = computeSelectMenuPosition(
      { top: 500, bottom: 524, left: 40, right: 160, width: 120, height: 24 },
      180,
      { width: 800, height: 540 },
    )
    expect(pos.placement).toBe('above')
    expect(pos.top).toBeLessThan(500)
  })
})
