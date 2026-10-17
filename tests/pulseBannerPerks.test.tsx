// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseBannerControls } from '../src/ui/PulseBanner.tsx'
import { QuickLook } from '../src/ui/PulseSettingsPanel.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A profile that saved Rain earlier, for instance while it was a Supporter. */
function stubSavedBanner(saved: Record<string, unknown> = { mode: 'rain', intensity: 40, title: 'My Pulse' }) {
  const set = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension' },
    storage: {
      sync: { get: vi.fn().mockResolvedValue({ pulseBanner: saved }), set },
      onChanged: { addListener() {}, removeListener() {} },
    },
  })
  return set
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
    const set = stubSavedBanner()
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
    expect(perk.textContent).toContain('Emote rain, still or falling, is a Supporter perk. Only you see it. Sign-ups are not open yet.')
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
    const set = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    await act(async () => { [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Reset')!.click() })
    expect(view.host.querySelector<HTMLInputElement>('input[maxlength="40"]')!.value).toBe('')
    await act(async () => { view.host.querySelector('form')!.requestSubmit() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'rain', intensity: 40, title: '' } })
    view.unmount()
  })

  it('waits, neutral, until the membership check answers instead of flashing the lock', async () => {
    stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={undefined} />)
    expect(view.host.querySelector('[data-supporter-perks]')?.getAttribute('data-supporter-perks')).toBe('pending')
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    expect(modeButton(view.host, 'Rain').disabled).toBe(true)
    expect(view.host.querySelector('.pulse-banner-modes')?.getAttribute('aria-busy')).toBe('true')
    expect(view.host.querySelectorAll('.pulse-background-preview img')).toHaveLength(0)
    view.unmount()
  })

  it('gives an active or grace Supporter today’s controls and preview', async () => {
    stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks />)
    expect(view.host.querySelector('[data-supporter-perks]')?.getAttribute('data-supporter-perks')).toBe('on')
    for (const name of ['Off', 'Still', 'Rain']) expect(modeButton(view.host, name).disabled, name).toBe(false)
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    expect(view.host.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(false)
    expect(view.host.querySelector('.pulse-background-preview .pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
    expect(view.host.querySelectorAll('.pulse-background-preview img')).toHaveLength(6)
    view.unmount()
  })

  it('starts the quick settings strip on what the overlay draws, and lets anyone try a look without saving it', async () => {
    const set = stubSavedBanner()
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
    supporter.unmount()
  })
})
