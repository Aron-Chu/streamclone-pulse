import { describe, expect, it } from 'vitest'
import { densityFromStorageChange, DENSITY_PREFERENCE_KEY, themeFromStorageChange, THEME_PREFERENCE_KEY } from '../src/shared/storage.ts'

/**
 * Open Twitch tabs follow preference changes through chrome.storage.onChanged.
 * Both readers once checked the wrong thing: the overlay listened for a
 * `density` key that is never written, and the accent listener dropped Emerald.
 */
describe('preference changes from sync storage', () => {
  it('reads density from the stored key, not a lookalike', () => {
    expect(DENSITY_PREFERENCE_KEY).toBe('densityPreference')
    expect(densityFromStorageChange({ densityPreference: { newValue: 'compact' } })).toBe('compact')
    expect(densityFromStorageChange({ densityPreference: { newValue: 'comfortable' } })).toBe('comfortable')
    expect(densityFromStorageChange({ density: { newValue: 'compact' } })).toBeUndefined()
    expect(densityFromStorageChange({ densityPreference: { newValue: 'tiny' } })).toBe('comfortable')
    expect(densityFromStorageChange({})).toBeUndefined()
  })

  it('carries every accent, including Emerald and renamed legacy values', () => {
    expect(THEME_PREFERENCE_KEY).toBe('themePreference')
    for (const accent of ['aurora', 'volt', 'azure', 'emerald'] as const) {
      expect(themeFromStorageChange({ themePreference: { newValue: accent } })).toBe(accent)
    }
    expect(themeFromStorageChange({ themePreference: { newValue: 'volcano' } })).toBe('volt')
    expect(themeFromStorageChange({ themePreference: { newValue: 'ocean' } })).toBe('azure')
    expect(themeFromStorageChange({ overlayMode: { newValue: 'mini' } })).toBeUndefined()
  })
})
