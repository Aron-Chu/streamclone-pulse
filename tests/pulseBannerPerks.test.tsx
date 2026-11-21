// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseBannerControls } from '../src/ui/PulseBanner.tsx'
import { QuickLook } from '../src/ui/PulseSettingsPanel.tsx'
import { SupporterCosmeticControls } from '../src/options/SupporterCosmeticControls.tsx'
import type { SupporterEntitlement } from '../src/shared/supporterAccount.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type StorageListener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void

/** A profile that saved a backdrop earlier, for instance while it was a Supporter. */
function stubSavedBanner(saved: Record<string, unknown> = { mode: 'rain', intensity: 40, title: 'My Pulse' }) {
  const set = vi.fn().mockResolvedValue(undefined)
  // Reads of the backdrop setting can be replaced one at a time; everything else reads as unset.
  const bannerReads: Array<() => Promise<unknown>> = []
  const get = vi.fn((key: string) => key === 'pulseBanner'
    ? (bannerReads.shift() ?? (() => Promise.resolve({ pulseBanner: saved })))()
    : Promise.resolve({}))
  const sendMessage = vi.fn().mockResolvedValue({ type: 'SUPPORTER_ENTITLEMENT', entitlement: { state: 'not_linked' } })
  const listeners = new Set<StorageListener>()
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', sendMessage },
    storage: {
      sync: { get, set },
      onChanged: { addListener: (listener: StorageListener) => listeners.add(listener), removeListener: (listener: StorageListener) => listeners.delete(listener) },
    },
  })
  const bannerReadCount = () => get.mock.calls.filter(call => call[0] === 'pulseBanner').length
  return {
    set, get, sendMessage, bannerReadCount,
    nextBannerRead: (read: () => Promise<unknown>) => { bannerReads.push(read) },
    changed: (changes: Record<string, chrome.storage.StorageChange>, area = 'local') => listeners.forEach(listener => listener(changes, area)),
  }
}

const entitlement = (checkoutEnabled?: boolean): SupporterEntitlement => ({ state: 'ready', status: 'none', supportPeriods: 0, features: [], checkoutEnabled })
const NOT_LINKED: SupporterEntitlement = { state: 'not_linked' }
const ACTIVE: SupporterEntitlement = { state: 'ready', status: 'active', supportPeriods: 1, checkoutEnabled: false, features: ['supporter.banner.v1', 'supporter.finish.v1'], cosmetics: { enabled: true, finish: 'glass' } }
const findButton = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === name)!
const quickBackdropButton = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLButtonElement>('[aria-label="Backdrop"] button')].find(button => button.textContent?.startsWith(name))!
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
  return {
    host,
    rerender: async (next: React.ReactNode) => { await act(async () => root.render(next)) },
    unmount: () => { act(() => root.unmount()); host.remove() },
  }
}

const studio = (entitlementValue: SupporterEntitlement | null, extra: { unavailable?: boolean } = {}) =>
  <SupporterCosmeticControls entitlement={entitlementValue} tenure="new" {...extra} />
