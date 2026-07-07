import { describe, expect, it } from 'vitest'
import {
  COVERAGE_TIER_ACTIVE_LIVE,
  PULSE_STREAM_START_TOLERANCE_SEC,
  resolvePulseLiveAccess,
  secondsSinceStreamStartAt,
} from '../src/ui/resolvePulseLiveAccess.ts'
import type { ExtensionCoverageTierResponse, PulsePayload } from '../src/shared/messages.ts'

function basePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'testchan',
    isLive: true,
    tracking: true,
    top500Eligible: true,
    startedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    coverageStartOffsetSeconds: 60,
    currentOffsetSeconds: 1800,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    peaks: [],
    recap: null,
    ...overrides,
  }
}

const hostedCap: ExtensionCoverageTierResponse = {
  login: 'testchan',
  coverageTier: COVERAGE_TIER_ACTIVE_LIVE,
  hostedCap: { activeLimit: 250, activeCount: 120, activeAvailable: true },
}

describe('secondsSinceStreamStartAt', () => {
  it('returns seconds between stream start and tab open', () => {
    const startedAt = '2026-07-04T12:00:00.000Z'
    const openedAt = Date.parse('2026-07-04T12:01:30.000Z')
    expect(secondsSinceStreamStartAt(startedAt, openedAt)).toBe(90)
  })
})

describe('resolvePulseLiveAccess', () => {
  it('blocks roster channels outside top 500', () => {
    const result = resolvePulseLiveAccess({
      payload: basePayload({ top500Eligible: false }),
      pageIsLive: true,
      hosted: true,
    })
    expect(result.state).toBe('not_in_roster')
  })

  describe('hosted', () => {
    it('allows full live only for active_live_coverage with tracking', () => {
      const result = resolvePulseLiveAccess({
        payload: basePayload(),
        pageIsLive: true,
        hosted: true,
        coverageTier: hostedCap,
      })
      expect(result.state).toBe('full_live')
    })

    it('shows not_tracked when tracking but metadata-only tier', () => {
      const result = resolvePulseLiveAccess({
        payload: basePayload({ tracking: true }),
        pageIsLive: true,
        hosted: true,
        coverageTier: {
          ...hostedCap,
          coverageTier: 'top500_metadata_only',
        },
      })
      expect(result.state).toBe('not_tracked')
    })

    it('shows full_live when in active tier regardless of tab open time', () => {
      const startedAt = new Date(Date.now() - 30 * 60_000).toISOString()
      const result = resolvePulseLiveAccess({
        payload: basePayload({ startedAt, coverageStartOffsetSeconds: 90 }),
        sessionOpenedAtMs: Date.now(),
        pageIsLive: true,
        hosted: true,
        coverageTier: hostedCap,
      })
      expect(result.state).toBe('full_live')
    })

    it('shows not_tracked when live but collector inactive', () => {
      const result = resolvePulseLiveAccess({
        payload: basePayload({ tracking: false }),
        pageIsLive: true,
        hosted: true,
        coverageTier: {
          ...hostedCap,
          coverageTier: 'top500_metadata_only',
        },
      })
      expect(result.state).toBe('not_tracked')
    })
  })

  describe('local stack', () => {
    it('allows full live for protected channels tracked from start', () => {
      const result = resolvePulseLiveAccess({
        payload: basePayload({ coverageStartOffsetSeconds: 90 }),
        alwaysTrackedLogins: ['testchan'],
        sessionOpenedAtMs: Date.now(),
        pageIsLive: true,
        hosted: false,
      })
      expect(result.state).toBe('full_live')
    })

    it('allows full live when tab opened near stream start', () => {
      const startedAt = new Date(Date.now() - 60_000).toISOString()
      const result = resolvePulseLiveAccess({
        payload: basePayload({ startedAt, coverageStartOffsetSeconds: 90 }),
        sessionOpenedAtMs: Date.now(),
        pageIsLive: true,
        hosted: false,
      })
      expect(result.state).toBe('full_live')
    })

    it('shows late_session when backend tracked from start but user opened late', () => {
      const startedAt = new Date(Date.now() - 30 * 60_000).toISOString()
      const result = resolvePulseLiveAccess({
        payload: basePayload({ startedAt, coverageStartOffsetSeconds: 90 }),
        sessionOpenedAtMs: Date.now(),
        pageIsLive: true,
        hosted: false,
      })
      expect(result.state).toBe('late_session')
    })

    it('shows not_irc_tracked when live but collector inactive', () => {
      const result = resolvePulseLiveAccess({
        payload: basePayload({ tracking: false, coverageStartOffsetSeconds: 0 }),
        pageIsLive: true,
        hosted: false,
        coverageTier: {
          ...hostedCap,
          coverageTier: 'top500_metadata_only',
        },
      })
      expect(result.state).toBe('not_irc_tracked')
    })
  })

  it('uses offline state when stream ended', () => {
    const result = resolvePulseLiveAccess({
      payload: basePayload({ isLive: false, tracking: false }),
      pageIsLive: false,
      hosted: true,
    })
    expect(result.state).toBe('offline')
  })

  it('respects stream start tolerance constant', () => {
    expect(PULSE_STREAM_START_TOLERANCE_SEC).toBe(120)
  })

  it('propagates nested coverage.coverageStartOffsetSeconds into access result', () => {
    const result = resolvePulseLiveAccess({
      payload: basePayload({
        coverageStartOffsetSeconds: undefined,
        coverage: {
          state: 'partial_live',
          coverageStartOffsetSeconds: 45 * 60,
          coverageEndOffsetSeconds: 55 * 60,
          hasFullStreamCoverage: false,
          hasGaps: false,
          canBackfill: false,
        },
      }),
      pageIsLive: true,
      hosted: true,
      coverageTier: hostedCap,
    })
    expect(result.coverageStartOffsetSeconds).toBe(45 * 60)
    expect(result.state).toBe('full_live')
  })
})
