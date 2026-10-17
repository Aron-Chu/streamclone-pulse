import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as availabilityTransport from '../src/lib/discoveryAvailability'
import { normalizeApiError } from '../src/lib/apiClient'
import { clearRankedFeatureCheckForTests } from '../src/hooks/useRankedFeatureAvailability'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'

const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }

const feed = vi.hoisted(() => ({ load: vi.fn(), poll: vi.fn(), item: vi.fn(), vod: vi.fn(), minutes: vi.fn() }))
vi.mock('../src/lib/momentsFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/momentsFeed')>()),
  loadMomentsFeed: feed.load, pollMomentsFeed: feed.poll, loadMomentsFeedItem: feed.item,
}))
vi.mock('../src/lib/momentsFeedVod', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/momentsFeedVod')>()), loadMomentVod: feed.vod }))
vi.mock('../src/lib/momentMinuteSeries', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/momentMinuteSeries')>()), loadMomentMinuteSeries: feed.minutes }))
vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (rows: unknown) => rows }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
const { hub } = vi.hoisted(() => ({ hub: {
  data: { generatedAt: new Date().toISOString(), livePulseMoments: [] },
  loading: false, refreshing: false, error: null, loadSource: 'network', hubEndpointOk: true, refresh: () => {},
} }))
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: () => hub }))

const renderMoments = () => render(<MemoryRouter initialEntries={['/analytics/moments']}><AnalyticsMomentsPage /></MemoryRouter>)
const rows = () => [...document.querySelectorAll<HTMLElement>('.mk-list .mk-r')]
const seg = (name: string) => within(screen.getByRole('group', { name: 'Which moments' })).getByRole('button', { name: new RegExp(`^${name}`) })

beforeEach(() => {
  vi.spyOn(availabilityTransport, 'fetchRankedAvailability').mockReturnValue(new Promise(() => {}))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  Element.prototype.scrollIntoView = () => {}
  window.localStorage.clear()
  window.history.replaceState(null, '', '/analytics/moments')
  feed.load.mockResolvedValue({ items: fixture.items, generatedAt: fixture.generatedAt, stale: false })
  feed.poll.mockReturnValue(new Promise(() => {}))
  feed.item.mockResolvedValue(null)
  feed.vod.mockResolvedValue(null)
  feed.minutes.mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  Object.values(feed).forEach(fn => fn.mockReset())
  clearRankedFeatureCheckForTests()
})

describe('Moments page flag', () => {
  it('is master’s page, with no feed read, while the flag is off', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    renderMoments()
    expect(screen.getByRole('tab', { name: 'Latest' })).toBeTruthy()
    expect(document.querySelector('.mk')).toBeNull()
    expect(feed.load).not.toHaveBeenCalled()
  })

  it('falls back to master’s page when the feed is not there (backend flag off)', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    feed.load.mockRejectedValue(normalizeApiError(404, { error: 'not_found' }))
    renderMoments()
    expect(await screen.findByRole('tab', { name: 'Latest' })).toBeTruthy()
    expect(document.querySelector('.mk')).toBeNull()
    expect(feed.load).toHaveBeenCalledTimes(1)
  })
})

describe('checked Moments page', () => {
  beforeEach(() => vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on'))

  it('lists the moments that hold up, one row per stream, and says how many are left out', async () => {
    renderMoments()
    expect(await screen.findByRole('heading', { level: 1, name: 'Moments' })).toBeTruthy()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const shown = fixture.items.filter(item => item.verdict !== 'bad')
    expect(rows().length).toBe(new Set(shown.map(item => item.streamId)).size)
    expect(document.querySelectorAll('.mk-list > li.mk-g[data-vd="bad"]')).toHaveLength(0)
    expect(document.querySelector('.mk-fresh')?.textContent).toMatch(/ · 40 moments in the last 12 hours from \d+ live streams · 20 hold up, 6 partly, 14 don’t$/)
    const foot = document.querySelector('.mk-foot')!
    expect(foot.textContent).toMatch(/^14 moments didn’t hold up and are left out\. Show all 40$/)
    fireEvent.click(within(foot as HTMLElement).getByRole('button', { name: 'Show all 40' }))
    expect(seg('All').getAttribute('aria-pressed')).toBe('true')
    expect(rows().length).toBe(new Set(fixture.items.map(item => item.streamId)).size)
    // no per-row reads: the opened moment is the only one that reads its stream and minutes
    expect(feed.vod).not.toHaveBeenCalled()
    expect(feed.minutes).not.toHaveBeenCalled()
  })

  it('opens a moment under its row on a narrow screen, with one stream read and one minutes read', async () => {
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    const first = rows()[0]
    fireEvent.click(first)
    const detail = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.mk-slot .mk-d')
      expect(el).toBeTruthy()
      return el!
    })
    expect(within(detail).getByRole('heading', { name: 'Why it counts' })).toBeTruthy()
    expect(within(detail).getByRole('heading', { name: 'The minutes around it' })).toBeTruthy()
    expect(within(detail).getByRole('link', { name: /Watch live on Twitch/ })).toBeTruthy()
    expect(feed.vod).toHaveBeenCalledTimes(1)
    expect(feed.minutes).toHaveBeenCalledTimes(1)
    expect(new URL(window.location.href).searchParams.get('m')).toBe(first.dataset.key)
    expect(first.getAttribute('aria-current')).toBe('true')
    // a second click closes it (narrow)
    fireEvent.click(first)
    await waitFor(() => expect(document.querySelector('.mk-slot')).toBeNull())
  })

  it('opens a deep-linked moment that didn’t hold up in All', async () => {
    const bad = fixture.items.find(item => item.verdict === 'bad')!
    window.history.replaceState(null, '', `/analytics/moments?m=${bad.id}`)
    renderMoments()
    await waitFor(() => expect(document.querySelector('.mk-d')).toBeTruthy())
    expect(document.querySelector('.mk-d')?.getAttribute('data-key')).toBe(bad.id)
    expect(seg('All').getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps a saved moment in Saved after a reload', async () => {
    const { unmount } = renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(rows()[0])
    const save = await screen.findByRole('button', { name: 'Save' })
    fireEvent.click(save)
    expect(screen.getByRole('button', { name: 'Saved' }).getAttribute('aria-pressed')).toBe('true')
    unmount()
    renderMoments()
    await waitFor(() => expect(rows().length).toBeGreaterThan(0))
    fireEvent.click(seg('Saved'))
    expect(seg('Saved').textContent).toBe('Saved1')
    expect(rows()).toHaveLength(1)
  })
})
