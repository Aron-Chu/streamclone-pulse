import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PulseStreamRecap } from '../../apiTypes.ts'
import { SessionRecapMomentsStrip } from './SessionRecapMomentsStrip.tsx'
import { SESSION_MOMENTS_SHOWN } from '../../utils/momentListDisplay.tsx'

const START = '2026-09-08T18:00:00Z'
const startMs = Date.parse(START)
const minuteTs = (offset: number) => new Date(startMs + offset * 1000).toISOString()

/** n moments a minute apart from 10 min, score falling with rank. */
function recapWith(n: number): PulseStreamRecap {
  return {
    streamId: 'stream-n',
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
  { gameName: 'Just Chatting', categoryId: '509658', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg', offsetSeconds: 0, durationSeconds: 1800 },
  { gameName: 'Grand Theft Auto V', categoryId: '32982', boxArtUrl: 'https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-210x280.jpg', offsetSeconds: 1800, durationSeconds: 36_000 },
]

const rows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-moment-row]'))
const row = (rank: number) => document.querySelector<HTMLElement>(`[data-moment-rank="${rank}"]`)!

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('SessionRecapMomentsStrip analytical identity', () => {
  it("shows the exact minute's rate and emotes, never the detection snapshot's", () => {
    render(
      <SessionRecapMomentsStrip
        recap={{ streamId: 'stream-1', topMoments: [{
          offsetSeconds: 600, score: 27, reasons: ['emote_spike'],
          chatCount: 641, emoteCount: 22,
          topEmotes: [{ code: 'StaleSnapshot', count: 10 }],
        }] }}
        rollups={[{ minuteTs: '2026-09-08T18:10:00Z', chatCount: 416,
          totalEmoteCount: 94, emotes: { stabeBlue: 71 } }]}
        streamStartedAt={START}
        selectedOffsetSeconds={600}
        onSelectOffset={vi.fn()}
        selectedDetail={<a href="https://www.twitch.tv/videos/123?t=9m56s">Watch source</a>}
      />,
    )
    const r = row(1)
    expect(r.querySelector('.ssr-rt')!.textContent).toBe('94 emotes/min')
    expect(r.textContent).not.toContain('641')
    expect(screen.queryByTitle('StaleSnapshot: 10 uses')).toBeNull()
    expect(screen.getByTitle('stabeBlue: 71 uses')).toBeTruthy()
    // Strip mode: the chart's selection rings the row; nothing opens in place.
    expect(r.getAttribute('aria-pressed')).toBe('true')
    expect(r.hasAttribute('aria-expanded')).toBe(false)
    const pinned = document.querySelector('[data-moment-review-pinned]')
    expect(pinned?.textContent).toContain('Watch source')
    expect(pinned!.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(r.nextElementSibling).toBeNull()
  })

  it('uses analytical offsets for display, selection and hover', () => {
    const onSelectOffset = vi.fn()
    const onPreviewOffset = vi.fn()
    render(
      <SessionRecapMomentsStrip
        recap={{
          streamId: 'stream-1',
          topMoments: [{
            offsetSeconds: 600,
            reactionOnsetOffsetSeconds: 608,
            seekOffsetSeconds: 580,
            precisionSeconds: 1,
            score: 90,
            reasons: ['chat_spike'],
            chatCount: 100,
          }],
        }}
        selectedOffsetSeconds={0}
        onSelectOffset={onSelectOffset}
        onPreviewOffset={onPreviewOffset}
      />,
    )
    const r = screen.getByText('Chat spike').closest('button')!
    fireEvent.pointerEnter(r, { pointerType: 'mouse' })
    fireEvent.click(r)
    expect(onPreviewOffset).toHaveBeenCalledWith(608)
    expect(onSelectOffset).toHaveBeenCalledWith(608)
    expect(screen.getByText('0:10:08')).toBeTruthy()
    expect(r.getAttribute('data-moment-offset')).toBe('608')
  })
})

describe('SessionRecapMomentsStrip d3-v2 rows', () => {
  it('drops the old header, explainer and amber line; keeps a hidden heading', () => {
    render(<SessionRecapMomentsStrip recap={recapWith(6)} streamStartedAt={START} onSelectOffset={vi.fn()} />)
    const region = screen.getByRole('region', { name: 'Pulse moments recap' })
    expect(within(region).getByRole('heading', { name: 'Pulse Moments' }).parentElement!.className).toBe('ssr-vh')
    expect(region.textContent).not.toMatch(/Select a moment to review its minute/)
    expect(region.textContent).not.toMatch(/#1/)
    expect(region.querySelector('.bg-gradient-to-r')).toBeNull()
    expect(row(1).querySelector('.ssr-off')!.textContent).toBe('0:10:00')
    expect(screen.getByRole('button', { name: 'Show 3 more moments' })).toBeTruthy()
  })

  it('shows the game and its blurred box art; a failed image falls to the next candidate, then to none', () => {
    render(<SessionRecapMomentsStrip recap={recapWith(5)} streamStartedAt={START} games={GAMES} onSelectOffset={vi.fn()} />)
    expect(row(1).querySelector('.ssr-gm-n')!.textContent).toBe('Just Chatting')
    expect(row(3).querySelector('.ssr-gm-n')!.textContent).toBe('Grand Theft Auto V')
    const art = () => row(1).querySelector('img.ssr-fr-art')?.getAttribute('src') ?? null
    expect(art()).toBe('https://static-cdn.jtvnw.net/ttv-boxart/509658-210x280.jpg')
    expect(row(1).className).toContain('has-art has-bd')
    const seen = new Set<string>()
    for (let guard = 0; guard < 10 && art(); guard += 1) {
      seen.add(art()!)
      fireEvent.error(row(1).querySelector('img.ssr-fr-art')!)
    }
    expect(seen.size).toBeGreaterThan(1)
    expect(Array.from(seen).every((url) => url.startsWith('https://static-cdn.jtvnw.net/ttv-boxart/'))).toBe(true)
    expect(art()).toBeNull()
    expect(row(1).className).not.toContain('has-bd')
    expect(row(1).querySelector('.ssr-gm-n')!.textContent).toBe('Just Chatting')
  })

  it('draws each row spark from the measured minutes around it', () => {
    const rollups = Array.from({ length: 30 }, (_, i) => ({ minuteTs: minuteTs(i * 60), chatCount: 10 + i, totalEmoteCount: 5 + i }))
    render(<SessionRecapMomentsStrip recap={recapWith(1)} streamStartedAt={START} rollups={rollups} onSelectOffset={vi.fn()} />)
    const rects = row(1).querySelectorAll('svg.ssr-msp rect')
    expect(rects).toHaveLength(17)
    expect(row(1).querySelectorAll('svg.ssr-msp rect.at')).toHaveLength(1)
    expect(row(1).querySelector('.ssr-rt')!.textContent).toBe('15 emotes/min')
  })

  it('shows the top three rows collapsed; the footer counts the rest', () => {
    const { rerender } = render(<SessionRecapMomentsStrip recap={recapWith(12)} streamStartedAt={START} onSelectOffset={vi.fn()} />)
    expect(SESSION_MOMENTS_SHOWN).toBe(3)
    expect(rows()).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Show 9 more moments' })).toBeTruthy()
    rerender(<SessionRecapMomentsStrip recap={recapWith(2)} streamStartedAt={START} onSelectOffset={vi.fn()} />)
    expect(rows()).toHaveLength(2)
    expect(document.querySelector('[data-moment-list-more]')).toBeNull()
  })
})

describe('SessionRecapMomentsStrip lock (strip mode)', () => {
  it('locks on click, plays the glow once, and the same row releases', () => {
    const onSelectOffset = vi.fn()
    const onReleaseOffset = vi.fn()
    const view = (selected: number | null) => (
      <SessionRecapMomentsStrip
        recap={recapWith(6)}
        streamStartedAt={START}
        selectedOffsetSeconds={selected}
        onSelectOffset={onSelectOffset}
        onReleaseOffset={onReleaseOffset}
      />
    )
    const { rerender } = render(view(null))
    expect(rows().every((r) => r.getAttribute('aria-pressed') === 'false')).toBe(true)
    fireEvent.click(row(2))
    expect(onSelectOffset).toHaveBeenLastCalledWith(1200)
    expect(row(2).getAttribute('aria-pressed')).toBe('true')
    expect(row(2).classList.contains('lk')).toBe(true)
    expect(row(2).querySelectorAll('[data-moment-row-pop]')).toHaveLength(1)
    rerender(view(1200)) // the page echoes the selection: no second glow
    expect(row(2).getAttribute('aria-pressed')).toBe('true')
    expect(row(2).querySelectorAll('[data-moment-row-pop]')).toHaveLength(1)
    fireEvent.click(row(2))
    expect(onReleaseOffset).toHaveBeenCalledWith(1200)
    expect(row(2).getAttribute('aria-pressed')).toBe('false')
    rerender(view(null))
    expect(rows().some((r) => r.getAttribute('aria-pressed') === 'true')).toBe(false)
  })

  it('drops the ring when the page clears its selection (Esc)', () => {
    const view = (selected: number | null) => (
      <SessionRecapMomentsStrip recap={recapWith(6)} streamStartedAt={START} selectedOffsetSeconds={selected} onSelectOffset={vi.fn()} />
    )
    const { rerender } = render(view(null))
    fireEvent.click(row(3))
    rerender(view(1800))
    expect(row(3).getAttribute('aria-pressed')).toBe('true')
    rerender(view(null))
    expect(row(3).getAttribute('aria-pressed')).toBe('false')
  })

  it('without onReleaseOffset a second click keeps the lock', () => {
    const onSelectOffset = vi.fn()
    render(<SessionRecapMomentsStrip recap={recapWith(6)} streamStartedAt={START} onSelectOffset={onSelectOffset} />)
    fireEvent.click(row(1))
    fireEvent.click(row(1))
    expect(onSelectOffset.mock.calls).toEqual([[600], [600]])
    expect(row(1).getAttribute('aria-pressed')).toBe('true')
  })

  it('a lock past the collapsed rows opens the list', () => {
    const view = (selected: number | null) => (
      <SessionRecapMomentsStrip recap={recapWith(9)} streamStartedAt={START} selectedOffsetSeconds={selected} onSelectOffset={vi.fn()} />
    )
    const { rerender } = render(view(null))
    expect(rows()).toHaveLength(3)
    rerender(view(600 + 7 * 600)) // rank 8, from a chart bar
    expect(rows()).toHaveLength(9)
    expect(row(8).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Show fewer moments' })).toBeTruthy()
  })

  it('the play button locks the moment and asks the page to play it', () => {
    const onSelectOffset = vi.fn()
    const onPlayOffset = vi.fn()
    const onReleaseOffset = vi.fn()
    render(
      <SessionRecapMomentsStrip
        recap={recapWith(5)}
        streamStartedAt={START}
        vodId="2590000000"
        onSelectOffset={onSelectOffset}
        onPlayOffset={onPlayOffset}
        onReleaseOffset={onReleaseOffset}
      />,
    )
    const play = row(1).querySelector('[data-moment-row-play]')!
    fireEvent.click(play)
    expect(onSelectOffset).toHaveBeenCalledWith(600)
    expect(onPlayOffset).toHaveBeenCalledWith(600)
    fireEvent.click(play) // play again on the locked row never releases it
    expect(onReleaseOffset).not.toHaveBeenCalled()
    expect(onPlayOffset).toHaveBeenCalledTimes(2)
  })

  it('shows the play button only when the stream has a VOD', () => {
    const { rerender } = render(<SessionRecapMomentsStrip recap={recapWith(5)} streamStartedAt={START} onSelectOffset={vi.fn()} />)
    expect(document.querySelector('[data-moment-row-play]')).toBeNull()
    rerender(<SessionRecapMomentsStrip recap={recapWith(5)} streamStartedAt={START} vodId="not-a-vod" onSelectOffset={vi.fn()} />)
    expect(document.querySelector('[data-moment-row-play]')).toBeNull()
    rerender(<SessionRecapMomentsStrip recap={recapWith(5)} streamStartedAt={START} vodId="2590000000" onSelectOffset={vi.fn()} />)
    expect(document.querySelectorAll('[data-moment-row-play]')).toHaveLength(3)
  })
})

describe('SessionRecapMomentsStrip row mode', () => {
  it('opens the detail in place under the row and closes it on a second click', () => {
    vi.useFakeTimers()
    const onSelectOffset = vi.fn()
    const onReleaseOffset = vi.fn()
    const view = (selected: number | null) => (
      <SessionRecapMomentsStrip
        recap={recapWith(6)}
        streamStartedAt={START}
        lockMode="row"
        games={GAMES}
        vodId="2590000000"
        vodAlignSeconds={30}
        selectedOffsetSeconds={selected}
        selectedDetail={<p>Selected minute card</p>}
        onSelectOffset={onSelectOffset}
        onReleaseOffset={onReleaseOffset}
      />
    )
    const { rerender } = render(view(null))
    expect(row(2).getAttribute('aria-expanded')).toBe('false')
    expect(row(2).hasAttribute('aria-pressed')).toBe(false)
    fireEvent.click(row(2))
    rerender(view(1200))
    expect(onSelectOffset).toHaveBeenCalledWith(1200)
    expect(row(2).getAttribute('aria-expanded')).toBe('true')
    const detail = screen.getByRole('region', { name: 'Moment 2 detail' })
    expect(row(2).getAttribute('aria-controls')).toBe(detail.id)
    expect(row(2).nextElementSibling).toBe(detail)
    expect(within(detail).getByText('Selected minute card')).toBeTruthy()
    // 1200 s + 30 s alignment, 10 s lead-in
    expect(within(detail).getByRole('button', { name: 'Play VOD from 0:20:20' })).toBeTruthy()
    expect(detail.querySelector('iframe')).toBeNull()
    fireEvent.click(row(2))
    expect(onReleaseOffset).toHaveBeenCalledWith(1200)
    expect(row(2).getAttribute('aria-expanded')).toBe('false')
    act(() => { vi.advanceTimersByTime(250) })
    expect(screen.queryByRole('region', { name: 'Moment 2 detail' })).toBeNull()
  })

  it("the row's play button opens the detail playing", () => {
    render(
      <SessionRecapMomentsStrip
        recap={recapWith(3)}
        streamStartedAt={START}
        lockMode="row"
        vodId="2590000000"
        vodAlignSeconds={0}
        onSelectOffset={vi.fn()}
      />,
    )
    fireEvent.click(row(1).querySelector('[data-moment-row-play]')!)
    const frame = document.querySelector('[data-moment-row-detail] iframe')!
    expect(frame.getAttribute('src')).toContain('https://player.twitch.tv/?video=v2590000000&time=9m50s&parent=')
  })
})
