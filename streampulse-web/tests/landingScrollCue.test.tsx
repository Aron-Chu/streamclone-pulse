import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LandingScrollCue } from '../src/ui/components/landing/LandingScrollCue'
import { DEMO_PLAY_EVENT } from '../src/ui/components/landing/demoPlayEvent'

/** Answers matchMedia as allowing motion (or not). */
function stubReducedMotion(reduced: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

function renderCue() {
  return render(
    <>
      <LandingScrollCue />
      <section id="demo" tabIndex={-1} aria-label="Demo" />
    </>,
  )
}

const originalScrollIntoView = Element.prototype.scrollIntoView
let scrollIntoView: ReturnType<typeof vi.fn>
let played: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrollIntoView = vi.fn()
  Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView']
  played = vi.fn()
  window.addEventListener(DEMO_PLAY_EVENT, played)
})

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView
  window.removeEventListener(DEMO_PLAY_EVENT, played)
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
})

describe('the hero cue to the demo (board extension-brainchat 11-22, ★ A1)', () => {
  it('stays reachable when the arrow starts below a short viewport', () => {
    renderCue()
    const cue = screen.getByRole('link', { name: 'See the extension beside Twitch chat' })
    vi.spyOn(cue, 'getBoundingClientRect').mockImplementation(() =>
      new DOMRect(0, window.innerHeight + 20 - window.scrollY, 160, 90))
    Object.defineProperty(window, 'scrollY', { value: 140, configurable: true })
    fireEvent.scroll(window)
    expect(cue.hasAttribute('data-gone')).toBe(false)
    fireEvent.click(cue)
    expect(played).toHaveBeenCalledOnce()
  })

  it('is a plain link to #demo with its label, and the arrow is decoration', () => {
    renderCue()
    const cue = screen.getByRole('link', { name: 'See the extension beside Twitch chat' })
    expect(cue.getAttribute('href')).toBe('#demo')
    expect(cue.querySelector('.sl-cue__btn')?.getAttribute('aria-hidden')).toBe('true')
    expect(cue.hasAttribute('data-gone')).toBe(false)
  })

  it('scrolls smoothly to the demo, moves focus there and starts the demo from the top', () => {
    stubReducedMotion(false)
    renderCue()
    const cue = screen.getByRole('link', { name: 'See the extension beside Twitch chat' })
    const notPrevented = fireEvent.click(cue)
    expect(notPrevented).toBe(false)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(document.activeElement?.id).toBe('demo')
    expect(played).toHaveBeenCalledTimes(1)
  })

  it('jumps without the smooth scroll under reduced motion', () => {
    stubReducedMotion(true)
    renderCue()
    fireEvent.click(screen.getByRole('link', { name: 'See the extension beside Twitch chat' }))
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' })
    expect(played).toHaveBeenCalledTimes(1)
  })

  it('leaves a modified click to the browser', () => {
    renderCue()
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: 'See the extension beside Twitch chat' }), { ctrlKey: true })
    expect(notPrevented).toBe(true)
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(played).not.toHaveBeenCalled()
  })

  it('stays while it is still low on the screen, and never fades while focused', () => {
    renderCue()
    const cue = screen.getByRole('link', { name: 'See the extension beside Twitch chat' })
    let bottom = window.innerHeight * 0.8
    vi.spyOn(cue, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, bottom - 90, 160, 90))
    Object.defineProperty(window, 'scrollY', { value: 200, configurable: true })
    fireEvent.scroll(window)
    expect(cue.hasAttribute('data-gone')).toBe(false)
    // Focused, it stays even once it has risen; it fades when the focus moves on.
    act(() => { cue.focus() })
    bottom = window.innerHeight * 0.3
    fireEvent.scroll(window)
    expect(cue.hasAttribute('data-gone')).toBe(false)
    act(() => { cue.blur() })
    expect(cue.hasAttribute('data-gone')).toBe(true)
  })

  it('fades out once the page has scrolled, and back at the top', () => {
    renderCue()
    const cue = screen.getByRole('link', { name: 'See the extension beside Twitch chat' })
    Object.defineProperty(window, 'scrollY', { value: 200, configurable: true })
    fireEvent.scroll(window)
    expect(cue.hasAttribute('data-gone')).toBe(true)
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    fireEvent.scroll(window)
    expect(cue.hasAttribute('data-gone')).toBe(false)
  })
})
