/**
 * Front page chat band, "Fastest chats" (board artifacts/chat-now-board-20261122, ★ 1A 2A 3A, 11-22): the Hub's
 * Busiest now order on the page's own 30m read, "right now" only over counts the Hub calls Live, Twitch's chat
 * beside the list only for a row pointed at with a mouse and no data saver, and board option D's chat column when
 * Twitch does not load in 10 seconds.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePublicHub, type HubLiveChannel, type PublicHub } from '../src/lib/publicHub'
import { LandingChatNow } from '../src/ui/components/landing/LandingChatNow'
import {
  CHAT_COLUMN_LINES,
  CHAT_LINE_EMOTES_MAX,
  CHAT_PEEK_DRAW_MS,
  CHAT_PEEK_FADE_MS,
  CHAT_PEEK_SETTLE_MS,
  CHAT_PEEK_TIMEOUT_MS,
  chatBarPct,
  chatColumnLine,
  chatEmotesPerMessage,
  chatMessagesPerLine,
  chatNowBand,
  chatPeekAllowed,
  chatTicks,
  twitchChatEmbedUrl,
} from '../src/ui/components/landing/landingChatNowModel'

const raw = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8'))
const down = normalizePublicHub(raw)
const nowMs = Date.parse(down.generatedAt)
const RATES = [900, 640, 410, 380, 220, 120]

/** A row with a full 5-minute window that ended `ageMs` before nowMs (the healthy screener shape). */
function withFullWindow(c: HubLiveChannel, perMin: number, ageMs = 60_000): HubLiveChannel {
  const end = nowMs - ageMs
  return {
    ...c,
    coverageState: 'synced',
    screenerV1: {
      ...c.screenerV1!,
      state: 'ready',
      reason: undefined,
      currentWindow: { start: end - 300_000, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
      chat: { ...c.screenerV1!.chat!, state: 'ready', reason: undefined, currentPerMin: perMin },
    },
  } as HubLiveChannel
}

function healthy(rates = RATES, ageMs = 60_000): Pick<PublicHub, 'liveChannels' | 'generatedAt'> {
  const live = down.liveChannels.slice(0, rates.length).map((c, i) => withFullWindow(c, rates[i], ageMs))
  return { liveChannels: live, generatedAt: down.generatedAt }
}

describe('chatNowBand', () => {
  it('ranks the five busiest by the Hub order and says "right now" over live counts', () => {
    const band = chatNowBand(healthy(), nowMs)!
    expect(band.state).toBe('live')
    expect(band.title).toBe('Fastest chats right now')
    expect(band.sub).toBe('Chat messages per minute over the last 5 minutes, in the live channels StreamPulse reads')
    expect(band.rows.map((r) => r.perMin)).toEqual([900, 640, 410, 380, 220])
    expect(band.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5])
  })

  it('drops "right now" once the counts are more than 3 minutes old and says when they stopped', () => {
    const band = chatNowBand(healthy(), nowMs + 10 * 60_000)!
    expect(band.state).toBe('stale')
    expect(band.title).toBe('Fastest chats')
    expect(band.sub).toMatch(/^Chat messages per minute over 5 minutes, not updated since \d{1,2}:\d{2} [AP]M$/)
  })

  it('shows nothing for counts more than a day old, fewer than two rows, or no hub', () => {
    expect(chatNowBand(healthy(), nowMs + 25 * 60 * 60_000)).toBeNull()
    expect(chatNowBand(healthy([500]), nowMs)).toBeNull()
    expect(chatNowBand({ liveChannels: [], generatedAt: down.generatedAt }, nowMs)).toBeNull()
    expect(chatNowBand(null, nowMs)).toBeNull()
  })

  it('names the recent average as one while the 5-minute counts are down', () => {
    const band = chatNowBand(down, nowMs)!
    expect(band.state).toBe('average')
    expect(band.title).toBe('Fastest chats')
    expect(band.sub).toBe('Chat messages per minute, recent average, in the live channels StreamPulse reads')
    expect(chatNowBand(down, nowMs + 10 * 60_000)!.sub).toMatch(/recent average as of \d{1,2}:\d{2} [AP]M,/)
    expect(chatNowBand(down, nowMs + 25 * 60 * 60_000)).toBeNull()
  })
})

