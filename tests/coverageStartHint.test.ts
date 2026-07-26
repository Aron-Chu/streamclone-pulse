import { describe, expect, it } from 'vitest'
import {
  COVERAGE_TIER_ACTIVE_LIVE,
  PULSE_STREAM_START_TOLERANCE_SEC,
  resolveCoverageStartHint,
} from '../src/ui/coverageStartHint.ts'

describe('resolveCoverageStartHint', () => {
  it('hides hint within stream-start tolerance', () => {
    expect(
      resolveCoverageStartHint({
        coverageStartOffsetSeconds: PULSE_STREAM_START_TOLERANCE_SEC,
        tracking: true,
        isLive: true,
        coverageTier: COVERAGE_TIER_ACTIVE_LIVE,
      }).show,
    ).toBe(false)
    expect(
      resolveCoverageStartHint({
        coverageStartOffsetSeconds: 300,
        trackedFromStart: true,
        tracking: true,
        isLive: true,
        coverageTier: COVERAGE_TIER_ACTIVE_LIVE,
      }).show,
    ).toBe(false)
  })

  it('uses soft copy for in-cap moderate late join', () => {
    const hint = resolveCoverageStartHint({
      coverageStartOffsetSeconds: 180,
      tracking: true,
      isLive: true,
      coverageTier: COVERAGE_TIER_ACTIVE_LIVE,
    })
    expect(hint.show).toBe(true)
    expect(hint.tone).toBe('soft')
    expect(hint.text).toContain('Live chat from')
  })

  it('uses warn copy for large gaps or out-of-cap tracking', () => {
    const outOfCap = resolveCoverageStartHint({
      coverageStartOffsetSeconds: 180,
      tracking: true,
      isLive: true,
    })
    expect(outOfCap.tone).toBe('warn')
    expect(outOfCap.text).toContain('Rollups since')

    const largeGap = resolveCoverageStartHint({
      coverageStartOffsetSeconds: 900,
      tracking: true,
      isLive: true,
      coverageTier: COVERAGE_TIER_ACTIVE_LIVE,
    })
    expect(largeGap.tone).toBe('warn')
  })

  it('hides hint when backfill is actionable', () => {
    expect(
      resolveCoverageStartHint({
        coverageStartOffsetSeconds: 900,
        canBackfill: true,
        tracking: true,
        isLive: true,
        coverageTier: COVERAGE_TIER_ACTIVE_LIVE,
      }).show,
    ).toBe(false)
  })
})
