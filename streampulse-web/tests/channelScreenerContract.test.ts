import { describe, expect, it } from 'vitest'
import {
  normalizeHubChannelScreenerFields,
  screenerViewLabel,
} from '../src/lib/channelScreenerContract'

describe('channelScreenerContract', () => {
  it('labels screener views', () => {
    expect(screenerViewLabel('overview')).toBe('Overview')
    expect(screenerViewLabel('momentum')).toBe('Momentum')
    expect(screenerViewLabel('coverage')).toBe('Coverage')
    expect(screenerViewLabel('anomalies')).toBe('Anomalies')
  })

  it('accepts server-owned acceleration and anomaly fields', () => {
    const fields = normalizeHubChannelScreenerFields({
      chatAcceleration: 1.5,
      emoteAcceleration: -0.2,
      viewerChatDivergence: 3,
      anomalyReason: 'chat drought',
      newlyLive: true,
      dataFreshnessAt: '2026-07-10T12:00:00Z',
    })
    expect(fields?.chatAcceleration).toBe(1.5)
    expect(fields?.anomalyReason).toBe('chat drought')
    expect(fields?.newlyLive).toBe(true)
  })

  it('rejects hostile / malformed payloads', () => {
    expect(normalizeHubChannelScreenerFields(null)).toBeNull()
    expect(normalizeHubChannelScreenerFields([])).toBeNull()
    expect(normalizeHubChannelScreenerFields({})).toBeNull()
    expect(normalizeHubChannelScreenerFields({ chatAcceleration: 'fast' })).toBeNull()
    expect(normalizeHubChannelScreenerFields({ anomalyReason: '   ' })).toBeNull()
    expect(normalizeHubChannelScreenerFields({ newlyLive: 'yes' })).toBeNull()
    expect(
      normalizeHubChannelScreenerFields({
        chatAcceleration: 1,
        pulseScore: 99,
      }),
    ).toBeNull()
    expect(
      normalizeHubChannelScreenerFields({
        clientScore: 12,
        anomalyReason: 'x',
      }),
    ).toBeNull()
  })

  it('keeps server-owned semantics — does not invent missing fields', () => {
    const fields = normalizeHubChannelScreenerFields({ newlyLive: false })
    expect(fields).toEqual({ newlyLive: false })
    expect(fields).not.toHaveProperty('chatAcceleration')
    expect(fields).not.toHaveProperty('anomalyReason')
  })
})
