import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PulseStreamRecap } from '../../apiTypes.ts'
import { configureAnalyticsApi, type AnalyticsApi } from '../../configureApi.ts'
import { setStripPinHover } from '../../utils/sessionStripMoments.ts'
import { resetVodFrameCache } from '../../utils/vodFrames.ts'
import { SESSION_OWNER_SWITCHES } from '../../sessionOwnerSwitches.ts'
import { reelIntervalLabel, reelNote, reelScrubOffsets, reelScrubStep } from './MomentReel.tsx'
import { SessionRecapMomentsStrip } from './SessionRecapMomentsStrip.tsx'

const START = '2026-09-08T18:00:00Z'
const VOD = '2899924626'
const ALIGN = -5
const SHEET = (i: number) => `https://d2vi6trrdongqn.cloudfront.net/af1cb9b7_xqc_1/storyboards/${VOD}-high-${i}.jpg`

/** n moments ten minutes apart from 10 min, score falling with rank. */
function recapWith(n: number): PulseStreamRecap {
  return {
    streamId: 'stream-reel',
    totalMessages: 1000,
    topMoments: Array.from({ length: n }, (_, i) => ({
      offsetSeconds: 600 + i * 600,
      score: 90 - i,
      reasons: ['emote_spike'],
      chatCount: 100,
      emoteCount: 50,
    })),
  }
}

