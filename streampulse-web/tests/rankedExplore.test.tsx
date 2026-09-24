import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as transport from '../src/lib/discoveryCatalogue'
import { RankedExploreControls } from '../src/ui/components/moments/RankedExploreControls'
import { normalizeApiError } from '../src/lib/apiClient'
import { usePublicHubData } from '../src/hooks/usePublicHubData'

vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (rows: unknown) => rows }))
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: vi.fn(() => ({ data: null, loading: false })) }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
afterEach(async () => {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  vi.restoreAllMocks()
})
it('defaults to Latest without requesting undeployed ranked discovery', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockRejectedValue(normalizeApiError(404, { error: '404 page not found' }))
  render(<MemoryRouter initialEntries={['/analytics/moments']}><AnalyticsMomentsPage /></MemoryRouter>)
  expect(screen.getByRole('button', { name: 'Latest' }).getAttribute('aria-pressed')).toBe('true')
  expect(usePublicHubData).toHaveBeenLastCalledWith({ enabled: true, activityWindow: '30m' })
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.queryByText('Top measured moments')).toBeNull()
})
it('keeps explicit Explore and distinguishes 503 from empty with visible reset and filters', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(transport, 'fetchRankedDiscovery').mockRejectedValue(normalizeApiError(503, { error: 'discovery_unavailable' }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=explore']}><AnalyticsMomentsPage /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Explore' }).getAttribute('aria-pressed')).toBe('true'))
  await screen.findByRole('heading', { name: 'Ranked moments unavailable' })
  expect(screen.getByText(/HTTP 503/)).toBeTruthy()
  expect(screen.queryByText(/No ranked moments/)).toBeNull()
  expect(screen.getByRole('button', { name: 'Reset Explore' })).toBeTruthy()
  expect(screen.getByLabelText('Period')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Reset Explore' }))
})
it('reports undeployed Explore on plain-text 404 and offers a working Latest route', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(transport, 'fetchRankedDiscovery').mockRejectedValue(normalizeApiError(404, { error: '404 page not found\n' }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=explore&period=yesterday']}><AnalyticsMomentsPage /></MemoryRouter>)
  await screen.findByText(/not deployed on this server \(HTTP 404\)/)
  expect(screen.queryByText(/No ranked moments/)).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Browse Latest moments' }))
  expect(screen.getByRole('button', { name: 'Latest' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.queryByLabelText('Ranked order')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Explore' }))
  expect(screen.getByRole('button', { name: 'Explore' }).getAttribute('aria-pressed')).toBe('true')
  await screen.findByText(/not deployed on this server \(HTTP 404\)/)
})
it('routes empty Saved discovery to Latest', () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  render(<MemoryRouter initialEntries={['/analytics/moments?view=saved']}><AnalyticsMomentsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Find moments to save' }))
  expect(screen.getByRole('button', { name: 'Latest' }).getAttribute('aria-pressed')).toBe('true')
})
it('offers Latest when History is unavailable instead of treating it as empty', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(transport, 'fetchDiscoveryCatalogue').mockRejectedValue(normalizeApiError(503, { error: 'discovery_unavailable' }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=history']}><AnalyticsMomentsPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'History is temporarily unavailable' })
  fireEvent.click(screen.getByRole('link', { name: 'Browse Latest moments' }))
  expect(screen.getByRole('button', { name: 'Latest' }).getAttribute('aria-pressed')).toBe('true')
})
it('shows full selected eligibility counts without confusing excluded detections with loaded rows', () => {
  const data = { asOf: '2026-09-13T12:00:00Z', from: '2026-09-13', to: '2026-09-14', creator: '', category: null, categoryMissing: false,
    freshness: 'ready', coverage: { state: 'partial', indexedStreams: 2, measuredMinutes: 4 }, facets: [], items: [{ key: 'one' }],
    eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 60, rankedDetections: 52, excludedDetections: 8 },
  } as unknown as transport.RankedDiscovery
  render(<RankedExploreControls params={new URLSearchParams()} data={data} loading={false} retained={false} error="" invalid={false} onChange={() => {}} onReset={() => {}} onRefresh={() => {}} />)
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('60 matching detections')
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('1 of 52 ranked loaded')
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('8 excluded from comparable ranking')
})
