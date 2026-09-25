import { describe, expect, it } from 'vitest'
import { buildAnalyticsHref } from '../src/lib/analyticsLinks'
import { resolvePreferredChannelStreamId } from '../src/hooks/useChannelPageData'

describe('generated analytics links stay identity-bound at roster scale', () => {
  it('keeps 500 same-day histories bound to immutable stream IDs and hash time', () => {
    const roster = Array.from({ length: 500 }, (_, index) => ({
      login: `creator_${index}`,
      streamId: `stream-${index}-20260904`,
      startedAt: '2026-09-04T12:00:00Z',
      offsetSeconds: index + 1,
    }))

    const links = roster.map(row => buildAnalyticsHref(row))
    expect(new Set(links).size).toBe(500)
    for (const [index, href] of links.entries()) {
      expect(href).toBe(`/analytics/creator_${index}/stream-${index}-20260904#t=${index + 1}`)
      expect(href).not.toContain('?t=')
    }

    const sameDayHistory = roster.slice(0, 24).map(row => ({ streamId: row.streamId, live: false }))
    expect(resolvePreferredChannelStreamId(sameDayHistory, roster[499].streamId)).toBe(roster[499].streamId)
    expect(resolvePreferredChannelStreamId(sameDayHistory)).toBe(roster[0].streamId)
  })

  it('models query-preserving aliases without admitting network-derived identity', () => {
    const alias = new URL('/s/creator_7/stream-7-20260904?utm=share#t=91', 'https://streampulse.stream')
    const segments = alias.pathname.split('/').filter(Boolean)
    const canonical = `/analytics/${segments[1]}/${segments[2]}${alias.search}${alias.hash}`
    expect(canonical).toBe('/analytics/creator_7/stream-7-20260904?utm=share#t=91')
    expect(buildAnalyticsHref({ login: segments[1], streamId: segments[2], offsetSeconds: 91 }))
      .toBe('/analytics/creator_7/stream-7-20260904#t=91')
  })
})
