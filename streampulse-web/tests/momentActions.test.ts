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
  })

  it('emits vodHref only when a vodId is set', () => {
    const out = resolveMomentActions({ ...base, vodId: 'vod-999' })
    expect(out.vodHref).toBe('https://www.twitch.tv/videos/vod-999?t=300s')
  })

  it('omits vodHref when vodId is absent', () => {
    const out = resolveMomentActions(base)
    expect(out.vodHref).toBeUndefined()
  })

  it('sets disabledReason with no "#" when nothing resolves', () => {
    const minimal: FigmaMomentRow = { offsetSeconds: 0, label: 'x' }
    const out = resolveMomentActions(minimal)
    expect(out.analyticsHref).toBeUndefined()
    expect(out.vodHref).toBeUndefined()
    expect(out.disabledReason).toBe('Live tracking only')
  })
})
