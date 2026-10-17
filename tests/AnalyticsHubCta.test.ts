import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { AnalyticsHubCta } from '../src/ui/AnalyticsHubCta.tsx'
import { shadowStyles } from '../src/ui/theme.ts'

describe('analytics hub CTA theme', () => {
  it('ships restrained entry and interaction motion without the old loop', () => {
    expect(shadowStyles).toContain('.pulse-analytics-hub-cta')
    expect(shadowStyles).toContain('pulse-hub-cta-in')
    expect(shadowStyles).toContain('pulse-hub-cta-sheen')
    expect(shadowStyles).not.toContain('pulse-hub-glow')
    expect(shadowStyles).not.toContain('pulse-hub-shimmer')
    expect(shadowStyles).toContain('prefers-reduced-motion')
  })

  it('releases the entry transform so hover and pressed states can animate', () => {
    expect(shadowStyles).toMatch(
      /\[data-pulse-hub-cta="true"\]\s*\{\s*animation:\s*pulse-hub-cta-in[^;]+backwards;/,
    )
    expect(shadowStyles).not.toMatch(
      /animation:\s*pulse-hub-cta-in[^;]+(?:both|forwards);/,
    )
  })

  it('keeps the original button label and accent-driven surface, with Discord beside it', () => {
    const html = renderToStaticMarkup(
      createElement(AnalyticsHubCta, { backendUrl: 'https://api.streampulse.stream' }),
    )

    expect(html).toContain('Open Analytics Hub →')
    expect(html).toContain('title="Browse full stream history, tracked channels, and deeper analytics"')
    expect(html).not.toContain('<small')
    expect(html).not.toContain('pulse-action-chip')
    // Discord sits beside the Hub so it shows every time Pulse opens; the worker opens it, so no page URL ships here.
    expect(html).toMatch(/<div class="pulse-hub-row"><button[^>]*class="pulse-analytics-hub-cta"[\s\S]*?<\/button><button type="button" class="pulse-hub-discord" data-community-link="discord">Discord<\/button><\/div>/)
    expect(html).not.toMatch(/https?:\/\//)
    expect(shadowStyles).toContain('.pulse-hub-discord')
    expect(shadowStyles).toContain('background: linear-gradient(')
    expect(shadowStyles).toContain('rgba(var(--pulse-accent-rgb, 139, 92, 246), 0.22)')
    expect(shadowStyles).toContain('var(--pulse-accent-ink, #ddd6fe)')
  })
})
