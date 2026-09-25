import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../src/routes/index'

vi.mock('../src/routes/analytics/AnalyticsExplorerPage', () => ({
  default: () => <main aria-label="Pulse Explorer">Explorer route</main>,
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

  describe('Pulse Explorer', () => {
    it.each(['/analytics/explore', '/analytics/explore/pulse-xqc-session-1?window=7d&signal=emotes&state=ended#evidence'])('keeps the Explorer route and its deep-link context at %s', async path => {
      renderPath(path)
      expect(await screen.findByRole('main', { name: 'Pulse Explorer' })).toBeTruthy()
      expect(screen.getByTestId('location').textContent).toBe(path)
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

  it('sends gated /dashboard to public analytics when there is no beta key', async () => {
    renderPath('/dashboard')
    await waitFor(
      () => {
        expect(screen.getByTestId('pathname').textContent).toBe('/analytics')
      },
      { timeout: 10_000 },
    )
    expect(await screen.findByRole('main')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /connect streampulse/i })).toBeNull()
  })

  it('renders private clips dashboard when there is a beta key', async () => {
    localStorage.setItem('sp.betaKey', 'secret-one')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })),
    )
    renderPath('/dashboard/clips')
    expect(await screen.findByRole('heading', { name: /streamPulse clips/i })).toBeTruthy()
  })
})
