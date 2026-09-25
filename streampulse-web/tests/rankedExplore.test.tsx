import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as transport from '../src/lib/discoveryCatalogue'
import * as availabilityTransport from '../src/lib/discoveryAvailability'
import { RankedExploreControls } from '../src/ui/components/moments/RankedExploreControls'
import { normalizeApiError } from '../src/lib/apiClient'
import { usePublicHubData } from '../src/hooks/usePublicHubData'
import { useRankedRetention } from '../src/hooks/useDiscoveryCatalogue'

vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (rows: unknown) => rows }))
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: vi.fn(() => ({ data: null, loading: false })) }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
function emptyVolume(scope: transport.RankedScope, indexedRetentionStart: string | null, freshness: 'ready' | 'stale' = 'ready'): transport.RankedDiscovery {
  const asOf = new Date().toISOString()
  return { state: 'ready', sort: 'volume', from: scope.from, to: scope.to, creator: scope.creator, category: null, categoryMissing: false,
    asOf, rankingVersion: 'volume-observed-irc-v1', items: [], facets: [], nextCursor: null,
    coverage: { state: 'none', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 0, measuredMinutes: 0 },
    eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 0, rankedDetections: 0, excludedDetections: 0 },
    freshness, projectionUpdatedAt: null, dataThrough: null, indexedRetentionStart, indexedRetentionAttestedAt: asOf,
    certifiedThroughExclusive: new Date().toISOString().slice(0, 10), certificateGeneration: 1 }
}
function certifiedAvailability(from: string): availabilityTransport.RankedAvailability {
  const asOf = new Date().toISOString()
  const serverToday = asOf.slice(0, 10)
  const days = Array.from({ length: (Date.parse(serverToday) - Date.parse(from)) / 86_400_000 }, (_, index) => ({
    day: new Date(Date.parse(from) + index * 86_400_000).toISOString().slice(0, 10),
    state: 'no_measurement' as const, coverage: 'none' as const, streams: 0, measuredStreamMinutes: 0,
    chatMessages: null, emoteUses: null, detections: null,
  }))
  return { asOf, serverToday, certifiedFrom: from, certifiedThroughExclusive: serverToday,
    verifiedAt: asOf, certificateGeneration: 1, login: '', days }
}
afterEach(async () => {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  vi.restoreAllMocks()
})
it('defaults to Latest without requesting undeployed ranked discovery', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockRejectedValue(normalizeApiError(404, { error: '404 page not found' }))
  render(<MemoryRouter initialEntries={['/analytics/moments']}><AnalyticsMomentsPage /></MemoryRouter>)
  expect(screen.getByRole('tab', { name: 'Latest' }).getAttribute('aria-selected')).toBe('true')
  expect(usePublicHubData).toHaveBeenLastCalledWith({ enabled: true, activityWindow: '30m', projection: 'moments' })
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.queryByText('Top measured moments')).toBeNull()
})
it('keeps explicit Explore and distinguishes 503 from empty with visible reset and filters', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(503, { error: 'discovery_unavailable' }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=explore']}><AnalyticsMomentsPage /></MemoryRouter>)
  await waitFor(() => expect(screen.getByRole('tab', { name: 'Explore' }).getAttribute('aria-selected')).toBe('true'))
  await screen.findByRole('heading', { name: 'Ranked moments unavailable' })
  expect(screen.getByText(/certified date range is temporarily unavailable/)).toBeTruthy()
  expect(screen.queryByText(/No ranked moments/)).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Most active detected moments' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Reset Explore' })).toBeTruthy()
  expect(screen.getByLabelText('Period')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Reset Explore' }))
})
it('reports undeployed Explore on plain-text 404 and offers a working Latest route', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(404, { error: '404 page not found\n' }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=explore&period=latest']}><AnalyticsMomentsPage /></MemoryRouter>)
  await screen.findByText(/Ranked history is not deployed on this server yet/)
  expect(screen.queryByText(/No ranked moments/)).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Browse Latest moments' }))
  expect(screen.getByRole('tab', { name: 'Latest' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.queryByLabelText('Ranked order')).toBeNull()
  fireEvent.click(screen.getByRole('tab', { name: 'Explore' }))
  expect(screen.getByRole('tab', { name: 'Explore' }).getAttribute('aria-selected')).toBe('true')
  await screen.findByText(/Ranked history is not deployed on this server yet/)
})
it('hides filters that cannot apply when ranked Explore is not deployed', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(404, { error: '404 page not found' }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=explore']}><AnalyticsMomentsPage /></MemoryRouter>)
  await screen.findByText(/Ranked history is not deployed on this server yet/)
  expect(screen.queryByLabelText('Period')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reset Explore' })).toBeNull()
  expect(screen.queryByText(/Checking certified dates/)).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Browse categories' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Reload collection' })).toBeTruthy()
})
it('routes empty Saved discovery to Latest', () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  render(<MemoryRouter initialEntries={['/analytics/moments?view=saved']}><AnalyticsMomentsPage /></MemoryRouter>)
  fireEvent.click(screen.getByRole('button', { name: 'Find moments to save' }))
  expect(screen.getByRole('tab', { name: 'Latest' }).getAttribute('aria-selected')).toBe('true')
})
it('offers Latest when History is unavailable instead of treating it as empty', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(503, { error: 'discovery_unavailable' }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=history']}><AnalyticsMomentsPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'History unavailable' })
  expect(screen.getByText(/certified date range is temporarily unavailable/)).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'Most active detected moments' })).toBeNull()
  fireEvent.click(screen.getByRole('link', { name: 'Browse Latest moments' }))
  expect(screen.getByRole('tab', { name: 'Latest' }).getAttribute('aria-selected')).toBe('true')
})
it('names ranked discovery rather than Explore when History receives a 404', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(404, { error: '404 page not found' }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=history']}><AnalyticsMomentsPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'History unavailable' })
  expect(screen.getByText(/Ranked history is not deployed on this server yet/)).toBeTruthy()
  expect(screen.queryByText(/Ranked Explore is not deployed/)).toBeNull()
})
it('keeps ranked reads closed while the certificate is unavailable', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const availability = vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockRejectedValue(normalizeApiError(503, { error: 'discovery_unavailable' }))
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementation(async scope => emptyVolume(scope, null))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=explore&period=last7']}><AnalyticsMomentsPage /></MemoryRouter>)
  await screen.findByRole('heading', { name: 'Ranked moments unavailable' })
  expect(availability).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
  expect(screen.queryByText(/No indexed measurement in this selection/)).toBeNull()
})
it('uses certified bounds before requesting a wider Explore collection', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const today = new Date().toISOString().slice(0, 10)
  const boundary = new Date(Date.parse(today) - 5 * 86_400_000).toISOString().slice(0, 10)
  const latestDay = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10)
  const availability = vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockResolvedValue(certifiedAvailability(boundary))
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementation(async scope => emptyVolume(scope, boundary))
  render(<MemoryRouter initialEntries={[`/analytics/moments?view=explore&period=custom&from=${boundary}&to=${latestDay}`]}><AnalyticsMomentsPage /></MemoryRouter>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  expect(availability).toHaveBeenCalledWith('', expect.any(AbortSignal))
  expect(fetch.mock.calls[0][0]).toMatchObject({ from: boundary, to: today, sort: 'volume' })
  expect(screen.getByText(/Snapshot:/).textContent).toContain(boundary)
})
it('hides certified History days when the ranked certificate generation differs', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const today = new Date().toISOString().slice(0, 10)
  const boundary = new Date(Date.parse(today) - 5 * 86_400_000).toISOString().slice(0, 10)
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockResolvedValue(certifiedAvailability(boundary))
  vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementation(async scope => ({ ...emptyVolume(scope, boundary), certificateGeneration: 2 }))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=history']}><AnalyticsMomentsPage /></MemoryRouter>)
  await screen.findByText(/Ranked response could not be verified/)
  expect(screen.getByText(/Certified calendar hidden/)).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Recent activity overview' })).toBeNull()
})
it('keeps a valid checked range visible while a routine recheck is in flight', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const boundary = new Date(Date.parse(today) - 5 * 86_400_000).toISOString().slice(0, 10)
  let resolve!: (value: availabilityTransport.RankedAvailability) => void
  const fetch = vi.spyOn(availabilityTransport, 'fetchRankedAvailability')
    .mockImplementationOnce(async () => certifiedAvailability(boundary))
    .mockImplementationOnce(() => new Promise(response => { resolve = response }))
  const { result } = renderHook(() => useRankedRetention(true))
  await waitFor(() => expect(result.current.from).toBe(boundary))
  act(() => result.current.refresh())
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(result.current.rechecking).toBe(true)
  expect(result.current.loading).toBe(false)
  expect(result.current.from).toBe(boundary)
  await act(async () => resolve(certifiedAvailability(boundary)))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.from).toBe(boundary)
})
it('shows full selected eligibility counts without confusing excluded detections with loaded rows', () => {
  const data = { asOf: '2026-09-13T12:00:00Z', from: '2026-09-13', to: '2026-09-14', creator: '', category: null, categoryMissing: false,
    freshness: 'ready', coverage: { state: 'partial', indexedStreams: 2, measuredMinutes: 4 }, facets: [], items: [{ key: 'one' }],
    eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 60, rankedDetections: 52, excludedDetections: 8 },
  } as unknown as transport.RankedDiscovery
  render(<RankedExploreControls params={new URLSearchParams()} now={new Date('2026-09-13T12:00:00Z')} data={data} loading={false} retained={false} error="" invalid={false} onChange={() => {}} onReset={() => {}} onRefresh={() => {}} />)
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('60 matching detections')
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('1 of 52 ranked loaded')
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('8 excluded from volume ranking')
})
