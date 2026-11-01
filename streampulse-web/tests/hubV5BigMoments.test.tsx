import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubV5BigMoments } from '../src/ui/components/hub/v5/HubV5BigMoments'
import type { TopView } from '../src/ui/components/hub/v5/HubV5TopMoments'
import type { TopGame, TopRowData } from '../src/ui/components/hub/v5/hubV5TopModel'

const NOW = Date.UTC(2026, 9, 31, 20, 0)
const MIN = 60_000
const KEKW = 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_k/default/dark/2.0'
const KEKW_STILL = 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_k/static/dark/2.0'
const SEVEN = 'https://cdn.7tv.app/emote/01H/2x.webp'

const row = (login: string, over: Partial<TopRowData> = {}): TopRowData => ({
  id: `m-${login}`, login, name: login.toUpperCase(), streamId: `s-${login}`, offsetSeconds: 42 * 60, avatar: null, kind: 'emotes', x: 4.2,
  at: NOW - 5 * MIN, game: 'Just Chatting', art: null, emote: null,
  emotes: [{ name: 'KEKW', imageUrl: KEKW, count: 120 }, { name: 'OMEGALUL', imageUrl: SEVEN, count: 80 }],
  rate: 300, usual: 60, viewers: 5600, live: true, href: `/analytics/moments?m=m-${login}`, also: [], checked: null,
  ...over,
})
const list = (rows: TopRowData[], asOf = NOW): TopView => ({ key: '', source: 'feed', asOf, total: rows.length, rows })
const abc = () => list([row('a'), row('b'), row('c')])

function Where() {
  const { pathname, search } = useLocation()
  return <output data-testid="where">{pathname + search}</output>
}
const ui = (shown: TopView | null, game: TopGame | null = null) => (
  <MemoryRouter initialEntries={['/analytics']}>
    <div className="hub-v5"><HubV5BigMoments top={{ shown, avatars: new Map(), game }} nowMs={NOW} /></div>
    <Where />
  </MemoryRouter>
)

const section = () => document.getElementById('big-moments')
const stage = () => section()!.querySelector<HTMLElement>('.hv5-bm')!
const track = () => section()!.querySelector<HTMLElement>('.hv5-bm-track')!
const slides = () => [...section()!.querySelectorAll<HTMLElement>('.hv5-bm-card')]
const slide = (login: string) => slides().find((s) => s.querySelector('strong')!.textContent === login.toUpperCase())!
const front = () => slides().find((s) => s.dataset.pos === '0')!
const frontName = () => front().querySelector('strong')!.textContent
const dots = () => [...section()!.querySelectorAll<HTMLButtonElement>('.hv5-bm-dots button')]
const fill = () => section()!.querySelector<HTMLElement>('.hv5-bm-dots button[aria-current="true"] .hv5-bm-fill')!
const count = () => section()!.querySelector('.hv5-bm-count')!.textContent
const paused = () => stage().hasAttribute('data-paused')
const where = () => screen.getByTestId('where').textContent
const emoteSrcs = (s: HTMLElement) => [...s.querySelectorAll('.hv5-bm-em img')].map((img) => img.getAttribute('src'))

