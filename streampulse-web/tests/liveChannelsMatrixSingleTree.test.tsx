import { act, render, screen } from '@testing-library/react'
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
})
