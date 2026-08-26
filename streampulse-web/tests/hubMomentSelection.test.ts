import { describe, expect, it } from 'vitest'
import { screenerViewLabel } from '../src/lib/channelScreenerContract'
import { activityBucketKey } from '../src/lib/hubActivitySummary'
import { momentRowKey, type FigmaMomentRow } from '../src/lib/figmaSessionAnalytics'

describe('channelScreenerContract', () => {
  it('labels screener views', () => {
    expect(screenerViewLabel('overview')).toBe('Overview')
    expect(screenerViewLabel('momentum')).toBe('Activity change')
    expect(screenerViewLabel('coverage')).toBe('Coverage evidence')
    expect(screenerViewLabel('anomalies')).toBe('Anomalies')
  })
})

describe('hub moment selection sync helpers', () => {
  it('derives accent bucket from selected moment.at', () => {
    const moment: FigmaMomentRow = {
      kind: 'emote_spike',
      login: 'zackrawrr',
      label: 'Emote spike',
      offsetSeconds: 120,
      score: 90,
      at: Date.parse('2026-07-10T18:00:00Z'),
    }
    const key = momentRowKey(moment)
    expect(key).toContain('zackrawrr')
    const bucket = activityBucketKey(moment.at!, 24 * 60)
    expect(Number.isFinite(bucket)).toBe(true)
  })
})
