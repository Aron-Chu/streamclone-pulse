import { describe, expect, it } from 'vitest'
import {
  ALLOWLIST_PUBLIC_ANALYTICS_AGGREGATE,
  isAllowlistedPublicAnalyticsPath,
  portalStreamDetailPath,
  portalStreamMinutesPath,
  PORTAL_ANALYTICS_PREFIX,
} from '../src/lib/portalAnalytics'

describe('portalAnalytics', () => {
  it('uses portal prefix for stream chart paths', () => {
    expect(portalStreamMinutesPath('123')).toBe('/v1/portal/analytics/streams/123/minutes')
    expect(portalStreamDetailPath('abc')).toBe('/v1/portal/analytics/streams/abc')
    expect(PORTAL_ANALYTICS_PREFIX).toBe('/v1/portal/analytics')
  })

  it('does not construct raw /v1/analytics/streams paths', () => {
    expect(portalStreamMinutesPath('1')).not.toContain('/v1/analytics/streams')
    expect(portalStreamDetailPath('1')).not.toContain('/v1/analytics/streams')
  })

  it('allowlists only aggregate readiness ops endpoints', () => {
    for (const path of ALLOWLIST_PUBLIC_ANALYTICS_AGGREGATE) {
      expect(isAllowlistedPublicAnalyticsPath(`${path}?topN=500`)).toBe(true)
    }
    expect(isAllowlistedPublicAnalyticsPath('/v1/analytics/streams/1/minutes')).toBe(false)
    expect(isAllowlistedPublicAnalyticsPath('/v1/analytics/channels/x/live')).toBe(false)
  })
})
