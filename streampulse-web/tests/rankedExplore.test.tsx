import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as transport from '../src/lib/discoveryCatalogue'
import * as availabilityTransport from '../src/lib/discoveryAvailability'
import { RankedExploreControls } from '../src/ui/components/moments/RankedExploreControls'
import { normalizeApiError } from '../src/lib/apiClient'
import { usePublicHubData } from '../src/hooks/usePublicHubData'
import { useRankedRetention } from '../src/hooks/useDiscoveryCatalogue'
import { clearRankedFeatureCheckForTests } from '../src/hooks/useRankedFeatureAvailability'
import { CREATOR_COMMIT_DELAY_MS } from '../src/ui/components/moments/useCreatorDraft'

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
function NavigationLog({ entries }: { entries: { search: string; type: string }[] }) {
  const location = useLocation()
  const type = useNavigationType()
  useEffect(() => { entries.push({ search: location.search, type }) }, [location.key])
  return null
}
const PARTIAL_LOGINS = ['c', 'cr', 'cre', 'crea', 'creat', 'creato', 'creator']
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
afterEach(async () => {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  vi.restoreAllMocks()
  clearRankedFeatureCheckForTests()
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
  // The bookmarked view's 404 hides both ranked tabs for the rest of the session.
  expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Latest', 'Saved (0)'])
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
  render(<MemoryRouter><RankedExploreControls params={new URLSearchParams()} now={new Date('2026-09-13T12:00:00Z')} data={data} loading={false} retained={false} error="" invalid={false} onChange={() => {}} onReset={() => {}} onRefresh={() => {}} /></MemoryRouter>)
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('60 matching detections')
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('1 of 52 ranked loaded')
  expect(screen.getByLabelText('Selection eligibility').textContent).toContain('8 excluded from volume ranking')
})
it('applies a typed Explore creator once, replacing the URL entry instead of one per keystroke', async () => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const today = new Date().toISOString().slice(0, 10)
  const boundary = new Date(Date.parse(today) - 5 * 86_400_000).toISOString().slice(0, 10)
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockResolvedValue(certifiedAvailability(boundary))
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementation(async scope => emptyVolume(scope, boundary))
  const navigations: { search: string; type: string }[] = []
  render(<MemoryRouter initialEntries={['/analytics/moments?view=explore']}><AnalyticsMomentsPage /><NavigationLog entries={navigations} /></MemoryRouter>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  const input = screen.getByLabelText('Exact creator login') as HTMLInputElement
  input.focus()
  await act(nextFrame)
  navigations.length = 0
  scrollTo.mockClear()
  for (const value of PARTIAL_LOGINS) fireEvent.change(input, { target: { value } })
  expect(input.value).toBe('creator')
  expect(navigations).toEqual([])
  await act(() => new Promise(resolve => setTimeout(resolve, CREATOR_COMMIT_DELAY_MS + 50)))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(fetch.mock.calls.map(([scope]) => scope.creator)).toEqual(['', 'creator'])
  expect(navigations.map(entry => entry.type)).toEqual(['REPLACE'])
  expect(new URLSearchParams(navigations[0].search).get('creator')).toBe('creator')
  expect(document.activeElement).toBe(input)
  // Applied in place: the page keeps the reader's place instead of jumping to the top.
  await act(nextFrame)
  expect(scrollTo).not.toHaveBeenCalled()

  // Enter applies at once and cancels the pending pause.
  fireEvent.change(input, { target: { value: 'XQC' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(navigations.map(entry => new URLSearchParams(entry.search).get('creator'))).toEqual(['creator', 'xqc'])
  await act(() => new Promise(resolve => setTimeout(resolve, CREATOR_COMMIT_DELAY_MS + 50)))
  expect(navigations.map(entry => entry.type)).toEqual(['REPLACE', 'REPLACE'])

  // A reset from outside the field wins over the typed value and starts at the top.
  fireEvent.click(screen.getByRole('button', { name: 'Reset Explore' }))
  expect(input.value).toBe('')
  await waitFor(() => expect(screen.getByText(/Snapshot:/).textContent).toContain('All creators'))
  await act(nextFrame)
  expect(scrollTo).toHaveBeenLastCalledWith(0, 0)
})
it('drops a pending Explore creator when navigation from outside the field keeps the same login', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const today = new Date().toISOString().slice(0, 10)
  const boundary = new Date(Date.parse(today) - 5 * 86_400_000).toISOString().slice(0, 10)
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockResolvedValue(certifiedAvailability(boundary))
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementation(async scope => emptyVolume(scope, boundary))
  const navigations: { search: string; type: string }[] = []
  render(<MemoryRouter initialEntries={['/analytics/moments?view=explore']}><AnalyticsMomentsPage /><NavigationLog entries={navigations} /></MemoryRouter>)
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  const input = screen.getByLabelText('Exact creator login') as HTMLInputElement
  input.focus()
  navigations.length = 0
  fireEvent.change(input, { target: { value: 'abc' } })
  // A tap that leaves focus in the field (no blur) while the pause is pending.
  fireEvent.click(screen.getByRole('button', { name: 'Reset Explore' }))
  expect((screen.getByLabelText('Exact creator login') as HTMLInputElement).value).toBe('')
  await act(() => new Promise(resolve => setTimeout(resolve, CREATOR_COMMIT_DELAY_MS + 50)))
  expect(navigations.map(entry => new URLSearchParams(entry.search).get('creator'))).toEqual([null])
  expect((screen.getByLabelText('Exact creator login') as HTMLInputElement).value).toBe('')
  expect(fetch.mock.calls.map(([scope]) => scope.creator)).not.toContain('abc')
})
it('keeps the History creator field focused and its filters open and in place while a typed creator is checked', async () => {
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const today = new Date().toISOString().slice(0, 10)
  const boundary = new Date(Date.parse(today) - 5 * 86_400_000).toISOString().slice(0, 10)
  let releaseCreator!: (value: availabilityTransport.RankedAvailability) => void
  const availability = vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockImplementation(login => login
    ? new Promise(resolve => { releaseCreator = resolve })
    : Promise.resolve(certifiedAvailability(boundary)))
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementation(async scope => emptyVolume(scope, boundary))
  const navigations: { search: string; type: string }[] = []
  render(<MemoryRouter initialEntries={['/analytics/moments?view=history']}><AnalyticsMomentsPage /><NavigationLog entries={navigations} /></MemoryRouter>)
  const input = await screen.findByLabelText('History creator') as HTMLInputElement
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
  const filters = input.closest('details')!
  const overview = screen.getByRole('region', { name: 'Recent activity overview' })
  const results = screen.getByRole('region', { name: 'Moment results' })
  filters.open = true
  input.focus()
  await act(nextFrame)
  navigations.length = 0
  scrollTo.mockClear()
  for (const value of PARTIAL_LOGINS) {
    fireEvent.change(input, { target: { value } })
    expect(screen.getByLabelText('History creator')).toBe(input)
    expect(document.activeElement).toBe(input)
  }
  await act(() => new Promise(resolve => setTimeout(resolve, CREATOR_COMMIT_DELAY_MS + 50)))
  await waitFor(() => expect(availability).toHaveBeenCalledTimes(2))
  expect(availability.mock.calls.map(([login]) => login)).toEqual(['', 'creator'])
  expect(navigations.map(entry => entry.type)).toEqual(['REPLACE'])
  // While the new creator is checked, the last checked calendar stays in place (so
  // nothing above the open panel moves) and the check is announced below the panel.
  expect(screen.getByText('Checking certified dates…')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'Global moments' })).toBeTruthy()
  expect(screen.getByRole('region', { name: 'Recent activity overview' })).toBe(overview)
  expect(screen.queryByRole('heading', { name: 'History unavailable' })).toBeNull()
  // The results below keep their place too, holding the last ranking marked as retained.
  expect(screen.getByRole('region', { name: 'Moment results' })).toBe(results)
  expect(screen.getByText(/Previous volume ranking retained/).textContent).toContain('global')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(screen.getByLabelText('History creator')).toBe(input)
  expect(input.closest('details')).toBe(filters)
  expect(filters.open).toBe(true)
  expect(document.activeElement).toBe(input)
  await act(nextFrame)
  expect(scrollTo).not.toHaveBeenCalled()

  await act(async () => releaseCreator(certifiedAvailability(boundary)))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(fetch.mock.calls.map(([scope]) => scope.creator)).toEqual(['', 'creator'])
  expect(screen.getByRole('heading', { name: '@creator' })).toBeTruthy()
  expect(screen.queryByText('Checking certified dates…')).toBeNull()
  expect(screen.getByRole('region', { name: 'Recent activity overview' })).toBe(overview)
  expect(screen.getByLabelText('History creator')).toBe(input)
  expect(filters.open).toBe(true)
  expect(document.activeElement).toBe(input)
  expect(input.value).toBe('creator')
  await act(nextFrame)
  expect(scrollTo).not.toHaveBeenCalled()
})
it('does not bring back an old calendar or ranking when History is retried after a failed creator check', async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const today = new Date().toISOString().slice(0, 10)
  const boundary = new Date(Date.parse(today) - 5 * 86_400_000).toISOString().slice(0, 10)
  let creatorChecks = 0
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockImplementation(login => !login
    ? Promise.resolve(certifiedAvailability(boundary))
    : ++creatorChecks === 1 ? Promise.reject(normalizeApiError(503, { error: 'discovery_unavailable' })) : new Promise(() => {}))
  vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementation(async scope => emptyVolume(scope, boundary))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=history']}><AnalyticsMomentsPage /></MemoryRouter>)
  const input = await screen.findByLabelText('History creator') as HTMLInputElement
  await screen.findByRole('region', { name: 'Moment results' })
  fireEvent.change(input, { target: { value: 'creator' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await screen.findByRole('heading', { name: 'History unavailable' })
  expect(screen.getByLabelText('History creator')).toBe(input)
  expect(screen.queryByRole('region', { name: 'Recent activity overview' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Moment results' })).toBeNull()

  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }))
  await screen.findByRole('heading', { name: 'Checking certified dates…' })
  expect(creatorChecks).toBe(2)
  expect(screen.queryByRole('region', { name: 'Recent activity overview' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Moment results' })).toBeNull()
  expect(screen.queryByText(/Previous volume ranking retained/)).toBeNull()
  expect(screen.getByLabelText('History creator')).toBe(input)
})
function rankedRow(scope: transport.RankedScope, boundary: string): transport.RankedDiscovery {
  const login = scope.creator || 'globalrow'
  return { ...emptyVolume(scope, boundary), items: [{ key: `row-${login}`, detectionId: `row-${login}`, rank: 1, score: 2, at: Date.now() - 86_400_000,
    rankingVersion: 'volume-observed-irc-v1', scoreExplanation: 'Measured score', categoryMissing: false,
    login, streamId: 'stream1', offsetSeconds: 60, label: `${login} reaction`, provenance: 'hub' }] } as unknown as transport.RankedDiscovery
}
function TestBack() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(-1)}>Test back</button>
}
for (const path of ['History tab', 'Back'] as const) it(`does not show Explore rows under a History creator while that creator is checked again (${path})`, async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const today = new Date().toISOString().slice(0, 10)
  const boundary = new Date(Date.parse(today) - 5 * 86_400_000).toISOString().slice(0, 10)
  let creatorChecks = 0
  let releaseCreator!: (value: availabilityTransport.RankedAvailability) => void
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockImplementation(login => !login || ++creatorChecks === 1
    ? Promise.resolve(certifiedAvailability(boundary))
    : new Promise(resolve => { releaseCreator = resolve }))
  const fetch = vi.spyOn(transport, 'fetchRankedDiscovery').mockImplementation(async scope => rankedRow(scope, boundary))
  render(<MemoryRouter initialEntries={['/analytics/moments?view=history&scope=creator&creator=creator']}><AnalyticsMomentsPage /><TestBack /></MemoryRouter>)
  await screen.findByText('creator reaction')
  fireEvent.click(screen.getByRole('tab', { name: 'Explore' }))
  await screen.findByText('globalrow reaction')
  fireEvent.click(path === 'Back' ? screen.getByRole('button', { name: 'Test back' }) : screen.getByRole('tab', { name: 'History' }))
  await screen.findByRole('heading', { name: 'Checking certified dates…' })
  expect(creatorChecks).toBe(2)
  // Explore's ranking never stands in for the creator's while the creator's dates are checked.
  expect(screen.queryByRole('region', { name: 'Moment results' })).toBeNull()
  expect(screen.queryByText('globalrow reaction')).toBeNull()
  expect(fetch.mock.calls.map(([scope]) => scope.creator)).toEqual(['creator', ''])

  await act(async () => releaseCreator(certifiedAvailability(boundary)))
  await screen.findByText('creator reaction')
  expect(screen.getByRole('heading', { name: '@creator' })).toBeTruthy()
  expect(fetch.mock.calls.map(([scope]) => scope.creator)).toEqual(['creator', '', 'creator'])
})