const GAMES = [
  { gameName: 'Grand Theft Auto V', categoryId: '32982', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-210x280.jpg', offsetSeconds: 0, durationSeconds: 36_000 },
]

/** The post-fix answer: one 220x124 tile every 249 s, 50 to a 5x10 sheet. */
function tileFor(offsetSec: number) {
  const index = Math.floor(offsetSec / 249)
  const inSheet = index % 50
  return {
    sheetUrl: SHEET(Math.floor(index / 50)),
    sheetWidth: 1100,
    sheetHeight: 1240,
    cropX: (inSheet % 5) * 220,
    cropY: Math.floor(inSheet / 5) * 124,
    cropW: 220,
    cropH: 124,
    frameIndex: index,
    intervalMilliseconds: 249_000,
  }
}

function configure(getVodStoryboardThumb: AnalyticsApi['getVodStoryboardThumb']) {
  configureAnalyticsApi({ getVodStoryboardThumb } as unknown as AnalyticsApi)
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-moment-card]'))
const card = (rank: number) => document.querySelector<HTMLElement>(`[data-moment-card][data-moment-rank="${rank}"]`)!

function reel(props: Partial<Parameters<typeof SessionRecapMomentsStrip>[0]> = {}) {
  return (
    <SessionRecapMomentsStrip
      recap={recapWith(6)}
      streamStartedAt={START}
      onSelectOffset={vi.fn()}
      games={GAMES}
      reel
      {...props}
    />
  )
}

beforeEach(() => {
  resetVodFrameCache()
  configure(async () => null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MomentReel helpers', () => {
  it('words the tile interval', () => {
    expect(reelIntervalLabel(249)).toBe('4 min 9 s')
    expect(reelIntervalLabel(60)).toBe('1 min')
    expect(reelIntervalLabel(30)).toBe('30 s')
  })

  it('steps three tiles either side across the picture', () => {
    expect([0, 0.1, 0.5, 0.66, 1].map(reelScrubStep)).toEqual([-3, -2, 0, 1, 3])
    expect(reelScrubStep(-1)).toBe(-3)
    expect(reelScrubOffsets(625, 249)).toEqual([874, 376, 1123, 127, 1372])
  })

  it('says what the pictures are, and nothing while the answer is out', () => {
    const frame = { ...tileFor(625), fromSec: 498, intervalSec: 249 }
    expect(reelNote({ frame, reason: null, loading: false, hasArt: true })).toBe(
      "Pictures are Twitch's VOD preview frames, one every 4 min 9 s. Move across one to step through them.",
    )
    expect(reelNote({ frame: { ...frame, intervalSec: null }, reason: null, loading: false, hasArt: true })).toMatch(/not the exact second/)
    expect(reelNote({ frame: null, reason: 'recording', loading: false, hasArt: true })).toBe('No preview frames while the stream is live.')
    expect(reelNote({ frame: null, reason: 'no_storyboard', loading: false, hasArt: true }))
      .toBe("Preview frames aren't available right now. Pictures are the game's box art.")
    // (fix, 10-30, PIC-3) no cover, no claim about box art: just the reason (it said nothing until 10-30)
    expect(reelNote({ frame: null, reason: 'no_storyboard', loading: false, hasArt: false })).toBe("Preview frames aren't available right now.")
    expect(reelNote({ frame: null, reason: null, loading: true, hasArt: true })).toBeNull()
  })

  it("follows the page's recording flag over the frame answer's reason (fix, 10-30, PIC-3)", () => {
    // every VOD answers no_storyboard today (F6), the live one too
    expect(reelNote({ frame: null, reason: 'no_storyboard', loading: false, hasArt: true, recording: true })).toBe('No preview frames while the stream is live.')
    expect(reelNote({ frame: null, reason: 'recording', loading: false, hasArt: true, recording: false }))
      .toBe("Preview frames aren't available right now. Pictures are the game's box art.")
  })
})

describe('SessionRecapMomentsStrip reel', () => {
  it('the page turns the reel on', () => {
    expect(SESSION_OWNER_SWITCHES.momentsReel).toBe(true)
  })

  it('shows the top three as cards (#1 large, #2 and #3 side by side), the rest as rows behind the footer', () => {
    render(reel())
    expect(cards().map((c) => [c.dataset.momentRank, c.dataset.momentCard])).toEqual([['1', 'hero'], ['2', 'small'], ['3', 'small']])
    expect(document.querySelector('.ssr-reel-two')!.querySelectorAll('[data-moment-card]')).toHaveLength(2)
    expect(document.querySelectorAll('.ssr-row')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Show 3 more moments' }))
    expect(cards()).toHaveLength(3)
    expect(Array.from(document.querySelectorAll<HTMLElement>('.ssr-row')).map((r) => r.dataset.momentRank)).toEqual(['4', '5', '6'])
    // the cards stay [data-moment-row] for the page (column fill, specs): 3 cards + 3 rows
    expect(document.querySelectorAll('[data-moment-row]')).toHaveLength(6)
  })

  it("shows the backend's reason and score (F8), the hero's clock, game and emotes, and no '× usual'", () => {
    render(reel())
    expect(card(1).textContent).toContain('Emote spike')
    expect(card(1).textContent).toContain('score 90')
    expect(card(1).textContent).toContain('Grand Theft Auto V')
    expect(card(1).querySelector('.ssr-clk')).not.toBeNull()
    expect(card(2).textContent).toContain('score 89')
    expect(card(2).querySelector('.ssr-clk')).toBeNull()
    expect(document.querySelector('[data-moment-reel]')!.textContent).not.toMatch(/×/)
  })

  it('a card locks, glows once and releases like a row; play locks and asks to play', () => {
    const onSelectOffset = vi.fn()
    const onReleaseOffset = vi.fn()
    const onPlayOffset = vi.fn()
    render(reel({ onSelectOffset, onReleaseOffset, onPlayOffset, vodId: VOD }))
    fireEvent.click(card(2))
    expect(onSelectOffset).toHaveBeenLastCalledWith(1200)
    expect(card(2).getAttribute('aria-pressed')).toBe('true')
    expect(card(2).classList.contains('lk')).toBe(true)
    expect(card(2).querySelectorAll('[data-moment-row-pop]')).toHaveLength(1)
    fireEvent.click(card(2))
    expect(onReleaseOffset).toHaveBeenCalledWith(1200)
    expect(card(2).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(card(3).querySelector('[data-moment-row-play]')!)
    expect(onSelectOffset).toHaveBeenLastCalledWith(1800)
    expect(onPlayOffset).toHaveBeenCalledWith(1800)
  })

  it('a chart pin over a moment ghosts its card', () => {
    render(reel())
    expect(card(1).classList.contains('ghost')).toBe(false)
    act(() => setStripPinHover(600))
    expect(card(1).classList.contains('ghost')).toBe(true)
    act(() => setStripPinHover(null))
    expect(card(1).classList.contains('ghost')).toBe(false)
  })

  it('loads the tile under the middle of each moment minute and shows it, with the note', async () => {
    const get = vi.fn(async (_vod: string, offset: number) => tileFor(offset))
    configure(get)
    render(reel({ vodId: VOD, vodAlignSeconds: ALIGN }))
    await waitFor(() => expect(card(1).dataset.momentFrame).toBe('frame'))
    // 600 s on the stream's clock = 595 s on the VOD's, + 30 s to the minute's middle
    expect(get).toHaveBeenCalledWith(VOD, 625)
    expect(get).toHaveBeenCalledWith(VOD, 1225)
    expect(get).toHaveBeenCalledWith(VOD, 1825)
    const fr = card(1).querySelector<HTMLElement>('[data-moment-card-frame]')!
    expect(fr.style.backgroundImage).toContain(SHEET(0))
    expect(fr.style.backgroundPosition).toBe('50% 0%') // tile 2: column 3 of 5, row 1 of 10
    expect(card(1).querySelector('.ssr-rc-at')!.textContent).toBe('≈ 0:08:23') // tile 2 starts 498 s on the VOD
    expect(card(1).textContent).toContain('Preview frame from about 97 s before the moment.')
    expect(screen.getByText(/one every 4 min 9 s/)).toBeTruthy()
  })

  it('asks for no frame without a verified alignment, and shows the box art with its note', async () => {
    const get = vi.fn(async (_vod: string, offset: number) => tileFor(offset))
    configure(get)
    render(reel({ vodId: VOD }))
    expect(get).not.toHaveBeenCalled()
    expect(card(1).dataset.momentFrame).toBe('fallback')
    // (candidate, 10-30, PIC-2) the cover whole and sharp in the corner, at ~2x its drawn size; nothing blurred
    // fills the card
    expect(card(1).querySelector('img.ssr-rc-cover')!.getAttribute('src'))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-216x288.jpg')
    expect(card(2).querySelector('img.ssr-rc-cover')!.getAttribute('src'))
      .toBe('https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-144x192.jpg')
    expect(card(1).querySelector('.ssr-rc-pic img')).toBeNull()
    expect(document.querySelector('.ssr-rc-art')).toBeNull()
    expect(screen.getByText("Preview frames aren't available right now. Pictures are the game's box art.")).toBeTruthy()
  })

  it("a cover that fails at the asked size reports the games answer's URL, so the next candidate takes over", () => {
    configure(vi.fn(async () => ({ reason: 'no_storyboard' })))
    render(reel({ vodId: VOD }))
    fireEvent.error(card(1).querySelector('img.ssr-rc-cover')!)
    const next = card(1).querySelector('img.ssr-rc-cover')?.getAttribute('src') ?? null
    expect(next).toBe('https://static-cdn.jtvnw.net/ttv-boxart/32982-216x288.jpg')
  })

  it('a VOD with no storyboard asks once and falls back to the box art', async () => {
    const get = vi.fn(async () => ({ reason: 'no_storyboard' }))
    configure(get)
    render(reel({ vodId: VOD, vodAlignSeconds: ALIGN }))
    await waitFor(() => expect(screen.getByText(/the game's box art/)).toBeTruthy())
    expect(cards().every((c) => c.dataset.momentFrame === 'fallback')).toBe(true)
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('a VOD still recording says there are no preview frames while the stream is live', async () => {
    configure(async () => {
      throw Object.assign(new Error('forbidden'), { status: 403 })
    })
    render(reel({ vodId: VOD, vodAlignSeconds: ALIGN }))
    await waitFor(() => expect(screen.getByText('No preview frames while the stream is live.')).toBeTruthy())
  })

  it('moving across a picture steps through the tiles either side; leaving puts the moment back', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent)
    const get = vi.fn(async (_vod: string, offset: number) => tileFor(offset))
    configure(get)
    render(reel({ vodId: VOD, vodAlignSeconds: ALIGN }))
    await waitFor(() => expect(card(1).dataset.momentFrame).toBe('frame'))
    const hero = card(1)
    vi.spyOn(hero, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 300, height: 169, right: 300, bottom: 169, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    fireEvent.pointerEnter(hero)
    // the six tiles around it are asked for up front
    await waitFor(() => expect(get).toHaveBeenCalledWith(VOD, 625 + 3 * 249))
    expect(get).toHaveBeenCalledWith(VOD, 625 - 2 * 249)
    fireEvent.pointerMove(hero, { clientX: 300 })
    await waitFor(() => expect(hero.querySelector('.ssr-rc-at')!.textContent).toBe('≈ 0:20:50')) // tile 5 starts 1245 s on the VOD
    expect(hero.classList.contains('scrubbing')).toBe(true)
    expect(hero.querySelector<HTMLElement>('.ssr-rc-bar i')!.style.left).toBe('100%')
    fireEvent.pointerLeave(hero)
    expect(hero.querySelector('.ssr-rc-at')!.textContent).toBe('≈ 0:08:23')
    expect(hero.classList.contains('scrubbing')).toBe(false)
  })

  it('row mode keeps rows (the reel is the strip mode only)', () => {
    render(reel({ lockMode: 'row' }))
    expect(cards()).toHaveLength(0)
    expect(document.querySelectorAll('.ssr-row')).toHaveLength(3)
  })

  it('one or two moments: the hero alone, or the hero and one card', () => {
    const { rerender } = render(reel({ recap: recapWith(1) }))
    expect(cards().map((c) => c.dataset.momentCard)).toEqual(['hero'])
    expect(document.querySelector('.ssr-reel-two')).toBeNull()
    rerender(reel({ recap: recapWith(2) }))
    expect(cards().map((c) => c.dataset.momentCard)).toEqual(['hero', 'small'])
    expect(document.querySelector('[data-moment-list-more]')).toBeNull()
  })
})
