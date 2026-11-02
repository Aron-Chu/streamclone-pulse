/**
 * Find emote on the Top emotes map, phone round (11-02): typing searches only the chosen window and says when the
 * whole answer has the emote (E1); Enter or the phone's search key widens to it. A × clears the field on touch (X1).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import { HubV5EmoteMap } from '../src/ui/components/hub/v5/HubV5EmoteMap'

vi.mock('../src/lib/prefetchHubBucketMoments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/prefetchHubBucketMoments')>()),
  requestHubBucketMoments: vi.fn(() => new Promise(() => {})),
}))

const MIN = 60_000
const BM = 6
const T0 = Date.UTC(2026, 9, 29, 12, 0)
const T1 = T0 + 239 * BM * MIN

/** KEKW leads every interval; Pog only 100 intervals in and in the last hour, never in the last 30 minutes. */
function points(): HubActivityPoint[] {
  return Array.from({ length: 240 }, (_, i) => ({
    t: T0 + i * BM * MIN,
    bucketComplete: i < 239,
    emotes: 1000,
    topEmotes: [
      { name: 'KEKW', provider: 'seventv', count: 100 },
      ...(i === 100 || i === 233 ? [{ name: 'Pog', provider: 'twitch', count: 30 }] : []),
    ],
  })) as unknown as HubActivityPoint[]
}

function renderMap() {
  render(<MemoryRouter><HubV5EmoteMap points={points()} bucketMinutes={BM} moments={[]} avatars={new Map()} nowMs={T1 + MIN} intervalWindow="24h" /></MemoryRouter>)
  const find = screen.getByRole('searchbox', { name: 'Find emote on the map' })
  const status = document.querySelector<HTMLElement>('.hv5-em-rh [role="status"]')!
  const chip = (label: string) => screen.getByRole('button', { name: label })
  return { find, status, chip }
}

const typeIn = (input: HTMLElement, value: string) => fireEvent.change(input, { target: { value } })

function touchScreen() {
  const real = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ ...real(query), matches: query === '(pointer: coarse)' }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Find emote: the window widens only on the search key (E1, 11-02)', () => {
  it('typing searches the chosen window and says the whole answer has it', () => {
    const { find, status, chip } = renderMap()
    fireEvent.click(chip('30m'))
    typeIn(find, 'Pog')
    expect(chip('30m').getAttribute('aria-pressed')).toBe('true')
    expect(status.className).toContain('hv5-em-fmsg')
    expect(status.textContent).toBe('Not in the last 30 min. Search to look in 24h.')
    // the chosen window has KEKW: found there, no switch
    typeIn(find, 'KEKW')
    expect(chip('30m').getAttribute('aria-pressed')).toBe('true')
    expect(status.className).not.toContain('hv5-em-fmsg')
    expect(status.textContent).toBe('KEKW is marked on the map.')
  })

  it('Enter widens to the whole answer and names the switch', () => {
    const { find, status, chip } = renderMap()
    fireEvent.click(chip('30m'))
    typeIn(find, 'Pog')
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(chip('24h').getAttribute('aria-pressed')).toBe('true')
    expect(status.className).not.toContain('hv5-em-fmsg')
    expect(status.textContent).toBe('Pog is marked on the map (24h; not in the last 30 min).')
  })

  it('finds it in a window that has it, with no switch', () => {
    const { find, status, chip } = renderMap()
    fireEvent.click(chip('1h'))
    typeIn(find, 'Pog')
    expect(status.textContent).toBe('Pog is marked on the map.')
    fireEvent.click(chip('30m'))
    typeIn(find, 'Pogg')
    expect(status.textContent).toBe('No emote matches “Pogg” here. Esc clears.')
  })

  it('a chip that has the emote finds it, and the line never names a window no longer shown', () => {
    const { find, status, chip } = renderMap()
    fireEvent.click(chip('30m'))
    typeIn(find, 'Pog')
    expect(status.textContent).toBe('Not in the last 30 min. Search to look in 24h.')
    fireEvent.click(chip('24h'))
    expect(status.className).not.toContain('hv5-em-fmsg')
    expect(status.textContent).toBe('Pog is marked on the map.')
  })

  it('keeps the plain miss line when the whole answer has nothing either', () => {
    const { find, status, chip } = renderMap()
    fireEvent.click(chip('30m'))
    typeIn(find, 'zzz')
    expect(status.textContent).toBe('No emote matches “zzz” here. Esc clears.')
    fireEvent.keyDown(find, { key: 'Enter' })
    expect(chip('30m').getAttribute('aria-pressed')).toBe('true')
    expect(status.textContent).toBe('No emote matches “zzz” here. Esc clears.')
  })
})

describe('Find emote on touch (X1, 11-02)', () => {
  it('is a label round the field, with the name on the input', () => {
    const { find } = renderMap()
    expect(find.closest('label')?.classList.contains('hv5-em-find')).toBe(true)
    expect(find.getAttribute('aria-label')).toBe('Find emote on the map')
  })

  it('shows a × while the field has text, which clears it, the match and the zoom, and keeps the field focused', () => {
    const { find, status } = renderMap()
    expect(screen.queryByRole('button', { name: 'Clear emote search' })).toBeNull()
    typeIn(find, 'KEKW')
    expect(status.textContent).toBe('KEKW is marked on the map.')
    const clear = screen.getByRole('button', { name: 'Clear emote search' })
    fireEvent.click(clear)
    expect((find as HTMLInputElement).value).toBe('')
    expect(status.textContent).toBe('')
    expect(document.activeElement).toBe(find)
    expect(document.querySelector('.hv5-em-zr')!.textContent).toBe('1.0×')
    expect(screen.queryByRole('button', { name: 'Clear emote search' })).toBeNull()
    // one letter is text too
    typeIn(find, 'K')
    expect(screen.getByRole('button', { name: 'Clear emote search' })).toBeTruthy()
  })

  it('drops "Esc clears." from the miss line on a touch screen', () => {
    touchScreen()
    const { find, status } = renderMap()
    typeIn(find, 'zzz')
    expect(status.textContent).toBe('No emote matches “zzz” here.')
  })

  it('keeps the 12 px text for a mouse only, so touch gets the hub’s 16 px and no zoom on focus', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/ui/components/hub/v5/hub-v5.css'), 'utf8')
    expect(css).toMatch(/@media \(pointer: fine\) \{\s*\.hub-v5 \.hv5-em-find input \{ font-size: 12px; \}\s*\}/)
    expect(css).not.toMatch(/\n\.hub-v5 \.hv5-em-find input \{ font-size: 12px; \}/)
    expect(css).toMatch(/\.hub-v5 \.hv5-emotes \.hv5-em-zb::after \{ content: ''; position: absolute; inset: -6px -2px; \}/)
  })
})
