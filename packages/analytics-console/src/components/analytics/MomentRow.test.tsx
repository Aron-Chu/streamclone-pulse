import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  momentRowClock,
  momentRowGameAt,
  momentRowHms,
  momentRowNamesNotCaptured,
  momentRowReasonTone,
  momentRowTwitchTime,
} from '../../utils/momentRowDisplay.ts'
import {
  SessionMomentPlayer,
  SessionMomentRow,
  momentRowVodStart,
  type SessionMomentRowModel,
} from './MomentRow.tsx'

const ART = 'https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-210x280.jpg'

function model(overrides: Partial<SessionMomentRowModel> = {}): SessionMomentRowModel {
  return {
    key: 'm1',
    rank: 1,
    offsetSeconds: 3054,
    offsetLabel: '0:50:54',
    clockLabel: '7:37 AM',
    reasonLabel: 'Emote spike',
    reasonTone: 'emotes',
    series: 'emotes',
    score: 56,
    rate: 250,
    spark: [{ slot: 8, value: 250, at: true }],
    game: { name: 'Grand Theft Auto V', artUrls: [ART] },
    emotes: [
      { name: 'HUH', count: 56, provider: 'seventv', imageUrl: 'https://cdn.7tv.app/emote/01FG1NDHJR0001XDR7G9054X2Q/4x.webp' },
      { name: 'LOL', count: 44, provider: 'seventv' },
    ],
    namesNotCaptured: null,
    snapshotOnly: false,
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('session moment row helpers', () => {
  it('prints offsets without a leading hour zero and Twitch times compactly', () => {
    expect(momentRowHms(3054)).toBe('0:50:54')
    expect(momentRowHms(39_600 + 62)).toBe('11:01:02')
    expect(momentRowHms(-4)).toBe('0:00:00')
    expect(momentRowTwitchTime(3044)).toBe('50m44s')
    expect(momentRowTwitchTime(3600 + 5)).toBe('1h0m5s')
    expect(momentRowTwitchTime(9)).toBe('9s')
  })

  it('adds the weekday only when the moment falls on another day than the start', () => {
    const start = new Date(2026, 9, 13, 22, 0, 0).toISOString()
    const sameDay = momentRowClock(start, 60 * 60)!
    const nextDay = momentRowClock(start, 3 * 60 * 60)!
    expect(sameDay).toBe(new Date(2026, 9, 13, 23, 0).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    expect(nextDay.startsWith(new Date(2026, 9, 14).toLocaleDateString([], { weekday: 'short' }) + ' ')).toBe(true)
    expect(momentRowClock(undefined, 60)).toBeNull()
  })

  it('names no emote when the minute names under 25 % of its uses', () => {
    expect(momentRowNamesNotCaptured({ minuteTs: 'x', totalEmoteCount: 400, emotes: { LOL: 40, HUH: 20 } }))
      .toBe('Names for 15% of 400 emote uses in this minute')
    expect(momentRowNamesNotCaptured({ minuteTs: 'x', totalEmoteCount: 5000, emotes: { LOL: 2 } }))
      .toBe('Names for <1% of 5,000 emote uses in this minute')
    expect(momentRowNamesNotCaptured({ minuteTs: 'x', totalEmoteCount: 100, emotes: { LOL: 25 } })).toBeNull()
    expect(momentRowNamesNotCaptured({ minuteTs: 'x', totalEmoteCount: 0 })).toBeNull()
    expect(momentRowNamesNotCaptured(null)).toBeNull()
  })

  it('finds the game segment holding an offset', () => {
    const games = [
      { gameName: 'Just Chatting', offsetSeconds: 0, durationSeconds: 2418 },
      { gameName: 'Grand Theft Auto V', offsetSeconds: 2418, durationSeconds: 38_114 },
    ]
    expect(momentRowGameAt(games, 654)?.gameName).toBe('Just Chatting')
    expect(momentRowGameAt(games, 3054)?.gameName).toBe('Grand Theft Auto V')
    expect(momentRowGameAt(games, 50_000)?.gameName).toBe('Grand Theft Auto V') // live tail
    expect(momentRowGameAt([], 10)).toBeNull()
    expect(momentRowReasonTone('Chat spike')).toBe('chat')
    expect(momentRowReasonTone('Viewer spike')).toBe('other')
  })
})

describe('SessionMomentRow', () => {
  it("renders the mockup row: rank, time, reason, score, game, emote, rate, spark, play", () => {
    render(<SessionMomentRow model={model()} artUrl={ART} lockMode="strip" locked={false} showPlay onActivate={vi.fn()} />)
    const row = screen.getByRole('button', { name: /Moment 1 0:50:54/ })
    expect(row.getAttribute('data-moment-row')).not.toBeNull()
    expect(row.getAttribute('data-moment-rank')).toBe('1')
    expect(row.getAttribute('aria-pressed')).toBe('false')
    expect(row.hasAttribute('aria-expanded')).toBe(false)
    // (candidate, 10-30, PIC-2) no blurred backdrop: the small cover by the game's name is the row's only picture
    expect(row.className).toBe('ssr-row')
    expect(row.querySelector('.ssr-fr')).toBeNull()
    expect(row.querySelector('.ssr-rk')!.textContent).toBe('1')
    expect(row.querySelector('.ssr-off')!.textContent).toBe('0:50:54')
    expect(row.querySelector('.ssr-why.emotes')!.textContent).toBe('Emote spike')
    expect(row.querySelector('.ssr-sc')!.textContent).toBe('reaction score 56 in this stream')
    expect(row.querySelector('.ssr-gm-n')!.textContent).toBe('Grand Theft Auto V')
    // asked at 2x its 15x20 (candidate, 10-30, PIC-2)
    expect(row.querySelector('.ssr-gm img')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/ttv-boxart/32982_IGDB-30x40.jpg')
    expect(row.querySelectorAll('img')).toHaveLength(1 + row.querySelectorAll('.ssr-tok img').length)
    expect(row.querySelectorAll('.ssr-tok')).toHaveLength(2)
    expect(row.querySelector('.ssr-tok .ssr-tok-n')!.textContent).toBe('56')
    expect(row.querySelector('.ssr-rt')!.textContent).toBe('250 emotes/min')
    expect(row.querySelector('.ssr-ev')!.getAttribute('title')).toMatch(/^Emotes per minute, 8 minutes either side/)
    expect(row.querySelector('svg.ssr-msp rect.at')).not.toBeNull()
    expect(row.querySelector('[data-moment-row-play]')!.getAttribute('aria-hidden')).toBe('true')
    // F8: no client-side "× usual"
    expect(row.textContent).not.toMatch(/×|usual/)
  })

  it('draws no backdrop without game art, and never a frame', () => {
    render(<SessionMomentRow model={model({ game: { name: 'Just Chatting', artUrls: [] } })} artUrl={null} lockMode="strip" locked={false} showPlay={false} onActivate={vi.fn()} />)
    const row = screen.getByRole('button')
    expect(row.className).toBe('ssr-row')
    expect(row.querySelector('.ssr-gm img')).toBeNull()
    expect(row.querySelector('[data-moment-row-play]')).toBeNull()
    expect(row.querySelector('.ssr-gm-n')!.textContent).toBe('Just Chatting')
  })

  it('says "emote names not captured" instead of naming emotes from a thin sample', () => {
    render(<SessionMomentRow model={model({ namesNotCaptured: 'Names for 15% of 400 emote uses in this minute' })} artUrl={ART} lockMode="strip" locked={false} showPlay onActivate={vi.fn()} />)
    const nn = screen.getByText('emote names not captured')
    expect(nn.getAttribute('title')).toBe('Names for 15% of 400 emote uses in this minute')
    expect(document.querySelector('.ssr-tok')).toBeNull()
  })

  it('tells the page about hover, with no backdrop to light (candidate, 10-30, PIC-2)', () => {
    const onHover = vi.fn()
    render(<SessionMomentRow model={model()} artUrl={ART} lockMode="strip" locked={false} showPlay onActivate={vi.fn()} onHover={onHover} />)
    const row = screen.getByRole('button')
    fireEvent.pointerEnter(row, { pointerType: 'mouse' })
    expect(onHover).toHaveBeenLastCalledWith(true)
    expect(row.classList.contains('lit')).toBe(false)
    fireEvent.pointerLeave(row, { pointerType: 'mouse' })
    expect(onHover).toHaveBeenLastCalledWith(false)
  })

  it("reports the games answer's URL when the resized cover fails", () => {
    const onArtError = vi.fn()
    render(<SessionMomentRow model={model()} artUrl={ART} lockMode="strip" locked={false} showPlay onActivate={vi.fn()} onArtError={onArtError} />)
    fireEvent.error(document.querySelector('.ssr-gm img')!)
    expect(onArtError).toHaveBeenCalledWith(ART)
  })

  it('rings the locked row with aria-pressed and plays the glow once per lock', () => {
    const { rerender } = render(<SessionMomentRow model={model()} artUrl={ART} lockMode="strip" locked showPlay onActivate={vi.fn()} pop={0} />)
    const row = screen.getByRole('button')
    expect(row.getAttribute('aria-pressed')).toBe('true')
    expect(row.classList.contains('lk')).toBe(true)
    expect(row.classList.contains('sc-moment-row-selected')).toBe(true)
    expect(row.querySelector('[data-moment-row-pop]')).toBeNull()
    rerender(<SessionMomentRow model={model()} artUrl={ART} lockMode="strip" locked showPlay onActivate={vi.fn()} pop={1} />)
    const glow = row.querySelector('[data-moment-row-pop]')!
    expect(glow.className).toBe('ssr-mpop')
    // jsdom has no AnimationEvent, so React listens for the webkit-prefixed name there.
    fireEvent.animationEnd(glow)
    fireEvent(glow, new Event('webkitAnimationEnd', { bubbles: true }))
    expect(row.querySelector('[data-moment-row-pop]')).toBeNull()
  })

  it('reports whether the play button was the click target', () => {
    const onActivate = vi.fn()
    render(<SessionMomentRow model={model()} artUrl={ART} lockMode="strip" locked={false} showPlay onActivate={onActivate} />)
    const row = screen.getByRole('button')
    fireEvent.click(row.querySelector('.ssr-off')!)
    fireEvent.click(row.querySelector('[data-moment-row-play] svg')!)
    expect(onActivate.mock.calls).toEqual([[false], [true]])
  })

  it('is a disclosure in row mode', () => {
    render(<SessionMomentRow model={model()} artUrl={ART} lockMode="row" locked expanded detailId="d1" showPlay onActivate={vi.fn()} />)
    const row = screen.getByRole('button')
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(row.getAttribute('aria-controls')).toBe('d1')
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.hasAttribute('aria-pressed')).toBe(false)
  })
})

describe('SessionMomentPlayer', () => {
  it('offers the VOD 10 s before the moment and loads Twitch only on play', () => {
    render(<SessionMomentPlayer model={model()} artUrl={ART} vodId="2590000000" vodAlignSeconds={-54} vodDurationSeconds={40_000} />)
    expect(momentRowVodStart({ offsetSeconds: 3054, vodId: '2590000000', vodAlignSeconds: -54, vodDurationSeconds: 40_000 })).toBe(2990)
    expect(document.querySelector('iframe')).toBeNull()
    // (fix, 10-30, PIC-3) the reel's line; (candidate, 10-30, PIC-2) no blurred box art in the box
    expect(screen.getByText("Preview frames aren't available right now. Pictures are the game's box art.")).toBeTruthy()
    expect(document.querySelector('.ssr-pl-box img')).toBeNull()
    expect(screen.getByText("Twitch's player loads only when you press play.")).toBeTruthy()
    const cap = document.querySelector('.ssr-pl-cap span[title]')!
    expect(cap.getAttribute('title')).toBe('VOD time = stream time − 54 s (the VOD starts 54 s after the stream went live), then 10 s earlier so the moment plays in')
    expect(screen.getByRole('link', { name: 'Open on Twitch ↗' }).getAttribute('href')).toBe('https://www.twitch.tv/videos/2590000000?t=49m50s')
    fireEvent.click(screen.getByRole('button', { name: 'Play VOD from 0:49:50' }))
    const frame = document.querySelector('iframe')!
    expect(frame.getAttribute('title')).toBe('Twitch VOD from 0:49:50')
    expect(frame.getAttribute('src')).toBe(`https://player.twitch.tv/?video=v2590000000&time=49m50s&parent=${encodeURIComponent(window.location.hostname)}&autoplay=true`)
  })

  it('never guesses a VOD time without a verified alignment', () => {
    render(<SessionMomentPlayer model={model()} artUrl={null} vodId="2590000000" vodAlignSeconds={null} />)
    expect(screen.getByText("This minute isn't in the VOD yet.")).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('says when there is no VOD, and that there are no preview frames while the stream is live', () => {
    render(<SessionMomentPlayer model={model()} artUrl={ART} vodId={null} vodRecording />)
    expect(screen.getByText('No VOD for this stream yet.')).toBeTruthy()
    expect(screen.getByText('No preview frames while the stream is live.')).toBeTruthy()
  })
})
