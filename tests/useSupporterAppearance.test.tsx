// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_RECHECK_MS,
  APPEARANCE_RENEW_LEAD_MS,
  APPEARANCE_WAKE_DEBOUNCE_MS,
  resetSupporterAppearanceForTests,
  useSupporterAppearance,
  useSupporterAppearanceDetails,
} from '../src/ui/useSupporterAppearance.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Reply = {
  type: 'SUPPORTER_APPEARANCE'
  finish: 'glass' | 'etched' | 'halo' | null
  validForMs: number
  tenure?: '12m' | '24m'
  paint?: { wave: 'smooth' | 'aurora'; sheen: 'sweep' | 'glint' }
  perks?: true
  unverified?: true
}
const accent = (validForMs = 60_000): Reply => ({ type: 'SUPPORTER_APPEARANCE', finish: 'halo', validForMs })
const none: Reply = { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0 }

let hidden = false
function mount(request: () => Promise<unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  function Probe() {
    const finish = useSupporterAppearance(request as never)
    return <span data-finish={finish ?? 'none'} />
  }
  act(() => root.render(<Probe />))
  return {
    finish: () => host.querySelector('span')?.getAttribute('data-finish'),
    unmount: () => { act(() => root.unmount()); host.remove() },
  }
}
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const setHidden = (value: boolean) => act(() => {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] })
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  resetSupporterAppearanceForTests()
})
afterEach(() => { vi.useRealTimers() })

