import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() })

const mocks = vi.hoisted(() => ({
  enabled: true,
  catalogue: vi.fn(),
  refresh: vi.fn(),
  source: vi.fn(),
  evidence: vi.fn((items: DiscoveryMoment[]) => items),
  savedItems: [] as DiscoveryMoment[],
}))
vi.mock('../src/lib/savedDiscoveryMoments', () => ({ useSavedMoments: () => ({ items: mocks.savedItems, warning: '' }), refreshSavedMoment: vi.fn(), toggleSavedMoment: vi.fn() }))
vi.mock('../src/lib/discoveryCapability', () => ({ discoveryCatalogueEnabled: () => mocks.enabled }))
vi.mock('../src/hooks/useDiscoveryCatalogue', () => ({ useDiscoveryCatalogue: (...args: unknown[]) => mocks.catalogue(...args) }))
vi.mock('../src/hooks/usePublicHubRecentMoments', () => ({ usePublicHubRecentMoments: () => ({ loading: false, data: null }) }))
vi.mock('../src/hooks/useNewsroomData', () => ({ useNewsroomData: () => ({ loading: false, data: null }) }))
vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (items: unknown) => items }))
vi.mock('../src/hooks/useSavedMomentEvidence', () => ({ useSavedMomentEvidence: (items: DiscoveryMoment[]) => mocks.evidence(items) }))
vi.mock('../src/lib/newsroomProfiles', () => ({ newsroomProfileUrl: () => '', loadNewsroomProfiles: async () => {} }))
vi.mock('../src/lib/discoveryMoments', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/discoveryMoments')>(),
  checkMomentSource: (...args: unknown[]) => mocks.source(...args),
}))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const moment = { key: 'creator:123:60', login: 'creator', streamId: '123', offsetSeconds: 60,
  at: Date.parse('2026-09-01T00:01:00Z'), label: 'Stored reaction', chatPerMin: 5, emotesPerMin: 3,
  revision: 1, topEmotes: [{ name: 'LOL', count: 2 }] }
function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="url">{location.search}</output><button onClick={() => navigate(-1)}>Browser back</button></>
}
function mount(search = '') {
  mocks.catalogue.mockReturnValue({ loading: false, unsupported: false, error: '', refresh: mocks.refresh })
  mocks.source.mockResolvedValue({ vodHref: null, liveHref: null, reason: 'Archive unavailable' })
  return render(<MemoryRouter initialEntries={[`/analytics/moments${search}`]}><AnalyticsMomentsPage /><LocationProbe /></MemoryRouter>)
}
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); mocks.enabled = true; mocks.savedItems = []; mocks.evidence.mockImplementation(items => items); localStorage.clear() })

