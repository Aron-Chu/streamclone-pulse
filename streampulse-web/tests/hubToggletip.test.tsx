import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HUB_TOGGLETIP_MEASURED_LABEL,
  HubToggletip,
  resetHubToggletipForTests,
} from '../src/ui/components/hub/d3/HubToggletip'
import { HubBucketCardHost, type HubBucketCardHostProps } from '../src/ui/components/hub/bucket-card/HubBucketCardHost'
import { HubIntervalSection, type HubIntervalSectionProps } from '../src/ui/components/hub/bucket-card/HubIntervalSection'
import { resetHubBucketSelectionForTests } from '../src/lib/hubBucketSelection'

const popover = () => document.querySelector<HTMLElement>('.hub-tip-pop')

beforeEach(() => {
  resetHubToggletipForTests()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  resetHubToggletipForTests()
})

describe('HubToggletip (plan §2.3)', () => {
  it('renders the (i) icon button, closed', () => {
    render(<HubToggletip tip="Messages per minute, all live channels." label="About chat/min" />)
    const button = screen.getByRole('button', { name: 'About chat/min' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.className).toBe('hub-tip')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.hasAttribute('aria-controls')).toBe(false)
    expect(button.querySelector('svg circle')?.getAttribute('r')).toBe('10')
    expect([...button.querySelectorAll('svg path')].map(path => path.getAttribute('d'))).toEqual(['M12 16v-4', 'M12 8h.01'])
    expect(popover()).toBeNull()
    expect(screen.getByRole('button', { name: 'About chat/min' })).toBe(button)
    render(<HubToggletip tip="x" />)
    expect(screen.getByRole('button', { name: 'About this' })).toBeTruthy()
  })

  it('opens on click into a portaled status popover and closes on a second click', () => {
    const { container } = render(<HubToggletip tip="Messages per minute." />)
    const button = screen.getByRole('button', { name: 'About this' })
    fireEvent.click(button)
    const pop = popover()!
    expect(pop).not.toBeNull()
    expect(container.contains(pop)).toBe(false)
    expect(pop.parentElement).toBe(document.body)
    expect(pop.className).toBe('hub-d3-layer hub-tip-pop')
    expect(pop.getAttribute('role')).toBe('status')
    expect(pop.textContent).toBe('Messages per minute.')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-controls')).toBe(pop.id)
    fireEvent.click(button)
    expect(popover()).toBeNull()
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Esc, returns focus to the button, and stops the Esc there', () => {
    const pageEscape = vi.fn()
    document.addEventListener('keydown', pageEscape)
    try {
      render(<HubToggletip tip="tip" />)
      const button = screen.getByRole('button', { name: 'About this' })
      fireEvent.click(button)
      ;(document.body as HTMLElement).focus()
      fireEvent.keyDown(popover()!, { key: 'Escape' })
      expect(popover()).toBeNull()
      expect(document.activeElement).toBe(button)
      // The card's layered Esc does not see it.
      expect(pageEscape).not.toHaveBeenCalled()
      // Closed: Esc reaches the page again.
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(pageEscape).toHaveBeenCalledTimes(1)
      // Other keys never close it.
      fireEvent.click(button)
      fireEvent.keyDown(document.body, { key: 'Enter' })
      expect(popover()).not.toBeNull()
    } finally {
      document.removeEventListener('keydown', pageEscape)
    }
  })

  it('closes on a pointer down outside, not inside the popover or on the button', () => {
    render(
      <div>
        <p data-testid="outside">elsewhere</p>
        <HubToggletip tip="tip" />
      </div>,
    )
    const button = screen.getByRole('button', { name: 'About this' })
    fireEvent.click(button)
    fireEvent.pointerDown(popover()!)
    fireEvent.pointerDown(button.querySelector('svg')!)
    expect(popover()).not.toBeNull()
    fireEvent.pointerDown(screen.getByTestId('outside'))
    expect(popover()).toBeNull()
    expect(document.activeElement).not.toBe(button)
  })

  it('keeps one open at a time', () => {
    render(
      <div>
        <HubToggletip tip="first" label="first" />
        <HubToggletip tip="second" label="second" />
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'first' }))
    expect(popover()?.textContent).toBe('first')
    fireEvent.click(screen.getByRole('button', { name: 'second' }))
    expect(document.querySelectorAll('.hub-tip-pop')).toHaveLength(1)
    expect(popover()?.textContent).toBe('second')
    expect(screen.getByRole('button', { name: 'first' }).getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on resize', () => {
    render(<HubToggletip tip="tip" />)
    fireEvent.click(screen.getByRole('button', { name: 'About this' }))
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(popover()).toBeNull()
  })

  it('offers "How this is measured" only with a handler; the link closes and calls it', () => {
    const onOpenMeasured = vi.fn()
    render(<HubToggletip tip="Lower bound." onOpenMeasured={onOpenMeasured} />)
    fireEvent.click(screen.getByRole('button', { name: 'About this' }))
    const link = screen.getByRole('link', { name: HUB_TOGGLETIP_MEASURED_LABEL })
    expect(link.getAttribute('href')).toBe('#measured')
    const notPrevented = fireEvent.click(link)
    expect(notPrevented).toBe(false)
    expect(onOpenMeasured).toHaveBeenCalledTimes(1)
    expect(popover()).toBeNull()
    cleanup()
    render(<HubToggletip tip="Plain." />)
    fireEvent.click(screen.getByRole('button', { name: 'About this' }))
    expect(popover()?.querySelector('a')).toBeNull()
  })

  it('places the popover under the button, inside an 8 px viewport margin', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('hub-tip-pop') ? 200 : 20
    })
    const at = (left: number, top: number) => ({
      left, right: left + 20, top, bottom: top + 20, width: 20, height: 20, x: left, y: top, toJSON: () => ({}),
    }) as DOMRect
    const viewport = window.innerWidth
    const place = (left: number, align?: 'center' | 'right') => {
      cleanup()
      render(<HubToggletip tip="tip" align={align} />)
      const button = screen.getByRole('button', { name: 'About this' })
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue(at(left, 100))
      fireEvent.click(button)
      const pop = popover()!
      expect(pop.style.visibility).toBe('')
      return { left: Number.parseFloat(pop.style.left), top: Number.parseFloat(pop.style.top) }
    }
    expect(place(400)).toEqual({ left: 410 - 100, top: 126 })
    expect(place(0)).toEqual({ left: 8, top: 126 })
    expect(place(viewport - 20)).toEqual({ left: viewport - 200 - 8, top: 126 })
    expect(place(400, 'right')).toEqual({ left: 420 - 200, top: 126 })
  })
})