/** The Backdrop row's Off/On buttons. */
const backdropButton = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLButtonElement>('.pulse-supporter-seg button')].find(button => button.textContent === name)!
const perkLine = (host: HTMLElement) => host.querySelector('[data-supporter-perk="backdrop"]')
const backdropRow = (host: HTMLElement) => host.querySelector('[data-supporter-perks]')!
const typeTitle = async (host: HTMLElement, value: string) => {
  const title = host.querySelector<HTMLInputElement>('input[maxlength="40"]')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(title, value)
    title.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('the backdrop is a Supporter perk in settings', () => {
  it('lets a non-Supporter try the backdrop, points to the offer, and writes nothing', async () => {
    const { set, sendMessage } = stubSavedBanner()
    const view = await mount(studio(entitlement(false)))
    expect(backdropRow(view.host).getAttribute('data-supporter-perks')).toBe('locked')
    // Anyone may try the look; nothing draws outside this preview and nothing is saved.
    for (const name of ['Off', 'On']) expect(backdropButton(view.host, name).matches(':disabled'), name).toBe(false)
    await act(async () => backdropButton(view.host, 'Off').click())
    await act(async () => backdropButton(view.host, 'On').click())
    const preview = view.host.querySelector('.pulse-supporter-mini-head .pulse-banner-art')!
    expect(preview.getAttribute('data-mode')).toBe('rain')
    expect(preview.querySelectorAll('svg')).toHaveLength(6)
    expect(view.host.querySelectorAll('.pulse-supporter-mini-head img')).toHaveLength(0)
    const perk = perkLine(view.host)!
    expect(perk.textContent).toContain('Supporter perk')
    expect(perk.textContent).toContain('Only you see it')
    expect(perk.textContent).toBe("The backdrop is a Supporter perk. Only you see it. Supporter isn't on sale yet. See Supporter →")
    expect(perk.textContent).not.toMatch(/moved from free|a backdrop you chose is kept/i)
    expect(perk.querySelector('a')?.getAttribute('href')).toBe('#supporter')
    // No storage write, and no entitlement or finish message, while Supporter is closed.
    expect(set).not.toHaveBeenCalled()
    expect(sendMessage.mock.calls.filter(([message]) => message?.type !== 'SUPPORTER_FINISH_INTENT')).toHaveLength(0)
    view.unmount()
  })

  it('keeps a locked Supporter choice through a title save: only the free title changes', async () => {
    const { set } = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    expect(view.host.querySelector('summary')?.textContent).toBe('Panel title')
    // The Still/Rain/Off lock moved to Your look and Quick settings.
    expect(view.host.querySelector('.pulse-banner-modes')).toBeNull()
    expect(view.host.querySelector('input[type="range"]')).toBeNull()
    expect(view.host.querySelector('.pulse-background-preview .pulse-banner-art')?.getAttribute('data-mode')).toBe('off')
    expect(view.host.querySelectorAll('.pulse-background-preview img, .pulse-background-preview svg')).toHaveLength(0)
    expect(view.host.querySelector('a[href="#supporter"]')?.textContent).toBe('Your look')
    await typeTitle(view.host, 'Renamed')
    await act(async () => { view.host.querySelector('form')!.requestSubmit() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'rain', intensity: 40, title: 'Renamed' } })
    view.unmount()
  })

  it('keeps a locked Supporter choice through Reset: only the free title goes back to default', async () => {
    const { set } = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    await act(async () => { findButton(view.host, 'Reset').click() })
    expect(view.host.querySelector<HTMLInputElement>('input[maxlength="40"]')!.value).toBe('')
    await act(async () => { view.host.querySelector('form')!.requestSubmit() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'rain', intensity: 40, title: '' } })
    view.unmount()
  })

  it('waits, neutral, until the membership check answers instead of flashing the lock', async () => {
    const { sendMessage } = stubSavedBanner()
    const view = await mount(studio(null))
    expect(backdropRow(view.host).getAttribute('data-supporter-perks')).toBe('pending')
    expect(perkLine(view.host)).toBeNull()
    expect(backdropRow(view.host).closest('fieldset')?.disabled).toBe(true)
    expect(backdropButton(view.host, 'On').matches(':disabled')).toBe(true)
    expect(view.host.querySelector('.pulse-supporter-save-status')?.textContent).toBe('')
    expect(view.host.textContent).toContain('Checking Supporter status…')
    expect(view.host.querySelectorAll('.pulse-supporter-mini-head img')).toHaveLength(0)
    expect(sendMessage).not.toHaveBeenCalled()
    view.unmount()

    const title = await mount(<PulseBannerControls expanded perks={undefined} />)
    expect(title.host.querySelector('[data-supporter-perks]')?.getAttribute('data-supporter-perks')).toBe('pending')
    // Nothing in the title section claims a lock before the answer.
    expect(title.host.textContent).not.toMatch(/Supporter perk|on sale/)
    title.unmount()
  })

  it('gives an active or grace Supporter today’s controls and preview', async () => {
    const { sendMessage } = stubSavedBanner()
    const view = await mount(studio(ACTIVE))
    expect(backdropRow(view.host).getAttribute('data-supporter-perks')).toBe('on')
    for (const name of ['Off', 'On']) expect(backdropButton(view.host, name).matches(':disabled'), name).toBe(false)
    expect(perkLine(view.host)).toBeNull()
    expect(backdropButton(view.host, 'On').getAttribute('aria-pressed')).toBe('true')
    const range = view.host.querySelector<HTMLInputElement>('input[type="range"]')!
    expect(range.disabled).toBe(false)
    expect(range.value).toBe('40')
    const preview = view.host.querySelector('.pulse-supporter-mini-head .pulse-banner-art')!
    expect(preview.getAttribute('data-mode')).toBe('rain')
    expect(preview.querySelectorAll('svg')).toHaveLength(6)
    expect(view.host.querySelectorAll('.pulse-supporter-mini-head img')).toHaveLength(0)
    expect(sendMessage).not.toHaveBeenCalled()
    view.unmount()
  })

  it('starts the quick settings strip on what the overlay draws, and lets anyone try a look without saving it', async () => {
    const { set, sendMessage } = stubSavedBanner()
    const choice = (host: HTMLElement, group: string, name: string) =>
      [...host.querySelectorAll<HTMLButtonElement>(`[aria-label="${group}"] button`)].find(button => button.textContent === name)!
    const strip = (host: HTMLElement) => host.querySelector<HTMLElement>('.pulse-quick-look')!
    // Without the perk the overlay draws no backdrop, so the strip starts with none, in the default paint.
    const tryOut = await mount(<QuickLook appearance={null} onOpen={() => {}} />)
    expect(strip(tryOut.host).querySelectorAll('img, svg')).toHaveLength(0)
    expect(strip(tryOut.host).querySelector('strong')?.textContent).toBe('My Pulse')
    expect(strip(tryOut.host).querySelector('.pulse-paint, .pulse-crest')).toBeNull()
    await act(async () => { choice(tryOut.host, 'Backdrop', 'On').click() })
    await act(async () => { choice(tryOut.host, 'Paint', 'Halo').click() })
    expect(strip(tryOut.host).querySelector('.pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
    expect(strip(tryOut.host).querySelectorAll('svg')).toHaveLength(6)
    expect(strip(tryOut.host).querySelectorAll('img')).toHaveLength(0)
    expect(strip(tryOut.host).querySelector('.pulse-banner-art')?.getAttribute('data-finish')).toBe('halo')
    expect(strip(tryOut.host).querySelector('strong')?.getAttribute('data-finish')).toBe('halo')
    expect(strip(tryOut.host).querySelector('.pulse-crest')?.getAttribute('data-tenure')).toBe('new')
    // A try is never saved.
    expect(set).not.toHaveBeenCalled()
    tryOut.unmount()
    // A Supporter's strip wears their saved backdrop and paint; the backdrop saves at once, paint is equipped in all settings.
    const supporter = await mount(<QuickLook appearance={{ finish: 'etched', tenure: '12m', paint: { wave: 'chrome', sheen: 'glint' }, perks: true }} onOpen={() => {}} />)
    expect(strip(supporter.host).querySelector('.pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
    expect(strip(supporter.host).querySelector('strong')?.dataset).toMatchObject({ finish: 'etched', wave: 'chrome', sheen: 'glint' })
    expect(strip(supporter.host).querySelector('.pulse-crest')?.getAttribute('data-tenure')).toBe('12m')
    expect(supporter.host.textContent).not.toContain('try free')
    await act(async () => { choice(supporter.host, 'Backdrop', 'Off').click() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'off', intensity: 40, title: 'My Pulse' } })
    await act(async () => { choice(supporter.host, 'Paint', 'Glass').click() })
    expect(supporter.host.textContent).toContain('Equip Glass in all settings ↗')
    expect(sendMessage).not.toHaveBeenCalled()
    supporter.unmount()
  })

  it('turns the quick backdrop on as still when the paint is still', async () => {
    const { set } = stubSavedBanner({ mode: 'off', intensity: 40, title: 'My Pulse' })
    const view = await mount(<QuickLook appearance={{ finish: 'glass', tenure: '3m', paint: { wave: 'smooth', sheen: 'none' }, perks: true }} onOpen={() => {}} />)
    await act(async () => { quickBackdropButton(view.host, 'On').click() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'still', intensity: 40, title: 'My Pulse' } })
    view.unmount()
  })

  it.each([true, false])('uses the server checkout flag %s for the lock line', async checkoutEnabled => {
    stubSavedBanner()
    const view = await mount(studio(entitlement(checkoutEnabled)))
    const perk = perkLine(view.host)!
    expect(perk.textContent).toBe(`The backdrop is a Supporter perk. Only you see it. ${checkoutEnabled ? '' : "Supporter isn't on sale yet. "}See Supporter →`)
    expect(perk.querySelector('a')?.getAttribute('href')).toBe('#supporter')
    view.unmount()
  })

  it('names the perk without claiming Supporter is closed for a browser with no account', async () => {
    stubSavedBanner()
    const view = await mount(studio(NOT_LINKED))
    expect(perkLine(view.host)?.textContent).toBe('The backdrop is a Supporter perk. Only you see it. See Supporter →')
    view.unmount()
  })

  it.each<SupporterEntitlement>([
    entitlement(), { state: 'error' },
    { state: 'unavailable', reason: 'temporarily_unavailable' },
    { state: 'unavailable', reason: 'not_deployed' },
    { state: 'unavailable', reason: 'environment_mismatch' },
  ])('waits without a lock line when checkout is unconfirmed: %j', async value => {
    stubSavedBanner()
    const view = await mount(studio(value))
    expect(perkLine(view.host)).toBeNull()
    view.unmount()
  })

  it('waits without a lock line when the membership read failed', async () => {
    stubSavedBanner()
    const view = await mount(studio(null, { unavailable: true }))
    expect(perkLine(view.host)).toBeNull()
    expect(view.host.textContent).toContain('Supporter status unavailable')
    view.unmount()
  })

  it('hides the lock line when the fresh entitlement confirms membership before the parent refreshes', async () => {
    stubSavedBanner()
    const view = await mount(studio(entitlement(false)))
    expect(perkLine(view.host)).not.toBeNull()
    await view.rerender(studio(ACTIVE))
    expect(perkLine(view.host)).toBeNull()
    expect(backdropRow(view.host).getAttribute('data-supporter-perks')).toBe('on')
    view.unmount()
  })

  // The account-change read that clears and re-asks lives in SupporterJourney (tests/supporterJourney.test.tsx,
  // "clears access at once when ... changes and drops the old response"); this is what the studio does with it.
  it('follows the entitlement it is given: an unknown gap drops the lock line and a newer answer replaces an older one', async () => {
    stubSavedBanner()
    const view = await mount(studio(entitlement(false)))
    expect(view.host.textContent).toContain("Supporter isn't on sale yet.")
    await view.rerender(studio(null))
    expect(perkLine(view.host)).toBeNull()
    await view.rerender(studio(entitlement(true)))
    expect(perkLine(view.host)?.textContent).toBe('The backdrop is a Supporter perk. Only you see it. See Supporter →')
    expect(view.host.textContent).not.toContain("Supporter isn't on sale yet.")
    view.unmount()
  })

  it('retries the actual setting read outside the paused controls', async () => {
    const { nextBannerRead, bannerReadCount } = stubSavedBanner()
    nextBannerRead(() => Promise.reject(new Error('offline')))
    const view = await mount(studio(ACTIVE))
    const error = view.host.querySelector('[data-emote-rain-load-error]')!
    expect(error.textContent).toBe("Couldn't load your backdrop setting. Try again")
    const retry = findButton(view.host, 'Try again')
    expect(retry.closest('fieldset')).toBeNull()
    expect(retry.disabled).toBe(false)
    // A change can be tried, but it cannot be equipped until the setting is read.
    await act(async () => backdropButton(view.host, 'On').click())
    expect(findButton(view.host, 'Equip look').getAttribute('aria-disabled')).toBe('true')
    expect(bannerReadCount()).toBe(1)
    await act(async () => retry.click())
    expect(bannerReadCount()).toBe(2)
    expect(view.host.querySelector('[data-emote-rain-load-error]')).toBeNull()
    expect(findButton(view.host, 'Equip look').hasAttribute('aria-disabled')).toBe(false)
    view.unmount()
  })

  it('keeps a newer synced setting when the initial read finishes late', async () => {
    const { nextBannerRead, changed } = stubSavedBanner()
    const initial = deferred<Record<string, unknown>>()
    nextBannerRead(() => initial.promise)
    const view = await mount(studio(ACTIVE))
    await act(async () => changed({ pulseBanner: { newValue: { mode: 'still', intensity: 45, title: 'Newer' } } }, 'sync'))
    expect(view.host.querySelector('[data-emote-rain-load-error]')).toBeNull()
    await act(async () => initial.resolve({ pulseBanner: { mode: 'off', intensity: 35, title: 'Older' } }))
    expect(backdropButton(view.host, 'On').getAttribute('aria-pressed')).toBe('true')
    expect(view.host.querySelector<HTMLInputElement>('input[type="range"]')!.value).toBe('45')
    view.unmount()

    // The panel title follows the same rule.
    const second = stubSavedBanner()
    const lateTitle = deferred<Record<string, unknown>>()
    second.nextBannerRead(() => lateTitle.promise)
    const titles = await mount(<PulseBannerControls expanded perks />)
    await act(async () => second.changed({ pulseBanner: { newValue: { mode: 'still', intensity: 45, title: 'Newer' } } }, 'sync'))
    expect(titles.host.querySelector('fieldset')?.disabled).toBe(false)
    await act(async () => lateTitle.resolve({ pulseBanner: { mode: 'off', intensity: 35, title: 'Older' } }))
    expect(titles.host.querySelector<HTMLInputElement>('input[maxlength="40"]')!.value).toBe('Newer')
    titles.unmount()
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
    const { set, sendMessage, nextBannerRead, bannerReadCount } = stubSavedBanner()
    const initial = deferred<Record<string, unknown>>()
    nextBannerRead(() => initial.promise)
    const view = await mount(<QuickLook appearance={{ finish: null, perks: true }} onOpen={() => {}} />)
    await act(async () => quickBackdropButton(view.host, 'On').click())
    expect(set).not.toHaveBeenCalled()
    await act(async () => initial.resolve({ pulseBanner: { mode: 'rain', intensity: 40, title: 'My Pulse' } }))
    view.unmount()

    nextBannerRead(() => Promise.reject(new Error('offline')))
    const failed = await mount(<QuickLook appearance={{ finish: null, perks: true }} onOpen={() => {}} />)
    expect(failed.host.querySelector('[data-emote-rain-load-error]')?.textContent).toBe("Couldn't load your backdrop setting. Try again")
    await act(async () => quickBackdropButton(failed.host, 'On').click())
    expect(set).not.toHaveBeenCalled()
    await act(async () => findButton(failed.host, 'Try again').click())
    expect(failed.host.querySelector('[data-emote-rain-load-error]')).toBeNull()
    expect(bannerReadCount()).toBe(3)
    expect(sendMessage).not.toHaveBeenCalled()
    failed.unmount()
  })

  it('keeps quick settings saves single and shows a failed save as plain text', async () => {
    const { set } = stubSavedBanner({ mode: 'off', intensity: 40, title: 'My Pulse' })
    let reject!: (error: Error) => void
    set.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    const view = await mount(<QuickLook appearance={{ finish: null, perks: true }} onOpen={() => {}} />)
    await act(async () => quickBackdropButton(view.host, 'On').click())
    await act(async () => quickBackdropButton(view.host, 'Off').click())
    expect(set).toHaveBeenCalledTimes(1)
    await act(async () => reject(new Error('offline')))
    expect(view.host.querySelector('[role="status"]')?.textContent).toBe("Couldn't save that. Try again.")
    expect(findButton(view.host, 'Try again')).toBeUndefined()
    view.unmount()
  })
})
