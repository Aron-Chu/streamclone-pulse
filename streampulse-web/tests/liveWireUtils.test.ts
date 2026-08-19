import { describe, expect, it } from 'vitest'
import {
  capNewKeysPerPoll,
  classifyMomentWindow,
  dedupeMomentsByLogin,
  normalizeRatePct,
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
