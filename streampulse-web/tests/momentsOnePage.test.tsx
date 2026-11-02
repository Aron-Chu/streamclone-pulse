import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as minuteWindow from '../src/lib/momentMinuteWindow'

vi.mock('../src/hooks/useMomentProfiles', () => ({ useMomentProfiles: (rows: unknown) => rows }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({ AnalyticsFigmaShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
// One stable hub result: a fresh object per render would re-run the feed effects forever.
const { hub } = vi.hoisted(() => {
  const at = Date.now() - 60_000
  const row = (login: string, offsetSeconds: number, category: string, categoryId: string, minutesAgo: number) => ({
    login, displayName: login, streamId: `s-${login}`, offsetSeconds, label: 'Chat spike', kind: 'chat_spike', chatPerMin: 200, emotesPerMin: 40,
    category, categoryId, boxArtUrl: `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-52x72.jpg`, at: at - minutesAgo * 60_000, score: 80,
  })
  return { hub: {
    data: { generatedAt: new Date().toISOString(), livePulseMoments: [
      row('xqc', 660, 'Just Chatting', '509658', 0),
      row('sodapoppin', 840, 'Minecraft', '27471', 2),
      // a stream's first 5 minutes: the hello spike stays off the page
      row('forsen', 120, 'Minecraft', '27471', 4),
      row('pokimane', 900, 'Minecraft', '27471', 6),
    ] },
    loading: false, refreshing: false, error: null, loadSource: 'network', hubEndpointOk: true, refresh: () => {},
  } }
})
vi.mock('../src/hooks/usePublicHubData', () => ({ usePublicHubData: () => hub }))

let currentUrl = ''
function UrlProbe() {
  const location = useLocation()
  currentUrl = location.pathname + location.search
  return null
}
const renderMoments = (url = '/analytics/moments') => render(<MemoryRouter initialEntries={[url]}><AnalyticsMomentsPage /><UrlProbe /></MemoryRouter>)
const logins = () => [...document.querySelectorAll<HTMLElement>('.moments-result')].map(row => JSON.parse(row.querySelector('[data-discovery-key]')!.getAttribute('data-discovery-key')!)[0] as string)
const covers = () => screen.getByRole('list', { name: 'Games, busiest first' })

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network disabled in tests') }))
  vi.spyOn(minuteWindow, 'loadMomentMinuteWindow').mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('one Moments page', () => {
  it('leaves a stream’s first 5 minutes off Latest', async () => {
    renderMoments()
    await waitFor(() => expect(logins()).toHaveLength(3))
    expect(logins()).not.toContain('forsen')
  })

  it('puts the games on top, busiest first, and a cover shows that game’s moments', async () => {
    renderMoments()
    await waitFor(() => expect(logins()).toHaveLength(3))
    const buttons = within(covers()).getAllByRole('button')
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      'All games: 3 moments. Shows every game’s moments.',
      'Minecraft: 2 moments. Shows its moments.',
      'Just Chatting: 1 moment. Shows its moments.',
    ])
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(buttons[1])
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments?category=Minecraft'))
    await waitFor(() => expect(logins().sort()).toEqual(['pokimane', 'sodapoppin']))
    fireEvent.click(within(covers()).getByRole('button', { name: /^Minecraft: / }))
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments'))
    expect(screen.queryByRole('combobox', { name: 'Category' })).toBeNull()
  })

  it('reads the hub’s game link by Twitch id', async () => {
    renderMoments('/analytics/moments?game=27471')
    await waitFor(() => expect(logins().sort()).toEqual(['pokimane', 'sodapoppin']))
    expect(within(covers()).getByRole('button', { name: /^Minecraft: / }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(covers()).getByRole('button', { name: /^All games: / }))
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments'))
    await waitFor(() => expect(logins()).toHaveLength(3))
  })

  it('opens a moment whose game shows that game’s moments', async () => {
    renderMoments()
    await waitFor(() => expect(logins()).toHaveLength(3))
    const xqc = document.querySelectorAll<HTMLElement>('.moments-result')[logins().indexOf('xqc')]
    fireEvent.click(xqc.querySelector<HTMLButtonElement>('.moments-card-primary')!)
    const detail = await screen.findByRole('region', { name: /^Selected moment: / })
    fireEvent.click(within(detail).getByRole('button', { name: 'Show Just Chatting moments' }))
    await waitFor(() => expect(currentUrl).toBe('/analytics/moments?category=Just+Chatting'))
    await waitFor(() => expect(logins()).toEqual(['xqc']))
  })
})
