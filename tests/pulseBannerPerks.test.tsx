// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BACKDROP_FREE, BACKDROP_FREE_NOTE } from '../src/shared/backdropPolicy.ts'
import { DEFAULT_PULSE_BANNER } from '../src/shared/storage.ts'
import { PulseBannerBackdrop, PulseBannerControls, PulseBannerQuickPreview } from '../src/ui/PulseBanner.tsx'
import { shadowStyles } from '../src/ui/theme.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/** A profile that saved Rain at 40% in 0.2.1, when the backdrop was free. */
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

/**
 * Owner decision 2026-10-11: the 7TV emote backdrop stays free until Supporter
 * sign-ups open, with one short note that it becomes a Supporter perk then.
 * tests/pulseBannerPerksLocked.test.tsx flips BACKDROP_FREE off and checks the gate.
 */
describe('the 7TV emote backdrop is free until Supporter sign-ups open', () => {
  it('ships free, with one short note', () => {
    expect(BACKDROP_FREE).toBe(true)
    expect(BACKDROP_FREE_NOTE).toBe('Becomes a Supporter perk when sign-ups open.')
    // A temporary "not yet" state, in the extension's amber.
    expect(shadowStyles).toContain('.pulse-settings-hint.pulse-backdrop-note, .pulse-supporter-detail.pulse-backdrop-note { color: #fcd34d; }')
  })

  it('draws a saved backdrop, still or falling, without Supporter perks', () => {
    for (const mode of ['rain', 'still'] as const) {
      const free = renderToStaticMarkup(<PulseBannerBackdrop value={{ ...DEFAULT_PULSE_BANNER, mode }} perks={false} />)
      expect(free, mode).toContain(`data-mode="${mode}"`)
      expect(free.match(/<img/g), mode).toHaveLength(6)
    }
    // Off stays off.
    expect(renderToStaticMarkup(<PulseBannerBackdrop value={DEFAULT_PULSE_BANNER} perks={false} />)).not.toContain('<img')
  })

  it('gives a non-Supporter Off, Still, Rain and intensity, with the note and no lock', async () => {
    const set = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={false} />)
    expect(document.getElementById(view.host.querySelector('.pulse-banner-modes')!.getAttribute('aria-labelledby')!)?.textContent).toBe('7TV emote backdrop')
    for (const name of ['Off', 'Still', 'Rain']) {
      expect(modeButton(view.host, name).disabled, name).toBe(false)
      expect(modeButton(view.host, name).title, name).toBe('')
    }
    // The 0.2.1 user's rain is back: pressed, and drawn in the preview.
    expect(modeButton(view.host, 'Rain').getAttribute('aria-pressed')).toBe('true')
    expect(view.host.querySelector<HTMLInputElement>('input[type="range"]')!.disabled).toBe(false)
    expect(view.host.querySelector('.pulse-background-preview .pulse-banner-art')?.getAttribute('data-mode')).toBe('rain')
    expect(view.host.querySelectorAll('.pulse-background-preview img')).toHaveLength(6)
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    const note = view.host.querySelector('[data-backdrop-note="free"]')!
    expect(note.textContent).toBe('Becomes a Supporter perk when sign-ups open.')
    expect(note.classList.contains('pulse-backdrop-note')).toBe(true)

    // Still saves for everyone.
    await act(async () => { modeButton(view.host, 'Still').click() })
    await act(async () => { view.host.querySelector('form')!.requestSubmit() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: { mode: 'still', intensity: 40, title: 'My Pulse' } })
    view.unmount()
  })

  it('does not wait on the membership check, and Reset resets everything', async () => {
    const set = stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks={undefined} />)
    expect(modeButton(view.host, 'Rain').disabled).toBe(false)
    expect(view.host.querySelector('.pulse-banner-modes')?.hasAttribute('aria-busy')).toBe(false)
    expect(view.host.querySelector('[data-backdrop-note="free"]')).not.toBeNull()
    await act(async () => { [...view.host.querySelectorAll('button')].find(button => button.textContent === 'Reset')!.click() })
    await act(async () => { view.host.querySelector('form')!.requestSubmit() })
    expect(set).toHaveBeenCalledWith({ pulseBanner: DEFAULT_PULSE_BANNER })
    view.unmount()
  })

  it('leaves the note out for a verified Supporter', async () => {
    stubSavedBanner()
    const view = await mount(<PulseBannerControls expanded perks />)
    for (const name of ['Off', 'Still', 'Rain']) expect(modeButton(view.host, name).disabled, name).toBe(false)
    expect(view.host.querySelector('[data-backdrop-note]')).toBeNull()
    expect(view.host.querySelector('[data-supporter-perk]')).toBeNull()
    view.unmount()
  })

  it('previews in quick settings what the overlay draws, named the 7TV emote backdrop', async () => {
    stubSavedBanner()
    const free = await mount(<PulseBannerQuickPreview perks={false} />)
    const preview = free.host.querySelector('[data-appearance-preview]')!
    expect(preview.getAttribute('data-preview-mode')).toBe('rain')
    expect(preview.getAttribute('aria-label')).toBe('Appearance preview: My Pulse. 7TV emote backdrop: Rain')
    expect(preview.querySelector('small')?.textContent).toBe('7TV emote backdrop: Rain')
    expect(preview.querySelectorAll('img')).toHaveLength(6)
    free.unmount()
    stubSavedBanner({ mode: 'off', intensity: 40, title: '' })
    const off = await mount(<PulseBannerQuickPreview perks={false} />)
    expect(off.host.querySelector('[data-appearance-preview] small')?.textContent).toBe('7TV emote backdrop: Off')
    off.unmount()
  })
})