describe('supporter header appearance', () => {
  it('lets the next mount start from a still-verified finish without asking again', async () => {
    const first = vi.fn<() => Promise<Reply>>().mockResolvedValue(accent())
    const header = mount(first)
    await advance(0)
    expect(header.finish()).toBe('halo')
    header.unmount()
    // Quick settings replaces the header a moment later.
    await advance(5_000)
    const second = vi.fn<() => Promise<Reply>>().mockResolvedValue(accent())
    const settings = mount(second)
    expect(settings.finish()).toBe('halo')
    await advance(0)
    expect(second).not.toHaveBeenCalled()
    // It still renews before the inherited window lapses.
    await advance(60_000 - 5_000 - APPEARANCE_RENEW_LEAD_MS)
    expect(second).toHaveBeenCalledTimes(1)
    expect(settings.finish()).toBe('halo')
    settings.unmount()
  })

  it('renews at once when the inherited finish is about to lapse, without blinking off', async () => {
    const first = vi.fn<() => Promise<Reply>>().mockResolvedValue(accent())
    const header = mount(first)
    await advance(0)
    header.unmount()
    // Only about 10 s of the verified window is left when settings mount.
    await advance(50_000)
    let finishRenewal!: (value: Reply) => void
    const second = vi.fn<() => Promise<Reply>>().mockImplementation(() => new Promise(resolve => { finishRenewal = resolve }))
    const settings = mount(second)
    expect(settings.finish()).toBe('halo')
    await advance(0)
    expect(second).toHaveBeenCalledTimes(1)
    await act(async () => { finishRenewal(accent()) })
    await advance(11_000)
    expect(settings.finish()).toBe('halo')
    settings.unmount()
  })

  it('starts blank again once the shared finish has lapsed', async () => {
    const first = vi.fn<() => Promise<Reply>>().mockResolvedValue(accent(10_000))
    const header = mount(first)
    await advance(0)
    header.unmount()
    await advance(11_000)
    const second = vi.fn<() => Promise<Reply>>().mockResolvedValue(none)
    const settings = mount(second)
    expect(settings.finish()).toBe('none')
    await advance(0)
    expect(second).toHaveBeenCalledTimes(1)
    settings.unmount()
  })

  it('keeps a verified accent through its renewal instead of blinking off', async () => {
    let finishSecond!: (value: Reply) => void
    const request = vi.fn<() => Promise<Reply>>()
      .mockResolvedValueOnce(accent())
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve }))
    const view = mount(request)
    await advance(0)
    expect(view.finish()).toBe('halo')
    // The renewal starts before the verified window lapses and never clears first.
    await advance(60_000 - APPEARANCE_RENEW_LEAD_MS)
    expect(request).toHaveBeenCalledTimes(2)
    expect(view.finish()).toBe('halo')
    await act(async () => { finishSecond(accent()) })
    await advance(APPEARANCE_RENEW_LEAD_MS + 1)
    expect(view.finish()).toBe('halo')
    view.unmount()
  })

  it('drops the accent when its verified window lapses without a renewal', async () => {
    const request = vi.fn<() => Promise<Reply>>()
      .mockResolvedValueOnce(accent(30_000))
      .mockRejectedValue(new Error('worker unavailable'))
    const view = mount(request)
    await advance(0)
    expect(view.finish()).toBe('halo')
    await advance(29_000)
    expect(view.finish()).toBe('halo')
    await advance(1_000)
    expect(view.finish()).toBe('none')
    view.unmount()
  })

  it('clears at once when the worker reports no finish', async () => {
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValueOnce(accent()).mockResolvedValue(none)
    const view = mount(request)
    await advance(0)
    expect(view.finish()).toBe('halo')
    await advance(60_000 - APPEARANCE_RENEW_LEAD_MS)
    expect(view.finish()).toBe('none')
    view.unmount()
  })

  it('checks a non-supporter at most once a minute, even when focused often', async () => {
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValue(none)
    const view = mount(request)
    await advance(0)
    expect(request).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 5; i += 1) act(() => { window.dispatchEvent(new Event('focus')) })
    await advance(APPEARANCE_RECHECK_MS - 1)
    expect(request).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(request).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('does not poll a hidden tab and checks again when it is shown', async () => {
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValue(none)
    const view = mount(request)
    await advance(0)
    setHidden(true)
    await advance(APPEARANCE_RECHECK_MS * 5)
    expect(request).toHaveBeenCalledTimes(1)
    setHidden(false)
    await advance(0)
    expect(request).toHaveBeenCalledTimes(2)
    view.unmount()
  })

  it('checks once when mounted in a background tab, then waits until shown', async () => {
    hidden = true
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValue(accent())
    const view = mount(request)
    await advance(0)
    expect(request).toHaveBeenCalledTimes(1)
    expect(view.finish()).toBe('halo')
    await advance(APPEARANCE_RECHECK_MS * 3)
    expect(request).toHaveBeenCalledTimes(1)
    expect(view.finish()).toBe('none')
    setHidden(false)
    await advance(0)
    expect(request).toHaveBeenCalledTimes(2)
    expect(view.finish()).toBe('halo')
    view.unmount()
  })

  it('still checks later when a tab is hidden and shown within the wake debounce', async () => {
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValue(none)
    const view = mount(request)
    await advance(0)
    setHidden(true)
    await advance(APPEARANCE_RECHECK_MS)
    setHidden(false)
    await advance(0)
    expect(request).toHaveBeenCalledTimes(2)
    setHidden(true)
    await advance(1_000)
    setHidden(false)
    await advance(0)
    expect(request).toHaveBeenCalledTimes(2)
    await advance(APPEARANCE_RECHECK_MS)
    expect(request).toHaveBeenCalledTimes(3)
    view.unmount()
  })

  it('stops every timer on unmount', async () => {
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValue(accent())
    const view = mount(request)
    await advance(0)
    view.unmount()
    await advance(APPEARANCE_RECHECK_MS * 3 + APPEARANCE_WAKE_DEBOUNCE_MS)
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('worker change signals', () => {
  type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
  const listeners = new Set<Listener>()
  beforeEach(() => {
    listeners.clear()
    vi.stubGlobal('chrome', { storage: { onChanged: {
      addListener: (listener: Listener) => listeners.add(listener),
      removeListener: (listener: Listener) => listeners.delete(listener),
    } } })
  })
  afterEach(() => { vi.unstubAllGlobals() })
  const signal = (key: string, area = 'local') => act(async () => { for (const listener of listeners) listener({ [key]: { newValue: 'x' } }, area) })

  it('applies a verified purchase or saved finish at once instead of at the next minute check', async () => {
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValueOnce(none).mockResolvedValue(accent())
    const view = mount(request)
    await advance(0)
    expect(view.finish()).toBe('none')
    await signal('pulseSupporterRevision')
    await advance(0)
    expect(request).toHaveBeenCalledTimes(2)
    expect(view.finish()).toBe('halo')
    view.unmount()
    expect(listeners.size).toBe(0)
  })

  it('removes an equipped accent promptly after revocation or an account switch', async () => {
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValueOnce(accent()).mockResolvedValue(none)
    const view = mount(request)
    await advance(0)
    expect(view.finish()).toBe('halo')
    await signal('pulseAccountRevision')
    await advance(0)
    expect(view.finish()).toBe('none')
    view.unmount()
  })

  it('carries the crest and paint style with the finish, and re-checks when the synced paint style changes', async () => {
    const painted = (sheen: 'sweep' | 'glint'): Reply => ({ ...accent(), tenure: '12m', paint: { wave: 'aurora', sheen } })
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValueOnce(painted('sweep')).mockResolvedValue(painted('glint'))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    function Probe() {
      const appearance = useSupporterAppearanceDetails(request as never)
      return <span data-tenure={appearance?.tenure} data-wave={appearance?.paint?.wave} data-sheen={appearance?.paint?.sheen} />
    }
    act(() => root.render(<Probe />))
    await advance(0)
    const probe = () => host.querySelector('span')!.dataset
    expect(probe()).toMatchObject({ tenure: '12m', wave: 'aurora', sheen: 'sweep' })
    // A wave or sheen saved in settings is a synced preference, not an account signal.
    await signal('supporterPaintStyle', 'sync')
    await advance(0)
    expect(request).toHaveBeenCalledTimes(2)
    expect(probe()).toMatchObject({ sheen: 'glint' })
    await signal('supporterPaintStyle', 'local')
    expect(request).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
    host.remove()
  })

  it('ignores unrelated keys and other storage areas, and coalesces a signal during a check', async () => {
    let finish!: (value: Reply) => void
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValueOnce(none)
    const view = mount(request)
    await advance(0)
    await signal('themePreference')
    await signal('pulseSupporterRevision', 'sync')
    expect(request).toHaveBeenCalledTimes(1)
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue(accent())
    await signal('pulseSupporterRevision')
    await signal('pulseSupporterRevision')
    expect(request).toHaveBeenCalledTimes(2)
    await act(async () => { finish(none) })
    await advance(0)
    // One follow-up for the signals that arrived mid-check, not one per signal.
    expect(request).toHaveBeenCalledTimes(3)
    expect(view.finish()).toBe('halo')
    view.unmount()
  })

  it('defers a signal while hidden and checks as soon as the tab is shown, without the wake debounce', async () => {
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValueOnce(none).mockResolvedValue(accent())
    const view = mount(request)
    await advance(0)
    setHidden(true)
    await signal('pulseSupporterRevision')
    expect(request).toHaveBeenCalledTimes(1)
    await advance(APPEARANCE_WAKE_DEBOUNCE_MS / 2)
    setHidden(false)
    await advance(0)
    expect(request).toHaveBeenCalledTimes(2)
    expect(view.finish()).toBe('halo')
    view.unmount()
  })

  it('verifies a Supporter with no equipped finish, so emote rain follows the same membership check', async () => {
    const perksOnly: Reply = { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 30_000, perks: true }
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValueOnce(perksOnly).mockRejectedValue(new Error('worker unavailable'))
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    function Probe() {
      const appearance = useSupporterAppearanceDetails(request as never)
      return <span data-perks={appearance?.perks ? 'on' : 'off'} data-finish={appearance?.finish ?? 'none'} />
    }
    act(() => root.render(<Probe />))
    await advance(0)
    const probe = () => host.querySelector('span')!.dataset
    expect(probe()).toMatchObject({ perks: 'on', finish: 'none' })
    // Like a finish, the perks stay only for the verified window.
    await advance(30_000)
    expect(probe()).toMatchObject({ perks: 'off', finish: 'none' })
    act(() => root.unmount())
    host.remove()
  })

  it('keeps verified paint and perks through an unverified read, until their own expiry', async () => {
    const verified: Reply = { type: 'SUPPORTER_APPEARANCE', finish: 'halo', validForMs: 60_000, perks: true }
    // The worker could not read the account (server error, timeout or a paused renewal).
    const unverified: Reply = { type: 'SUPPORTER_APPEARANCE', finish: null, validForMs: 0, unverified: true }
    const request = vi.fn<() => Promise<Reply>>().mockResolvedValueOnce(verified).mockResolvedValue(unverified)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    function Probe() {
      const appearance = useSupporterAppearanceDetails(request as never)
      return <span data-perks={appearance?.perks ? 'on' : 'off'} data-finish={appearance?.finish ?? 'none'} />
    }
    act(() => root.render(<Probe />))
    await advance(0)
    const probe = () => host.querySelector('span')!.dataset
    expect(probe()).toMatchObject({ perks: 'on', finish: 'halo' })
    await advance(60_000 - APPEARANCE_RENEW_LEAD_MS)
    expect(request).toHaveBeenCalledTimes(2)
    expect(probe()).toMatchObject({ perks: 'on', finish: 'halo' })
    await advance(APPEARANCE_RENEW_LEAD_MS)
    expect(probe()).toMatchObject({ perks: 'off', finish: 'none' })
    act(() => root.unmount())
    host.remove()
  })
})
