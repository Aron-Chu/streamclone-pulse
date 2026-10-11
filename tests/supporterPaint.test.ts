import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUPPORTER_PAINT,
  SUPPORTER_CREST_GEMS,
  SUPPORTER_SHEEN_OPTIONS,
  SUPPORTER_TENURES,
  SUPPORTER_WAVE_OPTIONS,
  normalizeSupporterPaintStyle,
  supporterCrestCssUrl,
  supporterTenureForMonths,
} from '../src/shared/supporterPaint.ts'
import { supporterPaintCss } from '../src/ui/supporterPaintStyles.ts'
import { supporterBadgeTenureForMonths } from '../src/ui/SupporterBadge.tsx'

describe('supporter paint style', () => {
  it('keeps known waves and sheens and falls back to the default for anything else', () => {
    expect(normalizeSupporterPaintStyle({ wave: 'aurora', sheen: 'glint' })).toEqual({ wave: 'aurora', sheen: 'glint' })
    expect(normalizeSupporterPaintStyle({ wave: 'plasma', sheen: 7 })).toEqual(DEFAULT_SUPPORTER_PAINT)
    expect(normalizeSupporterPaintStyle(null)).toEqual(DEFAULT_SUPPORTER_PAINT)
    expect(normalizeSupporterPaintStyle({ wave: 'chrome', sheen: 'none', extra: true })).toEqual({ wave: 'chrome', sheen: 'none' })
  })

  it('maps the reported support count to a crest stage', () => {
    expect([0, 2, 3, 5, 6, 11, 12, 23, 24, 60].map(supporterTenureForMonths)).toEqual(['new', 'new', '3m', '3m', '6m', '6m', '12m', '12m', '24m', '24m'])
    expect(supporterTenureForMonths(Number.NaN)).toBe('new')
    expect(supporterTenureForMonths(-4)).toBe('new')
    // The settings badge and the header crest read the same ladder.
    expect(supporterBadgeTenureForMonths(13)).toBe(supporterTenureForMonths(13))
  })

  it('draws each crest from the shared art as an encoded data URL', () => {
    for (const { id } of SUPPORTER_TENURES) {
      const url = supporterCrestCssUrl(id)
      expect(url.startsWith('url("data:image/svg+xml,%3Csvg ')).toBe(true)
      expect(url).not.toMatch(/[#<>]/)
      expect(url).toContain(SUPPORTER_CREST_GEMS[id].edge.replace(/#/g, '%23'))
    }
    expect(supporterCrestCssUrl('24m')).toContain('%23ffe8a6')
    expect(supporterCrestCssUrl('new')).not.toContain('%23ffe8a6')
  })

  it('styles every crest, wave and sheen, and stills all of it under reduced motion', () => {
    const css = supporterPaintCss()
    for (const { id } of SUPPORTER_TENURES) expect(css).toContain(`.pulse-crest[data-tenure="${id}"]`)
    for (const { id } of SUPPORTER_WAVE_OPTIONS.filter(option => option.id !== 'smooth')) expect(css).toContain(`.pulse-paint[data-wave="${id}"]`)
    for (const { id } of SUPPORTER_SHEEN_OPTIONS.filter(option => option.id !== 'sweep')) expect(css).toContain(`.pulse-paint[data-sheen="${id}"]`)
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.pulse-paint, \.pulse-paint::after, \.pulse-crest \{ animation: none !important; \}/)
    expect(css).not.toContain('/*')
  })
})
