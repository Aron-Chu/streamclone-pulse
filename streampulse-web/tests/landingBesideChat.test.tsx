import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LandingBesideChat } from '../src/ui/components/landing/besideChat/LandingBesideChat'
import {
  BEATS,
  CALM,
  CAPS,
  camFor,
  COL_W,
  FLOOD,
  PLAYER_W,
  sceneRatio,
  stageLayout,
  stillChat,
  TIMES,
} from '../src/ui/components/landing/besideChat/besideChatModel'
import { clock, STILL_VT } from '../src/ui/components/landing/besideChat/catStreamTimes'
import { DEMO_PLAY_EVENT, requestDemoPlay } from '../src/ui/components/landing/demoPlayEvent'

// Counts fetches of the three.js stream. It loads only near the stage, with motion and WebGL; the test
// IntersectionObserver never reports, so it never loads here.
const scene = vi.hoisted(() => ({ loads: 0 }))
vi.mock('../src/ui/components/landing/besideChat/catStreamScene', () => {
  scene.loads += 1
  return { createCatStreamScene: () => null }
})

/** Answers matchMedia as allowing motion (or not). */
function stubReducedMotion(reduced: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

const stage = () => document.querySelector<HTMLElement>('.es')!
const steps = () => screen.getAllByRole('button', { name: /^\d\. / })
const current = () => steps().findIndex((step) => step.getAttribute('aria-current') === 'step')
const chatText = () => Array.from(document.querySelectorAll('.es-lines .es-cl')).map((line) => line.textContent)

afterEach(() => {
  vi.useRealTimers()
})

describe('the demo beside Twitch chat: layout (board extension-brainchat 11-22, ★ E1)', () => {
  it('is 1120 x 700 at most, with the caption beside the column when it fits', () => {
    const wide = stageLayout(1400)
    expect([wide.width, wide.height, wide.phone]).toEqual([1120, 700, false])
    expect(wide.capLeft).not.toBeNull()
    expect(wide.capWidth).toBeGreaterThanOrEqual(200)
    // the page's own column, 1072 px wide
    expect(stageLayout(1072).capLeft).not.toBeNull()
    // narrower, the caption goes under the stage
    expect(stageLayout(900).capLeft).toBeNull()
  })

  it('takes the phone shape below 600 px, never taller than 640 px', () => {
    const phone = stageLayout(343)
    expect(phone.phone).toBe(true)
    expect(phone.height).toBe(Math.round((343 * 560) / 358))
    expect(phone.capLeft).toBeNull()
    expect(stageLayout(599).height).toBe(640)
    expect(stageLayout(600).phone).toBe(false)
  })

  it('centres the column when the camera moves in, and fits the whole page when it is out', () => {
    for (const width of [343, 720, 1072, 1120]) {
      const layout = stageLayout(width)
      const [x, , s] = layout.cam.in
      expect(x + (PLAYER_W + COL_W / 2) * s).toBeCloseTo(layout.width / 2, 5)
      const [ox, oy, os] = layout.cam.out
      expect(ox).toBeGreaterThanOrEqual(0)
      expect(oy).toBeGreaterThanOrEqual(0)
      expect(1280 * os).toBeLessThanOrEqual(layout.width + 1e-9)
      expect(800 * os).toBeLessThanOrEqual(layout.height + 1e-9)
    }
  })

  it('keeps the stream sharp but never above a 1.25 drawing ratio', () => {
    const layout = stageLayout(1120)
    expect(sceneRatio(layout, 3)).toBe(1.25)
    expect(sceneRatio(layout, 1)).toBeCloseTo(layout.cam.out[2], 5)
    expect(sceneRatio(stageLayout(240), 1)).toBe(0.5)
    expect(sceneRatio(layout, Number.NaN)).toBeCloseTo(layout.cam.out[2], 5)
  })

  it('moves in on the column for steps 2 to 4 only', () => {
    expect([0, 1, 2, 3, 4].map((beat) => camFor(beat as 0 | 1 | 2 | 3 | 4))).toEqual(['out', 'in', 'in', 'in', 'out'])
    expect(BEATS).toHaveLength(5)
  })

  it('keeps a phone on the column, at its foot for the chat flood', () => {
    expect([0, 1, 2, 3, 4].map((beat) => camFor(beat as 0 | 1 | 2 | 3 | 4, true))).toEqual(['low', 'in', 'in', 'in', 'in'])
    const phone = stageLayout(358)
    const [lx, ly, ls] = phone.cam.low
    expect([lx, ls]).toEqual([phone.cam.in[0], phone.cam.in[2]])
    // The column's foot sits on the stage's bottom edge.
    expect(ly + 800 * ls).toBeCloseTo(phone.height, 5)
    // Wider stages, where the column is shorter than the stage, never lift it off the top.
    expect(stageLayout(1120).cam.low[1]).toBeLessThanOrEqual(0)
    expect(CAPS).toHaveLength(5)
  })

  it('writes chat about the cat with made-up names and no game words', () => {
    for (const line of [...CALM, ...FLOOD]) {
      expect(line.name).toMatch(/^[a-z0-9_]+$/)
      expect(line.text).not.toMatch(/minecraft|creeper|diamond|nether|ender|steve|pickaxe|—/i)
    }
  })
})

describe('the demo beside Twitch chat: the stage', () => {
  it('shows step 4 still with the stream poster before it plays, and fetches no three.js', () => {
    stubReducedMotion(false)
    render(<LandingBesideChat />)
    expect(stage().getAttribute('aria-hidden')).toBe('true')
    expect(stage().dataset.beat).toBe('3')
    expect(stage().dataset.cam).toBe('in')
    expect(stage().hasAttribute('data-scene')).toBe(false)
    expect(document.querySelectorAll('.es-poster')).toHaveLength(2)
    expect(current()).toBe(3)
    expect(document.querySelector('.es-time span')?.textContent).toBe(clock(STILL_VT[3]))
    expect(document.querySelector('.es-ch')?.textContent).toBe('streampulse_demo')
    expect(scene.loads).toBe(0)
  })

  it('holds the step picked, with its words under the stage', () => {
    stubReducedMotion(false)
    render(<LandingBesideChat />)
    fireEvent.click(steps()[0]!)
    expect(current()).toBe(0)
    expect(stage().dataset.beat).toBe('0')
    expect(stage().dataset.cam).toBe('out')
    expect(document.querySelector('.es-steps-cap')?.textContent).toBe(`${BEATS[0]}. ${CAPS[0]}`)
    expect(chatText()).toEqual(stillChat().map((line) => `${line.name}: ${line.text}`))
    fireEvent.click(steps()[4]!)
    expect(stage().dataset.beat).toBe('4')
    expect(stage().dataset.cam).toBe('out')
    expect(chatText()).toEqual([])
  })

  it('plays the run from the top when the hero cue asks, and ends on the jump', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    render(<LandingBesideChat />)
    act(() => { window.dispatchEvent(new Event(DEMO_PLAY_EVENT)) })
    act(() => { vi.advanceTimersByTime(700) })
    expect(stage().dataset.beat).toBe('0')
    expect(chatText().slice(0, CALM.length)).toEqual(CALM.map((line) => `${line.name}: ${line.text}`))
    act(() => { vi.advanceTimersByTime(TIMES.camIn) })
    expect(stage().dataset.cam).toBe('in')
    act(() => { vi.advanceTimersByTime(TIMES.jumped - TIMES.camIn) })
    expect(stage().dataset.beat).toBe('4')
    act(() => { vi.advanceTimersByTime(TIMES.landed - TIMES.jumped + 2000) })
    expect(stage().dataset.cam).toBe('out')
    expect(current()).toBe(4)
  })

  it('plays from the top when the cue was pressed before its code had loaded', () => {
    vi.useFakeTimers()
    stubReducedMotion(false)
    requestDemoPlay()
    render(<LandingBesideChat />)
    act(() => { vi.advanceTimersByTime(700) })
    expect(stage().dataset.beat).toBe('0')
    expect(current()).toBe(0)
  })

  it('keeps the step picked, or plays on, when the motion setting changes', () => {
    vi.useFakeTimers()
    // A motion setting the test can change, telling its listeners like the browser does.
    let reduced = false
    const listeners = new Set<() => void>()
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
      get matches() { return reduced && query === '(prefers-reduced-motion: reduce)' },
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, listener: () => void) => { listeners.add(listener) },
      removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener) },
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList)
    const setReduced = (value: boolean) => act(() => {
      reduced = value
      for (const listener of [...listeners]) listener()
    })
    render(<LandingBesideChat />)
    fireEvent.click(steps()[1]!)
    setReduced(true)
    expect(stage().dataset.beat).toBe('1')
    setReduced(false)
    expect(stage().dataset.beat).toBe('1')
    // Once it plays, a new setting plays it on from the top.
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    act(() => { vi.advanceTimersByTime(TIMES.topMoments + 100) })
    expect(stage().dataset.beat).toBe('2')
    setReduced(true)
    expect(stage().dataset.beat).toBe('3')
    setReduced(false)
    expect(stage().dataset.beat).toBe('0')
    act(() => { vi.advanceTimersByTime(TIMES.jumped + 100) })
    expect(stage().dataset.beat).toBe('4')
  })

  it('holds one still step under reduced motion, even when asked to play', () => {
    vi.useFakeTimers()
    stubReducedMotion(true)
    render(<LandingBesideChat />)
    act(() => { window.dispatchEvent(new Event(DEMO_PLAY_EVENT)) })
    act(() => { vi.advanceTimersByTime(TIMES.loop) })
    expect(stage().dataset.beat).toBe('3')
    fireEvent.click(screen.getByRole('button', { name: 'Play again' }))
    act(() => { vi.advanceTimersByTime(TIMES.loop) })
    expect(stage().dataset.beat).toBe('3')
    expect(scene.loads).toBe(0)
  })
})
