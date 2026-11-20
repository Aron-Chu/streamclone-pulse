import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsMomentsPage from '../src/routes/analytics/AnalyticsMomentsPage'
import * as minuteWindow from '../src/lib/momentMinuteWindow'
import * as discovery from '../src/lib/discoveryMoments'
import { momentAtKey, momentMinuteAt } from '../src/lib/momentFeedback'

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
  vi.unstubAllEnvs()
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

  it('keeps the games row when every moment is one game, so the list does not move when a second game arrives', async () => {
    const all = hub.data.livePulseMoments.splice(0)
    hub.data.livePulseMoments.push(all[1]!)
    try {
      renderMoments()
      await waitFor(() => expect(logins()).toEqual(['sodapoppin']))
      expect(within(covers()).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
        'All games: 1 moment. Shows every game’s moments.',
        'Minecraft: 1 moment. Shows its moments.',
      ])
    } finally {
      hub.data.livePulseMoments.splice(0, hub.data.livePulseMoments.length, ...all)
    }
  })

  it('asks for the covers a phone shows at once and first; the rest wait until near the screen', async () => {
    const all = hub.data.livePulseMoments.splice(0)
    const extra = [['Fortnite', '33214', 'ninja'], ['Chess', '743', 'gmhikaru']].map(([category, categoryId, login]) => ({
      ...all[0]!, login, displayName: login, streamId: `s-${login}`, category, categoryId, boxArtUrl: `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-52x72.jpg`,
    }))
    hub.data.livePulseMoments.push(...all, ...extra)
    try {
      renderMoments()
      await waitFor(() => expect(logins()).toHaveLength(5))
      const pictures = [...covers().querySelectorAll('img')]
      expect(pictures.map(img => img.getAttribute('src'))).toEqual(['27471', '743', '33214', '509658'].map(id => `https://static-cdn.jtvnw.net/ttv-boxart/${id}-285x380.jpg`))
      expect(pictures.map(img => [img.getAttribute('loading'), img.getAttribute('fetchpriority')])).toEqual([
        ['eager', 'high'], ['eager', 'high'], ['eager', 'high'], ['lazy', null],
      ])
    } finally {
      hub.data.livePulseMoments.splice(0, hub.data.livePulseMoments.length, ...all)
    }
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

  describe('the way in to a Moment’s own page', () => {
    // A made-up stream that starts 10:00:00Z: offset 660 s is 10:11:00Z, and the hub's wall-clock peak is 37 s into that minute.
    const fake: { login: string; displayName: string; streamId: string; offsetSeconds: number; label: string; kind: string; chatPerMin: number; emotesPerMin: number
      category: string; categoryId: string; boxArtUrl: string; at?: number; score: number } = {
      login: 'fakechan01', displayName: 'FakeChan01', streamId: '9000001', offsetSeconds: 660, label: 'Chat spike', kind: 'chat_spike', chatPerMin: 200, emotesPerMin: 40,
      category: 'fake-pog', categoryId: '900001', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/900001-52x72.jpg', at: Date.parse('2026-11-14T10:11:37Z'), score: 80,
    }
    const asRow = fake as (typeof hub.data.livePulseMoments)[number]
    beforeEach(() => { hub.data.livePulseMoments.push(asRow) })
    afterEach(() => { hub.data.livePulseMoments.splice(hub.data.livePulseMoments.indexOf(asRow), 1) })

    const openFake = async () => {
      renderMoments()
      await waitFor(() => expect(logins()).toContain('fakechan01'))
      const row = document.querySelectorAll<HTMLElement>('.moments-result')[logins().indexOf('fakechan01')]
      fireEvent.click(row.querySelector<HTMLButtonElement>('.moments-card-primary')!)
      return screen.findByRole('region', { name: /^Selected moment: / })
    }
    const stubSource = (occurrenceAt: number | undefined) =>
      vi.spyOn(discovery, 'checkMomentSource').mockResolvedValue({ vodHref: null, liveHref: null, reason: 'fake', occurrenceAt })

    it('keys the link by the source’s minute when the source has one, not the peak’s', async () => {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
      stubSource(Date.parse('2026-11-14T10:11:00Z'))
      const detail = await openFake()
      const link = await within(detail).findByRole('link', { name: 'Open the Moment’s page' })
      await waitFor(() => expect(link.getAttribute('href')).toBe('/analytics/moments/9000001/20261114T1011Z'))
    })

    it('falls back to the minute the peak sits in when the source has none (10:11:37 is 10:11, R89)', async () => {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
      stubSource(undefined)
      const detail = await openFake()
      const link = await within(detail).findByRole('link', { name: 'Open the Moment’s page' })
      expect(link.getAttribute('href')).toBe('/analytics/moments/9000001/20261114T1011Z')
    })

    it('keeps a peak late in its minute (10:11:50) on that minute, with or without the source', async () => {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
      fake.at = Date.parse('2026-11-14T10:11:50Z')
      try {
        stubSource(undefined)
        const detail = await openFake()
        const link = await within(detail).findByRole('link', { name: 'Open the Moment’s page' })
        expect(link.getAttribute('href')).toBe('/analytics/moments/9000001/20261114T1011Z')
      } finally { fake.at = Date.parse('2026-11-14T10:11:37Z') }
    })

    it('keys the link by the Moment’s own minute when the stream started on a fractional second', async () => {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
      // Started 10:00:30.4; the 10:11 Moment is 629 s in, so the source's occurrence is 10:10:59.4.
      const start = Date.parse('2026-11-14T10:00:30.400Z')
      const key = momentAtKey(momentMinuteAt(start, 629))
      expect(key).toBe(momentAtKey(Date.parse('2026-11-14T10:11:00Z')))
      stubSource(start + 629_000)
      const detail = await openFake()
      const link = await within(detail).findByRole('link', { name: 'Open the Moment’s page' })
      await waitFor(() => expect(link.getAttribute('href')).toBe(`/analytics/moments/9000001/${key}`))
    })

    it('has no link while the page is off', async () => {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', '')
      stubSource(Date.parse('2026-11-14T10:11:00Z'))
      const detail = await openFake()
      expect(within(detail).queryByRole('link', { name: 'Open the Moment’s page' })).toBeNull()
    })

    it('has no link when the Moment’s time is unknown', async () => {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
      stubSource(undefined)
      delete fake.at
      try {
        const detail = await openFake()
        expect(within(detail).queryByRole('link', { name: 'Open the Moment’s page' })).toBeNull()
      } finally { fake.at = Date.parse('2026-11-14T10:11:37Z') }
    })
  })
})