/** A pointer event as React reads it (jsdom has no PointerEvent). */
function pointer(target: Element, type: string, init: { pointerType?: string; clientX?: number; clientY?: number } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: init.pointerType ?? 'mouse' },
    clientX: { value: init.clientX ?? 0 },
    clientY: { value: init.clientY ?? 0 },
    button: { value: 0 },
  })
  fireEvent(target, event)
}
const swipe = (dx: number, dy = 0) => {
  pointer(track(), 'pointerdown', { pointerType: 'touch', clientX: 300, clientY: 100 })
  pointer(track(), 'pointerup', { pointerType: 'touch', clientX: 300 + dx, clientY: 100 + dy })
}
const reducedMotion = () => vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
  matches: query.includes('prefers-reduced-motion: reduce'), media: query, onchange: null,
  addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
}) as MediaQueryList)

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Chat’s big moments (C1, 11-01)', () => {
  it('draws nothing without rows', () => {
    const { rerender } = render(ui(null))
    expect(section()).toBeNull()
    rerender(ui(list([])))
    expect(section()).toBeNull()
  })

  it('shows one card per channel in the list’s order, the front one first and its neighbours hidden from the keyboard', () => {
    render(ui(list([row('a'), row('b'), row('a', { id: 'm-a2' }), row('c')])))
    expect(screen.getByRole('heading', { name: 'Chat’s big moments' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'All moments →' }).getAttribute('href')).toBe('/analytics/moments?view=top')
    expect(stage().getAttribute('aria-roledescription')).toBe('carousel')
    expect(slides().map((s) => [s.querySelector('strong')!.textContent, s.dataset.pos])).toEqual([['A', '0'], ['B', '1'], ['C', '-1']])
    expect(front().getAttribute('aria-roledescription')).toBe('slide')
    expect(front().getAttribute('aria-label')).toBe('1 of 3: A, emote spike, 4.2 times usual emotes')
    expect(front().getAttribute('aria-hidden')).toBeNull()
    expect(within(front()).getByText('+1 more today')).toBeTruthy()
    expect(within(front()).getByText('Just Chatting · 42 min into the stream')).toBeTruthy()
    expect(within(front()).getByText('5 min ago')).toBeTruthy()
    expect(within(front()).getByText('300/min')).toBeTruthy()
    expect(within(front()).getByText('60/min')).toBeTruthy()
    expect(within(front()).getByText('120 uses')).toBeTruthy()
    for (const link of front().querySelectorAll('a')) expect(link.getAttribute('tabindex')).toBeNull()
    for (const side of [slide('b'), slide('c')]) {
      expect(side.getAttribute('aria-hidden')).toBe('true')
      for (const link of side.querySelectorAll('a')) expect(link.getAttribute('tabindex')).toBe('-1')
    }
    expect(count()).toBe('1 / 3')
    expect(dots().map((d) => d.getAttribute('aria-current'))).toEqual(['true', null, null])
  })

  it('links the game picked in Top moments today when its list is that game’s, as the rail does', () => {
    const valorant: TopGame = { id: '516575', name: 'Valorant', art: null, moments: 4 }
    const { rerender } = render(ui(list([row('a', { game: 'Valorant' })]), valorant))
    const link = screen.getByRole('link', { name: 'Valorant moments →' })
    expect(link.getAttribute('href')).toBe('/analytics/moments?view=top&game=516575')
    expect(link.classList.contains('hv5-mo-game')).toBe(true)
    // on the hub's rows the rail links every game, and so does this
    rerender(ui({ ...list([row('a')]), source: 'hub' }, valorant))
    expect(screen.getByRole('link', { name: 'All moments →' }).getAttribute('href')).toBe('/analytics/moments?view=top')
  })

  it('has no controls and no clock with one card', () => {
    render(ui(list([row('a'), row('a', { id: 'm-a2' })])))
    expect(slides()).toHaveLength(1)
    expect(within(front()).getByText('+1 more today')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Next moment' })).toBeNull()
    expect(dots()).toHaveLength(0)
    expect(stage().getAttribute('tabindex')).toBeNull()
    expect(track().getAttribute('aria-live')).toBe('polite')
    fireEvent.keyDown(stage(), { key: 'ArrowRight' })
    expect(frontName()).toBe('A')
  })

  it('leaves out the meter without a rate or a usual', () => {
    render(ui(list([row('a', { rate: null })])))
    expect(front().querySelector('.hv5-bm-meter')).toBeNull()
  })

  it('moves with the arrows, Home and End, round the ends, but not from a link', () => {
    render(ui(abc()))
    fireEvent.keyDown(stage(), { key: 'ArrowRight' })
    expect(frontName()).toBe('B')
    expect(count()).toBe('2 / 3')
    fireEvent.keyDown(stage(), { key: 'End' })
    expect(frontName()).toBe('C')
    fireEvent.keyDown(stage(), { key: 'ArrowRight' })
    expect(frontName()).toBe('A')
    fireEvent.keyDown(stage(), { key: 'ArrowLeft' })
    expect(frontName()).toBe('C')
    fireEvent.keyDown(stage(), { key: 'Home' })
    expect(frontName()).toBe('A')
    fireEvent.keyDown(front().querySelector('.hv5-bm-open')!, { key: 'ArrowRight' })
    expect(frontName()).toBe('A')
  })

  it('moves with the buttons and the dots', () => {
    render(ui(abc()))
    fireEvent.click(screen.getByRole('button', { name: 'Next moment' }))
    expect(frontName()).toBe('B')
    fireEvent.click(screen.getByRole('button', { name: 'Previous moment' }))
    expect(frontName()).toBe('A')
    fireEvent.click(screen.getByRole('button', { name: 'C' }))
    expect(frontName()).toBe('C')
    expect(dots().map((d) => [d.getAttribute('aria-current'), d.classList.contains('hv5-bm-done')])).toEqual([[null, true], [null, true], ['true', false]])
  })

  it('turns the page when the front dot’s fill ends, and the pause button holds it', () => {
    render(ui(abc()))
    expect(paused()).toBe(false)
    expect(track().getAttribute('aria-live')).toBe('off')
    fireEvent.animationEnd(dots()[1]!)
    expect(frontName()).toBe('A')
    fireEvent.animationEnd(fill())
    expect(frontName()).toBe('B')
    expect(dots()[0]!.classList.contains('hv5-bm-done')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(paused()).toBe(true)
    expect(track().getAttribute('aria-live')).toBe('polite')
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(paused()).toBe(false)
    expect(track().getAttribute('aria-live')).toBe('off')
  })

  it('holds while a mouse is over it, not a finger', () => {
    render(ui(abc()))
    pointer(stage(), 'pointerover', { pointerType: 'touch' })
    expect(paused()).toBe(false)
    pointer(stage(), 'pointerout', { pointerType: 'touch' })
    pointer(stage(), 'pointerover', { pointerType: 'mouse' })
    expect(paused()).toBe(true)
    pointer(stage(), 'pointerout', { pointerType: 'mouse' })
    expect(paused()).toBe(false)
  })

  it('holds while keyboard focus is inside it', () => {
    render(ui(abc()))
    const matches = Element.prototype.matches
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (this: Element, selector: string) {
      return selector === ':focus-visible' || matches.call(this, selector)
    })
    act(() => stage().focus())
    expect(paused()).toBe(true)
    act(() => stage().blur())
    expect(paused()).toBe(false)
  })

  it('holds while mostly off screen, and while the tab is hidden', () => {
    let report: IntersectionObserverCallback | null = null
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { report = callback }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    render(ui(abc()))
    const seen = (ratio: number) => act(() => report!([{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver))
    seen(0.2)
    expect(paused()).toBe(true)
    seen(0.6)
    expect(paused()).toBe(false)

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    try {
      act(() => { document.dispatchEvent(new Event('visibilitychange')) })
      expect(paused()).toBe(true)
    } finally {
      Reflect.deleteProperty(document, 'hidden')
    }
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(paused()).toBe(false)
  })

  it('starts paused with reduced motion, and holds the front card’s emotes still too', () => {
    reducedMotion()
    render(ui(abc()))
    expect(paused()).toBe(true)
    expect(track().getAttribute('aria-live')).toBe('polite')
    expect(emoteSrcs(front())).toEqual([KEKW_STILL, SEVEN])
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect(paused()).toBe(false)
  })

  it('moves only the front card’s emotes, and loads pictures only a step from the front', () => {
    render(ui(list([row('a'), row('b'), row('c'), row('d'), row('e')])))
    expect(emoteSrcs(slide('a'))).toEqual([KEKW, SEVEN])
    expect(emoteSrcs(slide('b'))).toEqual([KEKW_STILL, SEVEN])
    expect(emoteSrcs(slide('e'))).toEqual([KEKW_STILL, SEVEN])
    for (const far of [slide('c'), slide('d')]) {
      expect(far.dataset.pos).toMatch(/^-?2$/)
      expect(emoteSrcs(far)).toEqual([])
      expect(far.querySelector('.hv5-bm-bg')).toBeNull()
    }
    fireEvent.keyDown(stage(), { key: 'ArrowRight' })
    expect(emoteSrcs(slide('b'))).toEqual([KEKW, SEVEN])
    expect(emoteSrcs(slide('a'))).toEqual([KEKW_STILL, SEVEN])
    expect(emoteSrcs(slide('c'))).toEqual([KEKW_STILL, SEVEN])
    expect(emoteSrcs(slide('d'))).toEqual([])
    // once loaded, a picture stays
    expect(emoteSrcs(slide('e'))).toEqual([KEKW_STILL, SEVEN])
  })

  it('says live, links the stream and shows its picture only for a stream live in a recent answer', () => {
    const { rerender } = render(ui(list([row('a'), row('b', { live: false })])))
    expect(within(slide('a')).getByText('LIVE · 5.6K')).toBeTruthy()
    const watch = slide('a').querySelector<HTMLAnchorElement>('.hv5-bm-tw')!
    expect(watch.getAttribute('href')).toBe('https://www.twitch.tv/a')
    expect(watch.getAttribute('target')).toBe('_blank')
    expect(watch.getAttribute('rel')).toBe('noopener noreferrer')
    expect(slide('a').querySelector('.hv5-bm-bg')!.getAttribute('src')).toBe('https://static-cdn.jtvnw.net/previews-ttv/live_user_a-640x360.jpg')
    expect(slide('b').querySelector('.hv5-bm-live, .hv5-bm-tw, .hv5-bm-bg')).toBeNull()
    expect(slide('b').querySelector('.hv5-bm-open')!.getAttribute('href')).toBe('/analytics/moments?m=m-b')
    rerender(ui(list([row('a'), row('b', { live: false })], NOW - 20 * MIN)))
    expect(slide('a').querySelector('.hv5-bm-live, .hv5-bm-tw, .hv5-bm-bg')).toBeNull()
  })

  it('brings a side card to the front on a click, without following its links', () => {
    render(ui(abc()))
    fireEvent.click(slide('b'))
    expect(frontName()).toBe('B')
    fireEvent.click(slide('c').querySelector('.hv5-bm-open')!)
    expect(frontName()).toBe('C')
    expect(where()).toBe('/analytics')
    fireEvent.click(front().querySelector('.hv5-bm-open')!)
    expect(where()).toBe('/analytics/moments?m=m-c')
  })

  it('turns the page with a sideways swipe and swallows the click it ends in', () => {
    render(ui(abc()))
    swipe(-100, 10)
    expect(frontName()).toBe('B')
    fireEvent.click(front().querySelector('.hv5-bm-open')!)
    expect(where()).toBe('/analytics')
    swipe(100)
    expect(frontName()).toBe('A')
    // too short, or more down than across: not a swipe
    swipe(-40)
    swipe(-60, 90)
    expect(frontName()).toBe('A')
    fireEvent.click(front().querySelector('.hv5-bm-open')!)
    expect(where()).toBe('/analytics/moments?m=m-a')
  })

  it('keeps the front card’s channel in front when a poll still lists it, else starts again', () => {
    const { rerender } = render(ui(abc()))
    fireEvent.keyDown(stage(), { key: 'ArrowRight' })
    expect(frontName()).toBe('B')
    rerender(ui(list([row('d'), row('b'), row('a')])))
    expect(frontName()).toBe('B')
    expect(count()).toBe('2 / 3')
    rerender(ui(list([row('d'), row('a')])))
    expect(frontName()).toBe('D')
    expect(count()).toBe('1 / 2')
    rerender(ui(list([])))
    expect(section()).toBeNull()
    rerender(ui(abc()))
    expect(frontName()).toBe('A')
  })
})
