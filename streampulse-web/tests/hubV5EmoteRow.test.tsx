/**
 * The Top emotes row (H1, 11-19): the hub answer's most used emotes in one row
 * under Busiest now, before the chart. A chip finds its emote on the emote map,
 * as a pick in the hub's search does.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubEmote } from '../src/lib/publicHub'
import { EMOTE_ROW_COUNT, EMOTE_ROW_NONE, HubV5EmoteRow, emoteRowEmpty, emoteRowWindow } from '../src/ui/components/hub/v5/HubV5EmoteRow'
import { HubV5SearchContext, createHubV5SearchStore } from '../src/ui/components/hub/v5/hubV5SearchStore'

const SAFE = 'https://cdn.7tv.app/emote/01HXYZ/1x.webp'
const emote = (name: string, count: number, imageUrl: string | undefined = SAFE, more: Partial<HubEmote> = {}): HubEmote =>
  ({ id: `7tv:${name}`, name, provider: '7tv', imageUrl, count, sharePct: 0, ...more })
const row = () => document.querySelector<HTMLElement>('.hv5-emr')!

afterEach(cleanup)

describe('the Top emotes row (H1, 11-19)', () => {
  it('shows the first 8 by count as chips, named for screen readers, with the pool’s recent window', () => {
    const emotes = Array.from({ length: 11 }, (_, i) => emote(`E${i}`, 1200 - i * 100))
    render(<HubV5EmoteRow emotes={emotes} />)
    expect(within(row()).getByRole('heading', { name: 'Top emotes' })).toBeTruthy()
    // the pool is the answer's recent minutes, and the backend sends no window: the row claims none
    expect(row().querySelector('.hv5-f2-fresh')!.textContent).toBe('Recent window')
    const chips = within(row()).getAllByRole('button')
    expect(chips).toHaveLength(EMOTE_ROW_COUNT)
    // The accessible name is the hidden text: the visible parts are aria-hidden (WCAG 2.5.3).
    expect(within(row()).getByRole('button', { name: '1. E0, 1,200 uses in the recent window. Finds it on the emote map.' })).toBe(chips[0])
    expect(chips[0]!.querySelector('.hv5-emr-n')!.textContent).toBe('1,200')
    // a small still frame, and only the first 4 load at once
    const imgs = [...row().querySelectorAll('img')]
    expect(imgs).toHaveLength(EMOTE_ROW_COUNT)
    expect(imgs.map((i) => i.getAttribute('loading'))).toEqual(['eager', 'eager', 'eager', 'eager', 'lazy', 'lazy', 'lazy', 'lazy'])
    expect(imgs.every((i) => i.getAttribute('width') === '28' && i.getAttribute('alt') === '')).toBe(true)
    // the full map is a jump away
    expect(within(row()).getByRole('link', { name: 'Emote map ↓' }).getAttribute('href')).toBe('#emotes')
  })

  it('names the window in minutes only once the backend stamps it', () => {
    render(<HubV5EmoteRow emotes={[emote('KEKW', 40)]} windowMinutes={35} />)
    expect(row().querySelector('.hv5-f2-fresh')!.textContent).toBe('Last ≈35 min')
    expect(within(row()).getByRole('button', { name: '1. KEKW, 40 uses in the last 35 minutes. Finds it on the emote map.' })).toBeTruthy()
    expect(emoteRowWindow(undefined)).toBe('Recent window')
    expect(emoteRowWindow(0)).toBe('Recent window')
    expect(emoteRowWindow(Number.NaN)).toBe('Recent window')
    expect(emoteRowEmpty(35)).toBe('No emotes counted in the last 35 minutes yet.')
  })

  it('asks for still frames, as the emote map does, and never a 7TV still for an emote not flagged animated', () => {
    render(<HubV5EmoteRow emotes={[
      emote('hi', 50, 'https://cdn.7tv.app/emote/01HANIM/4x.webp', { animated: true }),
      emote('Still', 40, 'https://cdn.7tv.app/emote/01HSTILL/4x.webp'),
      emote('ilross4Yes', 30, 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc/default/dark/2.0', { provider: 'twitch' }),
    ]} />)
    const srcs = [...row().querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(srcs).toEqual([
      'https://cdn.7tv.app/emote/01HANIM/1x_static.webp',
      'https://cdn.7tv.app/emote/01HSTILL/1x.webp',
      'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_abc/static/dark/1.0',
    ])
  })

  it('falls back to the file it used before when a still fails, and hides the picture when that fails too', () => {
    render(<HubV5EmoteRow emotes={[emote('hi', 50, 'https://cdn.7tv.app/emote/01HANIM/4x.webp', { animated: true })]} />)
    const img = () => row().querySelector('img')!
    expect(img().getAttribute('src')).toBe('https://cdn.7tv.app/emote/01HANIM/1x_static.webp')
    fireEvent.error(img())
    expect(img().getAttribute('src')).toBe('https://cdn.7tv.app/emote/01HANIM/1x.webp')
    expect(img().style.visibility).toBe('')
    fireEvent.error(img())
    expect(img().style.visibility).toBe('hidden')
  })

  it('keeps two emotes of the same name from different providers apart', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<HubV5EmoteRow emotes={[
      { id: undefined, name: 'Clap', provider: '7tv', imageUrl: SAFE, count: 40, sharePct: 0 } as unknown as HubEmote,
      { id: undefined, name: 'Clap', provider: 'bttv', imageUrl: SAFE, count: 30, sharePct: 0 } as unknown as HubEmote,
    ]} />)
    expect(within(row()).getAllByRole('button')).toHaveLength(2)
    expect(spy.mock.calls.some((call) => String(call[0]).includes('same key'))).toBe(false)
    spy.mockRestore()
  })

  it('leaves out an emote with no name or no uses, and draws no picture for an unsafe URL', () => {
    render(<HubV5EmoteRow emotes={[emote('', 50), emote('KEKW', 40, 'javascript:alert(1)'), emote('Zero', 0)]} />)
    const chips = within(row()).getAllByRole('button')
    expect(chips).toHaveLength(1)
    expect(chips[0]!.querySelector('img')).toBeNull()
    expect(chips[0]!.querySelector('.hv5-emr-pic')).toBeTruthy()
    expect(chips[0]!.querySelector('.hv5-emr-nm')!.textContent).toBe('KEKW')
  })

  it('finds a chip’s emote on the emote map through the page’s search store', () => {
    const store = createHubV5SearchStore()
    const find = vi.fn()
    store.actions.emote = find
    render(
      <HubV5SearchContext.Provider value={store}>
        <HubV5EmoteRow emotes={[emote('KEKW', 40), emote('OMEGALUL', 30)]} />
      </HubV5SearchContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^2\. OMEGALUL, / }))
    expect(find).toHaveBeenCalledWith('OMEGALUL')
  })

  it('holds its height while it waits, then says none or unavailable in one line', () => {
    const { rerender } = render(<HubV5EmoteRow emotes={[]} loading />)
    expect(row().getAttribute('aria-busy')).toBe('true')
    expect(row().querySelector('.hv5-emr-wait')).toBeTruthy()
    expect(row().querySelector('.hv5-emr-q')).toBeNull()
    rerender(<HubV5EmoteRow emotes={[]} />)
    expect(row().hasAttribute('aria-busy')).toBe(false)
    expect(row().querySelector('.hv5-emr-q')!.textContent).toBe(emoteRowEmpty())
    expect(emoteRowEmpty()).toBe('No emotes counted in the recent window yet.')
    rerender(<HubV5EmoteRow emotes={[]} unavailable />)
    expect(row().querySelector('.hv5-emr-q')!.textContent).toBe(EMOTE_ROW_NONE)
  })
})
