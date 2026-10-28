import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as availabilityTransport from '../src/lib/discoveryAvailability'
import { normalizeApiError } from '../src/lib/apiClient'

vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (rows: unknown) => rows }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
// One stable hub result: a fresh object per render would re-run the feed effects forever.
const { hub } = vi.hoisted(() => ({ hub: {
  data: { generatedAt: new Date().toISOString(), livePulseMoments: [{ login: 'xqc', displayName: 'xQc', streamId: 's1', offsetSeconds: 60,
    label: 'Chat spike', kind: 'chat_spike', chatPerMin: 200, emotesPerMin: 40, category: 'Just Chatting', at: Date.now() - 60_000, score: 80 }] },
  loading: false, refreshing: false, error: null, loadSource: 'network', hubEndpointOk: true, refresh: () => {},
} }))
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: () => hub }))

function certifiedAvailability(): availabilityTransport.RankedAvailability {
  const asOf = new Date().toISOString()
  const today = asOf.slice(0, 10)
  return { asOf, serverToday: today, certifiedFrom: today, certifiedThroughExclusive: today, verifiedAt: asOf,
    certificateGeneration: 1, login: '', days: [] }
}
const tabNames = () => screen.getAllByRole('tab').map(tab => tab.textContent)
const renderMoments = (url = '/analytics/moments') => render(<MemoryRouter initialEntries={[url]}><AnalyticsMomentsPage /></MemoryRouter>)
/** Well past the 2 s the removed availability probe used to wait. */
async function passIdleTime() {
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
}

beforeEach(() => {
  // Real time keeps advancing so Testing Library's own zero-delay waits still run.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

it.each(['/analytics/moments', '/analytics/moments?view=saved'])('makes no ranked availability read and shows only Latest and Saved (%s)', async url => {
  const availability = vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockResolvedValue(certifiedAvailability())
  renderMoments(url)
  await passIdleTime()
  expect(availability).not.toHaveBeenCalled()
  expect(tabNames()).toEqual(['Latest', 'Saved (0)'])
  expect(document.querySelector('.moments-tabs')?.className).toBe('moments-tabs moments-tabs-two')
})

it('keeps Latest creator links on the stream console while History is hidden', async () => {
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockResolvedValue(certifiedAvailability())
  renderMoments()
  await passIdleTime()
  expect(screen.getByRole('tab', { name: 'Latest' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByRole('link', { name: 'History' })).toBeNull()
  expect(screen.getByText(/A detection may be older than the chart range\.$/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'All xQc broadcasts' }).getAttribute('href')).toBe('/analytics/xqc')
})

it('keeps a bookmarked History tab and its not-deployed panel with only its own availability read', async () => {
  const availability = vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(404, { error: '404 page not found' }))
  renderMoments('/analytics/moments?view=history')
  await screen.findByText(/Ranked history is not deployed on this server yet/)
  expect(screen.getByRole('link', { name: 'Browse Latest moments' }).getAttribute('href')).toBe('/analytics/moments?view=recent')
  expect(tabNames()).toEqual(['Latest', 'History', 'Saved (0)'])
  expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.moments-tabs')?.className).toBe('moments-tabs')
  await passIdleTime()
  expect(availability).toHaveBeenCalledTimes(1)
})