describe('Stored history navigation', () => {
  it('keeps creator navigation with the gate off without fabricating annual activity', () => {
    mocks.enabled = false
    mocks.savedItems = [{ ...moment, at: Date.parse('2025-09-02T12:00:00Z'), provenance: 'saved' }]
    mount('?view=saved')
    const link = screen.getByRole('link', { name: 'Browse creator history' })
    expect(link.getAttribute('href')).toContain('month=2025-09&calendar=year')
    fireEvent.click(link)
    expect(screen.getByRole('heading', { name: '@creator · 2025 heatmap unavailable' })).toBeTruthy()
    expect(document.querySelector('.discovery-year')).toBeNull()
    expect(mocks.catalogue.mock.calls.every(call => call[0] === false)).toBe(true)
  })

  it('offers heatmap navigation and distinguishes loaded snapshots from annual history', () => {
    mocks.enabled = false
    mount()
    expect(screen.getByText(/this snapshot cannot populate a year heatmap/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Creator heatmap' }))
    expect(screen.getByRole('heading', { name: 'Stored history is not available yet' })).toBeTruthy()
    expect(mocks.catalogue.mock.calls.every(call => call[0] === false)).toBe(true)
  })

  it('uses seven semantic review columns with separate interactive controls', async () => {
    mocks.savedItems = [{ ...moment, provenance: 'saved' }]
    mount('?view=saved&login=creator&stream=123&offset=60')
    await waitFor(() => expect(mocks.source).toHaveBeenCalled())
    expect(screen.getAllByRole('columnheader').map(node => node.textContent)).toEqual(['Creator', 'Category', 'Event time', 'Moment', 'Emotes', 'Source', 'Save'])
    expect(screen.getAllByRole('cell')).toHaveLength(7)
    expect(document.querySelector('button button, button a, a button')).toBeNull()
  })
  it('retains the selected day for measure changes but clears it for explicit year navigation', () => {
    mount('?collection=history&month=2025-09&creator=creator&day=2025-09-01&calendar=year&year=2025')
    fireEvent.click(screen.getByRole('combobox', { name: 'Year activity measure' }))
    fireEvent.click(screen.getByRole('option', { name: 'Emote uses' }))
    expect(screen.getByTestId('url').textContent).toContain('day=2025-09-01')
    fireEvent.click(screen.getByRole('combobox', { name: 'Activity year' }))
    fireEvent.click(screen.getByRole('option', { name: '2024' }))
    expect(screen.getByTestId('url').textContent).toContain('year=2024')
    expect(screen.getByTestId('url').textContent).not.toContain('day=')
    expect(mocks.catalogue.mock.lastCall?.[0]).toBe(false)
  })

  it('keeps year day reads active and parks the mounted calendar during exact review', async () => {
    const search = '?collection=history&month=2026-09&creator=creator&day=2026-09-01&calendar=year&year=2026'
    const view = mount(search)
    mocks.catalogue.mockReturnValue({ loading: false, unsupported: false, error: '', refresh: mocks.refresh,
      data: { state: 'ready', items: [moment], days: [], nextCursor: '', projectionUpdatedAt: null, dataThrough: null } })
    view.rerender(<MemoryRouter><AnalyticsMomentsPage /><LocationProbe /></MemoryRouter>)
    expect(mocks.catalogue.mock.lastCall?.[0]).toBe(true)
    const calendar = document.querySelector('.discovery-calendar')
    expect(calendar).not.toBeNull()
    expect(document.querySelector('.moments-broadcast-group .moments-gallery-media')).toBeNull()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Stored reaction.*Open moment/ })) })
    expect(document.querySelector('.discovery-calendar')).toBe(calendar)
    expect(calendar?.closest('[hidden]')).not.toBeNull()
    expect(screen.getByRole('navigation', { name: 'Creator day return context' }).textContent).toContain('2026-09-01')
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }))
    expect(document.querySelector('.discovery-calendar')).toBe(calendar)
    expect(calendar?.closest('[hidden]')).toBeNull()
    expect(screen.getByTestId('url').textContent).toBe(search)
  })

  it.each(['unavailable', 'failed'])('presents one %s source state before measurements and continuation', async state => {
    mount('?login=creator&stream=123&offset=60')
    if (state === 'failed') {
      mocks.source.mockRejectedValue(new Error('offline'))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Recheck source' })).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Recheck source' }))
    }
    await waitFor(() => expect(document.querySelector('.moments-source-state')?.getAttribute('data-source-state')).toBe(state))
    const source = document.querySelector('.moments-source-state')!
    const measurement = document.querySelector('.moments-measurement')!
    expect(source.compareDocumentPosition(measurement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(document.querySelectorAll('.moments-source-state')).toHaveLength(1)
    expect(document.querySelector('.moments-detail iframe')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Recheck source' })).toHaveLength(1)
    expect(screen.getByRole('link', { name: /Inspect .* in Analytics/ })).toBeTruthy()
  })

  it.each(['compatible', 'revision', 'publicId', 'key'])('reuses Saved gallery evidence only for compatible selected identity: %s', async mismatch => {
    const saved = { ...moment, provenance: 'saved' as const, publicMomentId: 'public-a' }
    mocks.savedItems = [saved]
    const enriched = { ...saved, topEmotes: [{ name: 'LOL', count: 2, imageUrl: 'https://cdn.7tv.app/emote/hydrated/1x.webp' }],
      ...(mismatch === 'revision' ? { revision: 2 } : mismatch === 'publicId' ? { publicMomentId: 'public-b' } : mismatch === 'key' ? { key: 'other' } : {}) }
    mocks.evidence.mockReturnValue([enriched])
    mount('?view=saved&login=creator&stream=123&offset=60&moment=public-a')
    await waitFor(() => expect(mocks.source).toHaveBeenCalled())
    const image = document.querySelector<HTMLImageElement>('.moments-detail .moments-reactions img')
    if (mismatch === 'compatible') expect(image?.src).toContain('/hydrated/')
    else expect(image).toBeNull()
    expect(screen.getByTestId('url').textContent).toContain('stream=123&offset=60&moment=public-a')
  })

  it('provides a dedicated session-back class and hidden navigation icon', () => {
    mount('?view=sessions&story=story-a&q=creator')
    const back = screen.getByRole('button', { name: /All sessions/ })
    expect(back.classList.contains('moments-session-back')).toBe(true)
    expect(back.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    fireEvent.click(back)
    expect(screen.getByTestId('url').textContent).toContain('q=creator')
    expect(screen.getByTestId('url').textContent).not.toContain('story=')
  })

  it('keeps a filtered-out Saved selection inspectable', async () => {
    mocks.savedItems = [{ ...moment, provenance: 'saved', publicMomentId: 'public-a' }]
    mount('?view=saved&q=unmatched&login=creator&stream=123&offset=60&moment=public-a')
    await waitFor(() => expect(mocks.source).toHaveBeenCalled())
    expect(screen.getByRole('heading', { name: 'Stored reaction' })).toBeTruthy()
    expect(screen.getByText('Selection outside loaded matches')).toBeTruthy()
    expect(mocks.source.mock.lastCall?.[0]).toMatchObject({ key: moment.key, publicMomentId: 'public-a', revision: 1 })
    expect(mocks.evidence.mock.lastCall?.[0]).toEqual([])
  })
  it('does not present the seven-day loaded filter as historical retrieval', () => {
    vi.stubEnv('VITE_PUBLIC_NEWSROOM_WINDOWS', '')
    mount('?occurred=7d')
    expect(screen.getByText(/Seven-day session history is not enabled/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Browse 7-day sessions' })).toBeNull()
  })

  it('routes to existing seven-day sessions only when explicitly enabled', () => {
    vi.stubEnv('VITE_PUBLIC_NEWSROOM_WINDOWS', '7d')
    mount('?occurred=7d&category=Minecraft&q=old&sort=chatPerMin')
    fireEvent.click(screen.getByRole('button', { name: 'Browse 7-day sessions' }))
    expect(screen.getByTestId('url').textContent).toBe('?view=sessions&window=7d')
  })
  it('exposes a gated entry from Saved and clears incompatible browse filters', () => {
    mount('?view=saved&occurred=custom&from=2026-08-01&to=2026-08-02&q=old&sort=chatPerMin')
    fireEvent.click(screen.getByRole('button', { name: 'Stored history' }))
    expect(screen.getByTestId('url').textContent).toBe('?view=recent&collection=history')
    expect(screen.getByRole('button', { name: 'Stored history' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Recent' }).getAttribute('aria-pressed')).toBe('false')
    expect(mocks.catalogue.mock.lastCall?.[0]).toBe(true)
  })

  it('Recent leaves history and browser back restores its exact UTC scope', () => {
    const search = '?view=recent&collection=history&month=2026-09&creator=creator&day=2026-09-01&calendar=year&year=2026&measure=emoteUses'
    mount(search)
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }))
    expect(screen.getByTestId('url').textContent).toBe('?view=recent')
    expect(mocks.catalogue.mock.lastCall?.[0]).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Browser back' }))
    expect(screen.getByTestId('url').textContent).toBe(search)
  })

  it('keeps disabled history discoverable without requesting or fabricating history data', () => {
    mocks.enabled = false
    mount()
    // Capability gates protect reads; they must not hide the availability destination.
    fireEvent.click(screen.getByRole('button', { name: 'Stored history' }))
    expect(screen.getByTestId('url').textContent).toBe('?view=recent&collection=history')
    expect(screen.getByText('Stored history is not enabled in this portal.', { exact: false })).toBeTruthy()
    expect(screen.getByText(/No history data is requested/)).toBeTruthy()
    expect(screen.queryByText(/No indexed detections/)).toBeNull()
    expect(mocks.catalogue.mock.calls.every(call => call[0] === false)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Return to recent moments' }))
    expect(screen.getByTestId('url').textContent).toBe('?view=recent')
  })

  it('explains disabled creator year deep links without rendering a heatmap', () => {
    mocks.enabled = false
    mount('?collection=history&creator=creator&calendar=year&year=2026')
    expect(screen.getByRole('heading', { name: 'Stored history is not available yet' })).toBeTruthy()
    expect(document.querySelector('.discovery-calendar')).toBeNull()
    expect(mocks.catalogue.mock.calls.every(call => call[0] === false)).toBe(true)
  })

  it('keeps loading and retry visible without claiming an empty collection', () => {
    const view = mount('?collection=history&month=2026-09')
    mocks.catalogue.mockReturnValue({ loading: true, unsupported: false, error: '', refresh: mocks.refresh })
    view.rerender(<MemoryRouter><AnalyticsMomentsPage /><LocationProbe /></MemoryRouter>)
    expect(screen.getByText('Checking stored activity…')).toBeTruthy()
    expect(screen.queryByText(/No indexed detections/)).toBeNull()
    mocks.catalogue.mockReturnValue({ loading: false, unsupported: false, error: 'Stored activity could not be loaded.', refresh: mocks.refresh })
    view.rerender(<MemoryRouter><AnalyticsMomentsPage /><LocationProbe /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.refresh).toHaveBeenCalledOnce()
  })

  it('distinguishes an unsupported endpoint from an empty indexed collection', () => {
    const view = mount('?collection=history&month=2026-09')
    mocks.catalogue.mockReturnValue({ loading: false, unsupported: true, error: '', refresh: mocks.refresh })
    view.rerender(<MemoryRouter><AnalyticsMomentsPage /><LocationProbe /></MemoryRouter>)
    expect(screen.getByText('The connected server does not expose the indexed day catalogue.', { exact: false })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    mocks.catalogue.mockReturnValue({ loading: false, unsupported: false, error: '', refresh: mocks.refresh,
      data: { state: 'ready', items: [], days: [], nextCursor: '', projectionUpdatedAt: null, dataThrough: null } })
    view.rerender(<MemoryRouter><AnalyticsMomentsPage /><LocationProbe /></MemoryRouter>)
    expect(screen.getByText(/No indexed detections match this selection/)).toBeTruthy()
    expect(screen.queryByText('Stored history is not available yet')).toBeNull()
  })

  it('reviews the exact stored identity and returns to the same collection and focused result', async () => {
    const search = '?collection=history&month=2026-09&creator=creator&day=2026-09-01'
    const view = mount(search)
    mocks.catalogue.mockReturnValue({ loading: false, unsupported: false, error: '', refresh: mocks.refresh,
      data: { state: 'ready', items: [moment], days: [], nextCursor: '', projectionUpdatedAt: null, dataThrough: null } })
    view.rerender(<MemoryRouter><AnalyticsMomentsPage /><LocationProbe /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: /Stored reaction.*Open moment/ }))
    await waitFor(() => expect(mocks.source).toHaveBeenCalled())
    expect(mocks.source.mock.lastCall?.[0]).toMatchObject({ login: 'creator', streamId: '123', offsetSeconds: 60 })
    expect(screen.getByTestId('url').textContent).toContain('stream=123&offset=60')
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }))
    expect(screen.getByTestId('url').textContent).toBe(search)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Stored reaction.*Open moment/ })))
  })

  it('groups interleaved broadcasts and reviews the flattened visible queue through continuation and sort changes', async () => {
    const view = mount('?collection=history&month=2026-09&creator=creator&sort=chatPerMin')
    const second = { ...moment, key: 'creator:456:0', streamId: '456', offsetSeconds: 0, label: 'Other broadcast', chatPerMin: 40 }
    const third = { ...moment, key: 'creator:123:90000', offsetSeconds: 90000, label: 'Long broadcast', chatPerMin: 30 }
    const first = { ...moment, chatPerMin: 50 }
    const loadMore = vi.fn()
    const state = { loading: false, unsupported: false, error: '', refresh: mocks.refresh, loadMore,
      data: { state: 'ready', items: [first, second, third], days: [], nextCursor: 'page2', projectionUpdatedAt: null, dataThrough: null } }
    const repaint = () => view.rerender(<MemoryRouter><AnalyticsMomentsPage /><LocationProbe /></MemoryRouter>)
    mocks.catalogue.mockReturnValue(state); repaint()
    const keys = () => [...document.querySelectorAll<HTMLButtonElement>('[data-discovery-key]')].map(item => item.dataset.discoveryKey)
    expect(document.querySelectorAll('.moments-broadcast-group')).toHaveLength(2)
    expect(keys()).toEqual([first.key, third.key, second.key])
    expect(screen.getByText(/highest matching loaded detection, not an aggregate/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Stored reaction.*Open moment/ })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Next moment' })) })
    expect(screen.getByTestId('url').textContent).toContain('stream=123&offset=90000')
    fireEvent.click(screen.getByRole('button', { name: 'Load more moments into review' }))
    expect(loadMore).toHaveBeenCalledOnce()
    mocks.catalogue.mockReturnValue({ ...state, loading: true }); repaint()
    expect(screen.getByTestId('url').textContent).toContain('stream=123&offset=90000')
    mocks.catalogue.mockReturnValue({ ...state, error: 'Continuation failed' }); repaint()
    expect(screen.getByRole('heading', { name: 'Long broadcast' })).toBeTruthy()
    const continued = { ...moment, key: 'creator:123:120', offsetSeconds: 120, label: 'Continued reaction', chatPerMin: 60 }
    mocks.catalogue.mockReturnValue({ ...state, data: { ...state.data, items: [...state.data.items, continued], nextCursor: '' } }); repaint()
    expect(document.querySelectorAll('.moments-broadcast-group')).toHaveLength(2)
    expect(keys()).toEqual([continued.key, first.key, third.key, second.key])
    expect(screen.getByText('3 of 4 loaded matches')).toBeTruthy()
    fireEvent.click(screen.getByRole('combobox', { name: 'Result sort order' }))
    fireEvent.click(screen.getByRole('option', { name: 'Oldest first' }))
    expect(screen.getByTestId('url').textContent).toContain('stream=123&offset=90000')
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Other broadcast' } })
    expect(screen.getByText('Selection outside loaded matches')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next moment' })).toBeNull()
    // Closing restores the originating browse scope and the last reviewed card.
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /Long broadcast.*Open moment/ })))
  })
})
