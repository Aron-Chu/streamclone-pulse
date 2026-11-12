import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ActivitySummary } from '../src/lib/hubActivitySummary'
import type { HubCorpusPipeline } from '../src/lib/publicHub'
import { HubDataHealthBanner } from '../src/ui/components/hub/HubDataHealthBanner'

const activity: ActivitySummary = {
  pointCount: 11, expectedBuckets: 12, missingBuckets: 1, coveragePct: 92,
  nonZeroCount: 8, gapCount: 0, bucketMinutes: 1, windowLabel: '30 minutes', footnote: '',
}
const healthyPipeline = {
  state: 'operational', collectorMax: 500, roster: { collectorTracking: 500, expectedCollectorRows: 500 },
} as HubCorpusPipeline

function banner(state?: string, extra: { error?: string; loading?: boolean; pending?: boolean; late?: boolean; loadSource?: 'cache' } = {}) {
  return <HubDataHealthBanner hubEndpointOk activitySummary={activity} pipeline={healthyPipeline}
    liveRosterCount={500} coverageState={state} {...extra} />
}

describe('hub coverage state disclosure', () => {
  it.each([
    ['critical', 'Tracking or coverage is critical'],
    ['degraded', 'Tracking or coverage is degraded'],
    ['future-state', 'Coverage status is unknown'],
  ])('shows %s coverage even with a healthy pipeline', (state, message) => {
    render(banner(state))
    expect(screen.getByText(new RegExp(message)).textContent).toContain('in this snapshot')
  })

  it('keeps the coverage warning visible alongside a refresh error', () => {
    render(banner('critical', { error: 'Request failed', loadSource: 'cache' }))
    expect(screen.getByText(/Tracking or coverage is critical/)).toBeTruthy()
    expect(screen.getByText(/Could not refresh hub data/)).toBeTruthy()
  })

  it('keeps saved-copy coverage visible throughout a pending slow refresh', () => {
    render(banner('critical', { loadSource: 'cache', pending: true, late: true }))
    expect(screen.getByText(/Tracking or coverage is critical/)).toBeTruthy()
    expect(screen.getByText(/Live data is slow/)).toBeTruthy()
  })

  it.each(['unknown', 'future-state'])('discloses %s pipeline health despite operational coverage and a populated roster', (state) => {
    const pipeline = { ...healthyPipeline, state }
    render(<HubDataHealthBanner hubEndpointOk activitySummary={activity} pipeline={pipeline}
      liveRosterCount={500} coverageState="operational" />)
    expect(screen.getByText(/Tracking status is unknown/)).toBeTruthy()
    expect(screen.queryByText(/Coverage was operational/)).toBeNull()
  })

  it('does not infer operational coverage or limited tracking from an absent pipeline', () => {
    const pipeline = { ...healthyPipeline, available: false, state: 'unknown', roster: { collectorTracking: 0, expectedCollectorRows: 0 } } as HubCorpusPipeline
    render(<HubDataHealthBanner hubEndpointOk activitySummary={activity} pipeline={pipeline}
      liveRosterCount={0} coverageState="operational" />)
    expect(screen.getByText(/Tracking status is unknown/)).toBeTruthy()
    expect(screen.queryByText(/Coverage was operational/)).toBeNull()
    expect(screen.queryByText(/Live tracking is limited/)).toBeNull()
  })

  it('retains snapshot coverage but suppresses an earlier error and retry while a late read is pending', () => {
    const retry = vi.fn()
    const view = render(<HubDataHealthBanner hubEndpointOk activitySummary={activity} pipeline={healthyPipeline}
      liveRosterCount={500} coverageState="critical" loadSource="cache" error="Previous read failed"
      pending late retryDisabled onRetry={retry} />)
    expect(screen.getByText(/Tracking or coverage is critical/)).toBeTruthy()
    expect(screen.getByText(/Live data is slow/)).toBeTruthy()
    expect(screen.queryByText(/Could not refresh hub data/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull()
    view.rerender(<HubDataHealthBanner hubEndpointOk activitySummary={activity} pipeline={healthyPipeline}
      liveRosterCount={500} coverageState="critical" loadSource="cache" error="Previous read failed"
      onRetry={retry} />)
    expect(screen.getByText(/Could not refresh hub data/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('does not show the unknown pipeline warning before a measured snapshot exists', () => {
    const pipeline = { ...healthyPipeline, state: 'unknown' }
    render(<HubDataHealthBanner hubEndpointOk activitySummary={activity} pipeline={pipeline}
      liveRosterCount={500} />)
    expect(screen.queryByText(/Tracking status is unknown/)).toBeNull()
  })

  it('says nothing for operational coverage', () => {
    const view = render(banner('operational'))
    expect(screen.queryByText(/Coverage was operational/)).toBeNull()
    expect(view.container.querySelector('.hx-health-banner')).toBeNull()
  })

  it('hides a degraded row while under 1% of the minutes are missing, and keeps critical', () => {
    const nearlyAll = { ...activity, pointCount: 1438, expectedBuckets: 1440, missingBuckets: 2, coveragePct: 99.9 }
    const view = render(<HubDataHealthBanner hubEndpointOk activitySummary={nearlyAll} pipeline={healthyPipeline}
      liveRosterCount={500} coverageState="degraded" />)
    expect(screen.queryByText(/Tracking or coverage is degraded/)).toBeNull()
    view.rerender(<HubDataHealthBanner hubEndpointOk activitySummary={{ ...nearlyAll, pointCount: 1420, missingBuckets: 20 }}
      pipeline={healthyPipeline} liveRosterCount={500} coverageState="degraded" />)
    expect(screen.getByText(/Tracking or coverage is degraded/)).toBeTruthy()
    view.rerender(<HubDataHealthBanner hubEndpointOk activitySummary={nearlyAll} pipeline={healthyPipeline}
      liveRosterCount={500} coverageState="critical" />)
    expect(screen.getByText(/Tracking or coverage is critical/)).toBeTruthy()
  })

  it('does not report operational coverage when the displayed database check failed', () => {
    render(<HubDataHealthBanner hubEndpointOk activitySummary={activity} pipeline={healthyPipeline}
      liveRosterCount={500} coverageState="operational" coverageDatabaseOk={false} />)
    expect(screen.getByText(/Database check failed in this snapshot/)).toBeTruthy()
    expect(screen.queryByText(/Coverage was operational/)).toBeNull()
  })

  it('does not invent a warning for missing or initially loading data', () => {
    const view = render(banner(undefined))
    expect(screen.queryByText(/Tracking or coverage is|Coverage status is unknown/)).toBeNull()
    view.rerender(banner(undefined))
    expect(screen.queryByText(/Tracking or coverage is|Coverage status is unknown/)).toBeNull()
    view.rerender(banner('critical', { loading: true }))
    expect(screen.queryByText(/Tracking or coverage is critical/)).toBeNull()
  })
})
