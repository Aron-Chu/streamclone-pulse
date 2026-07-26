import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HubMover } from '../src/lib/publicHub'
import { HubLiveRailMoversStrip } from '../src/ui/components/analytics/HubLiveRailMoversStrip'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'

const { gsapTo, gsapFrom, flipFrom, flipGetState } = vi.hoisted(() => ({
  gsapTo: vi.fn(),
  gsapFrom: vi.fn(),
  flipFrom: vi.fn(),
  flipGetState: vi.fn(() => ({ targets: [] })),
}))

vi.mock('gsap', () => ({
  default: {
    to: gsapTo,
    from: gsapFrom,
    fromTo: vi.fn(),
    registerPlugin: vi.fn(),
  },
}))

vi.mock('gsap/Flip', () => ({
  Flip: {
    getState: flipGetState,
    from: flipFrom,
  },
}))

function renderStrip(movers: HubMover[], reducedMotion = false) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reducedMotion && query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))

  return render(
    <MemoryRouter>
      <AnalyticsThemeProvider>
        <HubLiveRailMoversStrip movers={movers} />
      </AnalyticsThemeProvider>
    </MemoryRouter>,
  )
}

const MOVERS: HubMover[] = [
  {
    login: 'xqc',
    displayName: 'xQc',
    viewers: 24000,
    emotesPerMin: 400,
    seventvPerMin: 380,
    chatPerMin: 500,
    trendPct: 12,
    trendSignal: true,
  },
  {
    login: 'sodapoppin',
    displayName: 'sodapoppin',
    viewers: 8800,
    emotesPerMin: 200,
    seventvPerMin: 180,
    chatPerMin: 300,
    trendPct: -8,
    trendSignal: true,
  },
  {
    login: 'jynxzi',
    displayName: 'Jynxzi',
    viewers: 15000,
    emotesPerMin: 100,
    seventvPerMin: 90,
    chatPerMin: 150,
    trendPct: 0,
    trendSignal: true,
  },
]

describe('HubLiveRailMoversStrip', () => {
  beforeEach(() => {
    gsapTo.mockClear()
    gsapFrom.mockClear()
    flipFrom.mockClear()
    flipGetState.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders rows in backend order without re-sorting', () => {
    renderStrip(MOVERS)
    const names = screen.getAllByRole('link').map((el) => el.textContent ?? '')
    expect(names[0]).toContain('xQc')
    expect(names[1]).toContain('sodapoppin')
    expect(names[2]).toContain('Jynxzi')
  })

  it('sets bar widths proportional to emotesPerMin', () => {
    const { container } = renderStrip(MOVERS)
    const xqcBar = container.querySelector('[data-bar-login="xqc"]') as HTMLElement
    const sodaBar = container.querySelector('[data-bar-login="sodapoppin"]') as HTMLElement
    expect(xqcBar?.style.width).toBe('100%')
    expect(sodaBar?.style.width).toBe('50%')
  })

  it('renders trend chips reflecting trendPct sign', () => {
    renderStrip(MOVERS)
    expect(screen.getByText('▲ 12%')).toBeTruthy()
    expect(screen.getByText('▼ 8%')).toBeTruthy()
    expect(screen.getByText('flat')).toBeTruthy()
  })

  it('triggers GSAP bar animation when motion is enabled', async () => {
    renderStrip(MOVERS, false)
    await vi.waitFor(() => {
      expect(gsapTo).toHaveBeenCalled()
    })
  })

  it('does not trigger GSAP when prefers-reduced-motion is set', async () => {
    renderStrip(MOVERS, true)
    await new Promise((r) => setTimeout(r, 50))
    expect(gsapTo).not.toHaveBeenCalled()
    expect(flipFrom).not.toHaveBeenCalled()
  })

  it('shows rank delta when order changes on re-render', () => {
    const { rerender } = renderStrip(MOVERS.slice(0, 2), false)
    const reordered = [MOVERS[1]!, MOVERS[0]!]
    rerender(
      <MemoryRouter>
        <AnalyticsThemeProvider>
          <HubLiveRailMoversStrip movers={reordered} />
        </AnalyticsThemeProvider>
      </MemoryRouter>,
    )
    expect(screen.getByText('▲1')).toBeTruthy()
    expect(screen.getByText('▼1')).toBeTruthy()
  })
})
