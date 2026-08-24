import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ExtensionClip } from '../src/shared/messages.ts'
import { ClipSpikeCard } from '../src/ui/Overlay.tsx'
import { shadowStyles } from '../src/ui/theme.ts'

describe('chart motion and accessibility chrome', () => {
  it('defines restrained picker enter/exit motion and reduced-motion overrides', () => {
    expect(shadowStyles).toContain('.pulse-seven-tv-toggle:focus-visible')
    expect(shadowStyles).toContain('.pulse-seven-tv-chip:focus-visible')
    expect(shadowStyles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(shadowStyles).toContain('.pulse-clip-spike-card')
  })

  it('keeps keyboard focus visible without restoring the old global focus suppression', () => {
    expect(shadowStyles).toContain('.pulse-moment-row-button:focus-visible')
    expect(shadowStyles).toContain('outline: 2px solid rgba(var(--pulse-accent-light-rgb, 196, 181, 253), 0.95) !important;')
    expect(shadowStyles).toContain('.pulse-seven-tv-toggle:focus-visible')
    expect(shadowStyles).toContain('.pulse-clip-spike-card:focus-visible')
    expect(shadowStyles).not.toContain('button:focus, button:focus-visible')
  })

  it('renders Clip Spike as an accessible, classed interaction surface', () => {
    const clip: ExtensionClip = {
      id: 'clip-1',
      title: 'A clean chart spike',
      url: 'https://clips.twitch.tv/clip-1',
      viewCount: 123,
    }
    const html = renderToStaticMarkup(
      <ClipSpikeCard clip={clip} backendUrl="https://api.streampulse.stream" />,
    )
    expect(html).toContain('class="pulse-clip-spike-card"')
    expect(html).toContain('data-clip-spike-card="true"')
    expect(html).toContain('aria-label="Clip spike: A clean chart spike"')
    expect(shadowStyles).toContain('.pulse-clip-spike-card:hover')
    expect(shadowStyles).toContain('.pulse-clip-spike-card:focus-visible')
  })
})
