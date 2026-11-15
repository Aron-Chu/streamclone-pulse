import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { firefoxDesktopCompatibilityErrors } from '../scripts/extension-permission-allowlists.mjs'

const settings = JSON.parse(readFileSync('manifests/firefox.json', 'utf8')).browser_specific_settings

describe('desktop-only Firefox packaging', () => {
  it('keeps Firefox 140 ESR support without declaring Android compatibility', () => {
    expect(settings.gecko.strict_min_version).toBe('140.0')
    expect(settings).not.toHaveProperty('gecko_android')
    expect(firefoxDesktopCompatibilityErrors(settings)).toEqual([])
  })

  it.each([{ strict_min_version: '142.0' }, {}, null])('rejects an Android declaration even when it is %j', declaration => {
    expect(firefoxDesktopCompatibilityErrors({ ...settings, gecko_android: declaration }))
      .toContain('Firefox is desktop-only: omit browser_specific_settings.gecko_android')
  })

  it('rejects an absent Gecko identity or an unreviewed desktop minimum', () => {
    expect(firefoxDesktopCompatibilityErrors({})).toHaveLength(2)
    expect(firefoxDesktopCompatibilityErrors({ gecko: { ...settings.gecko, strict_min_version: '142.0' } }))
      .toContain('Firefox desktop manifest requires strict_min_version=140.0 for built-in consent')
  })
})
