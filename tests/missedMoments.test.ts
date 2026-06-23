import { describe, expect, it } from 'vitest'
import {
  evaluateBackfillRefresh,
  isPulseBackfillTerminal,
  missedMomentsButtonLabel,
  missedMomentsButtonState,
  shouldShowMissedMomentsBanner,
} from '../src/ui/missedMoments.ts'
import type { PulseCoverage } from '../src/shared/messages.ts'

function partialCoverage(overrides: Partial<PulseCoverage> = {}): PulseCoverage {
  return {
    state: 'partial_tracking',
    coverageStartOffsetSeconds: 7200,
    coverageEndOffsetSeconds: 9000,
    hasFullStreamCoverage: false,
    hasGaps: true,
    missingRanges: [{ fromOffsetSeconds: 0, toOffsetSeconds: 7140 }],
    canBackfill: true,
    backfillReason: 'vod_available',
    message: 'Showing moments since 2:00:00',
    ...overrides,
  }
}

describe('missedMoments helpers', () => {
  it('shows banner for late tracking', () => {
    expect(shouldShowMissedMomentsBanner(partialCoverage())).toBe(true)
    expect(shouldShowMissedMomentsBanner(partialCoverage({ hasFullStreamCoverage: true }))).toBe(false)
  })

  it('labels load vs backfill states', () => {
    expect(missedMomentsButtonLabel('load')).toBe('Load missed moments')
    expect(missedMomentsButtonLabel('backfilling', {
      jobId: 'x',
      status: 'fetching_chat',
      message: 'Fetching',
      progress: { percent: 33 },
      range: { fromOffsetSeconds: 0, toOffsetSeconds: 100 },
      streamId: '1',
      login: 'chan',
    })).toContain('33%')
    expect(missedMomentsButtonLabel('waiting_vod')).toBe('Waiting for VOD')
  })

  it('derives button state from coverage', () => {
    expect(missedMomentsButtonState(partialCoverage(), false, false)).toBe('load')
    expect(missedMomentsButtonState(partialCoverage({ state: 'backfill_running' }), false, false)).toBe('backfilling')
    expect(missedMomentsButtonState(partialCoverage(), false, true)).toBe('refreshed')
  })

  it('treats terminal backfill statuses', () => {
    expect(isPulseBackfillTerminal('done')).toBe(true)
    expect(isPulseBackfillTerminal('already_available')).toBe(true)
    expect(isPulseBackfillTerminal('fetching_chat')).toBe(false)
  })

  it('evaluates backfill refresh outcomes from coverage movement', () => {
    const before = {
      coverageStartOffsetSeconds: 7200,
      coverage: partialCoverage(),
    }
    expect(
      evaluateBackfillRefresh(before, {
        coverageStartOffsetSeconds: 7200,
        coverage: partialCoverage({ hasFullStreamCoverage: true }),
      }),
    ).toBe('full')
    expect(
      evaluateBackfillRefresh(before, {
        coverageStartOffsetSeconds: 3600,
        coverage: partialCoverage({ coverageStartOffsetSeconds: 3600 }),
      }),
    ).toBe('partial')
    expect(
      evaluateBackfillRefresh(before, {
        coverageStartOffsetSeconds: 7200,
        coverage: partialCoverage(),
      }),
    ).toBe('none')
  })
})
