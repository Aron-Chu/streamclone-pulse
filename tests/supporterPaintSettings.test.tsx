// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupporterPaintStyleFields } from '../src/options/SupporterPaintStyleFields.tsx'

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
  it('shows the saved wave and sheen as chosen and reports a new choice', () => {
    const onChoose = vi.fn()
    const view = mount(<SupporterPaintStyleFields style={{ wave: 'chrome', sheen: 'sweep' }} onChoose={onChoose} />)
    const checked = [...view.host.querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value)
    expect(checked).toEqual(['wave-chrome', 'sheen-sweep'])
    // The pills name each choice; the Your look preview above draws it.
    expect(view.host.querySelectorAll('.pulse-supporter-tile')).toHaveLength(8)
    expect(view.host.querySelector('.pulse-supporter-paint-sample')).toBeNull()
    act(() => (view.host.querySelector('input[aria-label="Glint sheen"]') as HTMLInputElement).click())
    expect(onChoose).toHaveBeenCalledWith({ wave: 'chrome', sheen: 'glint' })
    act(() => (view.host.querySelector('input[aria-label="Aurora wave"]') as HTMLInputElement).click())
    expect(onChoose).toHaveBeenLastCalledWith({ wave: 'aurora', sheen: 'sweep' })
    view.unmount()
  })
})
