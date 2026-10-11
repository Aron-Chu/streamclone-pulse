// @vitest-environment jsdom
import SUPPORTER_PERKS from '../src/shared/supporter-perks.json'
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

function stubExtension(appearance: unknown, reducedMotion = false, entitlement?: unknown) {
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', getURL: (path: string) => path, sendMessage: vi.fn(async (message: { type: string }) => message.type === 'SUPPORTER_APPEARANCE' ? appearance : message.type === 'SUPPORTER_ENTITLEMENT' && entitlement ? { type: 'SUPPORTER_ENTITLEMENT', entitlement } : undefined) },
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
const chips = (banner: HTMLElement) => [...banner.querySelectorAll('.pulse-settings-supporter-perk')].map(chip => chip.textContent)

describe('full-settings Supporter banner: Crown, staged', () => {
  it('shows the price and View benefits only while paid sign-ups are open', async () => {
    for (const [entitlement, eyebrow, arrow] of [
      [undefined, 'Pulse Supporter', 'See what’s coming →'],
      [{ state: 'not_linked' }, 'Pulse Supporter', 'See what’s coming →'],
      [{ state: 'ready', status: 'none', checkoutEnabled: false }, 'Pulse Supporter', 'See what’s coming →'],
      [{ state: 'ready', status: 'none', checkoutEnabled: true }, 'Pulse Supporter· US$4.99/mo', 'View benefits →'],
    ] as const) {
      stubExtension(NON_SUPPORTER, false, entitlement)
      const onOpen = vi.fn()
      const view = await mount(<SupporterBanner onOpen={onOpen} />)
      expect(view.banner().querySelector('.pulse-settings-supporter-banner-eyebrow')?.textContent, JSON.stringify(entitlement)).toBe(eyebrow)
      expect(view.banner().querySelector('.pulse-settings-supporter-banner-arrow')?.textContent).toBe(arrow)
      // Same target either way: the Supporter page.
      view.banner().click()
      expect(onOpen).toHaveBeenCalledTimes(1)
      view.unmount()
    }
  })

  it('renders the staged Crown for a non-Supporter: the sample kit, a chip for every perk and the way to the benefits', async () => {
    stubExtension(NON_SUPPORTER)
    const onPerks = vi.fn()
    const onOpen = vi.fn()
    const view = await mount(<SupporterBanner onOpen={onOpen} onPerks={onPerks} />)
    expect(onPerks).toHaveBeenLastCalledWith(false)
    expect(view.banner().dataset.supporterKit).toBe('sample')
    expect(view.stage().dataset.mode).toBe('crown')
    expect(view.stage().getAttribute('aria-hidden')).toBe('true')
    expect(view.stage().dataset.running).toBe('true')
    // Sign-ups closed (no entitlement says otherwise): no price.
    expect(view.banner().querySelector('.pulse-settings-supporter-banner-eyebrow')?.textContent).toBe('Pulse Supporter')
    expect(view.banner().querySelector('strong')?.textContent).toBe('Your crest lands on top')
    expect(chips(view.banner())).toEqual(SUPPORTER_PERKS.names)
    expect(chips(view.banner())).toEqual(['Title paint', 'Tenure crest', 'Emote rain', 'Supporter card'])
    expect(view.banner().querySelector('[data-perk="crest"] .pulse-crest')?.getAttribute('data-tenure')).toBe('12m')
    expect(view.banner().querySelector('small')?.textContent).toBe('Only you see them. Core tools stay free.')
    expect(view.banner().textContent).not.toMatch(/signature/i)
    expect(view.banner().querySelector('.pulse-settings-supporter-banner-arrow')?.textContent).toBe('See what’s coming →')
    expect(view.banner().style.getPropertyValue('--spk-fin')).toBe('#efc96a')
    runFrames(1)
    // The lab builds nine chat emotes and one of yours into a settled pile. Yours is your crest, not an emote.
    expect(view.stage().querySelectorAll('.spk-body')).toHaveLength(10)
    expect(youImages(view.stage())).toEqual([])
    const you = view.stage().querySelector<HTMLElement>('.spk-you')!
    expect(you.querySelector('.spk-crest')?.getAttribute('data-tenure')).toBe('12m')
    // The sample crest's frame is drawn in the sample's Etched paint.
    expect(you.querySelector('.spk-crest polygon')?.getAttribute('stroke')).toBe('#efc96a')
    // A small "you" tag rides above it.
    const tag = view.stage().querySelector<HTMLElement>('.spk-tag')!
    expect(tag.textContent).toBe('you')
    expect(tag.style.opacity).toBe('1')
    runFrames(600)
    const bodies = view.stage().querySelectorAll('.spk-body')
    expect(bodies.length).toBeGreaterThan(10)
    // Staged keeps fewer bodies on screen than the lab's 26.
    expect(bodies.length).toBeLessThanOrEqual(22 + 2)
    for (const img of view.stage().querySelectorAll('img')) {
      expect(img.src).toMatch(/^https:\/\/(static-cdn\.jtvnw\.net\/emoticons\/v2\/\d+\/default\/dark\/2\.0|cdn\.7tv\.app\/emote\/[0-9A-Z]+\/2x\.webp)$/)
    }
    // Hover shakes the pile and drops your crest in; a click opens the benefits.
    const yours = view.stage().querySelectorAll('.spk-you').length
    view.banner().dispatchEvent(new Event('pointerenter'))
    expect(view.stage().querySelectorAll('.spk-you').length).toBeGreaterThan(Math.min(yours, 2) - 1)
    view.banner().click()
    expect(onOpen).toHaveBeenCalledTimes(1)
    view.unmount()
    expect(frames).toHaveLength(0)
  })

  it('crowns the pile with a Supporter’s own crest in their paint, and names their kit', async () => {
    stubExtension(SUPPORTER)
    const view = await mount(<SupporterBanner onOpen={() => {}} />)
    expect(view.banner().dataset.supporterKit).toBe('own')
    expect(view.banner().style.getPropertyValue('--spk-fin')).toBe('#e6a9d6')
    expect(view.banner().querySelector('.pulse-settings-supporter-banner-eyebrow')?.textContent).toBe('Your kit')
    expect(view.banner().querySelector('strong')?.textContent).toBe('Yours lands on top')
    expect(chips(view.banner())).toEqual(['Halo paint', 'Year-one crest', 'Emote rain', 'Supporter card'])
    expect(view.banner().textContent).not.toContain('4.99')
    runFrames(1)
    expect(youImages(view.stage())).toEqual([])
    const you = view.stage().querySelector<HTMLElement>('.spk-you')!
    expect(you.querySelector('.spk-crest')?.getAttribute('data-tenure')).toBe('12m')
    // The crest's frame is drawn in the Halo paint, and the tag's "you" wears their real paint.
    expect(you.querySelector('.spk-crest polygon')?.getAttribute('stroke')).toBe('#e6a9d6')
    expect(view.stage().querySelector<HTMLElement>('.spk-tag .pulse-paint')?.dataset).toMatchObject({ finish: 'halo', wave: 'chrome', sheen: 'glint', text: 'you' })
    // A crest stays nearly upright, like a wide emote, so it reads.
    const angle = Number(/rotate\(([-\d.]+)deg\)/.exec(you.querySelector<HTMLElement>('.spk-inner')!.style.transform)![1])
    expect(Math.abs(angle)).toBeLessThanOrEqual(20)
    view.unmount()
  })

  it('gives a Supporter without a finish the Peak teal, their own crest and a default paint chip', async () => {
    stubExtension(PLAIN_SUPPORTER)
    const view = await mount(<SupporterBanner onOpen={() => {}} />)
    expect(view.banner().dataset.supporterKit).toBe('own')
    expect(view.banner().style.getPropertyValue('--spk-fin')).toBe('#2dd4bf')
    expect(chips(view.banner())).toEqual(['Default paint', 'Signal set', 'Emote rain', 'Supporter card'])
    runFrames(1)
    expect(view.stage().querySelector('.spk-you .spk-crest')?.getAttribute('data-tenure')).toBe('3m')
    expect(view.stage().querySelector('.spk-tag .spk-name')?.className).toBe('spk-name')
    view.unmount()
  })

  it('runs calmer than the lab: the first peak at 8 s, then one every 28 to 36 s, each swelling the glow for a moment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    stubExtension(NON_SUPPORTER)
    const view = await mount(<SupporterBanner onOpen={() => {}} />)
    runFrames(150)
    expect(view.stage().dataset.peaks).toBeUndefined()
    runFrames(20)
    expect(view.stage().dataset.peaks).toBe('1')
    expect(view.stage().dataset.glow).toBe('peak')
    await act(async () => { vi.advanceTimersByTime(1500) })
    expect(view.stage().dataset.glow).toBeUndefined()
    // 35 s in, still only the first peak; by 45 s the second.
    runFrames(530)
    expect(view.stage().dataset.peaks).toBe('1')
    runFrames(200)
    expect(view.stage().dataset.peaks).toBe('2')
    const stage = view.stage()
    expect(stage.dataset.glow).toBe('peak')
    view.unmount()
    // Stopping the pile drops a glow that was still swollen.
    expect(stage.dataset.glow).toBeUndefined()
  })

  it('never reads or shows an emote stored by the dropped signature perk', async () => {
    for (const appearance of [NON_SUPPORTER, SUPPORTER]) {
      resetSupporterAppearanceForTests()
      stubExtension(appearance)
      stored = { supporterSignatureEmote: 'PartyParrot' }
      const view = await mount(<SupporterBanner onOpen={() => {}} />)
      runFrames(300)
      expect(view.stage().querySelector('img[src*="01FKSDK14G0008TM5NY9QEG0QV"]')).toBeNull()
      expect((chrome.storage.sync.get as ReturnType<typeof vi.fn>).mock.calls.flat()).not.toContain('supporterSignatureEmote')
      expect(stored).toEqual({ supporterSignatureEmote: 'PartyParrot' })
      view.unmount()
    }
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
    expect(youImages(view.stage())).toEqual([])
    expect(view.stage().querySelector('.spk-you .spk-crest')?.getAttribute('data-tenure')).toBe('12m')
    expect(view.stage().querySelector<HTMLElement>('.spk-tag')?.style.opacity).toBe('1')
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
