import { describe, expect, it } from 'vitest'
import { resolveMomentActions } from '../src/lib/momentActions'
import type { FigmaMomentRow } from '../src/lib/figmaSessionAnalytics'

const base: FigmaMomentRow = {
  offsetSeconds: 300,
  label: 'Spike',
  login: 'somechannel',
  streamId: 'abc123',
}

describe('resolveMomentActions', () => {
  it('prefers an explicit moment.href', () => {
    const out = resolveMomentActions({ ...base, href: 'https://custom.example/moment' })
    expect(out.analyticsHref).toBe('https://custom.example/moment')
    expect(out.disabledReason).toBeUndefined()
  })

  it('falls back to the canonical analytics route with #t offset', () => {
    const out = resolveMomentActions(base)
    expect(out.analyticsHref).toBe('/analytics/somechannel/abc123#t=300')
    expect(out.reviewHref).toBe('/analytics/moments?view=recent&login=somechannel&stream=abc123&offset=300')
  })

  it('routes raw VOD metadata through exact-identity review instead of a Twitch timestamp', () => {
    const out = resolveMomentActions({ ...base, vodId: 'vod-999' })
    expect(out.reviewHref).toBe('/analytics/moments?view=recent&login=somechannel&stream=abc123&offset=300')
    expect(Object.values(out).some((value) => value?.includes('twitch.tv/videos'))).toBe(false)
  })

  it('sets disabledReason with no "#" when nothing resolves', () => {
    const minimal: FigmaMomentRow = { offsetSeconds: 0, label: 'x' }
    const out = resolveMomentActions(minimal)
    expect(out.analyticsHref).toBeUndefined()
    expect(out.reviewHref).toBeUndefined()
    expect(out.disabledReason).toBe('Live tracking only')
  })

  it.each([
    { ...base, login: 'nearby channel' },
    { ...base, streamId: '' },
  ])('does not create a review route for invalid exact identity %o', (moment) => {
    expect(resolveMomentActions(moment).reviewHref).toBeUndefined()
  })
})
