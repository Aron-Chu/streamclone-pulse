/**
 * GameArt box art by name (LW-5/GP-5, fix, 10-30). The hub sends no art per
 * live channel, so a game without vetted moment art showed only its initials.
 * Twitch serves box art by name, but an unknown name gets its grey "?" cover
 * with HTTP 200: the cover loads with CORS, stays hidden until the placeholder
 * check clears it, and a proven placeholder or a failed load shows the initials.
 * Since 11-02 such a game is looked up in a live stream's game list (hubGameArt),
 * which has its exact cover.
 */
import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const check = vi.hoisted(() => ({ placeholder: vi.fn(async (_img: HTMLImageElement) => false) }))
const games = vi.hoisted(() => ({ load: vi.fn(async (_streamId: string) => new Map<string, { categoryId: string; boxArtUrl: string }>()) }))

vi.mock('../../packages/analytics-console/src/utils/twitchBoxArt.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../packages/analytics-console/src/utils/twitchBoxArt.ts')>()),
  isTwitchPlaceholderBoxArt: check.placeholder,
}))

vi.mock('../src/lib/momentCategoryArtwork', () => ({ loadCategoryArtwork: games.load }))

import { GAME_ART_KEY, GAME_ART_READS, GAME_ART_STREAMS, askGameArt, resetGameArtForTests } from '../src/lib/hubGameArt'
import { GameArt } from '../src/ui/components/hub/v5/HubV5Rack'
import { HUB_NO_CATEGORY } from '../src/ui/components/hub/v5/hubV5Model'

const GTA_BY_NAME = 'https://static-cdn.jtvnw.net/ttv-boxart/Grand%20Theft%20Auto%20V-60x80.jpg'

afterEach(() => {
  check.placeholder.mockReset()
  check.placeholder.mockImplementation(async () => false)
  games.load.mockReset()
  games.load.mockImplementation(async () => new Map())
  resetGameArtForTests()
})

const PBZ = 'https://static-cdn.jtvnw.net/ttv-boxart/306019403_IGDB-210x280.jpg'
const answer = (...rows: [string, string][]) => new Map(rows.map(([name, url]) => [name, { categoryId: url.match(/\/(\d+)(?:_IGDB)?-/)![1]!, boxArtUrl: url }]))
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

describe('GameArt box art by name (fix, 10-30)', () => {
  it('loads Twitch box art by name with CORS when no vetted art is known', () => {
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toBe(GTA_BY_NAME)
    expect(img!.getAttribute('crossorigin')).toBe('anonymous')
    expect(img!.getAttribute('referrerpolicy')).toBe('no-referrer')
    // hidden until the placeholder check clears it
    expect(img!.style.opacity).toBe('0')
  })

  it('shows the cover once the check says it is not the "?" placeholder', async () => {
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    const img = container.querySelector('img')!
    await act(async () => { fireEvent.load(img) })
    expect(check.placeholder).toHaveBeenCalledWith(img)
    expect(container.querySelector('img')!.style.opacity).toBe('')
    expect(container.textContent).toBe('')
  })

  it('falls back to the initials when the cover is Twitch\'s placeholder', async () => {
    check.placeholder.mockImplementation(async () => true)
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('GT')
  })

  it('falls back to the initials when the cover does not load', () => {
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    fireEvent.error(container.querySelector('img')!)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('GT')
  })

  it('keeps the cover when the check cannot tell', async () => {
    check.placeholder.mockImplementation(async () => { throw new Error('tainted canvas') })
    const { container } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    expect(container.querySelector('img')!.style.opacity).toBe('')
  })

  it('asks for nothing by name for "No category"', () => {
    const { container } = render(<GameArt url={undefined} name={HUB_NO_CATEGORY} w={30} h={40} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('NC')
  })

  it('tries the next game after a failed one', () => {
    const { container, rerender } = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} />)
    fireEvent.error(container.querySelector('img')!)
    rerender(<GameArt url={undefined} name="Just Chatting" w={30} h={40} />)
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/Just%20Chatting-60x80.jpg')
  })

  it('keeps vetted art as before: three times the box, no CORS, no check', async () => {
    const { container } = render(<GameArt url="https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-52x72.jpg" name="Grand Theft Auto V" w={30} h={40} />)
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-90x120.jpg')
    expect(img.hasAttribute('crossorigin')).toBe(false)
    expect(img.style.opacity).toBe('')
    await act(async () => { fireEvent.load(img) })
    expect(check.placeholder).not.toHaveBeenCalled()
    fireEvent.error(img)
    expect(container.textContent).toBe('GT')
  })
})

