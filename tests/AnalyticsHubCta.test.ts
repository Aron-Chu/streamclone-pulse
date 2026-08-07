import { describe, expect, it } from 'vitest'
import { shadowStyles } from '../src/ui/theme.ts'

describe('analytics hub CTA theme', () => {
  it('includes animated hub CTA styles', () => {
    expect(shadowStyles).toContain('.pulse-analytics-hub-cta')
    expect(shadowStyles).toContain('.pulse-analytics-hub-cta-wrap')
    expect(shadowStyles).toContain('pulse-hub-glow')
    expect(shadowStyles).toContain('prefers-reduced-motion')
    expect(shadowStyles).toMatch(/\.pulse-analytics-hub-cta\s*\{[^}]*display:\s*flex/s)
    expect(shadowStyles).toMatch(/\.pulse-analytics-hub-cta\s*\{[^}]*width:\s*100%/s)
  })

  it('hides scrollbars on the panel scroll region', () => {
    expect(shadowStyles).toMatch(/\.pulse-panel-scroll\s*\{[^}]*scrollbar-width:\s*none/s)
    expect(shadowStyles).toContain('.pulse-panel-scroll::-webkit-scrollbar')
  })
})
