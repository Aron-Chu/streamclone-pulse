// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsHostShell } from '../src/options/SettingsHostShell.tsx'
import { SupporterBanner } from '../src/options/SupporterCrownBanner.tsx'
import { resetSupporterAppearanceForTests } from '../src/ui/useSupporterAppearance.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** The full-settings Supporter banner: the lab's "Emote Pile · Crown". */
const NON_SUPPORTER = { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0 }
const SUPPORTER = { type: 'SUPPORTER_APPEARANCE', finish: 'halo', validForMs: 60_000, tenure: '12m', paint: { wave: 'chrome', sheen: 'glint' }, perks: true }
const PLAIN_SUPPORTER = { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 60_000, tenure: '3m', perks: true }

let hidden = false
let frames: Array<{ id: number; run: FrameRequestCallback }> = []
let clock = 0
let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null
let stored: Record<string, unknown> = {}
const raf = vi.fn((run: FrameRequestCallback) => { const id = frames.length + 1 + Math.random(); frames.push({ id, run }); return id })
const caf = vi.fn((id: number) => { frames = frames.filter(frame => frame.id !== id) })

function runFrames(count: number) {
  for (let k = 0; k < count && frames.length; k++) frames.shift()!.run(clock += 50)
}

function stubExtension(appearance: unknown, reducedMotion = false) {
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', getURL: (path: string) => path, sendMessage: vi.fn(async (message: { type: string }) => message.type === 'SUPPORTER_APPEARANCE' ? appearance : undefined) },
    storage: {
      sync: { get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : key === 'pulseBanner' ? { pulseBanner: { mode: 'off', intensity: 35, title: '' } } : {})), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items) }) },
      onChanged: { addListener() {}, removeListener() {} },
    },
  })
  const matchMedia = (query: string) => ({ matches: reducedMotion && query.includes('reduce'), addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('matchMedia', matchMedia)
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
}

/** Roots a test mounted, unmounted in afterEach too, so a failing test never leaks a running pile. */
const roots: Array<() => void> = []

async function mount(node: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  for (let k = 0; k < 4; k++) await act(async () => { await Promise.resolve() })
  const banner = () => host.querySelector<HTMLButtonElement>('[data-settings-host-banner="supporter"]')!
  const stage = () => host.querySelector<HTMLElement>('.pulse-supporter-pile')!
  let done = false
  const unmount = () => { if (done) return; done = true; act(() => root.unmount()); host.remove() }
  roots.push(unmount)
  return { host, banner, stage, unmount }
}

beforeEach(() => {
  resetSupporterAppearanceForTests()
  hidden = false
  frames = []
  clock = 0
  intersect = null
  stored = {}
  raf.mockClear()
  caf.mockClear()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', caf)
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof intersect) { intersect = callback } observe() {} disconnect() {} })
  // jsdom has no layout; give the pile the lab banner's stage size (44% to 150 px from the edge of 720).
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('pulse-supporter-pile') ? 253 : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('pulse-supporter-pile') ? 108 : 0 } })
})

afterEach(() => {
  for (const unmount of roots.splice(0)) unmount()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  delete (window as { matchMedia?: unknown }).matchMedia
  document.body.replaceChildren()
})

const youImages = (stage: HTMLElement) => [...stage.querySelectorAll<HTMLImageElement>('.spk-you img')].map(img => img.src)

