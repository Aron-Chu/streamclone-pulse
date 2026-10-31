/**
 * The approved buckets rule (board pick 5, SITE.md #1): below 95% of the chart's buckets,
 * one grey line directly under the hub chart, "A few minutes are missing from this chart.";
 * at 95% or more, nothing; never an amber "Activity coverage ... buckets" row. It waits for the
 * read to settle, and stays out when the banner's gap row already says minutes are missing.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetHubBucketSelectionForTests } from '../src/lib/hubBucketSelection'
import { MINUTES_MISSING_NOTE, summarizeActivity } from '../src/lib/hubActivitySummary'
import { normalizePublicHub, type PublicHub } from '../src/lib/publicHub'
import AnalyticsHubV5Page from '../src/routes/analytics/AnalyticsHubV5Page'
import { HubActivityPanelV5 } from '../src/ui/components/analytics/HubActivityPanelV5'

const BUCKET = 6 * 60_000
/** jsdom has no layout: give every element a 1600 px box, as the chart tests do. */
const BOX_WIDTH = 1600

const hubState = vi.hoisted(() => ({
  data: null as PublicHub | null,
  loading: false,
  hubReadPending: false,
  hubReadLate: false,
}))

vi.mock('../src/hooks/usePublicHubData', () => ({
  usePublicHubData: () => ({
    data: hubState.data,
    loading: hubState.loading,
    refreshing: false,
    activityRefreshing: false,
    error: null,
    loadSource: 'full',
    hubEndpointOk: true,
    liveEmpty: false,
    lastUpdated: Date.now(),
    displayedSnapshotAt: Date.now(),
    lastSuccessfulPollAt: Date.now(),
    pollSequence: 1,
    pollAttempt: 0,
    cachedAt: null,
    hubReadPending: hubState.hubReadPending,
    hubReadLate: hubState.hubReadLate,
    refresh: vi.fn(),
  }),
}))

let clientWidth: PropertyDescriptor | undefined
beforeAll(() => {
  clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => BOX_WIDTH })
})
afterAll(() => {
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth)
})
beforeEach(() => {
  hubState.data = null
  hubState.loading = false
  hubState.hubReadPending = false
  hubState.hubReadLate = false
})
afterEach(() => {
  cleanup()
  resetHubBucketSelectionForTests()
})

/** A 24 h hub answer (240 buckets of 6 min) that keeps the buckets `keep` says. */
function hubWithBuckets(keep: (index: number) => boolean): PublicHub {
  const end = Math.floor(Date.now() / BUCKET) * BUCKET - BUCKET
  const points = Array.from({ length: 240 }, (_, index) => ({
    t: end - (239 - index) * BUCKET,
    chat: 600, seventv: 100, twitch: 40, bttv: 10, ffz: 5, emotes: 300, viewers: 1000,
    viewerContributors: 10, viewerExpectedContributors: 10, viewerCoverage: 'complete', bucketComplete: true,
    hasChatRollup: true, hasViewerRollup: true,
  })).filter((_, index) => keep(index))
  return normalizePublicHub({
    generatedAt: new Date().toISOString(),
    poolSize: 4,
    corpus: { streamsTracked: 10, momentsDetected: 4, chatMessagesProcessed: 1000, emotesIndexed: 100, vodsAnalyzed: 2 },
    coverage: { liveChannels: 4, trackingMax: 10, backfillActive: 0, backfillMax: 1, syncActive: 0, emotesIndexed: 100, databaseOk: true, state: 'operational' },
    // A healthy historical projection of the whole day, as the hub serves it; without these the chart window clamps to 30 min.
    activity: {
      points, windowMinutes: 1440, servedWindowMinutes: 1440, bucketMinutes: 6, channelCount: 4,
      source: 'historical_projection', state: 'healthy',
      availableWindowMinutes: 1440, accountedWindowMinutes: 1440, measuredWindowMinutes: 1440,
    },
    topEmotes: [], topMovers: [], liveChannels: [], moments: [], livePulseMoments: [],
  } as unknown as Parameters<typeof normalizePublicHub>[0])
}

