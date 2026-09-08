import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import type { PublicHub } from '../src/lib/publicHub'

const state = vi.hoisted(() => ({ moments: [] as PublicHub['livePulseMoments'], source: vi.fn() }))
vi.mock('../src/hooks/usePublicHubRecentMoments', () => ({ usePublicHubRecentMoments: () => ({
  loading: false, data: React.useMemo(() => ({ moments: state.moments, status: 'ready', limit: 200, hasMore: false }), [state.moments]),
}) }))
vi.mock('../src/hooks/useNewsroomData', () => ({ useNewsroomData: () => ({ loading: false, data: null }) }))
vi.mock('../src/hooks/useDiscoveryCatalogue', () => ({ useDiscoveryCatalogue: () => ({ loading: false }) }))
vi.mock('../src/lib/discoveryCapability', () => ({ discoveryCatalogueEnabled: () => false }))
vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (items: unknown) => items }))
vi.mock('../src/hooks/useSavedMomentEvidence', () => ({ useSavedMomentEvidence: (items: unknown) => items }))
vi.mock('../src/lib/categoryArtwork', async original => ({ ...await original<typeof import('../src/lib/categoryArtwork')>(), useCategoryArtwork: () => new Map() }))
vi.mock('../src/lib/newsroomProfiles', () => ({ newsroomProfileUrl: () => '', loadNewsroomProfiles: async () => {} }))
vi.mock('../src/lib/discoveryMoments', async original => ({
  ...await original<typeof import('../src/lib/discoveryMoments')>(),
  checkMomentSource: (...args: unknown[]) => state.source(...args),
}))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const first = { login: 'creator', streamId: '123', offsetSeconds: 60, at: Date.parse('2026-09-07T12:01:00Z'),
  label: 'First reaction', category: 'Minecraft', score: 10, chatPerMin: 120, emotesPerMin: 40,
  topEmotes: [{ name: 'LOL', count: 3, sharePct: 100, imageUrl: 'https://cdn.7tv.app/emote/test/1x.webp' }] }
const second = { ...first, offsetSeconds: 120, at: first.at - 60_000, label: 'Second reaction' }
function Probe() { return <output data-testid="url">{useLocation().search}</output> }
const tree = () => <MemoryRouter><AnalyticsMomentsPage /><Probe /></MemoryRouter>
const keys = () => [...document.querySelectorAll<HTMLButtonElement>('[data-discovery-key]')].map(node => node.dataset.discoveryKey)
beforeEach(() => {
  state.moments = [first, second]
  state.source.mockResolvedValue({ vodHref: null, liveHref: null, reason: 'Archive unavailable' })
  vi.stubGlobal('scrollTo', vi.fn())
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('renders Recent as compact evidence rows with independent exact actions, not fallback galleries or live claims', () => {
  render(tree())
  const table = screen.getByRole('table', { name: 'Loaded detection review' })
  const row = within(table).getAllByRole('row')[1]
  expect(within(row).getByText('120 chat/min')).toBeTruthy()
  expect(within(row).getByText('40 emotes/min')).toBeTruthy()
  expect(within(row).getByLabelText('Measured emote reactions')).toBeTruthy()
  expect(within(row).getByText('Source unchecked')).toBeTruthy()
  expect(within(row).getByRole('link', { name: 'Stream analytics' }).getAttribute('href')).toBe('/analytics/creator/123#t=60')
  expect(document.querySelector('.moments-category-track')).not.toBeNull()
  expect(document.querySelector('.moments-gallery-media, .moments-reaction-visual, .moments-result--gallery')).toBeNull()
  expect(within(table).queryByText(/live now|watch live|evidence only/i)).toBeNull()
  fireEvent.click(within(row).getByRole('button', { name: 'Save' }))
  expect(screen.queryByRole('region', { name: 'Selected moment' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Saved (1)' }))
  expect(document.querySelector('.moments-result--gallery')).not.toBeNull()
})

it('queues arrivals during exact review without changing selection or focus and restores result focus on Escape', async () => {
  const view = render(tree())
  fireEvent.click(screen.getByRole('button', { name: /First reaction.*Open moment/ }))
  await waitFor(() => expect(state.source).toHaveBeenCalled())
  expect(state.source.mock.lastCall?.[0]).toMatchObject({ login: 'creator', streamId: '123', offsetSeconds: 60 })
  const originalKeys = keys()
  const url = screen.getByTestId('url').textContent
  const next = screen.getByRole('button', { name: 'Next moment' })
  next.focus()
  state.moments = [{ ...first, offsetSeconds: 180, at: first.at + 60_000, label: 'New arrival' }, first, second]
  view.rerender(tree())
  expect(keys()).toEqual(originalKeys)
  expect(screen.getByTestId('url').textContent).toBe(url)
  expect(document.activeElement).toBe(next)
  expect(screen.getByRole('button', { name: 'Show 1 new moment' })).toBeTruthy()
  expect(screen.getByText('1 of 2 loaded matches')).toBeTruthy()
  fireEvent.keyDown(next, { key: 'Escape' })
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /First reaction.*Open moment/ })))
  expect(screen.queryByRole('region', { name: 'Selected moment' })).toBeNull()
  expect(keys()).toHaveLength(3)
})

it('keeps supplied thumbnails optional and never replaces a failed image with a giant evidence panel', () => {
  state.moments = [{ ...first, archiveArtwork: { kind: 'archive_thumbnail', vodId: '123456', url: 'https://static-cdn.jtvnw.net/cf_vods/test/thumb/preview.jpg' } }]
  render(tree())
  const disclosure = document.querySelector<HTMLDetailsElement>('.moments-recent-artwork')!
  expect(disclosure).not.toBeNull()
  expect(disclosure.open).toBe(false)
  expect(disclosure.textContent).toContain('not the moment frame')
  fireEvent.error(disclosure.querySelector('img')!)
  expect(disclosure.textContent).toContain('Thumbnail unavailable')
  expect(document.querySelector('.moments-gallery-media, .moments-reaction-visual')).toBeNull()
  expect(state.source).not.toHaveBeenCalled()
})
