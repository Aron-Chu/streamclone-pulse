import { describe, expect, it } from 'vitest'
import { analyticsReturnPath, broadcastTimelineHref, retiredExplorerPath } from '../src/lib/momentsNavigation'

describe('broadcast navigation', () => {
  it('preserves the history scope and exact minute across the stream round trip', () => {
    const back = '/analytics/moments?view=history&creator=forsen&month=2026-09&day=2026-09-12#evidence'
    const url = new URL(broadcastTimelineHref('forsen', '123', back, 120), 'https://portal.invalid')
    expect(url.pathname).toBe('/analytics/forsen/123')
    expect(url.hash).toBe('#t=120')
    expect(analyticsReturnPath(url.searchParams.get('returnTo'))).toBe(back)
  })
  it('keeps direct broadcast links unchanged', () => {
    expect(broadcastTimelineHref('forsen', '123', undefined, 120)).toBe('/analytics/forsen/123#t=120')
  })
  it('rejects foreign, unrelated and malformed return destinations', () => {
    for (const value of ['https://evil.example/analytics/moments', '//evil.example/analytics/moments', '/account', null]) {
      expect(analyticsReturnPath(value)).toBeNull()
    }
    expect(broadcastTimelineHref('forsen', '123', '//evil.example', NaN)).toBe('/analytics/forsen/123')
  })
  it('no longer returns to the retired Explorer', () => {
    for (const value of ['/analytics/explore', '/analytics/explore?window=24h', '/analytics/explore/pulse-xqc-123?window=live#evidence']) {
      expect(analyticsReturnPath(value)).toBeNull()
    }
  })
})

describe('retired Explorer links', () => {
  it('open the stream page an Explorer id names', () => {
    expect(retiredExplorerPath('pulse-xqc-315123456789')).toBe('/analytics/xqc/315123456789')
    expect(retiredExplorerPath('pulse-forsen_tv-session-1')).toBe('/analytics/forsen_tv/session-1')
    expect(retiredExplorerPath('pulse-XQC-123')).toBe('/analytics/xqc/123')
  })
  it('open Moments for the list and for any id that names no stream', () => {
    for (const id of [undefined, '', 'story-1', 'pulse-xqc', 'pulse--123', 'pulse-xqc-', 'pulse-x.qc-123', 'pulse-xqc-12/3',
      'pulse-settings-123', `pulse-${'a'.repeat(26)}-123`, `pulse-xqc-${'1'.repeat(129)}`]) {
      expect(retiredExplorerPath(id)).toBe('/analytics/moments')
    }
  })
})
