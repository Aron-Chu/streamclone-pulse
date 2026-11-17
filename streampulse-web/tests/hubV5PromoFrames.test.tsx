/**
 * The original card's pictures (O1, 11-16): on desktop and tablet the promo shows the panel's three states crossfading
 * every 4 s; hover holds the one on show and reduced motion keeps the first. Phones render none of it.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubV5Promo } from '../src/ui/components/hub/v5/HubV5Promo'

class QuietObserver {
  observe() {}
  disconnect() {}
}

/** Renders the card with the given media queries matching. */
function renderPromo(matching: string[]) {
  vi.stubGlobal('IntersectionObserver', QuietObserver)
  const real = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ ...real(query), matches: matching.includes(query) }))
  const { container } = render(<HubV5Promo />)
  return container
}

const shown = (container: HTMLElement) =>
  [...container.querySelectorAll('.hv5-pr-frames img')].findIndex((img) => img.classList.contains('on'))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the original card pictures (O1, 11-16)', () => {
  it('renders nothing on a phone', () => {
    const container = renderPromo([])
    expect(container.querySelector('.hv5-pr-frames')).toBeNull()
  })

  it('crossfades the three pictures every 4 s from 720 px, and hover holds the one on show', () => {
    vi.useFakeTimers()
    const container = renderPromo(['(min-width: 720px)'])
    const frames = container.querySelector<HTMLElement>('.hv5-pr-frames')!
    expect(frames.getAttribute('aria-hidden')).toBe('true')
    expect(frames.querySelectorAll('img')).toHaveLength(3)
    expect(frames.querySelectorAll('.hv5-pr-frame-dots i')).toHaveLength(3)
    expect(shown(container)).toBe(0)
    act(() => { vi.advanceTimersByTime(4000) })
    expect(shown(container)).toBe(1)
    act(() => { fireEvent.pointerEnter(frames) })
    act(() => { vi.advanceTimersByTime(8000) })
    expect(shown(container)).toBe(1)
    act(() => { fireEvent.pointerLeave(frames) })
    act(() => { vi.advanceTimersByTime(8000) })
    expect(shown(container)).toBe(0)
  })

  it('keeps the first picture and shows no dots with reduced motion', () => {
    vi.useFakeTimers()
    const container = renderPromo(['(min-width: 720px)', '(prefers-reduced-motion: reduce)'])
    expect(shown(container)).toBe(0)
    expect(container.querySelector('.hv5-pr-frame-dots')).toBeNull()
    act(() => { vi.advanceTimersByTime(12000) })
    expect(shown(container)).toBe(0)
  })
})
