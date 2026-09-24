import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LiveChannelsMatrix } from '../src/ui/components/analytics/LiveChannelsMatrix'
import { AnalyticsThemeProvider } from '../src/ui/providers/AnalyticsThemeProvider'
import type { HubLiveChannel } from '../src/lib/publicHub'

const channels: HubLiveChannel[] = Array.from({ length: 8 }, (_, index) => ({
  login: `channel${index}`,
  displayName: `Channel ${index}`,
  category: 'Just Chatting',
  viewers: 1000 - index * 10,
  chatPerMin: 50,
  emotesPerMin: 20,
  seventvPerMin: 15,
  coverageState: 'synced' as const,
  trendPct: 1,
}))

function installMatchMedia(matchesCompact: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  const mql: MediaQueryList = {
    matches: matchesCompact,
    media: '(max-width: 599px)',
    onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener as (event: MediaQueryListEvent) => void)
    },
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener as (event: MediaQueryListEvent) => void)
    },
    addListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener)
    },
    removeListener: (listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener)
    },
    dispatchEvent: () => false,
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      if (query.includes('max-width: 599px')) return mql
      return {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      } satisfies MediaQueryList
    }),
  )
  return {
    setMatches(next: boolean) {
      ;(mql as { matches: boolean }).matches = next
      const event = { matches: next, media: mql.media } as MediaQueryListEvent
      for (const listener of listeners) listener(event)
    },
  }
}

function renderMatrix() {
  return render(
    <MemoryRouter>
      <AnalyticsThemeProvider>
        <LiveChannelsMatrix channels={channels} maxRows={20} />
      </AnalyticsThemeProvider>
    </MemoryRouter>,
  )
}

describe('LiveChannelsMatrix single responsive tree', () => {
  it('keeps the current page when polling adds a channel and clamps after removal', () => {
    installMatchMedia(false)
    const many = Array.from({ length: 45 }, (_, i) => ({ ...channels[0], login: `row${i}`, viewers: 1000-i }))
    const tree = (rows: HubLiveChannel[]) => <MemoryRouter><AnalyticsThemeProvider><LiveChannelsMatrix channels={rows} maxRows={20} /></AnalyticsThemeProvider></MemoryRouter>
    const view = render(tree(many))
    fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    expect(screen.getByText(/Page 2 of 3/)).toBeTruthy()
    view.rerender(tree([...many, { ...many[0], login: 'newarrival' }]))
    expect(screen.getByText(/Page 2 of 3/)).toBeTruthy()
    view.rerender(tree(many.slice(0, 22)))
    expect(screen.getByText(/Page 2 of 2/)).toBeTruthy()
  })
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mounts table rows only on desktop — not a CSS-hidden card twin', () => {
    installMatchMedia(false)
    const { container } = renderMatrix()

    const tableRows = container.querySelectorAll('.live-channels-matrix__table tbody tr')
    const cards = container.querySelectorAll('.live-channels-matrix__card')

    expect(tableRows.length).toBe(channels.length)
    expect(cards.length).toBe(0)
    expect(screen.getByRole('table')).toBeTruthy()
  })

  it('keeps native table-row semantics and exposes one real channel anchor per row', () => {
    installMatchMedia(false)
    const { container } = renderMatrix()
    const rows = [...container.querySelectorAll<HTMLTableRowElement>('.live-channels-matrix__table tbody tr')]
    expect(rows).toHaveLength(channels.length)
    for (const row of rows) {
      expect(row.getAttribute('role')).toBeNull()
      expect(row.tabIndex).toBe(-1)
      expect(row.querySelectorAll('a.live-channels-matrix__channel')).toHaveLength(1)
    }
    const firstLink = screen.getByRole('link', { name: /Open analytics for Channel 0/i })
    expect(firstLink.tagName).toBe('A')
    expect(firstLink.getAttribute('href')).toContain('/analytics/channel0')
  })

  it('mounts cards only on compact viewport — not a CSS-hidden table twin', () => {
    installMatchMedia(true)
    const { container } = renderMatrix()

    const tableRows = container.querySelectorAll('.live-channels-matrix__table tbody tr')
    const cards = container.querySelectorAll('.live-channels-matrix__card')

    expect(cards.length).toBe(channels.length)
    expect(tableRows.length).toBe(0)
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('keeps channel content and labels when switching breakpoints', () => {
    const media = installMatchMedia(false)
    const { container } = renderMatrix()

    expect(container.querySelectorAll('.live-channels-matrix__table tbody tr').length).toBe(
      channels.length,
    )
    expect(screen.getByRole('link', { name: /Open analytics for Channel 0/i })).toBeTruthy()

    act(() => {
      media.setMatches(true)
    })

    expect(container.querySelectorAll('.live-channels-matrix__card').length).toBe(channels.length)
    expect(container.querySelectorAll('.live-channels-matrix__table tbody tr').length).toBe(0)
    expect(screen.getByRole('link', { name: /Open analytics for Channel 0/i })).toBeTruthy()
  })

  it('bounds 500 channels to one finite page and navigates across the entire result set', () => {
    installMatchMedia(false)
    const manyChannels: HubLiveChannel[] = Array.from({ length: 500 }, (_, index) => ({
      ...channels[0],
      login: `bulk${index.toString().padStart(3, '0')}`,
      displayName: `Bulk ${index.toString().padStart(3, '0')}`,
      viewers: 500 - index,
    }))
    const { container, rerender } = render(
      <MemoryRouter><AnalyticsThemeProvider><LiveChannelsMatrix channels={manyChannels} maxRows={25} /></AnalyticsThemeProvider></MemoryRouter>,
    )
    const seen = new Set<string>()
    for (let page = 1; page <= 20; page += 1) {
      const rows = container.querySelectorAll('.live-channels-matrix__table tbody tr')
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThanOrEqual(25)
      rows.forEach((row) => seen.add(row.querySelector('a')?.getAttribute('href') ?? ''))
      if (page < 20) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    }
    expect(seen.size).toBe(500)
    expect(screen.getByText(/Page 20 of 20/)).toBeTruthy()

    rerender(<MemoryRouter><AnalyticsThemeProvider><LiveChannelsMatrix channels={[...manyChannels]} maxRows={25} /></AnalyticsThemeProvider></MemoryRouter>)
    expect(screen.getByText(/Page 20 of 20/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Viewers/ }))
    expect(screen.getByText(/Page 1 of 20/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('tab', { name: /Chat tracked/ }))
    expect(screen.getByText(/Page 1 of 20/)).toBeTruthy()
  })

  it('uses the same bounded single DOM tree on compact viewports', () => {
    installMatchMedia(true)
    const manyChannels = Array.from({ length: 500 }, (_, index) => ({
      ...channels[0], login: `mobile${index}`, displayName: `Mobile ${index}`,
    }))
    const { container } = render(
      <MemoryRouter><AnalyticsThemeProvider><LiveChannelsMatrix channels={manyChannels} maxRows={25} /></AnalyticsThemeProvider></MemoryRouter>,
    )
    expect(container.querySelectorAll('.live-channels-matrix__card')).toHaveLength(25)
    expect(container.querySelectorAll('.live-channels-matrix__table')).toHaveLength(0)
  })
})