describe('ticks, the chat column and bars', () => {
  it('moves every bar at one speed and spaces ticks one message apart', () => {
    expect(chatTicks(120)).toEqual({ gap: 60, seconds: 0.5, run: 240, loopSeconds: 2 })
    expect(chatTicks(900)).toEqual({ gap: 8, seconds: 8 / 120, run: 240, loopSeconds: 2 })
    // a loop is whole spacings, about 2 s, at the same speed
    expect(chatTicks(20)).toMatchObject({ run: 288, loopSeconds: 2.4 })
    expect(chatTicks(5000)).toMatchObject({ run: 240, loopSeconds: 2 })
    // past the limits the spacing stops
    expect(chatTicks(5000)!.gap).toBe(4)
    expect(chatTicks(20)!.gap).toBe(96)
    expect(chatTicks(0)).toBeNull()
    expect(chatTicks(Number.NaN)).toBeNull()
  })

  it('loops whole spacings at the same speed when the spacing is not a whole number of pixels', () => {
    expect(chatTicks(1000)).toEqual({ gap: 7.2, seconds: 7.2 / 120, run: 237.6, loopSeconds: 1.98 })
    for (let perMin = 1; perMin <= 3000; perMin += 7) {
      const t = chatTicks(perMin)!
      const spacings = t.run / t.gap
      // the loop ends where it began: a whole number of spacings, so the seam cannot show
      expect(Math.abs(spacings - Math.round(spacings))).toBeLessThan(1e-9)
      expect(Math.round(spacings)).toBeGreaterThanOrEqual(1)
      // the same 120 px a second as one spacing, and about 2 s a loop
      expect(t.run / t.loopSeconds).toBeCloseTo(120, 9)
      expect(Math.abs(t.run - 240)).toBeLessThanOrEqual(t.gap / 2 + 1e-9)
    }
  })

  it('makes each line one message until twelve a second, and names the square only when the chat has emotes', () => {
    expect(chatMessagesPerLine(600)).toBe(1)
    expect(chatMessagesPerLine(1200)).toBe(2)
    expect(chatColumnLine(600, 0)).toBe('Each bar is one message we counted. We don’t keep the words.')
    expect(chatColumnLine(1200, 0.4)).toBe('Each bar is 2 messages we counted, each square an emote. We don’t keep the words.')
  })

  it("reads a chat's emotes per message from its own record in the hub answer", () => {
    const hub = {
      liveChannels: [
        { login: 'a', chatPerMin: 200, emotesPerMin: 50 },
        { login: 'b', chatPerMin: 0, emotesPerMin: 5 },
        { login: 'c', chatPerMin: 100 },
      ] as HubLiveChannel[],
    }
    expect(chatEmotesPerMessage(hub, 'a')).toBe(0.25)
    expect(chatEmotesPerMessage(hub, 'b')).toBe(0)
    expect(chatEmotesPerMessage(hub, 'c')).toBe(0)
    expect(chatEmotesPerMessage(hub, 'zz')).toBe(0)
    expect(chatEmotesPerMessage(null, 'a')).toBe(0)
    // the screener's 5 minutes, the row figure's own window, win when both counts are ready there
    const five = withFullWindow(down.liveChannels[0], 400)
    const screened = { ...five, chatPerMin: 200, emotesPerMin: 50, screenerV1: { ...five.screenerV1!, emotes: { ...five.screenerV1!.chat!, currentPerMin: 160 } } }
    expect(chatEmotesPerMessage({ liveChannels: [screened] }, screened.login)).toBe(0.4)
    const notReady = { ...screened, screenerV1: { ...screened.screenerV1, emotes: { ...screened.screenerV1.emotes, state: 'warming' } } }
    expect(chatEmotesPerMessage({ liveChannels: [notReady] }, screened.login)).toBe(0.25)
  })

  it('keeps a sliver for a slow chat', () => {
    expect(chatBarPct(450, 900)).toBe(50)
    expect(chatBarPct(1, 900)).toBe(6)
    expect(chatBarPct(5, 0)).toBe(6)
  })

  it("asks for Twitch's dark chat for this page's host", () => {
    expect(twitchChatEmbedUrl('some_channel', 'streampulse.stream')).toBe(
      'https://www.twitch.tv/embed/some_channel/chat?parent=streampulse.stream&darkpopout',
    )
  })
})

