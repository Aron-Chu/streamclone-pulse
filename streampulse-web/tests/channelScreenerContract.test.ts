import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  formatScreenerMultiplier,
  HUB_SCREENER_COUNT_FLOOR_PER_MIN,
  HUB_SCREENER_SHOW_FLOOR_PER_MIN,
  isScreenerAtTwoTimesUsual,
  normalizeHubChannelScreenerFields,
  normalizeHubChannelScreenerV1,
  screenerBaselineMinutes,
  screenerMetricMultiplier,
  screenerUsual,
  screenerUsualTooltip,
} from '../src/lib/channelScreenerContract'

describe('channelScreenerContract', () => {
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

/** A synthetic backend screener v1 payload (the shape the hub serves). */
function v1(overrides: Record<string, unknown> = {}, chat: Record<string, unknown> = {}, emotes: Record<string, unknown> = {}) {
  return {
    version: 1,
    streamId: '100000000001',
    measuredAt: 1_791_754_110_000,
    baselineKind: 'current_stream_measured_average',
    state: 'ready',
    currentWindow: { start: 1_791_753_780_000, end: 1_791_754_080_000, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
    baselineWindow: { start: 1_791_736_620_000, end: 1_791_753_780_000, expectedMinutes: 286, measuredMinutes: 285, coveragePct: 99.65 },
    evidence: { ircBound: true, chatObservedLast5m: true, rollupAvailable: true, metadataAgeSeconds: 124 },
    chat: {
      state: 'ready', currentPerMin: 37.2, baselinePerMin: 21.69, absoluteDeltaPerMin: 15.51, changePct: 71.51, multiplier: 1.72,
      currentMeasuredMinutes: 5, currentExpectedMinutes: 5, baselineMeasuredMinutes: 285, baselineExpectedMinutes: 286, baselineCoveragePct: 99.65,
      ...chat,
    },
    emotes: {
      state: 'ready', currentPerMin: 9, baselinePerMin: 9.35, absoluteDeltaPerMin: -0.35, changePct: -3.74, multiplier: 0.96,
      currentMeasuredMinutes: 5, currentExpectedMinutes: 5, baselineMeasuredMinutes: 285, baselineExpectedMinutes: 286, baselineCoveragePct: 99.65,
      ...emotes,
    },
    ...overrides,
  }
}

describe('screener v1 (plan §1.5)', () => {
  it('copies the backend payload without deriving anything', () => {
    const screener = normalizeHubChannelScreenerV1(v1())
    expect(screener).toMatchObject({
      version: 1,
      streamId: '100000000001',
      state: 'ready',
      baselineKind: 'current_stream_measured_average',
      baselineMeasuredMinutes: 285,
      baselineWindow: { measuredMinutes: 285, expectedMinutes: 286, coveragePct: 99.65 },
      chat: { state: 'ready', currentPerMin: 37.2, multiplier: 1.72, baselinePerMin: 21.69 },
      emotes: { state: 'ready', currentPerMin: 9, multiplier: 0.96 },
      evidence: { ircBound: true, metadataAgeSeconds: 124 },
    })
    // A missing multiplier stays missing: never computed from now / baseline.
    const noMultiplier = normalizeHubChannelScreenerV1(v1({}, { multiplier: undefined }))
    expect(noMultiplier?.chat?.multiplier).toBeNull()
    expect(screenerMetricMultiplier(noMultiplier, 'chat')).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({}, { multiplier: null }))?.chat?.multiplier).toBeNull()
  })

  it('rejects other versions, other baselines, malformed values and client-invented keys', () => {
    expect(normalizeHubChannelScreenerV1(null)).toBeNull()
    expect(normalizeHubChannelScreenerV1([])).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({ version: 2 }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({ baselineKind: 'trailing_7d' }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({ state: '  ' }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({ pulseScore: 9 }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({}, { clientScore: 3 }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({}, { multiplier: '2x' }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({}, { multiplier: -1 }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({}, { currentPerMin: Number.NaN }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({ baselineWindow: { start: 2, end: 1, expectedMinutes: 1, measuredMinutes: 1, coveragePct: 100 } }))).toBeNull()
    expect(normalizeHubChannelScreenerV1(v1({ currentWindow: 'now' }))).toBeNull()
  })

  it('keeps the legacy screener fields separate and unchanged', () => {
    // A v1 payload has no legacy field, so the legacy normalizer still returns null for it.
    expect(normalizeHubChannelScreenerFields(v1())).toBeNull()
    expect(normalizeHubChannelScreenerFields({ chatAcceleration: 2 })).toEqual({ chatAcceleration: 2 })
    expect(normalizeHubChannelScreenerV1({ chatAcceleration: 2 })).toBeNull()
  })

  it('shows "× usual" only when the comparison and metric are ready and now is at least 5/min', () => {
    expect(HUB_SCREENER_SHOW_FLOOR_PER_MIN).toBe(5)
    const ready = normalizeHubChannelScreenerV1(v1())
    expect(screenerMetricMultiplier(ready, 'chat')).toBe(1.72)
    expect(screenerMetricMultiplier(ready, 'emotes')).toBe(0.96)
    expect(screenerUsual(ready)).toEqual({ metric: 'chat', multiplier: 1.72, currentPerMin: 37.2 })

    expect(screenerUsual(normalizeHubChannelScreenerV1(v1({ state: 'warming' })))).toBeNull()
    expect(screenerUsual(normalizeHubChannelScreenerV1(v1({ state: 'partial' })))).toBeNull()
    expect(screenerUsual(normalizeHubChannelScreenerV1(v1({ state: 'unavailable', reason: 'irc_unbound' })))).toBeNull()
    const chatWarming = normalizeHubChannelScreenerV1(v1({}, { state: 'warming' }))
    expect(screenerMetricMultiplier(chatWarming, 'chat')).toBeNull()
    expect(screenerUsual(chatWarming)).toEqual({ metric: 'emotes', multiplier: 0.96, currentPerMin: 9 })

    const quiet = normalizeHubChannelScreenerV1(v1({}, { currentPerMin: 4.99, multiplier: 9 }, { currentPerMin: 5, multiplier: 3 }))
    expect(screenerMetricMultiplier(quiet, 'chat')).toBeNull()
    expect(screenerUsual(quiet)).toEqual({ metric: 'emotes', multiplier: 3, currentPerMin: 5 })
    expect(screenerUsual(null)).toBeNull()
    expect(screenerUsual(undefined)).toBeNull()
  })

  it('counts toward "2× usual or more" only at 2× and at least 50/min', () => {
    expect(HUB_SCREENER_COUNT_FLOOR_PER_MIN).toBe(50)
    const at = (now: number, multiplier: number, state = 'ready') =>
      isScreenerAtTwoTimesUsual(normalizeHubChannelScreenerV1(v1({ state }, { currentPerMin: now, multiplier }, { multiplier: 0.5 })))
    expect(at(50, 2)).toBe(true)
    expect(at(49.9, 2)).toBe(false)
    expect(at(400, 1.99)).toBe(false)
    expect(at(400, 6, 'warming')).toBe(false)
    expect(isScreenerAtTwoTimesUsual(normalizeHubChannelScreenerV1(v1({}, { multiplier: 1 }, { currentPerMin: 80, multiplier: 2.5 })))).toBe(true)
    expect(isScreenerAtTwoTimesUsual(null)).toBe(false)
  })

  it('names the measured minutes in the tooltip and formats the multiplier', () => {
    const ready = normalizeHubChannelScreenerV1(v1())
    expect(screenerBaselineMinutes(ready)).toBe(285)
    expect(screenerUsualTooltip(ready)).toBe("Now vs this channel's average over the last 285 measured minutes")
    const one = normalizeHubChannelScreenerV1(v1({ baselineWindow: { start: 0, end: 60_000, expectedMinutes: 1, measuredMinutes: 1, coveragePct: 100 } }))
    expect(screenerUsualTooltip(one)).toBe("Now vs this channel's average over the last 1 measured minute")
    // A slim copy without windows keeps N through the flat field.
    const slim = normalizeHubChannelScreenerV1(v1({ baselineWindow: null, currentWindow: null, baselineMeasuredMinutes: 120 }))
    expect(screenerBaselineMinutes(slim)).toBe(120)
    expect(screenerUsualTooltip(normalizeHubChannelScreenerV1(v1({ baselineWindow: null })))).toBeNull()
    expect(formatScreenerMultiplier(1.72)).toBe('1.7×')
    expect(formatScreenerMultiplier(2)).toBe('2.0×')
    expect(formatScreenerMultiplier(10)).toBe('10×+')
  })

  // Opt-in: SP_HUB_CAPTURE_PATH points at a local hub capture (never committed).
  const capturePath = process.env.SP_HUB_CAPTURE_PATH
  it.skipIf(!capturePath || !existsSync(capturePath))('reads every row of the production capture', () => {
    const raw = JSON.parse(readFileSync(capturePath!, 'utf8')) as { liveChannels: Array<{ screener?: unknown }> }
    const rows = raw.liveChannels.map(channel => normalizeHubChannelScreenerV1(channel.screener))
    expect(rows.every(Boolean)).toBe(true)
    const states = rows.reduce<Record<string, number>>((acc, row) => ({ ...acc, [row!.state]: (acc[row!.state] ?? 0) + 1 }), {})
    expect(states).toEqual({ ready: 412, partial: 58, warming: 20, unavailable: 10 })
    expect(rows.filter(row => isScreenerAtTwoTimesUsual(row)).length).toBe(13)
  })
})
