/**
 * The install card's chat (11-01): each new line moves the older ones up by a transform, never by layout, so
 * Chrome counts no layout shift while it plays. The box used to sit on the card's bottom and grow upward, and
 * the oldest line left at 14: 0.12 layout shift on a 375 px phone, over Google's 0.1 for "good".
 */
import { act, cleanup, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubV5Promo } from '../src/ui/components/hub/v5/HubV5Promo'

const css = readFileSync(resolve(process.cwd(), 'src/ui/components/hub/v5/hub-v5.css'), 'utf8')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the install card’s chat (11-01)', () => {
  it('pins the lines by their top and lifts them by their own height, so they end 8 px above the bottom', () => {
    const rule = css.match(/\n\.hv5-pr-lines \{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/\btop: calc\(100% - 8px\);/)
    expect(rule).toMatch(/\btransform: translateY\(-100%\);/)
    expect(rule).not.toMatch(/\bbottom:/)
  })

  it('ends each line’s fade with the fade', () => {
    // The keyframe has only a from, so a line looks the same once its fade ends; a both fill kept every finished
    // fade in effect, as on the Top emotes map.
    expect(css).toMatch(/\n@keyframes hv5-pr-in \{ from \{ opacity: 0; transform: translateY\(8px\); \} \}/)
    expect([...css.matchAll(/animation: hv5-pr-in ([^;]*);/g)].map(m => m[1])).toEqual(['0.25s ease backwards'])
  })

  it('keeps every line it shows until the next loop starts', () => {
    vi.useFakeTimers()
    let enter = () => {}
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        enter = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)
      }
      observe() {}
      disconnect() {}
    })
    const { container } = render(<HubV5Promo />)
    const lines = container.querySelector('.hv5-pr-lines')!
    act(() => enter())
    const first = lines.firstElementChild
    act(() => { vi.advanceTimersByTime(2600) })
    // Dropping the oldest line would move every other line up in layout, which Chrome counts as layout shift.
    expect(lines.childElementCount).toBeGreaterThan(14)
    expect(first?.isConnected).toBe(true)
    act(() => { vi.advanceTimersByTime(12_200 - 2600) })
    expect(lines.childElementCount).toBe(3)
  })
})
