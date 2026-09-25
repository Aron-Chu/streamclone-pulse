import { afterEach, describe, expect, it, vi } from 'vitest'
import { portalLifecycleDetailState } from './streamcloneAnalytics'

const stream = {
  streamId: 'stream-1',
  login: 'example',
  startedAt: '2026-09-04T00:00:00Z',
}

describe('portal lifecycle adaptation', () => {
  afterEach(() => vi.useRealTimers())
  it('lets explicit unknown override legacy live inference', () => {
    expect(portalLifecycleDetailState({ ...stream, lifecycleState: 'unknown' }, 'live')).toBe('unknown')
  })

  it('accepts only backend-confirmed live', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-09-04T00:02:00Z'))
    expect(portalLifecycleDetailState({ ...stream, lifecycleState: 'confirmed_live', lifecycleObservedAt: '2026-09-04T00:01:00Z' }, 'historical')).toBe('live')
    expect(portalLifecycleDetailState(stream, 'live')).toBe('unknown')
  })

  it('requires exact offline evidence rather than a legacy end boundary', () => {
    expect(portalLifecycleDetailState({
      ...stream,
      lifecycleState: 'confirmed_ended',
      endedAt: '2026-09-04T01:00:00Z',
      lifecycleObservedAt: '2026-09-04T00:58:00Z',
      lifecycleDetectedAt: '2026-09-04T01:02:00Z',
    }, 'live')).toBe('historical')
    expect(portalLifecycleDetailState({
      ...stream,
      lifecycleState: 'confirmed_ended',
      endedAt: '2026-09-03T23:00:00Z',
    }, 'historical')).toBe('unknown')
    expect(portalLifecycleDetailState({ ...stream, endedAt: '2026-09-04T01:00:00Z' }, 'live')).toBe('unknown')
  })
})
