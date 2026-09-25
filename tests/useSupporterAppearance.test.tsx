// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_RECHECK_MS,
  APPEARANCE_RENEW_LEAD_MS,
  APPEARANCE_WAKE_DEBOUNCE_MS,
  useSupporterAppearance,
} from '../src/ui/useSupporterAppearance.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Reply = { type: 'SUPPORTER_APPEARANCE'; finish: 'glass' | 'etched' | 'halo' | null; validForMs: number }
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
})
afterEach(() => { vi.useRealTimers() })

describe('supporter header appearance', () => {
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
