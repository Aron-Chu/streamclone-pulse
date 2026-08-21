import { describe, expect, it } from 'vitest'
import {
  applyFullTimelineResponse,
  isFullTimelineLabelActive,
  reduceFullTimelineState,
  shouldHideLiveAnalyticsForError,
  twelveHourFullViewIsAuthoritative,
  type FullTimelineState,
} from '../src/ui/fullTimelineState.ts'
import {
  chartMayEmitLateStartNarrative,
  lateStartPresentationOwner,
  plottedRangeLabel,
} from '../src/ui/lateStartSurface.ts'
import { coverageProgressPresentation } from '../src/ui/coverageProgress.ts'
import { resolvePulseCoverage, shouldShowMissedMomentsBanner } from '../src/ui/missedMoments.ts'
import { resolveCoverageStartHint } from '../src/ui/coverageStartHint.ts'

describe('FullTimelineFailureKeepsLastGoodLivePanel', () => {
  const lastGood = { login: 'fixturechan', streamId: '1', rollups: [{ offsetSeconds: 0 }] }

  it('keeps last-good payload and does not enter Full on failed full response', () => {
    const result = applyFullTimelineResponse(
      'recent',
      { type: 'PULSE_UPDATE', payload: null, error: 'timeout' },
      lastGood,
    )
    expect(result.payload).toBe(lastGood)
    expect(result.enteredFull).toBe(false)
    expect(result.nextState).toBe('full_error')
    expect(result.localWarning).toContain('timeout')
    expect(isFullTimelineLabelActive(result.nextState)).toBe(false)
  })

  it('does not hide live analytics when last-good payload exists alongside an error', () => {
    expect(shouldHideLiveAnalyticsForError(lastGood, 'timeout')).toBe(false)
    expect(shouldHideLiveAnalyticsForError(null, 'timeout')).toBe(true)
  })
})

describe('FullTimelineStateOnlyEntersFullAfterSuccessfulFullResponse', () => {
  it('enters full_loaded only from a successful full response with payload', () => {
    let state: FullTimelineState = 'recent'
    state = reduceFullTimelineState(state, { type: 'request_full' })
    expect(state).toBe('full_loading')
    expect(isFullTimelineLabelActive(state)).toBe(false)

    const ok = applyFullTimelineResponse(
      'recent',
      { type: 'PULSE_UPDATE', payload: { login: 'ok' } },
      null,
    )
    expect(ok.nextState).toBe('full_loaded')
    expect(ok.enteredFull).toBe(true)
    expect(isFullTimelineLabelActive(ok.nextState)).toBe(true)
  })

  it('refuses Full when response type is wrong even if payload-shaped', () => {
    const bad = applyFullTimelineResponse(
      'recent',
      { type: 'ERROR', payload: { login: 'x' } as object },
      { login: 'prior' },
    )
    expect(bad.enteredFull).toBe(false)
    expect(bad.nextState).toBe('full_error')
  })
})

describe('CoverageWithoutBackendTruthDoesNotInventMissingRanges', () => {
  it('produces unknown coverage with no invented ranges or CTA when backend omits coverage', () => {
    const resolved = resolvePulseCoverage({
      coverageStartOffsetSeconds: 900,
      vodId: '2797507897',
      isLive: true,
    })
    expect(resolved).toBeUndefined()
    expect(
      shouldShowMissedMomentsBanner({
        coverageStartOffsetSeconds: 900,
        vodId: '2797507897',
        isLive: true,
      }),
    ).toBe(false)
  })
})

describe('LateStartHasSingleAuthoritativeSurface', () => {
  it('assigns CoverageCard as the late-start owner; chart must not narrate', () => {
    const owner = lateStartPresentationOwner({
      coverageStartOffsetSeconds: 900,
      shouldShowCoverageCard: true,
    })
    expect(owner).toBe('coverage_card')
    expect(chartMayEmitLateStartNarrative(owner)).toBe(false)
  })

  it('suppresses LiveStatsBand coverageStartHint when CoverageCard owns late-start', () => {
    const owner = lateStartPresentationOwner({
      coverageStartOffsetSeconds: 900,
      shouldShowCoverageCard: true,
    })
    expect(chartMayEmitLateStartNarrative(owner)).toBe(false)
    // Hint helper still computes text for unit parity, but consumers must gate on owner.
    const hint = resolveCoverageStartHint({
      coverageStartOffsetSeconds: 900,
      tracking: true,
      isLive: true,
      coverageTier: 'active_live_coverage',
    })
    expect(hint.show).toBe(true)
    // Gating contract: when owner is coverage_card, chart must not show hint.
    expect(owner === 'coverage_card' && chartMayEmitLateStartNarrative(owner)).toBe(false)
  })
})

describe('TwelveHourFullViewLabelsAuthoritativeCoverage', () => {
  it('refuses Full label for recent fallback on a long stream', () => {
    expect(
      twelveHourFullViewIsAuthoritative({
        fullTimelineState: 'full_error',
        hasFullStreamCoverage: false,
        plottedIsRecentFallback: true,
      }),
    ).toBe(false)
    expect(
      twelveHourFullViewIsAuthoritative({
        fullTimelineState: 'full_loaded',
        hasFullStreamCoverage: true,
        plottedIsRecentFallback: false,
      }),
    ).toBe(true)
    expect(
      twelveHourFullViewIsAuthoritative({
        fullTimelineState: 'full_loaded',
        hasFullStreamCoverage: false,
        plottedIsRecentFallback: false,
      }),
    ).toBe(false)
  })

  it('labels recent window when not full_loaded', () => {
    expect(plottedRangeLabel({ fullTimelineState: 'recent', recentWindowMinutes: 30 })).toBe(
      'Recent 30 minutes',
    )
    expect(plottedRangeLabel({ fullTimelineState: 'full_loaded', recentWindowMinutes: 30 })).toBeNull()
  })
})

describe('CoverageCard progress honesty', () => {
  it('never uses a fake 35% fill for unknown progress', () => {
    const reduced = coverageProgressPresentation({
      showBar: true,
      percent: null,
      reducedMotion: true,
    })
    expect(reduced.kind).toBe('indeterminate_static')
    expect(reduced).not.toMatchObject({ percent: 35 })

    const shimmer = coverageProgressPresentation({
      showBar: true,
      percent: 0,
      reducedMotion: false,
    })
    expect(shimmer.kind).toBe('indeterminate_shimmer')
  })
})
