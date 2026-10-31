import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeActivity, type ActivitySummary } from '../src/lib/hubActivitySummary'
import {
  HUB_ACTIVITY_REASON_PORTAL_STAND_IN,
  hubActivityHonestyDetail,
  hubActivityStandInLine,
  isHubActivityBackendFallback,
  isHubActivityLivePoolFallback,
  isHubActivityStandIn,
} from '../src/lib/hubActivityHonesty'
import { hubActivityFallbackLine } from '../src/lib/hubActivityFallbackLine'
import { normalizePublicHub, type HubActivity, type HubCorpusPipeline, type HubIngest, type PublicHub } from '../src/lib/publicHub'
import { resetHubBucketSelectionForTests } from '../src/lib/hubBucketSelection'
import { HubActivityPanelV5 } from '../src/ui/components/analytics/HubActivityPanelV5'
import { HubDataHealthBanner } from '../src/ui/components/hub/HubDataHealthBanner'

afterEach(() => {
  cleanup()
  resetHubBucketSelectionForTests()
})

// The hub's 24h answer of 2026-10-30: the backend served its 30-minute live-pool fallback, ingest operational.
const down = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8')))
const backendFallback: HubActivity = down.activity
/** The portal's own 30m read standing in for 24h (usePublicHubData recentForRequestedWindow). */
const standIn: HubActivity = { ...down.activity, reason: HUB_ACTIVITY_REASON_PORTAL_STAND_IN }
const ingest = down.ingest!
const lagging: HubIngest = { ...ingest, state: 'admit_lag' }
/** Any chat or ingest health claim: the hub makes none (CX-1 fix, 10-30). */
const HEALTH_CLAIM = /Chat is still being counted|collection is fine|chat is fine/i

describe('the portal stand-in is its own state (IRC-10 fix, 10-30)', () => {
  it('is a live-pool view but not the backend fallback', () => {
    expect(backendFallback.reason).toBe('historical_projection_unavailable')
    expect(isHubActivityLivePoolFallback(standIn)).toBe(true)
    expect(isHubActivityStandIn(standIn)).toBe(true)
    expect(isHubActivityBackendFallback(standIn)).toBe(false)
    expect(isHubActivityStandIn(backendFallback)).toBe(false)
    expect(isHubActivityBackendFallback(backendFallback)).toBe(true)
  })

  it('says loading or did not load, never the backend reason', () => {
    expect(hubActivityStandInLine(standIn, true)).toBe('Loading 24h… showing the last 30 minutes meanwhile')
    expect(hubActivityStandInLine(standIn, false)).toBe("24h didn't load. Showing the last 30 minutes.")
    expect(hubActivityStandInLine({ ...standIn, windowMinutes: 7 * 1440, requestedWindowMinutes: 7 * 1440 }, true)).toBe('Loading 7d… showing the last 30 minutes meanwhile')
    expect(hubActivityStandInLine(backendFallback, false)).toBeNull()
    expect(hubActivityHonestyDetail(standIn)).not.toMatch(/projection unavailable|history is behind/i)
    expect(hubActivityHonestyDetail(backendFallback)).toMatch(/projection unavailable/)
  })
})

describe('the backend fallback line (IRC-2 candidate, pick A, 10-30)', () => {
  it('says history is behind and what is shown, with no chat health claim', () => {
    expect(hubActivityFallbackLine(backendFallback)).toBe('24-hour history is behind right now. Showing the last 30 minutes, live.')
    expect(hubActivityFallbackLine({ ...backendFallback, windowMinutes: 10080, requestedWindowMinutes: 10080 })).toBe('7-day history is behind right now. Showing the last 30 minutes, live.')
    expect(hubActivityFallbackLine(standIn)).toBeNull()
  })
})

function panel(activity: HubActivity, props: { activityRefreshing?: boolean; hubIngest?: HubIngest | undefined } = {}) {
  const hub: PublicHub = { ...down, activity, ingest: 'hubIngest' in props ? props.hubIngest : ingest }
  return render(<MemoryRouter>
    <HubActivityPanelV5
      hub={hub}
      activitySummary={summarizeActivity(hub.activity.points, 30, 0)}
      suggestions={[]}
      loading={false}
      activityRefreshing={props.activityRefreshing}
    />
  </MemoryRouter>)
}

describe('HubActivityPanelV5 under a fallback (10-30)', () => {
  it('shows the history-behind line under the header for the backend fallback (candidate)', () => {
    const view = panel(backendFallback)
    expect(screen.getByText('24-hour history is behind right now. Showing the last 30 minutes, live.')).toBeTruthy()
    expect(view.container.textContent).not.toMatch(HEALTH_CLAIM)
  })

  it('says the same whatever ingest reports (candidate)', () => {
    const view = panel(backendFallback, { hubIngest: lagging })
    expect(screen.getByText('24-hour history is behind right now. Showing the last 30 minutes, live.')).toBeTruthy()
    expect(view.container.textContent).not.toMatch(HEALTH_CLAIM)
  })

  it('says the stand-in is loading or did not load, and never claims the backend reason (fix)', () => {
    const loading = panel(standIn, { activityRefreshing: true })
    expect(screen.getByText('Loading 24h… showing the last 30 minutes meanwhile')).toBeTruthy()
    expect(loading.container.textContent).not.toMatch(/projection is unavailable|projection unavailable|history is behind/i)
    loading.unmount()
    const failed = panel(standIn)
    expect(screen.getByText("24h didn't load. Showing the last 30 minutes.")).toBeTruthy()
    expect(failed.container.textContent).not.toMatch(/projection is unavailable|projection unavailable|history is behind/i)
  })
})

const summary: ActivitySummary = {
  pointCount: 12, expectedBuckets: 12, missingBuckets: 0, coveragePct: 100,
  nonZeroCount: 8, gapCount: 0, bucketMinutes: 1, windowLabel: '30 minutes', footnote: '',
}
const pipeline = { state: 'degraded', collectorMax: 500, roster: { collectorTracking: 500, expectedCollectorRows: 500 } } as HubCorpusPipeline

function banner(coverageState = 'degraded') {
  return render(<HubDataHealthBanner hubEndpointOk activitySummary={summary} pipeline={pipeline} liveRosterCount={500}
    coverageState={coverageState} />)
}

// The banner takes no activity or ingest: a backend fallback never changes its coverage line (CX-1 fix, 10-30).
// The history-behind line lives under the activity header only.
describe('HubDataHealthBanner under the backend fallback (CX-1 fix, 10-30)', () => {
  it('keeps the degraded line and makes no chat health claim', () => {
    const view = banner()
    expect(screen.getByText('Tracking or coverage is degraded in this snapshot — analytics may be incomplete.')).toBeTruthy()
    expect(view.container.textContent).not.toMatch(HEALTH_CLAIM)
    expect(view.container.textContent).not.toMatch(/history is behind/i)
  })

  it('leaves a critical snapshot alone', () => {
    banner('critical')
    expect(screen.getByText(/Tracking or coverage is critical/)).toBeTruthy()
  })
})
