import { describe, expect, it } from 'vitest'
import {
  firstObservedOffsetSeconds,
  fullStreamWithGapsViewport,
  observedViewport,
  shouldApplyObservedInitialViewport,
} from '../src/ui/observedViewport.ts'

describe('ObservedViewportInitializesOnceAndNeverOverridesUserNavigation', () => {
  it('applies only once before any user navigation', () => {
    expect(
      shouldApplyObservedInitialViewport({
        missingPrefixSeconds: 10 * 60,
        userHasNavigated: false,
        alreadyAppliedForStream: false,
      }),
    ).toBe(true)
    expect(
      shouldApplyObservedInitialViewport({
        missingPrefixSeconds: 10 * 60,
        userHasNavigated: true,
        alreadyAppliedForStream: false,
      }),
    ).toBe(false)
    expect(
      shouldApplyObservedInitialViewport({
        missingPrefixSeconds: 10 * 60,
        userHasNavigated: false,
        alreadyAppliedForStream: true,
      }),
    ).toBe(false)
  })

  it('clips a 6-minute uncovered prefix on early streams, not only 10-minute gaps', () => {
    expect(
      shouldApplyObservedInitialViewport({
        missingPrefixSeconds: 6 * 60,
        userHasNavigated: false,
        alreadyAppliedForStream: false,
      }),
    ).toBe(true)
    expect(
      shouldApplyObservedInitialViewport({
        missingPrefixSeconds: 90,
        userHasNavigated: false,
        alreadyAppliedForStream: false,
      }),
    ).toBe(false)
  })
})

describe('PartialCoverageOpensObservedViewportAndFullShowsGaps', () => {
  it('starts at the first observed row and restores the full wall-time domain explicitly', () => {
    const rollups = [
      { offsetSeconds: 0, missing: true },
      { offsetSeconds: 60, missing: true },
      { offsetSeconds: 12 * 60, missing: false },
      { offsetSeconds: 13 * 60 },
    ]

    expect(firstObservedOffsetSeconds(rollups)).toBe(12 * 60)
    expect(observedViewport(rollups, 60 * 60)).toEqual({
      startSeconds: 12 * 60,
      endSeconds: 60 * 60,
    })
    expect(fullStreamWithGapsViewport(60 * 60)).toEqual({
      startSeconds: 0,
      endSeconds: 60 * 60,
    })
  })
})
