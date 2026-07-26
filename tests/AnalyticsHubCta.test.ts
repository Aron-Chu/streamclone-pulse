import { describe, expect, it } from 'vitest'
import { shadowStyles } from '../src/ui/theme.ts'

describe('analytics hub CTA theme', () => {
  it('includes animated hub CTA styles', () => {
    expect(shadowStyles).toContain('.pulse-analytics-hub-cta')
    expect(shadowStyles).toContain('pulse-hub-glow')
    expect(shadowStyles).toContain('prefers-reduced-motion')
  })
})
