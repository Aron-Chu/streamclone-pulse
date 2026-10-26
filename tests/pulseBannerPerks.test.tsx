// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseBannerControls } from '../src/ui/PulseBanner.tsx'
import { QuickLook } from '../src/ui/PulseSettingsPanel.tsx'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void

/** A profile that saved Rain earlier, for instance while it was a Supporter. */
function stubSavedBanner(saved: Record<string, unknown> = { mode: 'rain', intensity: 40, title: 'My Pulse' }) {
  const set = vi.fn().mockResolvedValue(undefined)
  const get = vi.fn().mockResolvedValue({ pulseBanner: saved })
  const sendMessage = vi.fn().mockResolvedValue({ type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'not_linked' } })
  const listeners = new Set<StorageListener>()
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', sendMessage },
    storage: {
      sync: { get, set },
      onChanged: { addListener: (listener: StorageListener) => listeners.add(listener), removeListener: (listener: StorageListener) => listeners.delete(listener) },
    },
  })
  return { set, get, sendMessage, changed: (changes: Record<string, chrome.storage.StorageChange>, area = 'local') => listeners.forEach(listener => listener(changes, area)) }
}

const entitlement = (checkoutEnabled?: boolean): SupporterEntitlement => ({ state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled })
const reply = (value: SupporterEntitlement) => ({ type: 'SUPPORTER_ENTITLEMENT', entitlement: value })
const findButton = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name)!
const quickRainButton = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Emote rain"] button')].find(button => button.textContent === name)!
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

async function mount(node: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(node))
  return { host, unmount: () => { act(() => root.unmount()); host.remove() } }
}

const modeButton = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLButtonElement>('.pulse-banner-modes button')].find(button => button.textContent === name)!

afterEach(() => { vi.unstubAllGlobals() })

