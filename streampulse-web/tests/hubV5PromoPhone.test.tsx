/**
 * The phone promo card (A, 11-02): collapsed it is the title, a line and "See how it works"; the button opens the
 * stage and the line under it in place and plays the scene once. Reduced motion keeps the still. Wider screens
 * show the stage whatever the button says (hub-v5.css hides the button there).
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubV5Promo } from '../src/ui/components/hub/v5/HubV5Promo'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/hub/v5/hub-v5.css'), 'utf8')

/** An observer that never reports: the closed card's stage is not drawn, so it never comes into view. */
class QuietObserver {
  observe() {}
  disconnect() {}
}

function renderPromo() {
  vi.stubGlobal('IntersectionObserver', QuietObserver)
  const { container } = render(<HubV5Promo />)
  const card = container.querySelector<HTMLElement>('.hv5-promo')!
  const stage = container.querySelector<HTMLElement>('.hv5-pr-stage')!
  const more = screen.getByRole('button', { name: 'See how it works' })
  return { card, stage, more }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('the phone promo card (A, 11-02)', () => {
  it('starts collapsed: the title, the desktop line and a button that controls the stage and the line', () => {
    const { card, stage, more } = renderPromo()
    expect(card.hasAttribute('data-open')).toBe(false)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(card.querySelector('.hv5-pr-h')!.textContent).toBe('See chat\'s big moments on Twitch')
    expect(card.querySelector('.hv5-pr-sub')!.textContent).toBe('Desktop extension for Chrome, Edge and Firefox · Free')
    const body = card.querySelector<HTMLElement>('.hv5-pr-p')!
    expect(more.getAttribute('aria-controls')).toBe(`${stage.id} ${body.id}`)
    expect(stage.id).not.toBe('')
    expect(body.id).not.toBe('')
    for (const img of stage.querySelectorAll('img')) expect(img.getAttribute('loading')).toBe('lazy')
  })

  it('opens in place, plays the scene once, and closes again', () => {
    vi.useFakeTimers()
    const { card, stage, more } = renderPromo()
    expect(stage.dataset.beat).toBe('0')
    act(() => { fireEvent.click(more) })
    expect(card.hasAttribute('data-open')).toBe(true)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    act(() => { vi.advanceTimersByTime(2600) })
    expect(stage.dataset.beat).toBe('1')
    act(() => { vi.advanceTimersByTime(12_200 - 2600) })
    expect(stage.dataset.beat).toBe('4')
    // once: no second loop starts
    act(() => { vi.advanceTimersByTime(12_200) })
    expect(stage.dataset.beat).toBe('4')
    act(() => { fireEvent.click(more) })
    expect(card.hasAttribute('data-open')).toBe(false)
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the still frame with reduced motion', () => {
    vi.useFakeTimers()
    const real = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ ...real(query), matches: query === '(prefers-reduced-motion: reduce)' }))
    const { stage, more } = renderPromo()
    expect(stage.dataset.beat).toBe('4')
    act(() => { fireEvent.click(more) })
    act(() => { vi.advanceTimersByTime(2600) })
    expect(stage.dataset.beat).toBe('4')
  })

  it('hides the stage and the line only on a closed phone card, and the button above 719 px', () => {
    expect(css).toMatch(/\n\.hv5-pr-sub,\s*\n\.hv5-pr-more \{ display: none; \}/)
    expect(css).toMatch(/\.hub-v5 \.hv5-mast \.hv5-promo:not\(\[data-open\]\) :is\(\.hv5-pr-stage, \.hv5-pr-p\) \{ display: none; \}/)
    // the card's rules sit in the phone block, after its opening and before the next block
    const at = css.indexOf('grid-template-areas: "h more" "sub more" "stage stage" "p p";')
    const block = css.lastIndexOf('@media', at)
    expect(at).toBeGreaterThan(-1)
    expect(css.startsWith('@media (max-width: 719px) {', block)).toBe(true)
  })
})
