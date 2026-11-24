import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import type { MomentMinuteSlot, MomentMinuteWindow } from '../src/lib/momentMinuteWindow'

const minutes = vi.hoisted(() => ({ load: vi.fn(), peek: vi.fn() }))
vi.mock('../src/lib/momentMinuteWindow', async original => ({
  ...(await original<typeof import('../src/lib/momentMinuteWindow')>()),
  loadMomentMinuteWindow: minutes.load,
  peekMomentMinuteWindow: minutes.peek,
}))
const clips = vi.hoisted(() => ({ within: vi.fn() }))
vi.mock('../src/lib/momentNearbyClip', async original => ({
  ...(await original<typeof import('../src/lib/momentNearbyClip')>()),
  nearbyClipWithin: clips.within,
}))
const twitch = vi.hoisted(() => ({ offline: vi.fn() }))
vi.mock('../../packages/analytics-console/src/utils/twitchBoxArt.ts', async original => ({
  ...(await original<typeof import('../../packages/analytics-console/src/utils/twitchBoxArt.ts')>()),
  isTwitchOfflinePreview: twitch.offline,
}))

const { MomentStreamCard } = await import('../src/ui/components/moments/MomentStreamCard')

/** Usual 100/min; the five minutes up to the moment run at 300, the moment's own at 500. Emotes 3, and 17 at the moment. */
function surgeWindow(): MomentMinuteWindow {
  const slots: MomentMinuteSlot[] = []
  for (let relative = -30; relative <= 10; relative += 1) {
    const chatPerMin = relative === 0 ? 500 : relative >= -4 && relative < 0 ? 300 : 100
    slots.push({ relative, state: 'measured', chatPerMin, emotesPerMin: relative === 0 ? 17 : 3 })
  }
  return { slots } as MomentMinuteWindow
}

const metric = (currentPerMin: number, baselinePerMin: number) => ({
  state: 'ready', currentPerMin, baselinePerMin, multiplier: currentPerMin / baselinePerMin,
  currentMeasuredMinutes: 1, currentExpectedMinutes: 1, baselineMeasuredMinutes: 30, baselineExpectedMinutes: 30, baselineCoveragePct: 100,
})
const base: DiscoveryMoment = {
  key: 'stream-1:7200',
  login: 'creator',
  displayName: 'Creator',
  streamId: 'stream-1',
  offsetSeconds: 2 * 3600,
  at: Date.parse('2026-11-22T16:50:00Z'),
  label: 'Emote spike',
  category: 'Just Chatting',
  provenance: 'hub',
  chatPerMin: 500,
  reactionSignal: 'chat',
  comparison: { chat: metric(500, 100), emotes: metric(17, 3) } as unknown as DiscoveryMoment['comparison'],
  topEmotes: [{ name: 'KEKW', id: 'kekw', provider: 'bttv', count: 17, imageUrl: 'https://cdn.betterttv.net/emote/5e9c6c187e090362f8b0b9e8/3x.webp' }] as DiscoveryMoment['topEmotes'],
}
const CLIP = { url: 'https://www.twitch.tv/creator/clip/NearbyClip-abc', thumbnailUrl: 'https://static-cdn.jtvnw.net/clip-thumb-480x272.jpg', title: 'chat lost it' }

function show(moment: DiscoveryMoment, props: Partial<Parameters<typeof MomentStreamCard>[0]> = {}) {
  const onSelect = vi.fn()
  const view = render(<MemoryRouter><MomentStreamCard moment={moment} selected={false} detailId="detail" onSelect={onSelect}
    avatar={<span>avatar</span>} creator={<a href="/creator">{moment.displayName}</a>} {...props} /></MemoryRouter>)
  return { ...view, onSelect }
}
const picture = (container: HTMLElement) => container.querySelector('.msc-picture')!
const shown = (container: HTMLElement, kind: string) => waitFor(() => expect(picture(container).getAttribute('data-picture')).toBe(kind))
/** The live picture the card is checking, once it asks for one. */
const probeOf = (container: HTMLElement) => waitFor(() => {
  const probe = container.querySelector<HTMLImageElement>('img.msc-probe')
  if (!probe) throw new Error('no live picture asked for yet')
  return probe
})

