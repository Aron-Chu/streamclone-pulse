// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supporterAppearanceReply } from '../src/background/supporterAppearance.ts'
import { mountSupporterCard } from '../src/content/supporterCard.ts'
import type { SupporterCardOptions } from '../src/supporter/cardContract.ts'
import { LINES, NAMES } from '../src/supporter/kit.ts'
import { SupporterHero } from '../src/ui/PulseSettingsPanel.tsx'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The quick-settings Supporter card: the lab's "Your Line" (ChatStack) in its
 * Anatomy and Tenure Climb modes, drawn by content/supporter-card.js.
 */
let hidden = false
let frames: Array<{ id: number; run: FrameRequestCallback }> = []
let clock = 0
let intersect: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null
let stored: Record<string, unknown> = {}
const storageListeners = new Set<(changes: Record<string, chrome.storage.StorageChange>, area: string) => void>()
const raf = vi.fn((run: FrameRequestCallback) => { const id = frames.length + 1 + Math.random(); frames.push({ id, run }); return id })
const caf = vi.fn((id: number) => { frames = frames.filter(frame => frame.id !== id) })

function runFrames(count: number) {
  for (let k = 0; k < count && frames.length; k++) frames.shift()!.run(clock += 50)
}

function stubExtension({ reducedMotion = false, sendMessage = vi.fn(async () => undefined) as (message: { type: string }) => Promise<unknown> } = {}) {
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', sendMessage },
    storage: {
      sync: { get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})), set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items) }) },
      onChanged: { addListener: (fn: never) => storageListeners.add(fn), removeListener: (fn: never) => storageListeners.delete(fn) },
    },
  })
  const matchMedia = (query: string) => ({ matches: reducedMotion && query.includes('reduce'), addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('matchMedia', matchMedia)
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
}

/** A sidebar card's stage: 285 px wide, 60 px tall, as in the lab. */
function cardStage() {
  const host = document.createElement('button')
  host.className = 'pulse-settings-supporter-cta'
  const stage = document.createElement('span')
  stage.className = 'pulse-supporter-stage'
  host.append(stage)
  document.body.append(host)
  // Every line the stage ever shows, including those that scrolled away.
  const seen = new MutationObserver(() => {})
  seen.observe(stage, { childList: true, subtree: true })
  const added = () => seen.takeRecords().flatMap(record => [...record.addedNodes]).filter((node): node is HTMLElement => node instanceof HTMLElement && node.classList.contains('spk-cl'))
  return { host, stage, added, remove: () => { seen.disconnect(); host.remove() } }
}

const text = (el: Element) => el.textContent!.replace(/\s+/g, ' ').trim()

/** Everything a test started, stopped in afterEach too, so a failing test never leaks a running stage. */
const cleanups: Array<() => void> = []
function track(stop: () => void): () => void {
  let done = false
  const once = () => { if (!done) { done = true; stop() } }
  cleanups.push(once)
  return once
}
const mountCard = (...args: Parameters<typeof mountSupporterCard>) => track(mountSupporterCard(...args))

beforeEach(() => {
  hidden = false
  frames = []
  clock = 0
  intersect = null
  stored = {}
  storageListeners.clear()
  raf.mockClear()
  caf.mockClear()
  delete globalThis.__pulseSupporterCard
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', caf)
  vi.stubGlobal('IntersectionObserver', class { constructor(callback: typeof intersect) { intersect = callback } observe() {} disconnect() {} })
  // jsdom has no layout; give the stage the lab's sidebar-card size.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('pulse-supporter-stage') ? 285 : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('pulse-supporter-stage') ? 60 : 0 } })
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  vi.unstubAllGlobals()
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight
  delete (window as { matchMedia?: unknown }).matchMedia
  delete globalThis.__pulseSupporterCard
  document.body.replaceChildren()
})

describe('quick-settings Supporter card shell (content script)', () => {
  async function render(node: React.ReactNode) {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(node))
    for (let k = 0; k < 3; k++) await act(async () => { await Promise.resolve() })
    const unmount = track(() => act(() => root.unmount()))
    return { host, rerender: (next: React.ReactNode) => act(async () => root.render(next)), unmount: async () => unmount() }
  }

  it('picks Anatomy for anyone without perks and Tenure Climb, with the earned crest and paint, for a verified Supporter', async () => {
    stubExtension()
    const stop = vi.fn()
    const mount = vi.fn((_stage: HTMLElement, _options: SupporterCardOptions) => stop)
    globalThis.__pulseSupporterCard = mount
    const view = await render(<SupporterHero appearance={null} onOpen={() => {}} />)
    expect(mount).toHaveBeenCalledTimes(1)
    expect(mount.mock.calls[0][0]).toBe(view.host.querySelector('.pulse-supporter-stage'))
    expect(mount.mock.calls[0][1]).toEqual({ mode: 'anatomy', finish: null })

    await view.rerender(<SupporterHero appearance={{ finish: null, tenure: '6m', perks: true }} onOpen={() => {}} />)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(mount.mock.calls[1][1]).toEqual({ mode: 'tenure', tenure: '6m', finish: null })

    await view.rerender(<SupporterHero appearance={{ finish: 'halo', tenure: '24m', paint: { wave: 'aurora', sheen: 'glint' }, perks: true }} onOpen={() => {}} />)
    expect(mount.mock.calls[2][1]).toEqual({ mode: 'tenure', tenure: '24m', finish: 'halo', paint: { wave: 'aurora', sheen: 'glint' } })
    // Nothing reached the worker: the card script was already in this tab.
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
    await view.unmount()
    expect(stop).toHaveBeenCalledTimes(3)
  })

  it('asks the worker to inject the card script once, then draws with what it registers', async () => {
    const mount = vi.fn((_stage: HTMLElement, _options: SupporterCardOptions) => () => {})
    const sendMessage = vi.fn(async (message: { type: string }) => {
      // The worker's chrome.scripting injection registers the stage in this isolated world.
      if (message.type === 'SUPPORTER_CARD_SCRIPT') globalThis.__pulseSupporterCard = mount
      return { type: 'SUPPORTER_CARD_SCRIPT', ok: true }
    })
    stubExtension({ sendMessage })
    const view = await render(<SupporterHero appearance={null} onOpen={() => {}} />)
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SUPPORTER_CARD_SCRIPT' })
    expect(mount).toHaveBeenCalledTimes(1)
    await view.rerender(<SupporterHero appearance={{ finish: 'glass', tenure: 'new', perks: true }} onOpen={() => {}} />)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(mount).toHaveBeenCalledTimes(2)
    await view.unmount()
  })

  it('leaves an empty strip, and never throws, when the card script cannot load', async () => {
    stubExtension({ sendMessage: vi.fn(async () => ({ type: 'SUPPORTER_CARD_SCRIPT', ok: false })) })
    const view = await render(<SupporterHero appearance={null} onOpen={() => {}} />)
    expect(view.host.querySelector('.pulse-supporter-stage')?.childElementCount).toBe(0)
    await view.unmount()
  })
})

