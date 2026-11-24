import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LandingBrainChat } from '../src/routes/public/LandingBrainChat'
import { DEMO, formatClock } from '../src/routes/public/brainchatDemoData'

function renderCard() {
  return render(
    <MemoryRouter>
      <LandingBrainChat />
    </MemoryRouter>,
  )
}

const moment = (n: number) => DEMO.moments[n - 1]!

afterEach(() => {
  vi.useRealTimers()
})

describe('BrainChat, coming later, on the front page (board extension-brainchat 11-22, ★ B1)', () => {
  it('says what it will do, that it is not out, and links to the demo', () => {
    const { container } = renderCard()
    const section = screen.getByRole('region', { name: 'BrainChat' })
    expect(within(section).getByText('Coming later')).toBeTruthy()
    expect(within(section).getByText(/says what it was about, who it was aimed at and how chat felt/i)).toBeTruthy()
    expect(within(section).getByText(/no date and nothing to sign up for/i)).toBeTruthy()
    expect(within(section).getByRole('link', { name: 'See the demo' }).getAttribute('href')).toBe('/brainchat')
    expect(within(section).getByText('The stream, the chat and the counts are made up.')).toBeTruthy()
    // Nothing to sign up for and nothing collected: no field, no form, no GitHub link, no date.
    expect(container.querySelector('input, textarea, select, form')).toBeNull()
    expect(container.innerHTML).not.toMatch(/github/i)
    expect(container.textContent).not.toMatch(/\b20\d\d\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i)
    expect(container.textContent).not.toContain('—')
  })

  it('pins the busiest three moments, the busiest pressed first, with its read-out', () => {
    renderCard()
    const pins = screen.getAllByRole('button', { name: /^Moment \d/ })
    expect(pins.map((pin) => pin.textContent)).toEqual(DEMO.busiestThree.map(String))
    const first = DEMO.busiestThree[0]!
    expect(pins.map((pin) => pin.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    expect(pins[0]!.getAttribute('aria-label')).toBe(`Moment ${first}, ${formatClock(moment(first).at)}`)
    const read = document.querySelector('.sl-bc__read')!
    expect(read.getAttribute('aria-live')).toBe('polite')
    expect(within(read as HTMLElement).getByRole('heading', { level: 3 }).textContent).toBe(`${moment(first).about}.`)
    expect(read.textContent).toContain(`Moment ${first} · ${formatClock(moment(first).at)}`)
    expect(read.textContent).toContain(`${moment(first).busiest} people in the busiest 10 s`)
  })

  it('swaps the read-out when another pin is pressed', () => {
    vi.useFakeTimers()
    renderCard()
    const pins = screen.getAllByRole('button', { name: /^Moment \d/ })
    const second = DEMO.busiestThree[1]!
    fireEvent.click(pins[1]!)
    expect(pins.map((pin) => pin.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
    act(() => { vi.advanceTimersByTime(200) })
    const read = document.querySelector<HTMLElement>('.sl-bc__read')!
    expect(read.hasAttribute('data-swapping')).toBe(false)
    expect(within(read).getByRole('heading', { level: 3 }).textContent).toBe(`${moment(second).about}.`)
    expect(within(read).getByText(moment(second).aimedAt)).toBeTruthy()
  })

  it('waits out of view to draw the line in once, and draws it as is without an observer', () => {
    // The test IntersectionObserver never reports, and jsdom puts the chart at 0 x 0, out of view.
    const waiting = renderCard()
    expect(waiting.container.querySelector('.sl-bc__chart')?.getAttribute('data-draw')).toBe('ready')
    expect(waiting.container.querySelector('.sl-bc__line')?.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L/)
    waiting.unmount()

    const observer = globalThis.IntersectionObserver
    // @ts-expect-error: a browser without IntersectionObserver
    delete globalThis.IntersectionObserver
    try {
      const plain = renderCard()
      expect(plain.container.querySelector('.sl-bc__chart')?.getAttribute('data-draw')).toBe('still')
    } finally {
      globalThis.IntersectionObserver = observer
    }
  })
})
