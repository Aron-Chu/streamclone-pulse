import { describe, expect, it } from 'vitest'
import {
  buildDirectionalX,
  capNewKeysPerPoll,
  classifyMomentWindow,
  dedupeMomentsByLogin,
  normalizeLiveWireMomentComparison,
  normalizeRatePct,
  partitionMomentWindow,
  resolveMomentAtMs,
} from '../src/lib/liveWire'

const WINDOW = 30 * 60 * 1000

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

describe('classifyMomentWindow', () => {
  const now = 1_700_000_000_000

  it('classifies valid <=30m boundary-inclusive as live', () => {
    expect(classifyMomentWindow(now - 60_000, now, WINDOW)).toBe('live')
    expect(classifyMomentWindow(now - WINDOW, now, WINDOW)).toBe('live')
    expect(classifyMomentWindow(now, now, WINDOW)).toBe('live')
  })

  it('classifies valid >30m as older', () => {
    expect(classifyMomentWindow(now - WINDOW - 1, now, WINDOW)).toBe('older')
    expect(classifyMomentWindow(1_000_000_000, now, WINDOW)).toBe('older')
  })

  it('omits missing, invalid, non-positive, and future', () => {
    expect(classifyMomentWindow(undefined, now, WINDOW)).toBe('omit')
    expect(classifyMomentWindow(Number.NaN, now, WINDOW)).toBe('omit')
    expect(classifyMomentWindow(0, now, WINDOW)).toBe('omit')
    expect(classifyMomentWindow(now + 60_000, now, WINDOW)).toBe('omit')
  })
})

describe('partitionMomentWindow', () => {
  const now = 1_700_000_000_000

  it('separates the truthful live lane from older archive detections and omits future rows', () => {
    const result = partitionMomentWindow([
      { id: 'live', at: now - 60_000 },
      { id: 'boundary', at: now - WINDOW },
      { id: 'older', at: now - WINDOW - 1 },
      { id: 'future', at: now + 1 },
    ], now, WINDOW)
    expect(result.live.map((item) => item.id)).toEqual(['live', 'boundary'])
    expect(result.older.map((item) => item.id)).toEqual(['older'])
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

describe('normalizeRatePct', () => {
  it('returns a pct string within the visible max', () => {
    expect(normalizeRatePct(50, 100)).toBe('50%')
    expect(Number.parseFloat(normalizeRatePct(100, 100)!)).toBe(100)
  })

  it('returns null for missing, zero, or non-positive max', () => {
    expect(normalizeRatePct(undefined, 100)).toBeNull()
    expect(normalizeRatePct(0, 100)).toBeNull()
    expect(normalizeRatePct(50, 0)).toBeNull()
    expect(normalizeRatePct(-1, 100)).toBeNull()
  })
})

describe('dedupeMomentsByLogin', () => {
  it('drops a login within the window and honors cap', () => {
    const items = [
      { login: 'a', at: 1000 },
      { login: 'a', at: 2000 }, // within 10s window -> dropped
      { login: 'b', at: 3000 },
    ]
    const out = dedupeMomentsByLogin(items, 10, 10_000)
    expect(out.map((i) => i.login)).toEqual(['a', 'b'])
  })

  it('keeps a login reappearing after the window closes', () => {
    const items = [
      { login: 'a', at: 1000 },
      { login: 'a', at: 1_000 + 20_000 }, // > 10s window -> kept
    ]
    const out = dedupeMomentsByLogin(items, 10, 10_000)
    expect(out).toHaveLength(2)
  })

  it('keeps an older re-surge outside the window when moments are newest-first', () => {
    const items = [
      { login: 'a', at: 30_000 },
      { login: 'a', at: 1_000 },
    ]
    const out = dedupeMomentsByLogin(items, 10, 10_000)
    expect(out).toHaveLength(2)
  })

  it('honors the cap on returned length', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ login: `c${i}`, at: i * 1000 }))
    const out = dedupeMomentsByLogin(items, 3, 10_000)
    expect(out).toHaveLength(3)
  })
})

describe('capNewKeysPerPoll', () => {
  const now = 1_700_000_000_000

  it('returns at most maxNew fresh, unseen keys', () => {
    const moments = [
      { key: 'a', at: now - 1000 },
      { key: 'b', at: now - 2000 },
    ]
    const out = capNewKeysPerPoll(new Set(), moments, now, WINDOW, 1)
    expect(out.size).toBe(1)
  })

  it('omits already-seen keys and out-of-window keys', () => {
    const moments = [
      { key: 'a', at: now - 1000 }, // unseen, in-window
      { key: 'b', at: now - 1000 }, // seen
      { key: 'c', at: now - WINDOW - 10_000 }, // unseen but out-of-window (older)
    ]
    const out = capNewKeysPerPoll(new Set(['b']), moments, now, WINDOW, 10)
    expect(out.has('a')).toBe(true)
    expect(out.has('b')).toBe(false)
    expect(out.has('c')).toBe(false)
  })
})