describe('Your Line, drawn by content/supporter-card.js', () => {
  it('Anatomy: the lab sample kit, a spotlight line every sixth, no labels over the line, and chat frozen while hovered', async () => {
    stubExtension()
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'anatomy', finish: null })
    expect(card.stage.dataset.mode).toBe('anatomy')
    expect(card.stage.dataset.running).toBe('true')
    // The card reads no storage: there is no emote to choose any more.
    expect(chrome.storage.sync.get).not.toHaveBeenCalled()
    expect(card.host.style.getPropertyValue('--spk-fin')).toBe('#efc96a')
    runFrames(300)
    const lines = card.added()
    const mine = lines.filter(line => line.classList.contains('spk-sup'))
    expect(mine.length).toBeGreaterThan(0)
    expect(lines.length / mine.length).toBeGreaterThanOrEqual(4)
    for (const line of mine) {
      expect(line.querySelector('.spk-crest')?.getAttribute('data-tenure')).toBe('12m')
      expect(line.querySelector('.spk-name')?.textContent).toBe('you')
      expect(line.querySelector<HTMLImageElement>('img.spk-kit-emote')?.src).toBe('https://cdn.7tv.app/emote/01GAFTZ9K80003DHH026MC7JW0/2x.webp')
    }

    card.host.dispatchEvent(new Event('pointerenter'))
    expect([...card.stage.querySelectorAll('.spk-cl')].at(-1)?.classList.contains('spk-sup')).toBe(true)
    runFrames(1)
    // Nothing is drawn over the demo line.
    expect(card.stage.querySelector('.spk-callouts, .spk-co')).toBeNull()
    card.added()
    runFrames(200)
    expect(card.added()).toHaveLength(0)
    card.host.dispatchEvent(new Event('pointerleave'))
    runFrames(200)
    expect(card.added().length).toBeGreaterThan(0)
    stop()
    expect(card.stage.childElementCount).toBe(0)
    expect(card.host.style.getPropertyValue('--spk-fin')).toBe('')
    expect(frames).toHaveLength(0)
    card.remove()
  })

  it('Tenure Climb: each of your lines climbs one crest stage up to the one the server reports for this Supporter, then holds there, finish or not', async () => {
    stubExtension()
    const member = (cosmetics: { enabled: boolean; finish: 'glass' | 'etched' | 'halo' }) => ({ state: 'ready', status: 'active', supportPeriods: 7, features: ['supporter.banner.v1', 'supporter.finish.v1'], validForMs: 60_000, cosmetics }) as SupporterEntitlement
    // 7 support periods: Steady signal (6 months), for a Supporter on the default accent.
    const reply = await supporterAppearanceReply(member({ enabled: false, finish: 'glass' }), async () => ({ wave: 'smooth', sheen: 'sweep' }))
    expect(reply).toMatchObject({ finish: null, tenure: '6m', perks: true })
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'tenure', tenure: reply.tenure, finish: reply.finish, paint: reply.paint })
    await act(async () => { await Promise.resolve() })
    runFrames(700)
    const mine = card.added().filter(line => line.classList.contains('spk-sup'))
    expect(mine.length).toBeGreaterThanOrEqual(5)
    expect(mine.map(line => line.querySelector('.spk-chip')!.textContent)).toEqual([
      'First signal · New', 'Signal set · 3 mo', 'Steady signal · 6 mo', ...Array(mine.length - 3).fill('Steady signal · 6 mo'),
    ])
    expect(mine.map(line => line.querySelector('.spk-crest')!.getAttribute('data-tenure')).slice(0, 4)).toEqual(['new', '3m', '6m', '6m'])
    // No finish: an unpainted name and the Peak teal; the line ends on the lab's fixed sample emote.
    expect(mine[0].querySelector('.spk-name')!.className).toBe('spk-name')
    expect(card.host.style.getPropertyValue('--spk-fin')).toBe('#2dd4bf')
    expect(mine.every(line => line.querySelector<HTMLImageElement>('img.spk-kit-emote')!.src === 'https://cdn.7tv.app/emote/01GAFTZ9K80003DHH026MC7JW0/2x.webp')).toBe(true)
    expect(chrome.storage.sync.get).not.toHaveBeenCalled()
    // Hover brings your next line right away.
    card.added()
    card.host.dispatchEvent(new Event('pointerenter'))
    expect(card.added().filter(line => line.classList.contains('spk-sup'))).toHaveLength(1)
    stop()
    card.remove()

    // With a finish, the name wears the header's real paint: finish, wave and sheen.
    const painted = await supporterAppearanceReply(member({ enabled: true, finish: 'glass' }), async () => ({ wave: 'aurora', sheen: 'glint' }))
    const second = cardStage()
    const halt = mountCard(second.stage, { mode: 'tenure', tenure: painted.tenure, finish: painted.finish, paint: painted.paint })
    runFrames(300)
    const name = second.added().find(line => line.classList.contains('spk-sup'))!.querySelector<HTMLElement>('.spk-name')!
    expect(name.classList.contains('pulse-paint')).toBe(true)
    expect(name.dataset).toMatchObject({ finish: 'glass', wave: 'aurora', sheen: 'glint', text: 'you' })
    expect(second.host.style.getPropertyValue('--spk-fin')).toBe('#78dce8')
    halt()
    second.remove()
  })

  it('ignores an emote stored by the dropped signature perk, and listens to no storage', async () => {
    stubExtension()
    // A value an older build saved stays where it is, unread.
    stored = { supporterSignatureEmote: 'wideReacting' }
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'tenure', tenure: '12m', finish: 'etched', paint: { wave: 'smooth', sheen: 'sweep' } })
    await act(async () => { await Promise.resolve() })
    runFrames(400)
    const emotes = [...card.stage.querySelectorAll<HTMLImageElement>('img.spk-kit-emote')].map(img => img.src)
    expect(emotes.length).toBeGreaterThan(0)
    expect(new Set(emotes)).toEqual(new Set(['https://cdn.7tv.app/emote/01GAFTZ9K80003DHH026MC7JW0/2x.webp']))
    expect(chrome.storage.sync.get).not.toHaveBeenCalled()
    expect(chrome.storage.sync.set).not.toHaveBeenCalled()
    expect(storageListeners.size).toBe(0)
    expect(stored).toEqual({ supporterSignatureEmote: 'wideReacting' })
    stop()
    card.remove()
  })

  it('never shows real chat: every other line is canned, neutral chatter, and none mentions Supporter', async () => {
    stubExtension()
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'anatomy', finish: null })
    runFrames(1500)
    const lines = card.added()
    expect(lines.length).toBeGreaterThan(40)
    const canned = new Set(LINES.map(line => line.split(' ').filter(word => !/^(Kappa|LUL|PogChamp|Kreygasm|SeemsGood|4Head|NotLikeThis|HeyGuys|wideSpeedLaugh4|wideReacting|wideSpeedNod)$/.test(word)).join(' ')))
    for (const line of lines.filter(entry => !entry.classList.contains('spk-sup'))) {
      const [who, ...rest] = text(line).split(': ')
      expect(NAMES).toContain(who.replace(/:$/, ''))
      expect(canned.has(rest.join(': ').trim())).toBe(true)
    }
    for (const line of lines) expect(text(line)).not.toMatch(/supporter|subscribe|support/i)
    for (const img of lines.flatMap(line => [...line.querySelectorAll('img')])) {
      expect(img.src).toMatch(/^https:\/\/(static-cdn\.jtvnw\.net\/emoticons\/v2\/\d+\/default\/dark\/2\.0|cdn\.7tv\.app\/emote\/[0-9A-Z]+\/2x\.webp)$/)
    }
    // Both halves of the requested mix show up: Twitch globals and the wide 7TV emotes.
    const sources = lines.flatMap(line => [...line.querySelectorAll('img')].map(img => img.src))
    expect(sources.some(src => new URL(src).hostname === 'static-cdn.jtvnw.net')).toBe(true)
    expect(sources.some(src => /01J7VZYB08000E8DPG2XYMKQYR|01HMM8VG3R0007GXBD883VP2YY|01K6YP3JPX47KY68B19S6MY6DY/.test(src))).toBe(true)
    stop()
    card.remove()
  })

  it('pauses in a hidden tab and offscreen, and resumes when shown', () => {
    stubExtension()
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'anatomy', finish: null })
    expect(card.stage.dataset.running).toBe('true')
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    expect(card.stage.dataset.running).toBe('false')
    expect(caf).toHaveBeenCalled()
    expect(frames).toHaveLength(0)
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    expect(card.stage.dataset.running).toBe('true')
    act(() => intersect!([{ isIntersecting: false }]))
    expect(card.stage.dataset.running).toBe('false')
    expect(frames).toHaveLength(0)
    act(() => intersect!([{ isIntersecting: true }]))
    expect(card.stage.dataset.running).toBe('true')
    stop()
    expect(frames).toHaveLength(0)
    card.remove()
  })

  it('draws one still frame from static images under reduced motion, ending on your line, and never schedules a frame', async () => {
    stubExtension({ reducedMotion: true })
    for (const options of [{ mode: 'anatomy', finish: null }, { mode: 'tenure', tenure: '24m', finish: 'halo', paint: { wave: 'smooth', sheen: 'none' } }] as const) {
      const card = cardStage()
      const stop = mountCard(card.stage, options)
      await act(async () => { await Promise.resolve() })
      expect(card.stage.dataset.still).toBe('true')
      expect(card.stage.dataset.running).toBe('false')
      const lines = [...card.stage.querySelectorAll('.spk-cl')]
      expect(lines.at(-1)!.classList.contains('spk-sup')).toBe(true)
      const sevenTv = [...card.stage.querySelectorAll<HTMLImageElement>('img')].map(img => img.src).filter(src => src.includes('cdn.7tv.app'))
      expect(sevenTv.length).toBeGreaterThan(0)
      expect(sevenTv.every(src => src.endsWith('/2x_static.webp'))).toBe(true)
      // A Supporter's still frame shows the crest they hold, not the bottom of the climb.
      if (options.mode === 'tenure') expect(lines.at(-1)!.querySelector('.spk-chip')!.textContent).toBe('Two-year pinnacle · 24 mo')
      // Hover adds nothing that moves, and nothing covers the line.
      const count = lines.length
      card.host.dispatchEvent(new Event('pointerenter'))
      expect(card.stage.querySelectorAll('.spk-cl')).toHaveLength(count)
      expect(card.stage.querySelector('.spk-callouts, .spk-co')).toBeNull()
      stop()
      card.remove()
    }
    expect(raf).not.toHaveBeenCalled()
  })
})