const page = () => <MemoryRouter><AnalyticsHubV5Page /></MemoryRouter>

describe('the hub page: the grey note under the chart', () => {
  it('shows below 95%, directly under the chart, and no amber buckets row anywhere', async () => {
    hubState.data = hubWithBuckets((index) => index % 10 !== 5)
    const { container } = render(page())
    expect(await screen.findByRole('heading', { name: 'Find your streamer' })).toBeTruthy()
    const note = screen.getByTestId('hub-minutes-missing-note')
    expect(note.textContent).toBe(MINUTES_MISSING_NOTE)
    expect(note.previousElementSibling?.classList.contains('figma-global-activity__hub-chart')).toBe(true)
    expect(container.querySelector('.figma-global-activity')?.contains(note)).toBe(true)
    // Not in the health banner, which carries no buckets row at any coverage.
    expect(container.querySelector('.hx-health-banner')?.contains(note) ?? false).toBe(false)
    expect(container.textContent).not.toMatch(/Activity coverage|buckets missing|stored rollups/)
  })

  it('shows nothing at 95% or more', async () => {
    hubState.data = hubWithBuckets((index) => index % 48 !== 5)
    const { container } = render(page())
    expect(await screen.findByRole('heading', { name: 'Find your streamer' })).toBeTruthy()
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
    expect(container.textContent).not.toMatch(/Activity coverage|buckets missing|A few minutes/)
  })

  it('shows nothing when every bucket is there', async () => {
    hubState.data = hubWithBuckets(() => true)
    const { container } = render(page())
    expect(await screen.findByRole('heading', { name: 'Find your streamer' })).toBeTruthy()
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
    expect(container.textContent).not.toMatch(/Activity coverage|A few minutes/)
  })

  it('is not drawn on first paint', async () => {
    hubState.loading = true
    hubState.data = null
    render(page())
    expect(await screen.findByRole('heading', { name: 'Find your streamer' })).toBeTruthy()
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
  })

  it('waits while a slow read is still running, then appears when it settles', async () => {
    hubState.data = hubWithBuckets((index) => index % 10 !== 5)
    hubState.hubReadPending = true
    hubState.hubReadLate = true
    const view = render(page())
    expect(await screen.findByRole('heading', { name: 'Find your streamer' })).toBeTruthy()
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
    expect(screen.getByText(/Live data is slow/)).toBeTruthy()

    hubState.hubReadPending = false
    hubState.hubReadLate = false
    await act(async () => { view.rerender(page()) })
    expect(screen.getByTestId('hub-minutes-missing-note').textContent).toBe(MINUTES_MISSING_NOTE)
  })
})

describe('HubActivityPanelV5: the grey note', () => {
  const empty = normalizePublicHub(null)
  const hub = { ...empty, activity: { ...empty.activity, windowMinutes: 24 * 60 } }
  const panel = (props: { minutesMissingNote?: boolean; awaitingData?: boolean; unavailable?: boolean }) => render(
    <MemoryRouter>
      <HubActivityPanelV5
        hub={hub}
        activitySummary={summarizeActivity([], 30, 0)}
        suggestions={[]}
        loading={false}
        updatedAgo="2m ago"
        {...props}
      />
    </MemoryRouter>,
  )

  it('is the line right under the chart card, above the data age, in the existing grey caption style', () => {
    panel({ minutesMissingNote: true })
    const note = screen.getByTestId('hub-minutes-missing-note')
    expect(note.textContent).toBe('A few minutes are missing from this chart.')
    expect(note.previousElementSibling?.classList.contains('figma-global-activity__hub-chart')).toBe(true)
    expect(note.nextElementSibling).toBe(screen.getByTestId('hub-data-age'))
    expect(note.className).toBe('figma-global-activity__served-window')
  })

  it('is not drawn unless the page asks for it', () => {
    panel({})
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
  })

  it('is not drawn while the first reply is awaited, or when measurements are unavailable', () => {
    panel({ minutesMissingNote: true, awaitingData: true })
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
    cleanup()
    panel({ minutesMissingNote: true, unavailable: true })
    expect(screen.queryByTestId('hub-minutes-missing-note')).toBeNull()
  })
})
