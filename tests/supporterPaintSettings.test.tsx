// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupporterPaintStyleFields } from '../src/options/SupporterPaintStyleFields.tsx'
import { SupporterBannerPile } from '../src/options/SupporterBannerPile.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function mount(node: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(node))
  return { host, unmount: () => { act(() => root.unmount()); host.remove() } }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('supporter paint settings', () => {
  it('previews each wave and sheen in the selected finish and reports the choice', () => {
    const onChoose = vi.fn()
    const view = mount(<SupporterPaintStyleFields finish="etched" style={{ wave: 'chrome', sheen: 'sweep' }} onChoose={onChoose} />)
    const samples = [...view.host.querySelectorAll<HTMLElement>('.pulse-supporter-paint-sample')]
    expect(samples).toHaveLength(8)
    expect(samples.every(sample => sample.dataset.finish === 'etched')).toBe(true)
    // Sheen samples show the chosen wave, so each choice previews the real combination.
    expect(samples.slice(4).every(sample => sample.dataset.wave === 'chrome')).toBe(true)
    act(() => (view.host.querySelector('input[aria-label="Glint sheen"]') as HTMLInputElement).click())
    expect(onChoose).toHaveBeenCalledWith({ wave: 'chrome', sheen: 'glint' })
    act(() => (view.host.querySelector('input[aria-label="Aurora wave"]') as HTMLInputElement).click())
    expect(onChoose).toHaveBeenLastCalledWith({ wave: 'aurora', sheen: 'sweep' })
    view.unmount()
  })

  it('settles one still pile of static emotes and crests under reduced motion, and cleans up', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), addEventListener() {}, removeEventListener() {} }))
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    const view = mount(<button type="button"><SupporterBannerPile /></button>)
    const pile = view.host.querySelector('.pulse-supporter-banner-pile')!
    expect(pile.getAttribute('aria-hidden')).toBe('true')
    expect(pile.querySelectorAll('.pulse-pile-body')).toHaveLength(14)
    expect(pile.querySelectorAll('.pulse-crest').length).toBeGreaterThan(0)
    expect([...pile.querySelectorAll('img')].every(img => img.src.includes('1x_static.webp'))).toBe(true)
    expect(raf).not.toHaveBeenCalled()
    view.unmount()
  })
})
