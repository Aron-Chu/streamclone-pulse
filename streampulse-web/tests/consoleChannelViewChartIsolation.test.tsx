import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Suspense, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The console hands its selected minute to the page's actions; a test sets one to see them.
const selected = vi.hoisted(() => ({ minute: null as null | Record<string, unknown> }))
vi.mock('@streampulse/analytics-console', () => ({
  AnalyticsConsole: ({ renderSelectedMomentActions }: { renderSelectedMomentActions?: (minute: Record<string, unknown>) => ReactNode }) => (
    <div data-testid="analytics-console">console{selected.minute ? renderSelectedMomentActions?.(selected.minute) : null}</div>
  ),
}))

vi.mock('../src/lib/streamcloneAnalytics', () => ({
  setupStreamcloneAnalyticsApi: () => undefined,
  usesLocalAnalyticsBackend: () => false,
}))

vi.mock('../src/ui/components/analytics/HubBackendSourceBanner', () => ({
  HubBackendSourceBanner: () => null,
}))

vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({
  AnalyticsFigmaShell: ({ children }: { children: ReactNode }) => <div data-testid="figma-shell">{children}</div>,
}))

import ConsoleChannelView from '../src/routes/analytics/ConsoleChannelView'

// The console's code loads on demand, as the channel page's Suspense shows its loading shell.
const suspended = (node: ReactNode) => <Suspense fallback={null}>{node}</Suspense>

describe('ConsoleChannelView shell', () => {
  it('does not probe service status for the header', async () => {
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined))
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(
        <MemoryRouter initialEntries={['/analytics/xqc/2026-07-11']}>
          <Routes>
            <Route path="/analytics/:login/:streamId" element={suspended(<ConsoleChannelView />)} />
          </Routes>
        </MemoryRouter>,
      )
      expect(await screen.findByTestId('analytics-console')).toBeTruthy()
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
  ])('labels %s from its view and preserves its destination', async (returnTo, label) => {
    const query = new URLSearchParams({ returnTo })
    render(
      <MemoryRouter initialEntries={[`/analytics/xqc/2026-07-11?${query}`]}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={suspended(<ConsoleChannelView />)} />
        </Routes>
      </MemoryRouter>,
    )

    expect((await screen.findByRole('link', { name: new RegExp(`${label}$`) })).getAttribute('href')).toBe(returnTo)
  })

  it.each(['/analytics/explore/pulse-xqc-session-1?window=7d&sort=recent', '/analytics/explore?window=24h'])('treats an old Explorer return path %s as no return path', async returnTo => {
    render(
      <MemoryRouter initialEntries={[`/analytics/xqc/2026-07-11?${new URLSearchParams({ returnTo })}`]}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={suspended(<ConsoleChannelView />)} />
        </Routes>
      </MemoryRouter>,
    )
    expect((await screen.findByRole('link', { name: /All xqc broadcasts$/ })).getAttribute('href')).toBe('/analytics/xqc')
    expect(screen.queryByRole('link', { name: /Pulse Explorer/ })).toBeNull()
  })

  it('sends a link without a return path to the creator broadcasts, not global History', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/xqc/2026-07-11']}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={suspended(<ConsoleChannelView />)} />
        </Routes>
      </MemoryRouter>,
    )
    expect((await screen.findByRole('link', { name: /All xqc broadcasts$/ })).getAttribute('href')).toBe('/analytics/xqc')
  })
})

describe('ConsoleChannelView selected minute', () => {
  // The console's minute for the selected bar: its minuteTs (10:40:00Z) and its offset into the stream.
  const minute = { login: 'fakechan01', streamId: '9000001', offsetSeconds: 2430, at: Date.parse('2026-11-14T10:40:00Z'), chatPerMin: 200, emotesPerMin: 40, category: 'fake-pog' }
  afterEach(() => { selected.minute = null; cleanup(); vi.unstubAllEnvs() })
  const renderStream = () => {
    let state: unknown
    function Page() { state = useLocation().state; return <p>moment page</p> }
    render(
      <MemoryRouter initialEntries={['/analytics/fakechan01/9000001']}>
        <Routes>
          <Route path="/analytics/:login/:streamId" element={suspended(<ConsoleChannelView />)} />
          <Route path="/analytics/moments/:streamId/:momentAt" element={<Page />} />
        </Routes>
      </MemoryRouter>,
    )
    return { state: () => state }
  }

  it('offers no Moment page link while the page is switched off', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', '')
    selected.minute = minute
    renderStream()
    expect(await screen.findByRole('button', { name: 'Save selected minute' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Moment page →' })).toBeNull()
    expect(screen.getByRole('link', { name: 'View saved moments →' }).getAttribute('href')).toBe('/analytics/moments?view=saved')
  })

  it('links the selected bar’s own minute, and hands the Moment over, once switched on', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    selected.minute = minute
    const view = renderStream()
    const link = await screen.findByRole('link', { name: 'Moment page →' })
    expect(link.getAttribute('href')).toBe('/analytics/moments/9000001/20261114T1040Z')
    fireEvent.click(link)
    await screen.findByText('moment page')
    expect(view.state()).toMatchObject({ from: 'stream', moment: { streamId: '9000001', momentAt: '20261114T1040Z', offsetSeconds: 2430, login: 'fakechan01', category: 'fake-pog' } })
  })

  it('offers no Moment page link when the minute has no time', async () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    selected.minute = { ...minute, at: undefined }
    renderStream()
    expect(await screen.findByTestId('analytics-console')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Moment page →' })).toBeNull()
  })
})
