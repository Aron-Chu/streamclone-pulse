import { describe, expect, it } from 'vitest'
import { analyticsReturnPath, broadcastTimelineHref, legacyMomentsExplorerPath } from '../src/lib/momentsNavigation'

describe('broadcast navigation', () => {
  it('preserves the history scope and exact minute across the stream round trip', () => {
    const back = '/analytics/moments?view=history&creator=forsen&month=2026-09&day=2026-09-12#evidence'
    const url = new URL(broadcastTimelineHref('forsen', '123', back, 120), 'https://portal.invalid')
    expect(url.pathname).toBe('/analytics/forsen/123')
    expect(url.hash).toBe('#t=120')
    expect(analyticsReturnPath(url.searchParams.get('returnTo'))).toBe(back)
  })
  it('keeps supported legacy browse context without reopening the story resolver', () => {
    const params = new URLSearchParams('view=sessions&story=story-1&window=7d&category=Just+Chatting&q=chat&scope=creator&creator=forsen&year=2026&day=2026-09-12&sort=top&login=forsen&stream=123&offset=120&moment=moment-1&signal=emotes&state=ended&returnTo=%2Faccount')
    expect(legacyMomentsExplorerPath(params, '#evidence')).toBe('/analytics/explore?window=7d&signal=emotes&category=Just+Chatting&state=ended&q=chat#evidence')
    expect(legacyMomentsExplorerPath(params, '#evidence', 'story-1')).toBe('/analytics/explore/story-1?window=7d&signal=emotes&category=Just+Chatting&state=ended&q=chat#evidence')
  })
  it('does not reinterpret unsupported legacy windows or sorts', () => {
    expect(legacyMomentsExplorerPath(new URLSearchParams('window=90d&sort=strongest&category=VALORANT'), '#keep'))
      .toBe('/analytics/explore?category=VALORANT&sort=strongest#keep')
  })
  it('keeps direct broadcast links unchanged', () => {
    expect(broadcastTimelineHref('forsen', '123', undefined, 120)).toBe('/analytics/forsen/123#t=120')
  })
  it('rejects foreign, unrelated and malformed return destinations', () => {
    for (const value of ['https://evil.example/analytics/moments', '//evil.example/analytics/moments', '/account', null]) {
      expect(analyticsReturnPath(value)).toBeNull()
    }
    expect(analyticsReturnPath('/analytics/explore/story-1?window=live#evidence'))
      .toBe('/analytics/explore/story-1?window=live#evidence')
    expect(analyticsReturnPath('/analytics/explore/../../account')).toBeNull()
    expect(broadcastTimelineHref('forsen', '123', '//evil.example', NaN)).toBe('/analytics/forsen/123')
  })
})