interface Media { wide?: boolean; fine?: boolean; reduce?: boolean; reducedData?: boolean }

function fakeWindow(media: Media, saveData = false): Window {
  return {
    matchMedia: (q: string) => ({ matches: match(q, media) }),
    navigator: { connection: { saveData } },
  } as unknown as Window
}

function match(q: string, { wide = true, fine = true, reduce = false, reducedData = false }: Media): boolean {
  if (q === '(min-width: 1024px) and (pointer: fine)') return wide && fine
  if (q === '(min-width: 1024px)') return wide
  if (q === '(prefers-reduced-motion: reduce)') return reduce
  if (q === '(prefers-reduced-data: reduce)') return reducedData
  return false
}

describe('chatPeekAllowed (the session player rule, restated)', () => {
  it('allows a wide window with a mouse and no data saver', () => {
    expect(chatPeekAllowed(fakeWindow({}))).toBe(true)
  })
  it('refuses touch, narrow windows, Save-Data and prefers-reduced-data', () => {
    expect(chatPeekAllowed(fakeWindow({ fine: false }))).toBe(false)
    expect(chatPeekAllowed(fakeWindow({ wide: false }))).toBe(false)
    expect(chatPeekAllowed(fakeWindow({}, true))).toBe(false)
    expect(chatPeekAllowed(fakeWindow({ reducedData: true }))).toBe(false)
    expect(chatPeekAllowed(undefined)).toBe(false)
  })
})

