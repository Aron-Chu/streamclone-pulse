// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MomentCardSlot } from '../src/ui/MomentCardSlot.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('MomentCardSlot', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    vi.unstubAllGlobals()
  })

  it('holds the tallest card height so a shorter next moment does not pull content up', () => {
    let notify: (() => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback }
      observe() {}
      disconnect() {}
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<MomentCardSlot exiting={false} data-testid="slot"><p>card</p></MomentCardSlot>))

    const slot = container.querySelector<HTMLElement>('.pulse-moment-slot')!
    const content = slot.querySelector<HTMLElement>('.pulse-moment-slot-inner > div')!
    const measure = (height: number) => {
      content.getBoundingClientRect = () => ({ height } as DOMRect)
      act(() => notify?.())
    }
    measure(120)
    expect(content.style.minHeight).toBe('120px')
    measure(90)
    expect(content.style.minHeight).toBe('120px')
    measure(140.2)
    expect(content.style.minHeight).toBe('141px')
    expect(slot.getAttribute('data-testid')).toBe('slot')
  })

  it('collapses through the exit class when the selection clears', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<MomentCardSlot exiting><p>card</p></MomentCardSlot>))
    expect(container.querySelector('.pulse-moment-slot')?.classList.contains('pulse-moment-slot-exit')).toBe(true)
  })
})
