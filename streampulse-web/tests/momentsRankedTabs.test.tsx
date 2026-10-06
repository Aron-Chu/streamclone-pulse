import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as availabilityTransport from '../src/lib/discoveryAvailability'
import { normalizeApiError } from '../src/lib/apiClient'
import { clearRankedFeatureCheckForTests, RANKED_FEATURE_CHECK_DELAY_MS } from '../src/hooks/useRankedFeatureAvailability'

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
async function passCheckDelay() {
  await act(async () => { await vi.advanceTimersByTimeAsync(RANKED_FEATURE_CHECK_DELAY_MS) })
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
  clearRankedFeatureCheckForTests()
})

it('keeps Latest free of discovery reads and hides ranked tabs while the deferred check is pending', async () => {
  const availability = vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockReturnValue(new Promise(() => {}))
  renderMoments()
  expect(screen.getByRole('tab', { name: 'Latest' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('link', { name: 'All xQc broadcasts' }).getAttribute('href')).toBe('/analytics/xqc')
  expect(availability).not.toHaveBeenCalled()
  expect(tabNames()).toEqual(['Latest', 'Saved (0)'])
  await passCheckDelay()
  expect(availability).toHaveBeenCalledTimes(1)
  expect(availability).toHaveBeenCalledWith('', expect.any(AbortSignal))
  expect(tabNames()).toEqual(['Latest', 'Saved (0)'])
  expect(document.querySelector('.moments-tabs')?.className).toBe('moments-tabs moments-tabs-two')
})

it('hides Explore, History and History links when the ranked backend is not deployed', async () => {
  const availability = vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(404, { error: '404 page not found' }))
  const { unmount } = renderMoments()
  await passCheckDelay()
  expect(availability).toHaveBeenCalledTimes(1)
  expect(tabNames()).toEqual(['Latest', 'Saved (0)'])
  expect(screen.queryByRole('link', { name: 'History' })).toBeNull()
  expect(screen.getByText(/A detection may be older than the chart range\.$/)).toBeTruthy()
  expect(screen.getByRole('link', { name: 'All xQc broadcasts' }).getAttribute('href')).toBe('/analytics/xqc')
  // Once per session: a later visit reuses the answer without another read.
  unmount()
  renderMoments('/analytics/moments?view=saved')
  await passCheckDelay()
  expect(availability).toHaveBeenCalledTimes(1)
  expect(tabNames()).toEqual(['Latest', 'Saved (0)'])
})

it('brings all four tabs back when ranked availability is ready', async () => {
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockResolvedValue(certifiedAvailability())
  renderMoments()
  await passCheckDelay()
  await waitFor(() => expect(tabNames()).toEqual(['Explore', 'Latest', 'History', 'Saved (0)']))
  expect(document.querySelector('.moments-tabs')?.className).toBe('moments-tabs moments-tabs-four')
  expect(screen.getByRole('link', { name: 'History' }).getAttribute('href')).toBe('/analytics/moments?view=history')
  expect(screen.getByRole('link', { name: 'Browse xQc history' }).getAttribute('href')).toBe('/analytics/moments?view=history&scope=creator&creator=xqc')
})

it('keeps the ranked tabs when the feature exists but is down', async () => {
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(503, { error: 'discovery_unavailable' }))
  renderMoments('/analytics/moments?view=saved')
  expect(tabNames()).toEqual(['Latest', 'Saved (0)'])
  await passCheckDelay()
  await waitFor(() => expect(tabNames()).toEqual(['Explore', 'Latest', 'History', 'Saved (0)']))
})

it('keeps a bookmarked History tab and its not-deployed panel without a second availability read', async () => {
  const availability = vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(404, { error: '404 page not found' }))
  renderMoments('/analytics/moments?view=history')
  await screen.findByText(/Ranked history is not deployed on this server yet/)
  expect(screen.getByRole('link', { name: 'Browse Latest moments' }).getAttribute('href')).toBe('/analytics/moments?view=recent')
  expect(tabNames()).toEqual(['Latest', 'History', 'Saved (0)'])
  expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true')
  expect(document.querySelector('.moments-tabs')?.className).toBe('moments-tabs')
  await passCheckDelay()
  expect(availability).toHaveBeenCalledTimes(1)
})
