import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import { stubClipsFetch } from './fixtures/nativeClips'

vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (rows: unknown) => rows }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
// One stable hub result: a fresh object per render would re-run the feed effects forever.
const { hub, hubReads } = vi.hoisted(() => ({ hubReads: [] as boolean[], hub: {
  data: { generatedAt: new Date().toISOString(), livePulseMoments: [] },
  loading: false, refreshing: false, error: null, loadSource: 'network', hubEndpointOk: true, refresh: () => {},
} }))
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: (options: { enabled: boolean }) => { hubReads.push(options.enabled); return hub } }))

const tabNames = () => screen.getAllByRole('tab').map(tab => tab.textContent)
const tabs = () => document.querySelector<HTMLElement>('.moments-tabs')!
const renderMoments = (url = '/analytics/moments') => render(<MemoryRouter initialEntries={[url]}><AnalyticsMomentsPage /></MemoryRouter>)

beforeEach(() => {
  hubReads.length = 0
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('keeps master’s tabs and markup while the switch is off, even for a Clips link', async () => {
  vi.stubEnv('VITE_PUBLIC_NATIVE_CLIPS', '')
  const calls = stubClipsFetch({ status: 404, body: {} })
  renderMoments('/analytics/moments?view=clips')
  await act(async () => {})
  expect(tabNames()).toEqual(['Latest', 'Saved (0)'])
  expect(tabs().className).toBe('moments-tabs moments-tabs-two')
  expect(tabs().getAttribute('style')).toBeNull()
  expect(screen.getByRole('tab', { name: 'Latest' }).getAttribute('aria-selected')).toBe('true')
  expect(calls.filter(call => call.url.includes('/v1/public/clips'))).toHaveLength(0)
})

it('adds a Clips tab when the switch is on, with the indicator under the selected tab', async () => {
  vi.stubEnv('VITE_PUBLIC_NATIVE_CLIPS', 'on')
  stubClipsFetch({ status: 404, body: {} })
  renderMoments()
  await act(async () => {})
  expect(tabNames()).toEqual(['Latest', 'Clips', 'Saved (0)'])
  expect(tabs().className).toBe('moments-tabs moments-tabs-indexed')
  expect(tabs().style.getPropertyValue('--moments-tab-index')).toBe('0')
})

it('opens the clip library on the Clips tab without reading the live hub', async () => {
  vi.stubEnv('VITE_PUBLIC_NATIVE_CLIPS', '1')
  const calls = stubClipsFetch({ status: 404, body: {} })
  renderMoments('/analytics/moments?view=clips')
  expect(screen.getByRole('heading', { level: 1, name: 'Clips' })).toBeTruthy()
  expect(screen.getByRole('tab', { name: 'Clips' }).getAttribute('aria-selected')).toBe('true')
  expect(tabs().style.getPropertyValue('--moments-tab-index')).toBe('1')
  await screen.findByText(/Clips aren.t switched on yet/)
  expect(new URL(calls[0].url).pathname).toBe('/v1/public/clips')
  expect(hubReads.every(enabled => !enabled)).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Open Moments' }))
  await act(async () => {})
  expect(screen.getByRole('tab', { name: 'Latest' }).getAttribute('aria-selected')).toBe('true')
  expect(document.activeElement?.id).toBe('moments-view-tab-recent')
})