describe('LandingChatNow', () => {
  const realMatchMedia = window.matchMedia
  function media(m: Media) {
    window.matchMedia = ((q: string) => ({
      matches: match(q, m),
      media: q,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(nowMs)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    window.matchMedia = realMatchMedia
  })

  const draw = (hub: Pick<PublicHub, 'liveChannels' | 'generatedAt'> | null, loading = false) =>
    render(<MemoryRouter><LandingChatNow hub={hub} loading={loading} /></MemoryRouter>)

  it('lists five rows that open each channel, with words for screen readers', () => {
    media({ wide: false })
    draw(healthy())
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Fastest chats right now')
    const links = screen.getAllByRole('listitem').map((li) => li.querySelector('a')!)
    expect(links).toHaveLength(5)
    expect(links[0].getAttribute('href')).toMatch(/^\/analytics\//)
    expect(links[0].querySelector('.sl-cn-vh')!.textContent).toMatch(/900 chat messages per minute/)
    // phones and tablets: no chat panel
    expect(document.querySelector('.sl-cn-peek')).toBeNull()
    expect(screen.getByRole('link', { name: /Open the Hub/ }).getAttribute('href')).toBe('/analytics')
  })

  it('sets one tick spacing per row from its rate', () => {
    media({ wide: false })
    draw(healthy())
    const tick = document.querySelector<HTMLElement>('.sl-cn-tk')!
    expect(tick.style.getPropertyValue('--sl-cn-gap')).toBe('8px')
    expect(tick.style.getPropertyValue('--sl-cn-run')).toBe('240px')
    expect(tick.style.getPropertyValue('--sl-cn-dur')).toBe('2.000s')
  })

  it("loads Twitch's chat for a row pointed at, out of the Tab order, and falls back to the column after 10 s", () => {
    media({})
    draw(healthy())
    const second = screen.getAllByRole('listitem')[1].querySelector('a')!
    // before anyone points: the first chat's column and the hint
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByText('Point at a chat to open Twitch’s live chat here.')).toBeTruthy()
    fireEvent.mouseEnter(second)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS) })
    const frame = document.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe(twitchChatEmbedUrl(second.closest('li')!.dataset.login!, window.location.hostname))
    expect(frame.tabIndex).toBe(-1)
    expect(frame.hasAttribute('data-on')).toBe(false)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_TIMEOUT_MS) })
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByText('Twitch’s chat didn’t load.')).toBeTruthy()
    // the second chat, 640 a minute, as board option D's column
    expect(document.querySelector('.sl-cn-pcap p')!.textContent).toMatch(/^Each bar is one message we counted/)
    expect(document.querySelectorAll('.sl-cn-col > .sl-cn-ln')).toHaveLength(CHAT_COLUMN_LINES)
  })

  it('shows the frame and says "Live on Twitch" once it loads', () => {
    media({})
    draw(healthy())
    fireEvent.mouseEnter(screen.getAllByRole('listitem')[0].querySelector('a')!)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS) })
    fireEvent.load(document.querySelector('iframe')!)
    // Twitch fires load before its chat has drawn: the frame waits a moment before it fades in
    expect(document.querySelector('iframe')!.hasAttribute('data-on')).toBe(false)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_DRAW_MS) })
    expect(document.querySelector('iframe')!.hasAttribute('data-on')).toBe(true)
    expect(document.querySelector('.sl-cn-peek-st')!.textContent).toBe('Live on Twitch')
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_TIMEOUT_MS) })
    expect(document.querySelector('iframe')).not.toBeNull()
  })

  it('keeps the chat before under the next one until the next has faded in, never dropping to the column between', () => {
    media({})
    draw(healthy())
    const [first, second] = screen.getAllByRole('listitem').map((li) => li.querySelector('a')!)
    fireEvent.mouseEnter(first)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS) })
    fireEvent.load(document.querySelector('iframe')!)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_DRAW_MS) })
    fireEvent.mouseLeave(first)
    fireEvent.mouseEnter(second)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS) })
    // the first chat stays, dimmed, under the second while it loads
    let frames = Array.from(document.querySelectorAll('iframe'))
    expect(frames).toHaveLength(2)
    expect(frames[0].hasAttribute('data-on') && frames[0].hasAttribute('data-old')).toBe(true)
    expect(frames[1].hasAttribute('data-on')).toBe(false)
    expect(frames[1].getAttribute('title')).toContain(second.closest('li')!.querySelector('.sl-cn-nm')!.textContent!)
    fireEvent.load(frames[1])
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_DRAW_MS) })
    frames = Array.from(document.querySelectorAll('iframe'))
    expect(frames).toHaveLength(2)
    expect(frames[1].hasAttribute('data-on')).toBe(true)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_FADE_MS) })
    frames = Array.from(document.querySelectorAll('iframe'))
    expect(frames).toHaveLength(1)
    expect(frames[0].hasAttribute('data-old')).toBe(false)
  })

  it('never loads Twitch with a touch screen, with data saver, or from keyboard focus', () => {
    media({ fine: false })
    draw(healthy())
    fireEvent.mouseEnter(screen.getAllByRole('listitem')[1].querySelector('a')!)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS * 2) })
    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.queryByText('Point at a chat to open Twitch’s live chat here.')).toBeNull()
    cleanup()

    media({ reducedData: true })
    draw(healthy())
    fireEvent.mouseEnter(screen.getAllByRole('listitem')[1].querySelector('a')!)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS * 2) })
    expect(document.querySelector('iframe')).toBeNull()
    cleanup()

    media({})
    draw(healthy())
    fireEvent.focus(screen.getAllByRole('listitem')[2].querySelector('a')!)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS * 2) })
    expect(document.querySelector('iframe')).toBeNull()
  })

  // 11-23: the band keeps its place so nothing under it moves; no rows leaves one quiet line in the same space.
  it('holds row shapes while the first read is on its way, and one quiet line when there are no rows', () => {
    media({ wide: false })
    const { container, rerender } = draw(null, true)
    expect(container.querySelector('section.sl-cn')!.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('.sl-cn-skel')).toHaveLength(5)
    rerender(<MemoryRouter><LandingChatNow hub={null} loading={false} /></MemoryRouter>)
    expect(container.querySelector('section.sl-cn')!.hasAttribute('aria-busy')).toBe(false)
    expect(container.querySelectorAll('.sl-cn-skel, a.sl-cn-row')).toHaveLength(0)
    expect(container.querySelector('.sl-cn-none')?.textContent).toBe('Chat speeds didn’t load. They’ll show here when they do.')
    rerender(<MemoryRouter><LandingChatNow hub={healthy([500])} loading={false} /></MemoryRouter>)
    expect(container.querySelectorAll('.sl-cn-skel, a.sl-cn-row')).toHaveLength(0)
    expect(container.querySelector('.sl-cn-none')?.textContent).toBe('No live chats to rank right now.')
  })

  /** The first chat (600 a minute) with `emotes` emote uses a message over the screener's 5 minutes. */
  function withEmotes(emotes: number) {
    const hub = healthy([600, 400])
    const c = hub.liveChannels[0]
    hub.liveChannels[0] = { ...c, screenerV1: { ...c.screenerV1!, emotes: { ...c.screenerV1!.chat!, currentPerMin: 600 * emotes } } }
    return hub
  }

  it('opens the column full and keeps it still when motion is reduced', () => {
    media({ reduce: true })
    draw(healthy())
    expect(document.querySelectorAll('.sl-cn-col > .sl-cn-ln')).toHaveLength(CHAT_COLUMN_LINES)
    expect(document.querySelectorAll('.sl-cn-ln.n')).toHaveLength(0)
    // 900 a minute: 15 a second, past twelve lines a second, so a line is 2 messages
    expect(document.querySelector('.sl-cn-pcap p')!.textContent).toMatch(/^Each bar is 2 messages we counted/)
  })

  it("gives each line a blank bar and the chat's emotes as squares after it, at its emote rate", () => {
    media({ reduce: true })
    draw(withEmotes(1))
    const lines = Array.from(document.querySelectorAll('.sl-cn-col > .sl-cn-ln'))
    expect(lines.every((l) => l.querySelectorAll('i').length === 1 && l.querySelectorAll('b').length === 1)).toBe(true)
    expect(document.querySelector('.sl-cn-pcap p')!.textContent).toBe('Each bar is one message we counted, each square an emote. We don’t keep the words.')
    cleanup()

    media({ reduce: true })
    draw(withEmotes(0))
    expect(document.querySelectorAll('.sl-cn-col b')).toHaveLength(0)
    expect(document.querySelector('.sl-cn-pcap p')!.textContent).toBe('Each bar is one message we counted. We don’t keep the words.')
    cleanup()

    // five emotes a message: a line shows CHAT_LINE_EMOTES_MAX squares at most
    media({ reduce: true })
    draw(withEmotes(5))
    const full = Array.from(document.querySelectorAll('.sl-cn-col > .sl-cn-ln'))
    expect(full.every((l) => l.querySelectorAll('b').length === CHAT_LINE_EMOTES_MAX)).toBe(true)
  })

  it("opens a newly picked chat's column at that chat's emote rate", () => {
    media({ reduce: true })
    const hub = healthy([600, 400])
    const [a, b] = hub.liveChannels
    hub.liveChannels[0] = { ...a, screenerV1: { ...a.screenerV1!, emotes: { ...a.screenerV1!.chat!, currentPerMin: 0 } } }
    hub.liveChannels[1] = { ...b, screenerV1: { ...b.screenerV1!, emotes: { ...b.screenerV1!.chat!, currentPerMin: 400 } } }
    draw(hub)
    expect(document.querySelectorAll('.sl-cn-col b')).toHaveLength(0)
    fireEvent.mouseEnter(screen.getAllByRole('listitem')[1].querySelector('a')!)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS) })
    // one emote a message: every opening line of the second chat has its square, none left from the first chat
    const lines = Array.from(document.querySelectorAll('.sl-cn-col > .sl-cn-ln'))
    expect(lines).toHaveLength(CHAT_COLUMN_LINES)
    expect(lines.every((l) => l.querySelectorAll('b').length === 1)).toBe(true)
    expect(document.querySelector('.sl-cn-pcap p')!.textContent).toContain('each square an emote')
  })

  it("holds the column still under Twitch's chat, the dimmed one under a loading chat included", () => {
    media({})
    draw(healthy())
    // the column's newest line: a new one coming in replaces it
    const newest = () => document.querySelector('.sl-cn-col')!.lastElementChild
    let before = newest()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(newest()).not.toBe(before)
    const [first, second] = screen.getAllByRole('listitem').map((li) => li.querySelector('a')!)
    fireEvent.mouseEnter(first)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS) })
    fireEvent.load(document.querySelector('iframe')!)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_DRAW_MS) })
    // Twitch's chat is up: no new line comes in
    before = newest()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(newest()).toBe(before)
    // the next chat loads under the first, which stays dimmed over the column: still nothing moves
    fireEvent.mouseLeave(first)
    fireEvent.mouseEnter(second)
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_SETTLE_MS) })
    expect(document.querySelectorAll('iframe')).toHaveLength(2)
    before = newest()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(newest()).toBe(before)
    // the next chat never loads: the frames go and the column moves again
    act(() => { vi.advanceTimersByTime(CHAT_PEEK_TIMEOUT_MS) })
    expect(document.querySelector('iframe')).toBeNull()
    before = newest()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(newest()).not.toBe(before)
  })

  it("brings new lines in at the bottom at the chat's pace, the oldest going", () => {
    media({})
    draw(withEmotes(0))
    expect(document.querySelectorAll('.sl-cn-ln.n')).toHaveLength(0)
    // a quarter second at 600 a minute (10 a second): two whole lines, the third due at 300 ms
    act(() => { vi.advanceTimersByTime(250) })
    expect(document.querySelectorAll('.sl-cn-ln.n')).toHaveLength(2)
    act(() => { vi.advanceTimersByTime(50) })
    expect(document.querySelectorAll('.sl-cn-ln.n')).toHaveLength(3)
    expect(document.querySelectorAll('.sl-cn-col > .sl-cn-ln')).toHaveLength(CHAT_COLUMN_LINES)
    expect(document.querySelector('.sl-cn-col')!.lastElementChild!.classList.contains('n')).toBe(true)
  })

  it('slides only live lines in, by a script animation started now', () => {
    const targets: Element[] = []
    const slides: Array<{ startTime: number | null }> = []
    const animate = vi.fn(function (this: Element) {
      targets.push(this)
      const slide = { startTime: null as number | null }
      slides.push(slide)
      return slide
    })
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: animate })
    Object.defineProperty(document, 'timeline', { configurable: true, value: { currentTime: 1234 } })
    try {
      media({})
      draw(withEmotes(0))
      // the first screenful is drawn still
      expect(animate).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(250) })
      expect(animate).toHaveBeenCalledTimes(2)
      for (const call of animate.mock.calls) {
        expect(call).toEqual([
          [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }],
          { duration: 160, easing: 'ease-out', fill: 'backwards' },
        ])
      }
      expect(targets.every((t) => t.classList.contains('sl-cn-ln') && t.classList.contains('n'))).toBe(true)
      expect(slides.map((s) => s.startTime)).toEqual([1234, 1234])
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate
      delete (document as { timeline?: unknown }).timeline
    }
  })
})
