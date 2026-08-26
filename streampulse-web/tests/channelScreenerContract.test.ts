import { describe, expect, it } from 'vitest'
import {
  normalizeHubChannelScreenerFields,
  screenerViewLabel,
} from '../src/lib/channelScreenerContract'

describe('channelScreenerContract', () => {
  it('labels screener views', () => {
    expect(screenerViewLabel('overview')).toBe('Overview')
    expect(screenerViewLabel('momentum')).toBe('Activity change')
    expect(screenerViewLabel('coverage')).toBe('Coverage evidence')
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

  it('accepts a complete v1 measured comparison without deriving fields', () => {
    const metric = {
      state: 'ready',
      currentPerMin: 20,
      baselinePerMin: 10,
      absoluteDeltaPerMin: 10,
      changePct: 100,
      multiplier: 2,
      currentMeasuredMinutes: 5,
      currentExpectedMinutes: 5,
      baselineMeasuredMinutes: 20,
      baselineExpectedMinutes: 20,
      baselineCoveragePct: 100,
    }
    const fields = normalizeHubChannelScreenerFields({
      version: 1,
      streamId: 'stream-1',
      measuredAt: 1_800_000,
      baselineKind: 'current_stream_measured_average',
      state: 'ready',
      currentWindow: { start: 1_500_000, end: 1_800_000, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
      baselineWindow: { start: 300_000, end: 1_500_000, expectedMinutes: 20, measuredMinutes: 20, coveragePct: 100 },
      evidence: { ircBound: true, chatObservedLast5m: true, rollupAvailable: true, metadataAgeSeconds: 10 },
      chat: metric,
      emotes: metric,
    })
    expect(fields?.version).toBe(1)
    if (fields?.version === 1) {
      expect(fields.chat.currentPerMin).toBe(20)
      expect(fields.baselineWindow.coveragePct).toBe(100)
    }
  })

  it('keeps honest unavailable and warming zero-history states renderable', () => {
    const metric = {
      state: 'unavailable',
      reason: 'stream_identity_unavailable',
      currentMeasuredMinutes: 0,
      currentExpectedMinutes: 5,
      baselineMeasuredMinutes: 0,
      baselineExpectedMinutes: 0,
      baselineCoveragePct: 0,
    }
    const unavailable = normalizeHubChannelScreenerFields({
      version: 1,
      streamId: '',
      measuredAt: 1_800_000,
      baselineKind: 'current_stream_measured_average',
      state: 'unavailable',
      reason: 'stream_identity_unavailable',
      currentWindow: { start: 1_500_000, end: 1_800_000, expectedMinutes: 5, measuredMinutes: 0, coveragePct: 0 },
      baselineWindow: { start: 1_500_000, end: 1_500_000, expectedMinutes: 0, measuredMinutes: 0 },
      evidence: { ircBound: false, chatObservedLast5m: false, rollupAvailable: false },
      chat: metric,
      emotes: metric,
    })
    expect(unavailable?.version).toBe(1)
    expect(unavailable?.version === 1 ? unavailable.baselineWindow.coveragePct : 'not-v1').toBeUndefined()
    expect(normalizeHubChannelScreenerFields({ ...unavailable, state: 'ready', streamId: '' })).toBeNull()
  })

  it('rejects ready rows whose evidence and coverage are internally contradictory', () => {
    const metric = {
      state: 'ready',
      currentPerMin: 20,
      baselinePerMin: 10,
      absoluteDeltaPerMin: 10,
      changePct: 100,
      multiplier: 2,
      currentMeasuredMinutes: 4,
      currentExpectedMinutes: 5,
      baselineMeasuredMinutes: 10,
      baselineExpectedMinutes: 20,
      baselineCoveragePct: 50,
    }
    expect(normalizeHubChannelScreenerFields({
      version: 1,
      streamId: 'stream-contradictory',
      measuredAt: 1_800_000,
      baselineKind: 'current_stream_measured_average',
      state: 'ready',
      currentWindow: { start: 1_500_000, end: 1_800_000, expectedMinutes: 5, measuredMinutes: 4, coveragePct: 80 },
      baselineWindow: { start: 300_000, end: 1_500_000, expectedMinutes: 20, measuredMinutes: 10, coveragePct: 50 },
      evidence: { ircBound: false, chatObservedLast5m: false, rollupAvailable: false },
      chat: metric,
      emotes: metric,
    })).toBeNull()
  })
})
