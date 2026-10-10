// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { supporterAppearanceReply } from '../src/background/supporterAppearance.ts'
import { mountSupporterCard } from '../src/content/supporterCard.ts'
import type { SupporterCardOptions } from '../src/supporter/cardContract.ts'
import { SupporterHero } from '../src/ui/PulseSettingsPanel.tsx'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The quick-settings Supporter card, drawn by content/supporter-card.js: the
 * settings banner's Crown pile, with the sample kit (anatomy) or a verified
 * Supporter's own crest and paint (tenure). It never draws a chat column:
 * nothing a Supporter has is added to Twitch chat.
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

/** The quick-settings card's stage: about 318 px wide and 96 px tall in the panel. */
function cardStage() {
  const host = document.createElement('button')
  host.className = 'pulse-settings-supporter-cta'
  const stage = document.createElement('span')
  stage.className = 'pulse-supporter-stage'
  host.append(stage)
  document.body.append(host)
  return { host, stage, remove: () => host.remove() }
}

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
  // jsdom has no layout; give the stage the quick-settings card's size.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return (this as HTMLElement).classList.contains('pulse-supporter-stage') ? 318 : 0 } })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return (this as HTMLElement).classList.contains('pulse-supporter-stage') ? 96 : 0 } })
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

  it('asks for the sample kit for anyone without perks, and a verified Supporter’s earned crest and paint', async () => {
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

describe('the card’s Crown pile, drawn by content/supporter-card.js', () => {
  const youImages = (stage: HTMLElement) => [...stage.querySelectorAll<HTMLImageElement>('.spk-you img')].map(img => img.src)

  it('anatomy: the sample crest and paint on a pile of emotes, with no chat column, line or chat names', () => {
    stubExtension()
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'anatomy', finish: null })
    expect(card.stage.dataset.mode).toBe('crown')
    expect(card.stage.dataset.running).toBe('true')
    // The card reads no storage.
    expect(chrome.storage.sync.get).not.toHaveBeenCalled()
    expect(card.host.style.getPropertyValue('--spk-fin')).toBe('#efc96a')
    runFrames(1)
    // Nine emotes and the sample crest, settled; a "you" tag rides above the crest.
    expect(card.stage.querySelectorAll('.spk-body')).toHaveLength(10)
    const you = card.stage.querySelector<HTMLElement>('.spk-you')!
    expect(you.querySelector('.spk-crest')?.getAttribute('data-tenure')).toBe('12m')
    expect(youImages(card.stage)).toEqual([])
    expect(card.stage.querySelector('.spk-tag')?.textContent).toBe('you')
    runFrames(600)
    // Nothing that reads as Twitch chat: no chat lines, no chatter names, no text but the tag.
    expect(card.stage.querySelector('.spk-chat, .spk-cl, .spk-sup, .spk-chip')).toBeNull()
    const words = [...card.stage.querySelectorAll('.spk-body')].map(body => body.textContent?.trim()).filter(Boolean)
    expect(words).toEqual([])
    for (const img of card.stage.querySelectorAll('img')) {
      expect(img.src).toMatch(/^https:\/\/(static-cdn\.jtvnw\.net\/emoticons\/v2\/\d+\/default\/dark\/2\.0|cdn\.7tv\.app\/emote\/[0-9A-Z]+\/2x\.webp)$/)
    }
    // Hover shakes the pile and drops a crest in.
    const crests = card.stage.querySelectorAll('.spk-you').length
    card.host.dispatchEvent(new Event('pointerenter'))
    expect(card.stage.querySelectorAll('.spk-you').length).toBeGreaterThanOrEqual(Math.min(crests, 2))
    stop()
    expect(card.stage.childElementCount).toBe(0)
    expect(card.host.style.getPropertyValue('--spk-fin')).toBe('')
    expect(frames).toHaveLength(0)
    card.remove()
  })

  it('tenure: a verified Supporter’s own crest, and their real paint on the tag, finish or not', async () => {
    stubExtension()
    const member = (cosmetics: { enabled: boolean; finish: 'glass' | 'etched' | 'halo' }) => ({ state: 'ready', status: 'active', supportPeriods: 7, features: ['supporter.banner.v1', 'supporter.finish.v1'], validForMs: 60_000, cosmetics }) as SupporterEntitlement
    // 7 support periods: Steady signal (6 months), for a Supporter on the default accent.
    const reply = await supporterAppearanceReply(member({ enabled: false, finish: 'glass' }), async () => ({ wave: 'smooth', sheen: 'sweep' }))
    expect(reply).toMatchObject({ finish: null, tenure: '6m', perks: true })
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'tenure', tenure: reply.tenure, finish: reply.finish, paint: reply.paint })
    runFrames(1)
    expect(card.stage.querySelector('.spk-you .spk-crest')?.getAttribute('data-tenure')).toBe('6m')
    // No finish: an unpainted name and the Peak teal.
    expect(card.stage.querySelector('.spk-tag .spk-name')?.className).toBe('spk-name')
    expect(card.host.style.getPropertyValue('--spk-fin')).toBe('#2dd4bf')
    expect(chrome.storage.sync.get).not.toHaveBeenCalled()
    stop()
    card.remove()

    // With a finish, the tag's name wears the header's real paint: finish, wave and sheen.
    const painted = await supporterAppearanceReply(member({ enabled: true, finish: 'glass' }), async () => ({ wave: 'aurora', sheen: 'glint' }))
    const second = cardStage()
    const halt = mountCard(second.stage, { mode: 'tenure', tenure: painted.tenure, finish: painted.finish, paint: painted.paint })
    runFrames(1)
    expect(second.stage.querySelector<HTMLElement>('.spk-tag .pulse-paint')?.dataset).toMatchObject({ finish: 'glass', wave: 'aurora', sheen: 'glint', text: 'you' })
    expect(second.host.style.getPropertyValue('--spk-fin')).toBe('#78dce8')
    halt()
    second.remove()
  })

  it('ignores an emote stored by the dropped signature perk, and listens to no storage', () => {
    stubExtension()
    // A value an older build saved stays where it is, unread.
    stored = { supporterSignatureEmote: 'wideReacting' }
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'tenure', tenure: '12m', finish: 'etched', paint: { wave: 'smooth', sheen: 'sweep' } })
    runFrames(400)
    expect(card.stage.querySelector('img[src*="01FKSDK14G0008TM5NY9QEG0QV"]')).toBeNull()
    expect(chrome.storage.sync.get).not.toHaveBeenCalled()
    expect(chrome.storage.sync.set).not.toHaveBeenCalled()
    expect(storageListeners.size).toBe(0)
    expect(stored).toEqual({ supporterSignatureEmote: 'wideReacting' })
    stop()
    card.remove()
  })

  it('carries the card host’s glow and hover in its own stage styles', () => {
    stubExtension()
    const card = cardStage()
    const stop = mountCard(card.stage, { mode: 'anatomy', finish: null })
    const css = card.stage.querySelector('style')?.textContent ?? ''
    expect(css).toContain('.pulse-settings-supporter-cta::before')
    expect(css).toContain('.pulse-supporter-stage { overflow: hidden; }')
    expect(css).not.toContain('spk-cl')
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

  it('draws one settled still pile from static images under reduced motion, and never schedules a frame', async () => {
    stubExtension({ reducedMotion: true })
    for (const options of [{ mode: 'anatomy', finish: null }, { mode: 'tenure', tenure: '24m', finish: 'halo', paint: { wave: 'smooth', sheen: 'none' } }] as const) {
      const card = cardStage()
      const stop = mountCard(card.stage, options)
      await act(async () => { await Promise.resolve() })
      expect(card.stage.dataset.still).toBe('true')
      expect(card.stage.dataset.running).toBe('false')
      const bodies = card.stage.querySelectorAll('.spk-body')
      expect(bodies.length).toBeGreaterThanOrEqual(10)
      // A Supporter's still frame shows the crest they hold.
      expect(card.stage.querySelector('.spk-you .spk-crest')?.getAttribute('data-tenure')).toBe(options.mode === 'tenure' ? '24m' : '12m')
      const sevenTv = [...card.stage.querySelectorAll<HTMLImageElement>('img')].map(img => img.src).filter(src => src.includes('cdn.7tv.app'))
      expect(sevenTv.every(src => src.endsWith('/2x_static.webp'))).toBe(true)
      // Hover adds nothing that moves.
      card.host.dispatchEvent(new Event('pointerenter'))
      expect(card.stage.querySelectorAll('.spk-body')).toHaveLength(bodies.length)
      stop()
      card.remove()
    }
    expect(raf).not.toHaveBeenCalled()
  })
})
