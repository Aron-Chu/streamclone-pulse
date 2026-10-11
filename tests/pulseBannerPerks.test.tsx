// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseBannerControls, PulseBannerQuickPreview } from '../src/ui/PulseBanner.tsx'

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
    // 0.2.1 gave the backdrop free: say plainly that it moved, and that a saved choice is kept.
    expect(perk.textContent).toContain('It moved from free to Supporter in 0.2.2, and a backdrop you chose is kept for when you support.')
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

  it('previews in quick settings only what the overlay draws', async () => {
    stubSavedBanner()
    const locked = await mount(<PulseBannerQuickPreview perks={false} />)
    const lockedPreview = locked.host.querySelector('[data-appearance-preview]')!
    expect(lockedPreview.getAttribute('data-preview-mode')).toBe('off')
    expect(lockedPreview.getAttribute('aria-label')).toBe('Appearance preview: My Pulse, Backdrop off')
    expect(lockedPreview.querySelectorAll('img')).toHaveLength(0)
    locked.unmount()
    const supporter = await mount(<PulseBannerQuickPreview perks />)
    const preview = supporter.host.querySelector('[data-appearance-preview]')!
    expect(preview.getAttribute('data-preview-mode')).toBe('rain')
    expect(preview.getAttribute('aria-label')).toBe('Appearance preview: My Pulse, 7TV rain')
    expect(preview.querySelectorAll('img')).toHaveLength(6)
    supporter.unmount()
  })
})