describe('full-settings Supporter banner: Emote Pile · Crown', () => {
  it('renders the Crown for a non-Supporter with the lab’s sample kit, its copy and the way to the benefits', async () => {
    stubExtension(NON_SUPPORTER)
    const onPerks = vi.fn()
    const onOpen = vi.fn()
    const view = await mount(<SupporterBanner onOpen={onOpen} onPerks={onPerks} />)
    expect(onPerks).toHaveBeenLastCalledWith(false)
    expect(view.banner().dataset.supporterKit).toBe('sample')
    expect(view.stage().dataset.mode).toBe('crown')
    expect(view.stage().getAttribute('aria-hidden')).toBe('true')
    expect(view.stage().dataset.running).toBe('true')
    expect(view.banner().querySelector('strong')?.textContent).toBe('Pulse Supporter')
    expect(view.banner().querySelector('small')?.textContent).toBe('Your signature emote lands on top, crest and all. Only you see it. Core Pulse tools stay free.')
    expect(view.banner().querySelector('.pulse-settings-supporter-banner-arrow')?.textContent).toBe('View benefits →')
    expect(view.banner().style.getPropertyValue('--spk-fin')).toBe('#efc96a')
    runFrames(1)
    // The lab builds nine chat emotes and one signature emote into a settled pile.
    expect(view.stage().querySelectorAll('.spk-body')).toHaveLength(10)
    expect(youImages(view.stage())).toEqual(['https://cdn.7tv.app/emote/01GAFTZ9K80003DHH026MC7JW0/2x.webp'])
    expect(view.stage().querySelector('.spk-you .spk-crest')?.getAttribute('data-tenure')).toBe('12m')
    runFrames(600)
    const bodies = view.stage().querySelectorAll('.spk-body')
    expect(bodies.length).toBeGreaterThan(10)
    expect(bodies.length).toBeLessThanOrEqual(26 + 2)
    for (const img of view.stage().querySelectorAll('img')) {
      expect(img.src).toMatch(/^https:\/\/(static-cdn\.jtvnw\.net\/emoticons\/v2\/\d+\/default\/dark\/2\.0|cdn\.7tv\.app\/emote\/[0-9A-Z]+\/2x\.webp)$/)
    }
    // Hover shakes the pile and drops a signature emote in; a click opens the benefits.
    const yours = view.stage().querySelectorAll('.spk-you').length
    view.banner().dispatchEvent(new Event('pointerenter'))
    expect(view.stage().querySelectorAll('.spk-you').length).toBeGreaterThan(Math.min(yours, 2) - 1)
    view.banner().click()
    expect(onOpen).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(frames).toHaveLength(0)
  })

  it('crowns the pile with a Supporter’s own signature emote, glowing in their paint, with their crest on top', async () => {
    stubExtension(SUPPORTER)
    stored = { supporterSignatureEmote: 'wideReacting' }
    const view = await mount(<SupporterBanner onOpen={() => {}} />)
    expect(view.banner().dataset.supporterKit).toBe('own')
    expect(view.banner().style.getPropertyValue('--spk-fin')).toBe('#e6a9d6')
    runFrames(1)
    expect(youImages(view.stage())).toEqual(['https://cdn.7tv.app/emote/01HMM8VG3R0007GXBD883VP2YY/2x.webp'])
    const you = view.stage().querySelector<HTMLElement>('.spk-you')!
    expect(you.querySelector('.spk-crest')?.getAttribute('data-tenure')).toBe('12m')
    // The crest's frame is drawn in the Halo paint.
    expect(you.querySelector('.spk-crest polygon')?.getAttribute('stroke')).toBe('#e6a9d6')
    // A wide signature emote keeps the lab's crown size, as an ellipse as wide as the emote.
    expect(parseFloat(you.style.width) / parseFloat(you.style.height)).toBeCloseTo(3.3, 1)
    view.unmount()
  })

  it('gives a Supporter who never picked one the default wideSpeedLaugh4, and a Supporter without a finish the Peak teal', async () => {
    stubExtension(PLAIN_SUPPORTER)
    const view = await mount(<SupporterBanner onOpen={() => {}} />)
    expect(view.banner().dataset.supporterKit).toBe('own')
    expect(view.banner().style.getPropertyValue('--spk-fin')).toBe('#2dd4bf')
    runFrames(1)
    expect(youImages(view.stage())).toEqual(['https://cdn.7tv.app/emote/01J7VZYB08000E8DPG2XYMKQYR/2x.webp'])
    expect(view.stage().querySelector('.spk-you .spk-crest')?.getAttribute('data-tenure')).toBe('3m')
    view.unmount()
  })

  it('never shows a stored signature emote without Supporter perks', async () => {
    stubExtension(NON_SUPPORTER)
    stored = { supporterSignatureEmote: 'PartyParrot' }
    const view = await mount(<SupporterBanner onOpen={() => {}} />)
    runFrames(300)
    expect(view.banner().dataset.supporterKit).toBe('sample')
    expect(view.stage().querySelector('img[src*="01FKSDK14G0008TM5NY9QEG0QV"]')).toBeNull()
    view.unmount()
  })

  it('pauses in a hidden tab and offscreen, and resumes when shown', async () => {
    stubExtension(NON_SUPPORTER)
    const view = await mount(<SupporterBanner onOpen={() => {}} />)
    expect(view.stage().dataset.running).toBe('true')
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    expect(view.stage().dataset.running).toBe('false')
    expect(frames).toHaveLength(0)
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    expect(view.stage().dataset.running).toBe('true')
    act(() => intersect!([{ isIntersecting: false }]))
    expect(view.stage().dataset.running).toBe('false')
    expect(frames).toHaveLength(0)
    act(() => intersect!([{ isIntersecting: true }]))
    expect(view.stage().dataset.running).toBe('true')
    view.unmount()
    expect(frames).toHaveLength(0)
  })

  it('draws one settled still pile from static images under reduced motion and never schedules a frame', async () => {
    stubExtension(SUPPORTER, true)
    stored = { supporterSignatureEmote: 'PETPET' }
    const view = await mount(<SupporterBanner onOpen={() => {}} />)
    expect(view.stage().dataset.still).toBe('true')
    expect(view.stage().dataset.running).toBe('false')
    const bodies = [...view.stage().querySelectorAll<HTMLElement>('.spk-body')]
    expect(bodies.length).toBeGreaterThanOrEqual(10)
    // Everything has landed: each body rests on the floor or on another body, inside the stage
    // (the lab's pair push can sink a body a pixel or two into the floor; the banner clips it).
    for (const body of bodies) {
      const [, , y] = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(body.style.transform)!.map(Number)
      expect(y + parseFloat(body.style.height)).toBeLessThanOrEqual(111)
      expect(y).toBeGreaterThan(-20)
    }
    expect(youImages(view.stage()).every(src => src === 'https://cdn.7tv.app/emote/01FE3XY508000AA32JP519W2EW/2x_static.webp')).toBe(true)
    expect([...view.stage().querySelectorAll<HTMLImageElement>('img')].filter(img => img.src.includes('cdn.7tv.app')).every(img => img.src.endsWith('/2x_static.webp'))).toBe(true)
    view.banner().dispatchEvent(new Event('pointerenter'))
    expect(view.stage().querySelectorAll('.spk-body')).toHaveLength(bodies.length)
    view.unmount()
    expect(raf).not.toHaveBeenCalled()
  })

  it('reports no answer until a verified membership reply, then falls back to the sample pile', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stubExtension({ type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0, unverified: true })
    const waiting = vi.fn()
    const view = await mount(<SupporterBanner onOpen={() => {}} onPerks={waiting} />)
    // A failed or renewal-paused account read is not an answer either.
    expect(waiting).toHaveBeenCalled()
    expect(waiting.mock.calls.every(([perks]) => perks === undefined)).toBe(true)
    expect(view.banner().dataset.supporterKit).toBe('pending')
    expect(view.stage().childElementCount).toBe(0)
    await act(async () => { vi.advanceTimersByTime(1300) })
    expect(view.banner().dataset.supporterKit).toBe('sample')
    expect(view.stage().dataset.mode).toBe('crown')
    view.unmount()
  })

  it('shares the banner’s membership check with the settings it frames', async () => {
    for (const [appearance, perks] of [[NON_SUPPORTER, 'false'], [SUPPORTER, 'true']] as const) {
      resetSupporterAppearanceForTests()
      stubExtension(appearance)
      const view = await mount(<SettingsHostShell>{(section, supporterPerks) => <span data-probe={`${section}:${supporterPerks}`} />}</SettingsHostShell>)
      expect(view.host.querySelector('[data-probe]')?.getAttribute('data-probe')).toBe(`moments:${perks}`)
      expect(view.stage().dataset.mode).toBe('crown')
      const sent = (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(([message]) => message.type === 'SUPPORTER_APPEARANCE')
      expect(sent).toHaveLength(1)
      view.unmount()
    }
  })
})
