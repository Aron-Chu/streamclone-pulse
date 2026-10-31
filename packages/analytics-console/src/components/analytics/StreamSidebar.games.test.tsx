import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsStream } from '../../apiTypes.ts'
import { sidebarCategoryIdsByName, sidebarStreamGames } from '../../utils/streamSidebarGames.ts'
import { StreamSidebar } from './StreamSidebar.tsx'

const placeholder = vi.hoisted(() => ({ answer: vi.fn<(img: HTMLImageElement) => Promise<boolean>>() }))
vi.mock('../../utils/twitchBoxArt.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/twitchBoxArt.ts')>()),
  isTwitchPlaceholderBoxArt: (img: HTMLImageElement) => placeholder.answer(img),
}))

beforeEach(() => placeholder.answer.mockReset().mockResolvedValue(false))
afterEach(() => cleanup())

// Trimmed from the yuyuta0702 list read of 2026-10-30 07:19Z (channels/{login}/streams?limit=100).
const rows = [
  { streamId: '316682889203', category: 'Just Chatting', categoryId: '509658', gamesSummary: 'Just Chatting · Gakuen iDOLM@STER · Powerful Pro Yakyuu 2026-2027', startedAt: '2026-10-23T04:12:17Z', peakViewers: 5547 },
  { streamId: '316692998003', category: 'Powerful Pro Yakyuu 2026-2027', categoryId: '1189321824', gamesSummary: 'Just Chatting · Powerful Pro Yakyuu 2026-2027', startedAt: '2026-10-25T09:00:20Z', peakViewers: 6996 },
  { streamId: '316644803571', category: 'Gakuen iDOLM@STER', categoryId: '1419480843', gamesSummary: 'Just Chatting · Fork Road · Gakuen iDOLM@STER', startedAt: '2026-10-14T09:00:24Z', peakViewers: 9710 },
  { streamId: '316604576883', category: 'Gakuen iDOLM@STER', categoryId: '1419480843', gamesSummary: 'Just Chatting · and Roger · Gakuen iDOLM@STER', startedAt: '2026-10-05T09:08:27Z', peakViewers: 8396 },
  { streamId: '316584393329', category: 'Gakuen iDOLM@STER', categoryId: '1419480843', gamesSummary: 'Just Chatting', startedAt: '2026-10-16T09:03:18Z', peakViewers: 5822 },
].map(row => ({ ...row, login: 'yuyuta0702', title: `Stream ${row.streamId}` })) as AnalyticsStream[]

const JC_ART = 'https://static-cdn.jtvnw.net/ttv-boxart/509658-144x192.jpg'

function renderRows(streams: AnalyticsStream[]) {
  return render(
    <MemoryRouter>
      <StreamSidebar
        login="yuyuta0702"
        streams={streams}
        isLiveView
        buildSessionPath={(login, id) => `/analytics/${login}/${id}`}
        buildChannelPath={login => `/analytics/${login}`}
      />
    </MemoryRouter>,
  )
}

function gamesOf(streamId: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`a[href="/analytics/yuyuta0702/${streamId}"]`)!
  return row.querySelector<HTMLElement>('[data-stream-games]')!
}

