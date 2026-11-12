import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@streampulse/analytics-console', () => ({
  AnalyticsConsole: () => <div data-testid="analytics-console">console</div>,
}))

vi.mock('../src/lib/streamcloneAnalytics', () => ({
  setupStreamcloneAnalyticsApi: () => undefined,
  usesLocalAnalyticsBackend: () => false,
}))

vi.mock('../src/ui/motion/useAnalyticsMotion', () => ({
  useAnalyticsMotion: () => ({ fadeThemeCenter: () => undefined }),
}))

vi.mock('../src/ui/components/analytics/HubBackendSourceBanner', () => ({
  HubBackendSourceBanner: () => null,
}))

vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({
  AnalyticsFigmaShell: ({ children }: { children: ReactNode }) => <div data-testid="figma-shell">{children}</div>,
}))

import ConsoleChannelView from '../src/routes/analytics/ConsoleChannelView'

describe('ConsoleChannelView shell', () => {
  it('does not probe service status for the header', () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(
        <MemoryRouter initialEntries={['/analytics/xqc/2026-07-11']}>
          <Routes>
            <Route path="/analytics/:login/:streamId" element={<ConsoleChannelView />} />
          </Routes>
        </MemoryRouter>,
      )
      expect(screen.getByTestId('analytics-console')).toBeTruthy()
      expect(fetchMock.mock.calls.map(([url]) => String(url)).filter(url => url.includes('/v1/public/status'))).toEqual([])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('ConsoleChannelView Moments return navigation', () => {
  it.each([
    ['/analytics/moments?view=recent&q=history', 'Latest moments'],
    ['/analytics/moments?view=recent#history', 'Latest moments'],
    ['/analytics/moments?view=saved#history', 'Saved moments'],
    ['/analytics/moments?view=history&year=2026&category=VALORANT#evidence', 'Broadcast history'],
  ])('labels %s from its view and preserves its destination', (returnTo, label) => {
    const query = new URLSearchParams({ returnTo })
    render(
      <MemoryRouter initialEntries={[`/analytics/xqc/2026-07-11?${query}`]}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={<ConsoleChannelView />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: new RegExp(`${label}$`) }).getAttribute('href')).toBe(returnTo)
  })

  it.each(['/analytics/explore/pulse-xqc-session-1?window=7d&sort=recent', '/analytics/explore?window=24h'])('treats an old Explorer return path %s as no return path', returnTo => {
    render(
      <MemoryRouter initialEntries={[`/analytics/xqc/2026-07-11?${new URLSearchParams({ returnTo })}`]}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={<ConsoleChannelView />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /All xqc broadcasts$/ }).getAttribute('href')).toBe('/analytics/xqc')
    expect(screen.queryByRole('link', { name: /Pulse Explorer/ })).toBeNull()
  })

  it('sends a link without a return path to the creator broadcasts, not global History', () => {
    render(
      <MemoryRouter initialEntries={['/analytics/xqc/2026-07-11']}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={<ConsoleChannelView />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: /All xqc broadcasts$/ }).getAttribute('href')).toBe('/analytics/xqc')
  })
})