describe('emote rain is a Supporter perk in settings', () => {
  it('locks Still and Rain for a non-Supporter, points to the offer, and keeps the saved choice untouched', async () => {
    const { set } = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    expect(view.host.querySelector('[data-supporter-perks]')?.getAttribute('data-supporter-perks')).toBe('locked')
    expect(modeButton(view.host, 'Off').disabled).toBe(false)
    expect(modeButton(view.host, 'Still').disabled).toBe(true)
    expect(modeButton(view.host, 'Rain').disabled).toBe(true)
    // The saved choice is shown as kept, but nothing draws it.
    expect(modeButton(view.host, 'Rain').getAttribute('aria-pressed')).toBe('true')
    expect(view.host.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(true)
    expect(view.host.querySelector('.pulse-background-preview .pulse-banner-art')?.getAttribute('data-mode')).toBe('off')
    expect(view.host.querySelectorAll('.pulse-background-preview img')).toHaveLength(0)
    const perk = view.host.querySelector('[data-supporter-perk="emote-rain"]')!
    expect(perk.textContent).toContain('Supporter perk')
    expect(perk.textContent).toContain('Only you see it')
    expect(perk.textContent).toBe("Emote rain is a Supporter perk. Only you see it. Supporter isn't on sale yet. See Supporter →")
    expect(perk.textContent).not.toMatch(/moved from free|a backdrop you chose is kept/i)
    expect(perk.querySelector('a')?.getAttribute('href')).toBe('#supporter')

    // The title stays free, and saving it keeps the stored Rain for a returning Supporter.
    const title = view.host.querySelector<HTMLInputElement>('input[maxlength="40"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, 'Renamed')
      title.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { view.host.querySelector('form')!.requestSubmit() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'rain', intensity: 40, title: 'Renamed' } })
    view.unmount()
  })

  it('keeps a locked Supporter choice through Reset: only the free title goes back to default', async () => {
    const { set } = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    await act(async () => { [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Reset')!.click() })
    expect(view.host.querySelector<HTMLInputElement>('input[maxlength="40"]')!.value).toBe('')
    await act(async () => { view.host.querySelector('form')!.requestSubmit() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'rain', intensity: 40, title: '' } })
    view.unmount()
  })

  it('waits, neutral, until the membership check answers instead of flashing the lock', async () => {
    const { sendMessage } = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={undefined} />)
    expect(view.host.querySelector('[data-supporter-perks]')?.getAttribute('data-supporter-perks')).toBe('pending')
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    expect(modeButton(view.host, 'Rain').disabled).toBe(true)
    expect(view.host.querySelector('.pulse-banner-modes')?.getAttribute('aria-busy')).toBe('true')
    expect(view.host.querySelectorAll('.pulse-background-preview img')).toHaveLength(0)
    expect(sendMessage).not.toHaveBeenCalled()
    view.unmount()
  })

  it('gives an active or grace Supporter today’s controls and preview', async () => {
    const { sendMessage } = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks />)
    expect(view.host.querySelector('[data-supporter-perks]')?.getAttribute('data-supporter-perks')).toBe('on')
    for (const name of ['Off', 'Still', 'Rain']) expect(modeButton(view.host, name).disabled, name).toBe(false)
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    expect(view.host.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(false)
    expect(view.host.querySelector('.pulse-background-preview .pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
    expect(view.host.querySelectorAll('.pulse-background-preview img')).toHaveLength(6)
    expect(sendMessage).not.toHaveBeenCalled()
    view.unmount()
  })

  it('starts the quick settings strip on what the overlay draws, and lets anyone try a look without saving it', async () => {
    const { set, sendMessage } = stubSavedBanner()
    const choice = (host: HTMLElement, group: string, name: string) =>
      [...host.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)].find(button => button.textContent === name)!
    const strip = (host: HTMLElement) => host.querySelector<HTMLElement>('.pulse-quick-look')!
    // Without the perk the overlay draws no rain, so the strip starts with none, in the default paint.
    const tryOut = await mount(<QuickLook appearance={null} onOpen={() => {}} />)
    expect(strip(tryOut.host).querySelectorAll('img')).toHaveLength(0)
    expect(strip(tryOut.host).querySelector('strong')?.textContent).toBe('My Pulse')
    expect(strip(tryOut.host).querySelector('.pulse-paint, .pulse-crest')).toBeNull()
    await act(async () => { choice(tryOut.host, 'Emote rain', 'Rain').click() })
    await act(async () => { choice(tryOut.host, 'Paint', 'Halo').click() })
    expect(strip(tryOut.host).querySelector('.pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
    expect(strip(tryOut.host).querySelectorAll('img')).toHaveLength(6)
    expect(strip(tryOut.host).querySelector('strong')?.getAttribute('data-finish')).toBe('halo')
    expect(strip(tryOut.host).querySelector('.pulse-crest')?.getAttribute('data-tenure')).toBe('new')
    // A try is never saved.
    expect(set).not.toHaveBeenCalled()
    tryOut.unmount()
    // A Supporter's strip wears their saved rain and paint; Emote rain saves at once, paint is equipped in all settings.
    const supporter = await mount(<QuickLook appearance={{ finish: 'etched', tenure: '12m', paint: { wave: 'chrome', sheen: 'glint' }, perks: true }} onOpen={() => {}} />)
    expect(strip(supporter.host).querySelector('.pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
    expect(strip(supporter.host).querySelector('strong')?.dataset).toMatchObject({ finish: 'etched', wave: 'chrome', sheen: 'glint' })
    expect(strip(supporter.host).querySelector('.pulse-crest')?.getAttribute('data-tenure')).toBe('12m')
    expect(supporter.host.textContent).not.toContain('try free')
    await act(async () => { choice(supporter.host, 'Emote rain', 'Still').click() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'still', intensity: 40, title: 'My Pulse' } })
    await act(async () => { choice(supporter.host, 'Paint', 'Glass').click() })
    expect(supporter.host.textContent).toContain('Equip Glass in all settings ↗')
    expect(sendMessage).not.toHaveBeenCalled()
    supporter.unmount()
  })

  it.each([true, false])('uses the server checkout flag %s for the lock line', async checkoutEnabled => {
    const { sendMessage } = stubSavedBanner()
    sendMessage.mockResolvedValue(reply(entitlement(checkoutEnabled)))
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    const perk = view.host.querySelector('[data-supporter-perk="emote-rain"]')!
    expect(perk.textContent).toBe(`Emote rain is a Supporter perk. Only you see it.${checkoutEnabled ? '' : " Supporter isn't on sale yet."} See Supporter →`)
    expect(perk.querySelector('a')?.getAttribute('href')).toBe('#supporter')
    view.unmount()
  })

  it.each<SupporterEntitlement>([
    entitlement(), { state: 'error' },
    { state: 'unavailable', reason: 'temporarily_unavailable' },
    { state: 'unavailable', reason: 'not_deployed' },
    { state: 'unavailable', reason: 'environment_mismatch' },
  ])('waits without a lock line when checkout is unconfirmed: %j', async value => {
    const { sendMessage } = stubSavedBanner()
    sendMessage.mockResolvedValue(reply(value))
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    view.unmount()
  })

  it('waits without a lock line after a failed worker read', async () => {
    const { sendMessage } = stubSavedBanner()
    sendMessage.mockRejectedValue(new Error('offline'))
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    view.unmount()
  })

  it('hides the lock line when the fresh entitlement confirms membership before the parent refreshes', async () => {
    const { sendMessage } = stubSavedBanner()
    sendMessage.mockResolvedValue(reply({ state: 'ready', status: 'active', supportPeriods: 1, checkoutEnabled: false, features: ['supporter.banner.v1', 'supporter.finish.v1'] }))
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    view.unmount()
  })

  it('invalidates account reads immediately and ignores an older account response', async () => {
    const { sendMessage, changed } = stubSavedBanner()
    const older = deferred<ReturnType<typeof reply>>()
    const current = deferred<ReturnType<typeof reply>>()
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    expect(view.host.textContent).toContain("Supporter isn't on sale yet.")
    sendMessage.mockReturnValueOnce(older.promise).mockReturnValueOnce(current.promise)
    await act(async () => changed({ pulseSupporterRevision: { newValue: 1 } }))
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    await act(async () => changed({ pulseAccountRevision: { newValue: 2 } }))
    await act(async () => current.resolve(reply(entitlement(true))))
    expect(view.host.querySelector('[data-supporter-perk]')?.textContent).toBe('Emote rain is a Supporter perk. Only you see it. See Supporter →')
    await act(async () => older.resolve(reply(entitlement(false))))
    expect(view.host.textContent).not.toContain("Supporter isn't on sale yet.")
    expect(sendMessage).toHaveBeenCalledTimes(3)
    view.unmount()
  })

  it('forgets the prior server checkout state when synced backend preferences change', async () => {
    const { sendMessage, changed } = stubSavedBanner()
    const next = deferred<ReturnType<typeof reply>>()
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    sendMessage.mockReturnValueOnce(next.promise)
    await act(async () => changed({ backendUrl: { newValue: 'http://localhost:8081' } }, 'sync'))
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    await act(async () => next.resolve(reply(entitlement(true))))
    expect(view.host.querySelector('[data-supporter-perk]')?.textContent).toBe('Emote rain is a Supporter perk. Only you see it. See Supporter →')
    expect(sendMessage).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => changed({ pulseAccountRevision: { newValue: 3 } }))
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  it('retries the actual setting read outside the paused fieldset', async () => {
    const { get } = stubSavedBanner()
    get.mockRejectedValueOnce(new Error('offline'))
    const view = await mount(<PulseBannerControls expanded perks />)
    expect(view.host.querySelector('fieldset')?.disabled).toBe(true)
    const error = view.host.querySelector('[data-emote-rain-load-error]')!
    expect(error.textContent).toBe("Couldn't load your Emote rain setting. Try again")
    const retry = findButton(view.host, 'Try again')
    expect(retry.closest('fieldset')).toBeNull()
    expect(retry.disabled).toBe(false)
    await act(async () => retry.click())
    expect(get).toHaveBeenCalledTimes(2)
    expect(view.host.querySelector('[data-emote-rain-load-error]')).toBeNull()
    expect(view.host.querySelector('fieldset')?.disabled).toBe(false)
    expect(modeButton(view.host, 'Rain').getAttribute('aria-pressed')).toBe('true')
    view.unmount()
  })

  it('keeps a newer synced setting when the initial read finishes late', async () => {
    const { get, changed } = stubSavedBanner()
    const initial = deferred<Record<string, unknown>>()
    get.mockReturnValueOnce(initial.promise)
    const view = await mount(<PulseBannerControls expanded perks />)
    await act(async () => changed({ pulseBanner: { newValue: { mode: 'still', intensity: 45, title: 'Newer' } } }, 'sync'))
    expect(view.host.querySelector('fieldset')?.disabled).toBe(false)
    await act(async () => initial.resolve({ pulseBanner: { mode: 'off', intensity: 35, title: 'Older' } }))
    expect(view.host.querySelector<HTMLInputElement>('input[maxlength="40"]')!.value).toBe('Newer')
    expect(modeButton(view.host, 'Still').getAttribute('aria-pressed')).toBe('true')
    view.unmount()
  })

  it('reports the picked save error without a second retry control', async () => {
    const { set } = stubSavedBanner()
    set.mockRejectedValueOnce(new Error('offline'))
    const view = await mount(<PulseBannerControls expanded perks />)
    await act(async () => view.host.querySelector('form')!.requestSubmit())
    expect(view.host.querySelector('span[role="status"]')?.textContent).toBe("Couldn't save that. Try again.")
    expect(findButton(view.host, 'Try again')).toBeUndefined()
    view.unmount()
  })

  it('shows quick settings load retry and does not save a default before the setting is ready', async () => {
    const { get, set, sendMessage } = stubSavedBanner()
    const initial = deferred<Record<string, unknown>>()
    get.mockReturnValueOnce(initial.promise).mockRejectedValueOnce(new Error('offline'))
    const view = await mount(<QuickLook appearance={{ finish: null, perks: true }} onOpen={() => {}} />)
    await act(async () => quickRainButton(view.host, 'Rain').click())
    expect(set).not.toHaveBeenCalled()
    await act(async () => initial.resolve({ pulseBanner: { mode: 'rain', intensity: 40, title: 'My Pulse' } }))
    view.unmount()

    const failed = await mount(<QuickLook appearance={{ finish: null, perks: true }} onOpen={() => {}} />)
    expect(failed.host.querySelector('[data-emote-rain-load-error]')?.textContent).toBe("Couldn't load your Emote rain setting. Try again")
    await act(async () => quickRainButton(failed.host, 'Rain').click())
    expect(set).not.toHaveBeenCalled()
    await act(async () => findButton(failed.host, 'Try again').click())
    expect(failed.host.querySelector('[data-emote-rain-load-error]')).toBeNull()
    expect(get).toHaveBeenCalledTimes(3)
    expect(sendMessage).not.toHaveBeenCalled()
    failed.unmount()
  })

  it('keeps quick settings saves single and shows a failed save as plain text', async () => {
    const { set } = stubSavedBanner()
    let reject!: (error: Error) => void
    set.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const view = await mount(<QuickLook appearance={{ finish: null, perks: true }} onOpen={() => {}} />)
    await act(async () => quickRainButton(view.host, 'Still').click())
    await act(async () => quickRainButton(view.host, 'Off').click())
    expect(set).toHaveBeenCalledTimes(1)
    await act(async () => reject(new Error('offline')))
    expect(view.host.querySelector('[role="status"]')?.textContent).toBe("Couldn't save that. Try again.")
    expect(findButton(view.host, 'Try again')).toBeUndefined()
    view.unmount()
  })
})
