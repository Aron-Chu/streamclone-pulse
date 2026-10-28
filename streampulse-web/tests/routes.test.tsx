import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../src/routes/index'

vi.mock('../src/routes/analytics/AnalyticsMomentsPage', () => ({
  default: () => <main aria-label="Moments">Moments route</main>,
}))
vi.mock('../src/routes/analytics/ChannelAnalyticsPage', () => ({
  default: () => <main aria-label="Stream page">Stream route</main>,
}))

const publicPaths = ['/', '/docs', '/status', '/privacy'] as const

function LocationProbe() {
  const { pathname, search, hash } = useLocation()
  return <><span data-testid="pathname">{pathname}</span><span data-testid="location">{pathname}{search}{hash}</span></>
}

function renderPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <AppRoutes />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  sessionStorage.clear()
})

describe('route smoke', () => {
  it.each(['/setup', '/login', '/analytics/hub', '/analytics/emotes', '/atlas', '/analytics/streams'])('preserves query/hash on %s compatibility redirects', async path => {
    renderPath(`${path}?range=24h#section-emote-signal`)
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/analytics?range=24h#section-emote-signal'))
  })
  for (const path of publicPaths) {
    it(`renders ${path}`, async () => {
      renderPath(path)
      expect(await screen.findByRole('main')).toBeTruthy()
      expect(screen.getByTestId('pathname').textContent).toBe(path)
    })
  }

  describe('retired Pulse Explorer', () => {
    it.each([
      ['/analytics/explore', '/analytics/moments', 'Moments'],
      ['/analytics/explore?window=7d&signal=emotes&state=ended&sort=recent&q=chat#evidence', '/analytics/moments', 'Moments'],
      ['/analytics/explore/pulse-xqc-session-1?window=7d&signal=emotes&state=ended#evidence', '/analytics/xqc/session-1', 'Stream page'],
      ['/analytics/explore/story-1?window=live', '/analytics/moments', 'Moments'],
      ['/analytics/explore/pulse-settings-123', '/analytics/moments', 'Moments'],
      ['/analytics/newsroom?window=24h#evidence', '/analytics/moments', 'Moments'],
      ['/analytics/newsroom/pulse-lirik-315123?window=live', '/analytics/lirik/315123', 'Stream page'],
      ['/analytics/newsroom/story-xqc?window=live#keep', '/analytics/moments', 'Moments'],
    ])('sends %s to %s without its old filters', async (path, target, page) => {
      renderPath(path)
      await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(target))
      expect(await screen.findByRole('main', { name: page })).toBeTruthy()
    })
  })

  it('redirects legacy /setup to analytics', async () => {
    renderPath('/setup')
    // Navigate can resolve after the initial MemoryRouter entry; wait for settlement.
    await waitFor(
      () => {
        expect(screen.getByTestId('pathname').textContent).toBe('/analytics')
      },
      { timeout: 10_000 },
    )
    expect(
      await screen.findByRole('main', { name: /streampulse analytics/i }, { timeout: 10_000 }),
    ).toBeTruthy()
  })

  it('redirects the legacy /login path to the public analytics hub', async () => {
    renderPath('/login')
    await waitFor(
      () => {
        expect(screen.getByTestId('pathname').textContent).toBe('/analytics')
      },
      { timeout: 10_000 },
    )
    // No beta-key login screen anymore — /login lands on the public analytics hub.
    expect(await screen.findByRole('main', { name: /streampulse analytics/i }, { timeout: 10_000 })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /connect streampulse/i })).toBeNull()
  })

  it.each(['/dashboard', '/dashboard/clips'])('answers the removed %s page with the 404, even with an old beta key saved', async path => {
    localStorage.setItem('sp.betaKey', 'secret-one')
    renderPath(path)
    expect(await screen.findByTestId('not-found')).toBeTruthy()
    expect(screen.getByTestId('pathname').textContent).toBe(path)
  })
})
