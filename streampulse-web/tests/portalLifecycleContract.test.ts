import { afterEach, describe, expect, it, vi } from 'vitest'
import { portalLifecycleDetailState, portalMinutesToRollups } from '../src/lib/streamcloneAnalytics'

const base = { streamId: '123', login: 'example', startedAt: '2026-08-01T10:00:00Z' }
afterEach(() => vi.useRealTimers())
describe('authoritative portal lifecycle and timestamp contract', () => {
  it('never treats an open row, legacy state or late EndedAt as confirmed life or end', () => {
    expect(portalLifecycleDetailState(base, 'live')).toBe('unknown')
    expect(portalLifecycleDetailState({ ...base, endedAt: '2026-08-04T10:00:00Z' }, 'historical')).toBe('unknown')
    expect(portalLifecycleDetailState(undefined, 'live')).toBe('unknown')
  })
  it('uses authoritative offline evidence even if the mutable row has no end or a late end', () => {
    const evidence = { ...base, lifecycleState: 'confirmed_ended' as const, lifecycleObservedAt: '2026-08-01T11:00:00Z', lifecycleDetectedAt: '2026-08-01T11:02:00Z' }
    expect(portalLifecycleDetailState(evidence, 'live')).toBe('historical')
    expect(portalLifecycleDetailState({ ...evidence, endedAt: '2026-09-01T00:00:00Z' }, 'live')).toBe('historical')
    expect(portalLifecycleDetailState({ ...evidence, lifecycleDetectedAt: '2026-08-01T10:30:00Z' }, 'historical')).toBe('unknown')
  })
  it('requires a trustworthy observation for live state; seeded exact active state need not have a detection event', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-08-01T11:01:00Z'))
    expect(portalLifecycleDetailState({ ...base, lifecycleState: 'confirmed_live' }, 'live')).toBe('unknown')
    expect(portalLifecycleDetailState({ ...base, lifecycleState: 'confirmed_live', lifecycleObservedAt: '2026-08-01T11:00:00Z' }, 'unknown')).toBe('live')
    vi.setSystemTime(new Date('2026-08-01T11:03:00Z'))
    expect(portalLifecycleDetailState({ ...base, lifecycleState: 'confirmed_live', lifecycleObservedAt: '2026-08-01T11:00:00Z' }, 'live')).toBe('unknown')
  })
  it.each(['0001-01-01T00:00:00Z', '1970-01-01T00:00:00Z', 'invalid', '2099-01-01T00:00:00Z'])('rejects sentinel and implausible measurements: %s', (timestamp) => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-04T12:00:00Z'))
    expect(portalLifecycleDetailState({ ...base, lifecycleState: 'confirmed_live', lifecycleObservedAt: timestamp }, 'live')).toBe('unknown')
    expect(portalMinutesToRollups(timestamp, [{ offsetSeconds: 0, chatCount: 5 }])).toEqual({ rollups: [], catalog: [] })
  })
})
