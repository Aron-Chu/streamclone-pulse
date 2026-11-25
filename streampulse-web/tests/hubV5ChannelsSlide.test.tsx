import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { normalizePublicHub, type HubLiveChannel } from '../src/lib/publicHub'
import { HubV5Channels } from '../src/ui/components/hub/v5/HubV5Channels'

// The hub's 24h answer of 2026-10-30 07:19Z (8 live channels), as the other Channels tests read it.
const hub = normalizePublicHub(JSON.parse(readFileSync(resolve(__dirname, 'fixtures/hub_screener_down_20261030.json'), 'utf8')))
const ROW_H = 40

type Call = { el: Element; frames: Keyframe[]; timing: KeyframeAnimationOptions }
let calls: Call[] = []
const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop')
beforeAll(() => {
  // jsdom lays nothing out: a row's top is its index times one row's height
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      return this.tagName === 'TR' && this.parentElement ? Array.from(this.parentElement.children).indexOf(this) * ROW_H : 0
    },
  })
  ;(Element.prototype as unknown as { animate: unknown }).animate = function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
    calls.push({ el: this, frames, timing })
    return {} as Animation
  }
})
afterAll(() => {
  if (offsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop)
  delete (Element.prototype as unknown as { animate?: unknown }).animate
})
afterEach(() => {
  cleanup()
  calls = []
  vi.unstubAllGlobals()
})

const byViewers = (rows: readonly HubLiveChannel[]) => [...rows].sort((a, b) => b.viewers - a.viewers)
const table = (live: readonly HubLiveChannel[], windowKey = '24h') => (
  <MemoryRouter>
    <HubV5Channels live={live} poolSize={500} nowMs={Date.parse(hub.generatedAt)} game={null} onClearGame={() => {}} windowKey={windowKey} />
  </MemoryRouter>
)
const logins = () => Array.from(document.querySelectorAll<HTMLTableRowElement>('tbody tr[data-login]')).map((tr) => tr.dataset.login)
const rowOf = (login: string) => document.querySelector<HTMLTableRowElement>(`tbody tr[data-login="${login}"]`)!
const slides = () => calls.filter((c) => String(c.frames[0]?.transform ?? '').startsWith('translateY'))

describe('Channels rows slide on refresh (3A, 11-22)', () => {
  const read1 = byViewers(hub.liveChannels)
  const [first, second] = [read1[0]!, read1[1]!]
  // the next read: the second channel passes the first, and the first's viewers change
  const read2 = read1.map((c) => (c.login === second.login ? { ...c, viewers: first.viewers + 1000 } : c.login === first.login ? { ...c, viewers: first.viewers - 1 } : c))

  it('slides the two rows that swapped from their old places, fades the changed figures, and moves nothing else', () => {
    const { rerender } = render(table(read1))
    expect(logins().slice(0, 2)).toEqual([first.login, second.login])
    expect(calls).toEqual([])
    rerender(table(read2))
    expect(logins().slice(0, 2)).toEqual([second.login, first.login])
    const moved = slides()
    expect(moved.map((c) => (c.el as HTMLElement).dataset.login).sort()).toEqual([first.login, second.login].sort())
    // each starts where it was: the riser one row down, the other one row up, and both end in place in 240 ms
    expect(moved.find((c) => c.el === rowOf(second.login))!.frames).toEqual([{ transform: `translateY(${ROW_H}px)` }, { transform: 'none' }])
    expect(moved.find((c) => c.el === rowOf(first.login))!.frames).toEqual([{ transform: `translateY(${-ROW_H}px)` }, { transform: 'none' }])
    expect(moved.every((c) => c.timing.duration === 240)).toBe(true)
    // the figures that changed fade in; nothing counts up
    const faded = calls.filter((c) => c.el.classList.contains('hv5-ch5-vw')).map((c) => c.el.closest('tr')!.dataset.login).sort()
    expect(faded).toEqual([first.login, second.login].sort())
    expect(calls.every((c) => c.frames.every((f) => Object.keys(f).every((k) => k === 'opacity' || k === 'transform')))).toBe(true)
  })

  it('fades in a row new to the page', () => {
    const { rerender } = render(table(read1.slice(0, -1)))
    const newcomer = read1.at(-1)!
    rerender(table(read1.slice(0, -2).concat([{ ...newcomer, viewers: first.viewers + 5 }])))
    expect(logins()[0]).toBe(newcomer.login)
    const fade = calls.find((c) => c.el === rowOf(newcomer.login))
    expect(fade?.frames).toEqual([{ opacity: 0 }, { opacity: 1 }])
  })

  it('snaps on a sort, a range switch, the first rows and reduced motion', () => {
    const { rerender } = render(table([]))
    rerender(table(read1))
    expect(calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: /^Chat\/min/ }))
    expect(calls).toEqual([])
    rerender(table(read2, '30m'))
    expect(calls).toEqual([])
    cleanup()
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    const again = render(table(read1))
    again.rerender(table(read2))
    expect(calls).toEqual([])
  })
})