/** Every card is on screen at once (the suite's own stub never reports one). */
class OnScreen {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver) }
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', OnScreen)
  minutes.peek.mockReturnValue(undefined)
  minutes.load.mockResolvedValue(surgeWindow())
  clips.within.mockResolvedValue(null)
  twitch.offline.mockResolvedValue(false)
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('moment stream card', () => {
  it('with no picture, draws the line over the game’s cover and says one × in its headline', async () => {
    const { container } = show(base)
    await shown(container, 'line')
    expect(container.querySelector('.msc-wash')).not.toBeNull()
    expect(container.querySelector('.msc-line')?.getAttribute('d')).toMatch(/^M/)
    expect(container.querySelector('.msc-usual')).not.toBeNull()
    expect(container.querySelector('.msc-surge')).not.toBeNull()
    expect(container.querySelectorAll('.msc-bars rect').length).toBeGreaterThan(0)
    expect(picture(container).getAttribute('title')).toBe('Line: chat per minute. Bars: emotes per minute. Dashes: this stream’s earlier average.')
    // One headline, one ×: the comparison's, with the surge's length.
    expect(container.querySelector('h3.msc-title button')?.textContent).toBe('5.0× more chat · 5 min surge')
    expect(container.textContent?.match(/×/g)).toHaveLength(1)
    expect(container.querySelector('.msc-at')?.textContent).toBe('about 2:00:00 in')
    expect(container.querySelector('.msc-source')).toBeNull()
    // The line hides its emotes from a screen reader, so the body names them, as the row did.
    expect(screen.getByRole('list', { name: 'Measured emote reactions' }).textContent).toBe('KEKW, 17 uses')
  })

  it('draws its line when the clip lookup fails', async () => {
    clips.within.mockRejectedValue(new Error('lookup failed'))
    const { container } = show(base)
    await shown(container, 'line')
  })

  it('puts a clip made near the moment first, with the line along its bottom and a link to the clip', async () => {
    clips.within.mockResolvedValue(CLIP)
    const { container } = show(base)
    await shown(container, 'photo')
    expect(container.querySelector('img.msc-photo')?.getAttribute('src')).toBe(CLIP.thumbnailUrl)
    expect(container.querySelector('.msc-source')?.textContent).toBe('Nearby clip')
    // The line keeps to the picture's bottom third.
    expect(Number(container.querySelector('.msc-surge')?.getAttribute('y'))).toBeGreaterThan(100)
    const watch = screen.getByRole('link', { name: /Watch nearby clip/ })
    expect(watch.getAttribute('href')).toBe(CLIP.url)
    expect(watch.getAttribute('target')).toBe('_blank')
    expect(watch.className).toBe('msc-go')
    expect(screen.getByRole('link', { name: /Stream analytics for Creator/ }).className).toBe('msc-link')
  })

  it('shows a young moment’s live picture on a list of live streams, never an old one’s or off that list', async () => {
    const young = { ...base, key: 'stream-1:young', at: Date.now() - 2 * 60_000 }
    const first = show(young, { live: true })
    // Loaded unseen and checked first; the card waits for the answer.
    const probe = await probeOf(first.container)
    expect(probe.getAttribute('src')).toContain('live_user_creator-640x360')
    expect(probe.getAttribute('crossorigin')).toBe('anonymous')
    expect(picture(first.container).getAttribute('data-picture')).toBe('waiting')
    fireEvent.load(probe)
    await shown(first.container, 'photo')
    expect(twitch.offline).toHaveBeenCalledWith(probe)
    expect(first.container.querySelector('img.msc-probe')).toBeNull()
    expect(first.container.querySelector('img.msc-photo')?.getAttribute('src')).toContain('live_user_creator-640x360')
    expect(first.container.querySelector('.msc-source')?.textContent).toBe('Live now')
    first.unmount()
    const old = show({ ...base, key: 'stream-1:old', at: Date.now() - 20 * 60_000 }, { live: true })
    await shown(old.container, 'line')
    old.unmount()
    const saved = show(young)
    await shown(saved.container, 'line')
  })

  it('drops a live picture Twitch answers with its offline one, one that fails, and one whose check runs long', async () => {
    const young = { ...base, key: 'stream-1:young', at: Date.now() - 2 * 60_000 }
    twitch.offline.mockResolvedValue(true)
    const offline = show(young, { live: true })
    fireEvent.load(await probeOf(offline.container))
    await shown(offline.container, 'line')
    expect(offline.container.querySelector('img.msc-photo')).toBeNull()
    expect(offline.container.querySelector('img.msc-probe')).toBeNull()
    offline.unmount()

    const failed = show(young, { live: true })
    fireEvent.error(await probeOf(failed.container))
    await shown(failed.container, 'line')
    failed.unmount()

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let answer: (offline: boolean) => void = () => {}
      twitch.offline.mockImplementation(() => new Promise<boolean>(resolve => { answer = resolve }))
      const slow = show(young, { live: true })
      fireEvent.load(await probeOf(slow.container))
      vi.advanceTimersByTime(3_000)
      await shown(slow.container, 'line')
      // An answer after the card drew its line doesn't bring the picture back.
      await act(async () => answer(false))
      expect(picture(slow.container).getAttribute('data-picture')).toBe('line')
      expect(slow.container.querySelector('img.msc-photo')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stands the moment’s emotes in, and says so, when its minutes can’t be read', async () => {
    minutes.load.mockResolvedValue(null)
    const { container } = show(base)
    await shown(container, 'emotes')
    expect(container.querySelector('.msc-emotes img')).not.toBeNull()
    // Over the same blurred cover the line would have had.
    expect(container.querySelector('.msc-wash')).not.toBeNull()
    expect(container.querySelector('.msc-source')?.textContent).toBe('Top emotes')
    expect(container.querySelector('h3.msc-title button')?.textContent).toBe('5.0× more chat')
  })

  it('names an emote it has no picture for, and lists each for a screen reader, as the row did', async () => {
    minutes.load.mockResolvedValue(null)
    const { container } = show({ ...base, topEmotes: [
      { name: 'KEKW', id: 'kekw', provider: 'bttv', count: 1200, imageUrl: 'https://cdn.betterttv.net/emote/5e9c6c187e090362f8b0b9e8/3x.webp' },
      { name: 'DinoDance', provider: 'twitch', count: 9 },
    ] as DiscoveryMoment['topEmotes'] })
    await shown(container, 'emotes')
    const list = container.querySelector('.msc-emotes')!
    expect(list.getAttribute('role')).toBe('list')
    expect(list.getAttribute('aria-label')).toBe('Measured emote reactions')
    const items = list.querySelectorAll('[role="listitem"]')
    expect(items).toHaveLength(2)
    expect(items[0].querySelector('img')?.getAttribute('alt')).toBe(`KEKW, ${(1200).toLocaleString()} uses`)
    expect(items[1].querySelector('img')).toBeNull()
    expect(items[1].textContent).toBe('DinoDance, 9 uses')
    expect(items[1].querySelector('.msc-emote-name')).not.toBeNull()
  })

  it('says nothing of emotes when a moment with no minutes has none', async () => {
    minutes.load.mockResolvedValue(null)
    const { container } = show({ ...base, topEmotes: [] })
    await shown(container, 'emotes')
    expect(container.querySelector('.msc-emotes')).toBeNull()
    expect(container.querySelector('.msc-source')).toBeNull()
  })

  it('draws emotes as the line when they lead and the minutes carry them', async () => {
    const { container } = show({ ...base, reactionSignal: 'emotes' })
    await shown(container, 'line')
    expect(picture(container).getAttribute('title')).toMatch(/^Line: emotes per minute/)
    // Emotes ran above twice their usual only in the moment's own minute: no surge to name.
    expect(container.querySelector('h3.msc-title button')?.textContent).toBe('5.7× more emotes')
  })

  it('draws nothing in a stream’s first 20 minutes to judge it by: no usual line, no surge, the early words', async () => {
    const { container } = show({ ...base, key: 'stream-1:420', offsetSeconds: 420 })
    await shown(container, 'line')
    expect(container.querySelector('.msc-usual')).toBeNull()
    expect(container.querySelector('.msc-surge')).toBeNull()
    expect(container.querySelector('h3.msc-title button')?.textContent).toBe('Emote spike')
    expect(container.querySelector('.msc-figure')?.textContent).toBe('Early in the stream')
  })

  it('names the stream’s end after its first 20 minutes too, as the row does', () => {
    const { container } = show({ ...base, streamEdge: 'closing' })
    expect(container.querySelector('.msc-figure')?.textContent).toBe('Stream end')
  })

  it('tells a screen reader the rates and the full time the picture and the age stand for', () => {
    const { container, unmount } = show({ ...base, emotesPerMin: 17.25 })
    expect(screen.getByText('500 chat/min, 17.3 emotes/min.')).not.toBeNull()
    expect(container.querySelector('.msc-sub time .sr-only')?.textContent).toMatch(/^, .*Nov 22, 2026/)
    unmount()
    show({ ...base, chatPerMin: undefined, at: undefined })
    expect(screen.getByText('Rates unavailable. Occurrence time unavailable.')).not.toBeNull()
  })

  it('keeps Save last, so Tab reaches the moment and its links first', () => {
    const { container } = show(base)
    const focusable = [...container.querySelectorAll('a[href], button')]
    expect(focusable.at(-1)?.getAttribute('aria-label') ?? focusable.at(-1)?.textContent).toMatch(/Save/)
  })

  it('opens Twitch 30 s before the moment when the replay is known, and leads with Analytics when it is not', () => {
    const { unmount } = show(base)
    expect(screen.queryByText('No replay link yet')).toBeNull()
    expect(screen.getByRole('link', { name: /Stream analytics for Creator/ }).className).toBe('msc-go')
    unmount()
    show({ ...base, vodId: '2345678901' })
    const replay = screen.getByRole('link', { name: /Open Twitch at/ })
    expect(replay.getAttribute('href')).toContain('2345678901')
    expect(replay.getAttribute('href')).toContain('t=7170s')
    expect(replay.getAttribute('target')).toBe('_blank')
  })

  it('opens the moment from the card or its headline, but not from its links and buttons', () => {
    const { container, onSelect } = show(base)
    fireEvent.click(container.querySelector('.msc-body')!)
    expect(onSelect).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /more chat.* — Open moment for Creator at about 2:00:00/ }))
    expect(onSelect).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('link', { name: /Stream analytics for Creator/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save Creator’s moment at about 2:00:00' }))
    expect(onSelect).toHaveBeenCalledTimes(2)
  })

  it('names the channel on the stream’s first card only; the later ones keep the game and the time', () => {
    const { container } = show(base, { lead: false })
    expect(screen.queryByText('avatar')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Creator' })).toBeNull()
    expect(container.querySelector('.msc-cover')).not.toBeNull()
    expect(container.querySelector('.msc-sub')?.textContent).toMatch(/^Just Chatting · /)
    expect(container.querySelector('.msc-sub time')?.getAttribute('dateTime')).toBe('2026-11-22T16:50:00.000Z')
    // The age shows; the time itself is on hover.
    expect(container.querySelector('.msc-sub time')?.getAttribute('title')).toMatch(/Nov 22, 2026/)
  })

  it('shows the stream’s other moments from its lead card, and says the open card is open', () => {
    const onToggle = vi.fn()
    const { rerender } = show(base, { more: { count: 2, expanded: false, onToggle } })
    const more = screen.getByRole('button', { name: '+2 more from Creator' })
    // The card already names the channel; the button says only the count, its name the rest.
    expect(more.textContent).toBe('+2 more')
    expect(more.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(more)
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<MemoryRouter><MomentStreamCard moment={base} selected detailId="detail" onSelect={() => {}} avatar={null} creator={null}
      more={{ count: 2, expanded: true, onToggle }} /></MemoryRouter>)
    const fewer = screen.getByRole('button', { name: 'Show fewer from Creator' })
    expect(fewer.textContent).toBe('Show fewer')
    expect(fewer.getAttribute('aria-expanded')).toBe('true')
    const primary = screen.getByRole('button', { name: /more chat.* — Close moment for Creator/ })
    expect(primary.getAttribute('aria-controls')).toBe('detail')
    expect(primary.getAttribute('aria-current')).toBe('true')
  })
})