describe('stream list games (GP-4, candidate, 10-30)', () => {
  it('splits the summary on " · " only and maps names to ids from the rows themselves', () => {
    const ids = sidebarCategoryIdsByName(rows)
    expect(Object.fromEntries(ids)).toEqual({
      'Just Chatting': '509658',
      'Powerful Pro Yakyuu 2026-2027': '1189321824',
      'Gakuen iDOLM@STER': '1419480843',
    })
    expect(sidebarStreamGames(rows[3]!, ids)).toEqual([
      { name: 'Just Chatting', categoryId: '509658' },
      { name: 'and Roger' },
      { name: 'Gakuen iDOLM@STER', categoryId: '1419480843' },
    ])
    // No summary: the row's own category stands in.
    expect(sidebarStreamGames({ category: 'Deduce Together', categoryId: '1815045597' }, ids)).toEqual([
      { name: 'Deduce Together', categoryId: '1815045597' },
    ])
  })

  it('drops a name the list maps to two ids, except on the row that owns that pair', () => {
    const clash = [
      { streamId: '1', login: 'x', startedAt: '2026-10-01T00:00:00Z', category: 'Retro', categoryId: '11' },
      { streamId: '2', login: 'x', startedAt: '2026-10-02T00:00:00Z', category: 'Retro', categoryId: '22' },
    ] as AnalyticsStream[]
    const ids = sidebarCategoryIdsByName(clash)
    expect(ids.has('Retro')).toBe(false)
    expect(sidebarStreamGames({ gamesSummary: 'Just Chatting · Retro' }, ids)).toEqual([{ name: 'Just Chatting' }, { name: 'Retro' }])
    expect(sidebarStreamGames({ gamesSummary: 'Retro', category: 'Retro', categoryId: '22' }, ids)).toEqual([{ name: 'Retro', categoryId: '22' }])
  })

  it('shows covers and names as Twitch writes them, with no shouty prefix', () => {
    renderRows(rows)
    const games = gamesOf('316644803571')
    expect(games.className).not.toMatch(/\buppercase\b/)
    expect(games.querySelector('[data-stream-games-names]')!.textContent).toBe('Just Chatting · Fork Road · Gakuen iDOLM@STER')
    expect(games.querySelector('[data-stream-games-names]')!.className).not.toMatch(/\buppercase\b/)
    // The "Games played" words stay for screen readers and the hover title only.
    expect(games.querySelector('.sr-only')!.textContent).toBe('Games played: Just Chatting, Fork Road, Gakuen iDOLM@STER')
    expect(games.getAttribute('title')).toBe('Games played: Just Chatting · Fork Road · Gakuen iDOLM@STER')
    const covers = Array.from(games.querySelectorAll<HTMLElement>('[data-game-cover]'))
    expect(covers.map(cover => cover.dataset.gameCover)).toEqual(['art', 'initials', 'art'])
    expect((covers[0] as HTMLImageElement).getAttribute('src')).toBe(JC_ART)
    expect((covers[2] as HTMLImageElement).getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1419480843-144x192.jpg')
    // No id for Fork Road anywhere in the list: initials, never a name-based guess.
    expect(covers[1]!.textContent).toBe('FR')
    expect(covers[1]!.tagName).toBe('SPAN')
    for (const cover of covers) {
      expect(cover.style.width).toBe('20px')
      expect(cover.style.height).toBe('27px')
    }
    expect(games.querySelector('[data-stream-games-more]')).toBeNull()
  })

  it('caps the covers at 3 and counts the rest as "+N"', () => {
    const long = { ...rows[0]!, streamId: '9', gamesSummary: 'Just Chatting · Fork Road · and Roger · Gakuen iDOLM@STER · Life Is Strange' }
    renderRows([long, ...rows.slice(1)])
    const games = gamesOf('9')
    expect(games.querySelectorAll('[data-game-cover]')).toHaveLength(3)
    expect(games.querySelector('[data-stream-games-names]')!.textContent).toBe('Just Chatting · Fork Road · and Roger')
    expect(games.querySelector('[data-stream-games-more]')!.textContent).toBe('+2')
    expect(games.querySelector('.sr-only')!.textContent).toBe(
      'Games played: Just Chatting, Fork Road, and Roger, Gakuen iDOLM@STER, Life Is Strange',
    )
  })

  it('falls back from the standard cover to the IGDB one, then to initials', () => {
    renderRows(rows)
    const games = gamesOf('316584393329')
    const cover = () => games.querySelector<HTMLElement>('[data-game-cover]')!
    expect(cover().getAttribute('src')).toBe(JC_ART)
    fireEvent.error(cover())
    expect(cover().getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658_IGDB-144x192.jpg')
    fireEvent.error(cover())
    expect(cover().dataset.gameCover).toBe('initials')
    expect(cover().textContent).toBe('JC')
  })

  it("moves past Twitch's grey cover to the IGDB one, shown only once checked (fix, 10-30)", async () => {
    // Checked 10-30: ttv-boxart/1419480843-144x192.jpg redirects to 404_boxart (HTTP 200); only the _IGDB cover is real.
    placeholder.answer.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    renderRows([{ ...rows[2]!, gamesSummary: 'Gakuen iDOLM@STER' }])
    const cover = () => gamesOf('316644803571').querySelector<HTMLImageElement>('[data-game-cover]')!
    expect(cover().getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1419480843-144x192.jpg')
    expect(cover().getAttribute('crossorigin')).toBe('anonymous')
    expect(cover().style.opacity).toBe('0')
    await act(async () => { fireEvent.load(cover()) })
    expect(cover().getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/1419480843_IGDB-144x192.jpg')
    expect(cover().style.opacity).toBe('0')
    await act(async () => { fireEvent.load(cover()) })
    expect(cover().style.opacity).toBe('')
    expect(placeholder.answer).toHaveBeenCalledTimes(2)
  })

  it('keeps the sync badge and the peak line beside the games', () => {
    renderRows(rows)
    const row = document.querySelector<HTMLElement>('a[href="/analytics/yuyuta0702/316682889203"]')!
    expect(row.textContent).toContain('peak 5.5K')
    const badge = row.querySelector('[data-stream-games]')!.nextElementSibling!
    expect(badge.textContent).toBe('Check status')
    expect(badge.getAttribute('title')).toBe('The stream list did not include minute-sync counts. Open this session to load its current coverage.')
  })
})
