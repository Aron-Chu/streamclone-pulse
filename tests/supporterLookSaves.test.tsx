// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupporterCosmeticControls } from '../src/options/SupporterCosmeticControls.tsx'
import { supporterAppearanceReply } from '../src/background/supporterAppearance.ts'
import { QuickLook } from '../src/ui/PulseSettingsPanel.tsx'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// How Equip look and the pre-purchase choice reach this profile's settings
// when a save fails partway, another window writes meanwhile, or membership
// cannot be confirmed.
const active: SupporterEntitlement = { state: 'ready', status: 'active', supportPeriods: 1, checkoutEnabled: false, features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled: true, finish: 'glass' } }
const guest = (checkoutEnabled: boolean): SupporterEntitlement => ({ state: 'ready', status: 'none', features: [], supportPeriods: 0, checkoutEnabled })
const initialBanner = { mode: 'off', intensity: 35, title: 'Original' } as const
const initialPaint = { wave: 'smooth', sheen: 'sweep' } as const
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.unstubAllGlobals() })

type Message = { type: string; finish?: string | null; look?: unknown }
type Options = { server?: () => unknown; intent?: string; extra?: Record<string, unknown>; failBannerRead?: boolean }

function stubChrome(opts: Options = {}) {
  const state: Record<string, unknown> = { pulseBanner: initialBanner, supporterPaintStyle: initialPaint, ...opts.extra }
  const fail: { key?: string } = {}
  const listeners = new Set<(changes: Record<string, { newValue: unknown }>, area: string) => void>()
  const change = (items: Record<string, unknown>) => {
    Object.assign(state, items)
    for (const listener of listeners) listener(Object.fromEntries(Object.entries(items).map(([key, newValue]) => [key, { newValue }])), 'sync')
  }
  const set = vi.fn(async (items: Record<string, unknown>) => {
    if (fail.key && fail.key in items) throw new Error('sync quota')
    change(items)
  })
  let intent = opts.intent ?? null
  const send = vi.fn(async (message: Message) => {
    if (message.type === 'SUPPORTER_COSMETICS') return opts.server ? opts.server() : { type: message.type, ok: true }
    if (message.finish !== undefined) intent = message.finish
    return { type: 'SUPPORTER_FINISH_INTENT', finish: intent, ...(intent ? { setAt: Date.now() } : {}) }
  })
  vi.stubGlobal('chrome', { runtime: { id: 'test-extension', sendMessage: send }, storage: {
    sync: { get: async (key: string) => {
      if (opts.failBannerRead && key === 'pulseBanner') throw new Error('offline')
      return { [key]: state[key] }
    }, set },
    onChanged: { addListener: (listener: never) => listeners.add(listener), removeListener: (listener: never) => listeners.delete(listener) },
  } })
  return { state, fail, set, send, change, intent: () => intent }
}

async function mount(entitlement: SupporterEntitlement, opts: Options = {}) {
  const store = stubChrome(opts)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  cleanups.push(() => { act(() => root.unmount()); host.remove() })
  await act(async () => root.render(<SupporterCosmeticControls entitlement={entitlement} tenure="new" />))
  const button = (name: string) => [...host.querySelectorAll('button')].find(item => item.textContent === name)
  return { ...store, host, button,
    click: async (selector: string) => { await act(async () => host.querySelector<HTMLElement>(selector)!.click()) },
    press: async (name: string) => { await act(async () => button(name)!.click()) },
    notice: () => host.querySelector('.pulse-supporter-save-status')?.textContent,
    cosmeticsSaves: () => store.send.mock.calls.filter(([message]) => message.type === 'SUPPORTER_COSMETICS'),
  }
}

