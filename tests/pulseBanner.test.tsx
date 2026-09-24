import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PULSE_BANNER, normalizePulseBanner } from '../src/shared/storage.ts'
import { PulseBannerBackdrop } from '../src/ui/PulseBanner.tsx'
import { StreamPulseTitleBlock } from '../src/ui/StreamPulseTitleBlock.tsx'

describe('personal Pulse banner', () => {
  it('normalizes missing, corrupt and out-of-range stored preferences', () => {
    expect(normalizePulseBanner(null)).toEqual(DEFAULT_PULSE_BANNER)
    expect(normalizePulseBanner({ mode: 'invalid', intensity: NaN, title: 23 })).toEqual(DEFAULT_PULSE_BANNER)
    expect(normalizePulseBanner({ mode: 'rain', intensity: 200, title: '  My Pulse  ' })).toEqual({ mode: 'rain', intensity: 70, title: 'My Pulse' })
    expect(normalizePulseBanner({ intensity: -5, title: 'x'.repeat(100) })).toMatchObject({ intensity: 10, title: 'x'.repeat(40) })
  })
  it('off renders no image requests; rain stays bounded and uses static frames', () => {
    const off = renderToStaticMarkup(<PulseBannerBackdrop value={{ ...DEFAULT_PULSE_BANNER, mode: 'off' }} />)
    expect(off).not.toContain('<img')
    const rain = renderToStaticMarkup(<PulseBannerBackdrop value={{ ...DEFAULT_PULSE_BANNER, mode: 'rain' }} />)
    expect(rain.match(/<img/g)).toHaveLength(6)
    expect(rain.match(/2x_static.webp/g)).toHaveLength(6)
    expect(rain).toContain('prefers-reduced-motion: reduce')
  })
  it('renders personal titles as text, never markup', () => {
    const html = renderToStaticMarkup(<StreamPulseTitleBlock title={'<script>hello</script>'} statusLabel="Live chart" />)
    expect(html).toContain('&lt;script&gt;hello&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })
})
