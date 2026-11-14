import { describe, expect, it } from 'vitest'
import {
  buildDirectionalX,
  formatMomentDateTime,
  normalizeLiveWireMomentComparison,
  resolveMomentAtMs,
} from '../src/lib/liveWire'

describe('resolveMomentAtMs', () => {
  it('converts seconds to ms and passthrough ms', () => {
    expect(resolveMomentAtMs(1_000_000_000)).toBe(1_000_000_000_000)
    expect(resolveMomentAtMs(1_700_000_000_000)).toBe(1_700_000_000_000)
  })

  it('rejects missing, non-finite, and non-positive', () => {
    expect(resolveMomentAtMs(undefined)).toBeNull()
    expect(resolveMomentAtMs(Number.NaN)).toBeNull()
    expect(resolveMomentAtMs(Infinity)).toBeNull()
    expect(resolveMomentAtMs(0)).toBeNull()
    expect(resolveMomentAtMs(-5)).toBeNull()
  })
})

describe('formatMomentDateTime', () => {
  it('formats valid seconds and millisecond timestamps', () => {
    expect(formatMomentDateTime(1_700_000_000)).toBe('2023-11-14T22:13:20.000Z')
    expect(formatMomentDateTime(1_700_000_000_000)).toBe('2023-11-14T22:13:20.000Z')
  })

  it('fails closed for malformed and out-of-range timestamps', () => {
    expect(formatMomentDateTime(undefined)).toBeUndefined()
    expect(formatMomentDateTime(Number.NaN)).toBeUndefined()
    expect(formatMomentDateTime(Infinity)).toBeUndefined()
    expect(formatMomentDateTime(0)).toBeUndefined()
    expect(formatMomentDateTime(Number.MAX_VALUE)).toBeUndefined()
  })
})

describe('normalizeLiveWireMomentComparison', () => {
  const eventAt = 1_700_000_100_000
  const eventMinute = Math.floor(eventAt / 60_000) * 60_000
  const metric = {
    state: 'ready', currentPerMin: 120, baselinePerMin: 40, absoluteDeltaPerMin: 80,
    changePct: 200, multiplier: 3, currentMeasuredMinutes: 1, currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 24, baselineExpectedMinutes: 30, baselineCoveragePct: 80,
  }
  const valid = {
    baselineKind: 'current_stream_measured_average_before_event', eventAt,
    baselineWindow: { start: eventMinute - 30 * 60_000, end: eventMinute, expectedMinutes: 30, measuredMinutes: 24, coveragePct: 80 },
    chat: metric, emotes: metric,
    evidence: { ircBound: true, eventRollupAvailable: true, baselineMeasuredMinutes: 24, baselineExpectedMinutes: 30, baselineCoveragePct: 80 },
  }

  it('accepts a coherent event-minute comparison with qualified prior-stream evidence', () => {
    expect(normalizeLiveWireMomentComparison(valid)).toMatchObject({
      baselineKind: 'current_stream_measured_average_before_event',
      chat: { state: 'ready', multiplier: 3 },
    })
  })

  it('fails closed when a ready claim lacks coverage or its event-time geometry is inconsistent', () => {
    expect(normalizeLiveWireMomentComparison({
      ...valid,
      baselineWindow: { ...valid.baselineWindow, end: eventMinute + 60_000 },
    })).toBeNull()
    expect(normalizeLiveWireMomentComparison({
      ...valid,
      evidence: { ...valid.evidence, baselineCoveragePct: 50 },
    })).toBeNull()
  })
})

describe('buildDirectionalX', () => {
  it('defaults to left (-24) for undefined/left', () => {
    expect(buildDirectionalX()).toBe(-24)
    expect(buildDirectionalX('left')).toBe(-24)
  })

  it('returns +24 for right entry', () => {
    expect(buildDirectionalX('right')).toBe(24)
  })
})
