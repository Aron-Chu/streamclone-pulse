import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PULSE_BANNER, normalizePulseBanner } from '../src/shared/storage.ts'
import { PulseBannerBackdrop } from '../src/ui/PulseBanner.tsx'
import { StreamPulseTitleBlock } from '../src/ui/StreamPulseTitleBlock.tsx'
import { shadowStyles } from '../src/ui/theme.ts'

describe('personal Pulse banner', () => {
  it('keeps the 7TV backdrop opt-in: new and unsaved installs start with it off', () => {
    expect(DEFAULT_PULSE_BANNER.mode).toBe('off')
    expect(normalizePulseBanner(undefined).mode).toBe('off')
    expect(normalizePulseBanner({ mode: 'rain' }).mode).toBe('rain')
  })
  it('normalizes missing, corrupt and out-of-range stored preferences', () => {
    expect(normalizePulseBanner(null)).toEqual(DEFAULT_PULSE_BANNER)
    expect(normalizePulseBanner({ mode: 'invalid', intensity: NaN, title: 23 })).toEqual(DEFAULT_PULSE_BANNER)
    expect(normalizePulseBanner({ mode: 'rain', intensity: 200, title: '  My Pulse  ' })).toEqual({ mode: 'rain', intensity: 70, title: 'My Pulse' })
    expect(normalizePulseBanner({ intensity: -5, title: 'x'.repeat(100) })).toMatchObject({ intensity: 10, title: 'x'.repeat(40) })
  })
  it('off renders no image requests; rain stays bounded and uses static frames', () => {
    const off = renderToStaticMarkup(<PulseBannerBackdrop value={{ ...DEFAULT_PULSE_BANNER, mode: 'off' }} perks />)
    expect(off).not.toContain('<img')
    const rain = renderToStaticMarkup(<PulseBannerBackdrop value={{ ...DEFAULT_PULSE_BANNER, mode: 'rain' }} perks />)
    expect(rain.match(/<img/g)).toHaveLength(6)
    expect(rain.match(/2x_static.webp/g)).toHaveLength(6)
    // The backdrop's styles, reduced motion included, ship in the shared shadow stylesheet.
    expect(rain).not.toContain('<style')
    expect(shadowStyles).toMatch(/prefers-reduced-motion: reduce\) \{ \.pulse-banner-art\[data-mode="rain"\] img \{ animation: none/)
  })
  it('draws emote rain, still or falling, only for verified Supporter perks', () => {
    for (const mode of ['rain', 'still'] as const) {
      // A lapsed or non-Supporter profile may still hold an older saved choice.
      const locked = renderToStaticMarkup(<PulseBannerBackdrop value={{ ...DEFAULT_PULSE_BANNER, mode }} perks={false} />)
      expect(locked, mode).toContain('data-mode="off"')
      expect(locked, mode).not.toContain('<img')
      const supporter = renderToStaticMarkup(<PulseBannerBackdrop value={{ ...DEFAULT_PULSE_BANNER, mode }} perks />)
      expect(supporter, mode).toContain(`data-mode="${mode}"`)
      expect(supporter.match(/<img/g), mode).toHaveLength(6)
    }
  })
  it('renders personal titles as text, never markup', () => {
    const html = renderToStaticMarkup(<StreamPulseTitleBlock title={'<script>hello</script>'} statusLabel="Live chart" />)
    expect(html).toContain('&lt;script&gt;hello&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
})
