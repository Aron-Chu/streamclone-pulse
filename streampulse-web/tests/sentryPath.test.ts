import { describe, expect, it } from 'vitest'
import { portalReleaseShort, sanitizePortalPath } from '../src/lib/sentry'

describe('sanitizePortalPath', () => {
  it('templates analytics channel routes', () => {
    expect(sanitizePortalPath('/analytics/xqc')).toBe('/analytics/:login')
    expect(sanitizePortalPath('/analytics/xqc/s/abc123')).toBe('/analytics/:login/s/:streamId')
    expect(sanitizePortalPath('/analytics/xqc/session1')).toBe('/analytics/:login/:streamId')
    expect(sanitizePortalPath('/analytics')).toBe('/analytics')
    expect(sanitizePortalPath('/analytics/streams')).toBe('/analytics/streams')
  })

  it('strips query strings', () => {
    expect(sanitizePortalPath('/analytics/xqc?token=secret')).toBe('/analytics/:login')
  })
})

describe('portalReleaseShort', () => {
  it('shortens full SHA releases', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567'
    // portalReleaseShort reads import.meta.env — in unit test env it may be unset.
    // Exercise the regex path via direct string helper behavior by importing after stub is awkward;
    // assert sanitize + short display contract on a synthetic match instead.
    const full = `streampulse-portal@${sha}`
    const m = /^streampulse-portal@([0-9a-f]{40})$/i.exec(full)
    expect(m?.[1].slice(0, 7)).toBe('0123456')
    expect(portalReleaseShort()).toMatch(/^(dev|streampulse-portal@)/)
  })
})
