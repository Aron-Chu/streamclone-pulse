/**
 * What the promo promises about Jump. The extension's Jump starts the replay 5 s before the spike on purpose
 * (reactionLeadInOffset), and minute moments are only known to the minute, so the card never claims the second.
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HubV5Promo } from '../src/ui/components/hub/v5/HubV5Promo'

class QuietObserver {
  observe() {}
  disconnect() {}
}

function renderPromo() {
  vi.stubGlobal('IntersectionObserver', QuietObserver)
  // Reduced motion keeps the last beat still, so the resting markup is what this reads.
  const real = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({ ...real(query), matches: query.includes('reduce') }))
  return render(<HubV5Promo />).container
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the promo promises what Jump does', () => {
  it('says Jump lands just before the spike, never on its second or minute', () => {
    const container = renderPromo()
    const body = container.querySelector('.hv5-pr-p')?.textContent ?? ''
    expect(body).toContain('jumps you to just before it happened.')
    expect(body).not.toMatch(/(second|minute) it happened/)
    expect(container.querySelector('.hv5-pr-tx')?.textContent).toBe('Lands just before it')
  })

  it('lands the sample player 5 s before the 2:18:20 spike', () => {
    const container = renderPromo()
    expect(container.querySelector('.hv5-pr-toast')?.textContent).toBe('▶ Jumped to 2:18:15')
    expect(container.querySelector('.hv5-pr-t')?.textContent).toBe('2:18:15')
  })
})
