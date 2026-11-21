// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupporterMotionField } from '../src/options/SupporterPaintStyleFields.tsx'

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
  it('shows the saved motion as chosen and reports a new choice', () => {
    const onChoose = vi.fn()
    const view = mount(<SupporterMotionField motion="shimmer" finish="glass" onChoose={onChoose} />)
    const checked = [...view.host.querySelectorAll<HTMLInputElement>('input:checked')].map(input => input.value)
    expect(checked).toEqual(['motion-shimmer'])
    // One pill per motion; the Your look preview above draws the whole look.
    expect(view.host.querySelectorAll('.pulse-supporter-tile')).toHaveLength(3)
    act(() => (view.host.querySelector('input[aria-label="Drift motion"]') as HTMLInputElement).click())
    expect(onChoose).toHaveBeenCalledWith('drift')
    act(() => (view.host.querySelector('input[aria-label="Still motion"]') as HTMLInputElement).click())
    expect(onChoose).toHaveBeenLastCalledWith('still')
    view.unmount()
  })
})
