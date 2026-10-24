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

  const renderMeasured = () => {
    let notify: (() => void) | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback }
      observe() {}
      disconnect() {}
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const render = (momentKey: string) => act(() => root?.render(
      <MomentCardSlot exiting={false} momentKey={momentKey} data-testid="slot"><p>card</p></MomentCardSlot>,
    ))
    render('a')

    const slot = container.querySelector<HTMLElement>('.pulse-moment-slot')!
    const held = slot.querySelector<HTMLElement>('.pulse-moment-slot-inner > div')!
    const card = held.querySelector<HTMLElement>(':scope > div')!
    // The card shows moment `key` at its own `height`, then reports its size.
    const show = (key: string, height: number, width = 312) => {
      card.getBoundingClientRect = () => ({ width, height } as DOMRect)
      render(key)
      act(() => notify?.())
    }
    return { slot, held, render, show }
  }

  it('holds the tallest card height so a shorter next moment does not pull content up', () => {
    const { slot, held, show } = renderMeasured()
    show('a', 120)
    expect(held.style.minHeight).toBe('120px')
    show('b', 90)
    expect(held.style.minHeight).toBe('120px')
    show('c', 140.2)
    expect(held.style.minHeight).toBe('141px')
    expect(slot.getAttribute('data-testid')).toBe('slot')
  })

  it('lets go when the same moment gets shorter, so a lost picture leaves no empty band', () => {
    const { held, render, show } = renderMeasured()
    show('a', 331)
    // Moment pictures turned off: the same moment, without its picture.
    show('a', 211)
    expect(held.style.minHeight).toBe('211px')
    show('a', 331)
    expect(held.style.minHeight).toBe('331px')
    // A next moment at the same height reports no resize; its own picture
    // going away later still counts as that moment getting shorter.
    render('b')
    show('b', 211)
    expect(held.style.minHeight).toBe('211px')
  })

  it('keeps the hold through a click to a shorter moment that later grows and shrinks', () => {
    const { held, show } = renderMeasured()
    show('a', 331)
    // Its picture is not in yet.
    show('b', 211)
    expect(held.style.minHeight).toBe('331px')
    show('b', 331)
    expect(held.style.minHeight).toBe('331px')
    show('b', 211)
    expect(held.style.minHeight).toBe('211px')
  })

  it('starts the hold over at a new width, so a card that was wider leaves no empty band', () => {
    const { held, show } = renderMeasured()
    show('a', 330)
    expect(held.style.minHeight).toBe('330px')
    // Wider: the 16:9 picture grows with the card.
    show('a', 454, 560)
    expect(held.style.minHeight).toBe('454px')
    // Back at the panel's width: the card's own height, not the wide one.
    show('a', 330)
    expect(held.style.minHeight).toBe('330px')
    // At that width a shorter next moment is held again.
    show('b', 300)
    expect(held.style.minHeight).toBe('330px')
  })

  it('collapses through the exit class when the selection clears', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<MomentCardSlot exiting momentKey="a"><p>card</p></MomentCardSlot>))
    expect(container.querySelector('.pulse-moment-slot')?.classList.contains('pulse-moment-slot-exit')).toBe(true)
  })
})