describe('Equip look', () => {
  it('keeps motion and backdrop retryable when the server saved the paint but this profile could not', async () => {
    const view = await mount(active)
    view.fail.key = 'pulseBanner'
    await view.click('input[value="look-Bloom"]')
    await view.press('Equip look')
    expect(view.cosmeticsSaves()).toEqual([[{ type: 'SUPPORTER_COSMETICS', enabled: true, finish: 'halo' }]])
    // One write for both keys: nothing half-applied.
    expect(view.state.supporterPaintStyle).toEqual(initialPaint)
    expect(view.state.pulseBanner).toEqual(initialBanner)
    expect(view.notice()).toBe('Your paint saved, but motion and backdrop did not. Try Equip look again.')
    // Halo is worn now; the draft keeps Still and the 30% backdrop to retry.
    expect(view.host.querySelector('[data-chip="equipped"]')?.parentElement?.querySelector('input')?.value).toBe('finish-halo')
    expect(view.host.querySelector<HTMLInputElement>('input[value="motion-still"]')?.checked).toBe(true)
    view.fail.key = undefined
    await view.press('Equip look')
    expect(view.cosmeticsSaves()).toHaveLength(1)
    expect(view.state.supporterPaintStyle).toEqual({ wave: 'smooth', sheen: 'none' })
    expect(view.state.pulseBanner).toEqual({ mode: 'still', intensity: 30, title: 'Original' })
    expect(view.notice()).toBe('Equipped: Bloom.')
    expect(view.button('Equip look')).toBeUndefined()
  })

  it('keeps a failed motion-only save retryable instead of showing it as saved', async () => {
    const view = await mount(active)
    view.fail.key = 'supporterPaintStyle'
    await view.click('input[value="motion-still"]')
    await view.press('Equip look')
    expect(view.state.supporterPaintStyle).toEqual(initialPaint)
    expect(view.notice()).toBe('Could not save. Please try again.')
    expect(view.button('Equip look')).toBeDefined()
    expect(view.host.querySelector<HTMLInputElement>('input[value="motion-still"]')?.checked).toBe(true)
  })

  it('leaves this profile untouched when the server refuses a changed paint', async () => {
    const view = await mount(active, { server: () => ({ type: 'SUPPORTER_COSMETICS', ok: false }) })
    await view.click('input[value="look-Bloom"]')
    await view.press('Equip look')
    expect(view.set).not.toHaveBeenCalled()
    expect(view.notice()).toContain('Could not save')
  })

  it('keeps a panel title renamed in another window while the server saves', async () => {
    let finishServer!: (value: unknown) => void
    const view = await mount(active, { server: () => new Promise(resolve => { finishServer = resolve }) })
    await view.click('input[value="look-Bloom"]')
    await view.press('Equip look')
    await act(async () => view.change({ pulseBanner: { ...initialBanner, title: 'Renamed elsewhere' } }))
    await act(async () => finishServer({ type: 'SUPPORTER_COSMETICS', ok: true }))
    expect(view.state.pulseBanner).toEqual({ mode: 'still', intensity: 30, title: 'Renamed elsewhere' })
  })

  it('keeps an older wave and sheen, and previews the backdrop as it moves now', async () => {
    const legacy = { wave: 'ripple', sheen: 'glint' }
    const view = await mount(active, { extra: { supporterPaintStyle: legacy } })
    await view.press('On')
    expect(view.host.querySelector('.pulse-supporter-mini-head [data-mode]')?.getAttribute('data-mode')).toBe('rain')
    await view.press('Equip look')
    expect(view.state.supporterPaintStyle).toEqual(legacy)
    expect(view.state.pulseBanner).toEqual({ mode: 'rain', intensity: 35, title: 'Original' })
    const still = await mount(active, { extra: { supporterPaintStyle: { wave: 'ripple', sheen: 'none' }, pulseBanner: { ...initialBanner, mode: 'rain' } } })
    expect(still.host.querySelector('.pulse-supporter-mini-head [data-mode]')?.getAttribute('data-mode')).toBe('rain')
  })

  it('gives every saved look its own name and identity', async () => {
    const view = await mount(active, { extra: { supporterLooks: [40, 45].map(intensity => ({ finish: 'glass', motion: 'shimmer', backdrop: true, intensity })) } })
    const inputs = [...view.host.querySelectorAll<HTMLInputElement>('.pulse-supporter-saved-look input')]
    expect(inputs.map(input => input.value)).toEqual(['look-Glass · Shimmer · backdrop 40%', 'look-Glass · Shimmer · backdrop 45%'])
  })
})

describe('choosing a look before Supporter starts', () => {
  it.each([
    ['a server without Supporter', { state: 'unavailable', reason: 'not_deployed' } as SupporterEntitlement],
    ['a membership read that failed', { state: 'error' } as SupporterEntitlement],
    ['closed checkout', guest(false)],
    ['an older server that does not say whether checkout is open', { state: 'ready', status: 'none', features: [], supportPeriods: 0 } as SupporterEntitlement],
  ])('offers only a try-on on %s', async (_label, entitlement) => {
    const view = await mount(entitlement)
    expect(view.button('Use this look when Supporter starts')).toBeUndefined()
    expect(view.host.textContent).toContain("Try a look. Changes here aren't saved.")
    expect(view.send.mock.calls.filter(([message]) => message.finish !== undefined)).toHaveLength(0)
    expect(view.set).not.toHaveBeenCalled()
  })

  it('carries the whole look with the choice, even when this profile could not read its backdrop', async () => {
    const view = await mount(guest(true), { failBannerRead: true })
    await view.click('input[value="look-Bloom"]')
    await view.press('Use this look when Supporter starts')
    expect(view.send).toHaveBeenLastCalledWith({ type: 'SUPPORTER_FINISH_INTENT', finish: 'halo', look: { motion: 'still', backdrop: true, intensity: 30 } })
    expect(view.set).not.toHaveBeenCalled()
  })

  it.each([['Clear choice', true], ['Remove', false]])('%s leaves this profile as it was before the choice', async (control, open) => {
    const chosen = await mount(guest(true))
    await chosen.click('input[value="look-Bloom"]')
    await chosen.press('Use this look when Supporter starts')
    const view = open ? chosen : await mount(guest(false), { intent: chosen.intent() ?? undefined })
    await view.press(control)
    expect(view.intent()).toBeNull()
    expect(chosen.set).not.toHaveBeenCalled()
    expect(view.set).not.toHaveBeenCalled()
    expect(view.state.pulseBanner).toEqual(initialBanner)
    expect(view.state.supporterPaintStyle).toEqual(initialPaint)
  })
})

describe('Quick settings', () => {
  it('keeps a Still backdrop still for a Supporter wearing Default paint', async () => {
    const paint = { wave: 'smooth', sheen: 'none' } as const
    stubChrome({ extra: { pulseBanner: { ...initialBanner, mode: 'still' }, supporterPaintStyle: paint } })
    const reply = await supporterAppearanceReply({ ...active, cosmetics: { enabled: false, finish: 'glass' }, validForMs: 10_000 }, async () => paint)
    expect(reply).toMatchObject({ finish: null, perks: true, paint })
    const host = document.createElement('div')
    const root = createRoot(host)
    cleanups.push(() => act(() => root.unmount()))
    await act(async () => root.render(<QuickLook appearance={reply} onOpen={() => {}} />))
    expect(host.querySelector('.pulse-quick-look [data-mode]')?.getAttribute('data-mode')).toBe('still')
  })
})