describe('d3 hub tokens (F2)', () => {
  // Rules only: the header comment names the tokens it leaves alone.
  const css = readFileSync(resolve(__dirname, '../src/ui/components/hub/d3/hub-d3-tokens.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('maps --sp-serif to the Inter stack under the hub scope', () => {
    expect(css).toMatch(/--sp-font:\s*"Inter",\s*system-ui,\s*sans-serif;/)
    expect(css).toMatch(/--sp-serif:\s*var\(--sp-font\);/)
    expect(css).not.toMatch(/Georgia|serif"|Newsreader|ui-serif/)
    expect(css).not.toMatch(/:root/)
    expect(css).toMatch(/^\.hub-d3,\r?\n\.hub-d3-layer \{/m)
  })

  it('never redefines the chart or theme tokens', () => {
    for (const token of ['--sp-viewers', '--sp-chat', '--sp-emotes', '--sp-live', '--sp-navigator', '--sp-accent']) {
      expect(css).not.toMatch(new RegExp(`^\\s*${token}\\s*:`, 'm'))
    }
    expect(css).toContain('var(--sp-accent, #5eead4)')
  })
})

describe('bucket card stubs (U7 fills them)', () => {
  it('render nothing without a selection', () => {
    resetHubBucketSelectionForTests()
    const cardProps: HubBucketCardHostProps = { points: [], bucketMinutes: 6, activityWindow: '24h', category: null }
    const listProps: HubIntervalSectionProps = { activityWindow: '24h', bucketMinutes: 6 }
    const { container } = render(
      <>
        <HubBucketCardHost {...cardProps} />
        <HubIntervalSection {...listProps} />
      </>,
    )
    expect(container.innerHTML).toBe('')
    expect(document.querySelector('.hub-tip-pop')).toBeNull()
  })
})
