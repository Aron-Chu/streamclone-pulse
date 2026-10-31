import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  MINUTES_MISSING_NOTE,
  QUIET_COVERAGE_RATIO,
  isQuietCoverage,
  showsMinutesMissingNote,
  type ActivitySummary,
} from '../src/lib/hubActivitySummary'
import type { HubCorpusPipeline } from '../src/lib/publicHub'
import { HubDataHealthBanner } from '../src/ui/components/hub/HubDataHealthBanner'

function summary(pointCount: number, expectedBuckets: number, extra: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    pointCount,
    expectedBuckets,
    missingBuckets: Math.max(0, expectedBuckets - pointCount),
    coveragePct: expectedBuckets > 0 ? (pointCount / expectedBuckets) * 100 : 0,
    nonZeroCount: pointCount,
    gapCount: 0,
    bucketMinutes: 1,
    windowLabel: '4 hours',
    footnote: '',
    ...extra,
  }
}

const healthyPipeline = {
  state: 'operational', collectorMax: 500, roster: { collectorTracking: 500, expectedCollectorRows: 500 },
} as HubCorpusPipeline

function banner(activity: ActivitySummary, props: Partial<Parameters<typeof HubDataHealthBanner>[0]> = {}) {
  return render(
    <HubDataHealthBanner hubEndpointOk activitySummary={activity} pipeline={healthyPipeline}
      liveRosterCount={500} {...props} />,
  )
}

// The approved rule (board pick 5): the buckets line shows only below 95%, as one grey line
// under the chart. The health banner never carries a buckets row, amber or grey.
describe('hub banner: no buckets row at any coverage', () => {
  it.each([
    ['99.5%', 239, 240],
    ['exactly 95%', 228, 240],
    ['94.6%', 227, 240],
    ['41.6%', 100, 240],
  ])('says nothing about buckets at %s', (_label, points, expected) => {
    const { container } = banner(summary(points, expected))
    expect(container.firstChild).toBeNull()
    expect(screen.queryByText(/Activity coverage/)).toBeNull()
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
  })

  it('carries no buckets or rollups wording beside the rows it still has', () => {
    const { container } = banner(summary(100, 240), { coverageState: 'degraded' })
    expect(screen.getByText(/Tracking or coverage is degraded in this snapshot/)).toBeTruthy()
    expect(container.textContent).not.toMatch(/bucket|rollup|Activity coverage|A few minutes/i)
    expect(container.querySelector('.hx-health-banner__row--warn')).not.toBeNull()
  })

  it('keeps the degraded title when pipeline state alone sets it', () => {
    banner(summary(239, 240), { coverageState: 'degraded' })
    expect(screen.getByText(/Tracking or coverage is degraded in this snapshot/)).toBeTruthy()
  })

  it('keeps the critical coverage line and the limited-tracking warning', () => {
    const critical = { ...healthyPipeline, state: 'critical', roster: { collectorTracking: 0, expectedCollectorRows: 500 } } as HubCorpusPipeline
    banner(summary(239, 240), { coverageState: 'critical', pipeline: critical })
    expect(screen.getByText(/Tracking or coverage is critical in this snapshot/)).toBeTruthy()
    expect(screen.getByText(/Live tracking is limited/)).toBeTruthy()
  })

  it('keeps the error and fallback branches, with their retry', () => {
    banner(summary(100, 240), { error: 'Public hub unavailable', loadSource: 'cache', onRetry: () => {} })
    expect(screen.getByText(/Could not refresh hub data/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('keeps the stats-fallback branch', () => {
    banner(summary(100, 240), { loadSource: 'stats-fallback', hubEndpointOk: false })
    expect(screen.getByText(/Hub temporarily unavailable/)).toBeTruthy()
  })

  it('keeps the slow-read line', () => {
    banner(summary(100, 240), { coverageState: 'operational', pending: true, late: true })
    expect(screen.getByText(/Live data is slow/)).toBeTruthy()
  })

  it('keeps the gap line alone: with no buckets row there is nothing behind a "more" toggle', () => {
    banner(summary(100, 240, { gapCount: 1 }))
    expect(screen.getByText(/1 gap in this window/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
    expect(screen.queryByText(/Activity coverage/)).toBeNull()
  })
})

describe('the grey note under the chart: when it shows', () => {
  it('uses one threshold, 95%', () => {
    expect(QUIET_COVERAGE_RATIO).toBe(0.95)
    expect(isQuietCoverage(239, 240)).toBe(true)
    expect(isQuietCoverage(228, 240)).toBe(true)
    expect(isQuietCoverage(227, 240)).toBe(false)
    expect(isQuietCoverage(0, 0)).toBe(false)
  })

  it('says it in plain words', () => {
    expect(MINUTES_MISSING_NOTE).toBe('A few minutes are missing from this chart.')
  })

  it('shows below 95% once the read has settled', () => {
    expect(showsMinutesMissingNote(summary(227, 240), true)).toBe(true)
    expect(showsMinutesMissingNote(summary(100, 240), true)).toBe(true)
    expect(showsMinutesMissingNote(summary(1, 240), true)).toBe(true)
  })

  it('shows nothing at 95% or more, or when nothing is missing', () => {
    expect(showsMinutesMissingNote(summary(228, 240), true)).toBe(false)
    expect(showsMinutesMissingNote(summary(239, 240), true)).toBe(false)
    expect(showsMinutesMissingNote(summary(240, 240), true)).toBe(false)
  })

  it('never shows on first paint or while a read is still settling', () => {
    expect(showsMinutesMissingNote(summary(100, 240), false)).toBe(false)
  })

  it('stays out when the gap row already says minutes are missing', () => {
    expect(showsMinutesMissingNote(summary(100, 240, { gapCount: 1 }), true)).toBe(false)
  })

  it('does not call an empty chart "a few minutes", and ignores a window with no buckets', () => {
    expect(showsMinutesMissingNote(summary(0, 240), true)).toBe(false)
    expect(showsMinutesMissingNote(summary(0, 0), true)).toBe(false)
  })
})
