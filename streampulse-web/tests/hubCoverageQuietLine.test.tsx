import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ActivitySummary } from '../src/lib/hubActivitySummary'
import type { HubCorpusPipeline } from '../src/lib/publicHub'
import {
  HubDataHealthBanner,
  MINUTES_MISSING_NOTE,
  QUIET_COVERAGE_RATIO,
  isQuietCoverage,
} from '../src/ui/components/hub/HubDataHealthBanner'

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

describe('hub banner: the buckets line at 95% or more (quiet by default)', () => {
  it('uses one threshold that matches the audit', () => {
    expect(QUIET_COVERAGE_RATIO).toBe(0.95)
    expect(isQuietCoverage(239, 240)).toBe(true)
    expect(isQuietCoverage(228, 240)).toBe(true)
    expect(isQuietCoverage(227, 240)).toBe(false)
    expect(isQuietCoverage(0, 0)).toBe(false)
  })

  it('replaces the amber buckets warning at 239/240 with one grey line in plain words', () => {
    const { container } = banner(summary(239, 240))
    expect(screen.queryByText(/Activity coverage/)).toBeNull()
    expect(container.textContent).not.toMatch(/bucket|rollup/i)
    expect(container.querySelector('.hx-health-banner__row--warn')).toBeNull()
    const note = screen.getByTestId('hub-minutes-missing-note')
    expect(note.textContent).toBe(MINUTES_MISSING_NOTE)
    expect(note.className).toContain('hx-health-banner__row--info')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('still shows the amber buckets warning below 95%, unchanged', () => {
    const { container } = banner(summary(227, 240))
    expect(screen.getByText('Activity coverage 94.5% for this window (227/240 buckets).')).toBeTruthy()
    expect(container.querySelector('.hx-health-banner__row--warn')).not.toBeNull()
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
    expect(screen.getByText('13 buckets missing from stored rollups.')).toBeTruthy()
  })

  it('shows nothing when nothing is missing', () => {
    const { container } = banner(summary(240, 240))
    expect(container.firstChild).toBeNull()
  })

  it('does not paint the grey line while the first read is still loading', () => {
    const { container } = banner(summary(239, 240), { loading: true })
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
    expect(container.firstChild).toBeNull()
  })

  it('does not paint it during a slow read either, where the slow line speaks', () => {
    banner(summary(239, 240), { coverageState: 'operational', pending: true, late: true })
    expect(screen.getByText(/Live data is slow/)).toBeTruthy()
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
  })

  it('keeps the degraded title when pipeline state alone sets it', () => {
    banner(summary(239, 240), { coverageState: 'degraded' })
    expect(screen.getByText(/Tracking or coverage is degraded in this snapshot/)).toBeTruthy()
    expect(screen.getByTestId('hub-minutes-missing-note')).toBeTruthy()
    expect(screen.queryByText(/Activity coverage/)).toBeNull()
  })

  it('keeps the critical coverage line and the limited-tracking warning', () => {
    const critical = { ...healthyPipeline, state: 'critical', roster: { collectorTracking: 0, expectedCollectorRows: 500 } } as HubCorpusPipeline
    banner(summary(239, 240), { coverageState: 'critical', pipeline: critical })
    expect(screen.getByText(/Tracking or coverage is critical in this snapshot/)).toBeTruthy()
    expect(screen.getByText(/Live tracking is limited/)).toBeTruthy()
    expect(screen.getByTestId('hub-minutes-missing-note')).toBeTruthy()
  })

  it('keeps the error and fallback branches, with their retry', () => {
    banner(summary(239, 240), { error: 'Public hub unavailable', loadSource: 'cache', onRetry: () => {} })
    expect(screen.getByText(/Could not refresh hub data/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(screen.getByTestId('hub-minutes-missing-note')).toBeTruthy()
  })

  it('keeps the stats-fallback branch', () => {
    banner(summary(239, 240), { loadSource: 'stats-fallback', hubEndpointOk: false })
    expect(screen.getByText(/Hub temporarily unavailable/)).toBeTruthy()
  })

  it('keeps the gap line, and adds no second grey line about the same minutes', () => {
    banner(summary(239, 240, { gapCount: 2 }))
    expect(screen.getByText(/2 gaps in this window/)).toBeTruthy()
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
    expect(screen.queryByText(/Activity coverage/)).toBeNull()
  })

  it('keeps the gap line and the amber warning together below 95%', () => {
    banner(summary(100, 240, { gapCount: 1 }))
    expect(screen.getByText(/1 gap in this window/)).toBeTruthy()
    // The gap line is the primary row; the amber coverage line waits behind "1 more".
    fireEvent.click(screen.getByRole('button', { name: /1 more/ }))
    expect(screen.getByText(/Activity coverage 41.6% for this window/)).toBeTruthy()
  })
})