describe('GameArt for a game Twitch’s by-name covers do not know (11-02)', () => {
  it('looks a placeholder game up in its stream’s game list and shows the exact cover', async () => {
    check.placeholder.mockImplementation(async () => true)
    games.load.mockImplementation(async () => answer(['Phantom Blade Zero', PBZ]))
    const { container } = render(<GameArt url={undefined} name="Phantom Blade Zero" w={30} h={40} streamIds={['s1']} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    await flush()
    expect(games.load).toHaveBeenCalledWith('s1')
    const img = container.querySelector('img')!
    expect(img.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/306019403_IGDB-90x120.jpg')
    // checked like a by-name cover: hidden until the check clears it
    expect(img.getAttribute('crossorigin')).toBe('anonymous')
    expect(img.style.opacity).toBe('0')
    check.placeholder.mockImplementation(async () => false)
    await act(async () => { fireEvent.load(img) })
    expect(container.querySelector('img')!.style.opacity).toBe('')
    // kept: the next page load shows it at once, with no read
    expect(JSON.parse(localStorage.getItem(GAME_ART_KEY)!)['Phantom Blade Zero'].url).toBe(PBZ)
    resetGameArtForTests()
    const again = render(<GameArt url={undefined} name="Phantom Blade Zero" w={18} h={24} streamIds={['s1']} />)
    expect(again.container.querySelector('img')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/306019403_IGDB-54x72.jpg')
    expect(games.load).toHaveBeenCalledTimes(1)
  })

  it('shows the initials, and keeps a miss, when the looked-up cover is Twitch’s placeholder too', async () => {
    check.placeholder.mockImplementation(async () => true)
    games.load.mockImplementation(async () => answer(['Corrupt', 'https://static-cdn.jtvnw.net/ttv-boxart/148148317-210x280.jpg']))
    const { container } = render(<GameArt url={undefined} name="Corrupt" w={30} h={40} streamIds={['s1']} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    await flush()
    expect(container.querySelector('img')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/148148317-90x120.jpg')
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toBe('C')
    expect(JSON.parse(localStorage.getItem(GAME_ART_KEY)!).Corrupt.url).toBeNull()
  })

  it('keeps only the game it asked about: a list’s other games keep their by-name covers', async () => {
    check.placeholder.mockImplementation(async () => true)
    games.load.mockImplementation(async () => answer(['Phantom Blade Zero', PBZ], ['Slots', 'https://static-cdn.jtvnw.net/ttv-boxart/498566-210x280.jpg']))
    const { container } = render(<GameArt url={undefined} name="Phantom Blade Zero" w={30} h={40} streamIds={['s1']} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    await flush()
    expect(Object.keys(JSON.parse(localStorage.getItem(GAME_ART_KEY)!))).toEqual(['Phantom Blade Zero'])
    const slots = render(<GameArt url={undefined} name="Slots" w={30} h={40} />)
    expect(slots.container.querySelector('img')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/Slots-60x80.jpg')
  })

  it('keeps a miss, so the next page load shows the initials without a read or a by-name try', async () => {
    check.placeholder.mockImplementation(async () => true)
    games.load.mockImplementation(async () => answer(['Just Chatting', 'https://static-cdn.jtvnw.net/ttv-boxart/509658-285x380.jpg']))
    const { container } = render(<GameArt url={undefined} name="Corrupt" w={30} h={40} streamIds={['s2']} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    await flush()
    expect(container.textContent).toBe('C')
    resetGameArtForTests()
    const again = render(<GameArt url={undefined} name="Corrupt" w={30} h={40} streamIds={['s2']} />)
    expect(again.container.querySelector('img')).toBeNull()
    expect(games.load).toHaveBeenCalledTimes(1)
  })

  it('reads nothing without a stream, or for a cover that is not the placeholder', async () => {
    check.placeholder.mockImplementation(async () => true)
    const { container } = render(<GameArt url={undefined} name="Corrupt" w={30} h={40} />)
    await act(async () => { fireEvent.load(container.querySelector('img')!) })
    check.placeholder.mockImplementation(async () => false)
    const other = render(<GameArt url={undefined} name="Grand Theft Auto V" w={30} h={40} streamIds={['s3']} />)
    await act(async () => { fireEvent.load(other.container.querySelector('img')!) })
    await flush()
    expect(games.load).not.toHaveBeenCalled()
  })

  it('reads one at a time, each game once, at most 12 a page load', async () => {
    let release = () => {}
    games.load.mockImplementationOnce(() => new Promise((done) => { release = () => done(new Map()) }))
    askGameArt('G0', ['s0'])
    askGameArt('G0', ['s0'])
    askGameArt('G1', ['s1'])
    await flush()
    expect(games.load).toHaveBeenCalledTimes(1)
    release()
    await flush()
    expect(games.load.mock.calls.map((c) => c[0])).toEqual(['s0', 's1'])
    for (let i = 2; i < 20; i++) askGameArt(`G${i}`, [`s${i}`])
    for (let i = 0; i < 20; i++) await flush()
    expect(games.load).toHaveBeenCalledTimes(GAME_ART_READS)
  })

  it('tries the next stream playing the game when a stream’s list lags its live category, at most 3', async () => {
    games.load.mockImplementation(async (id: string) => (id === 'c' ? answer(['Phantom Blade Zero', PBZ]) : answer(['VALORANT', 'https://static-cdn.jtvnw.net/ttv-boxart/516575-210x280.jpg'])))
    askGameArt('Phantom Blade Zero', ['a', null, 'b', 'a', 'c', 'd'])
    for (let i = 0; i < 5; i++) await flush()
    expect(games.load.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
    expect(JSON.parse(localStorage.getItem(GAME_ART_KEY)!)['Phantom Blade Zero'].url).toBe(PBZ)
    games.load.mockClear()
    askGameArt('Corrupt', ['e', 'f', 'g', 'h'])
    for (let i = 0; i < 5; i++) await flush()
    expect(games.load).toHaveBeenCalledTimes(GAME_ART_STREAMS)
    expect(JSON.parse(localStorage.getItem(GAME_ART_KEY)!).Corrupt.url).toBeNull()
  })
})
