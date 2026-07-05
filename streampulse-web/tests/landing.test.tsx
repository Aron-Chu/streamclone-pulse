import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Landing from '../src/routes/public/Landing'

// Plain-function mocks (not vi.fn) so the global afterEach restoreAllMocks in
// tests/setup.ts cannot wipe their implementations between cases.
vi.mock('../src/lib/publicHub', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/publicHub')>()
  return {
    ...actual,
    fetchPublicHub: () =>
      Promise.resolve({
        data: {
          generatedAt: new Date().toISOString(),
          poolSize: 0,
          corpus: {},
          coverage: {},
          activity: { points: [], windowMinutes: 30, channelCount: 0 },
          emoteIntel: {},
          topEmotes: [],
          topMovers: [],
          liveChannels: [],
          moments: [],
        },
      }),
  }
})

vi.mock('../src/lib/publicApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/publicApi')>()
  return {
    ...actual,
    fetchPublicStats: () =>
      Promise.resolve({
        data: {
          streamsTracked: 512,
          momentsDetected: 8400,
          chatMessagesProcessed: 263_500,
          emotesIndexed: 206_600,
          vodsAnalyzed: 1280,
          updatedAt: new Date().toISOString(),
        },
      }),
  }
})

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )
}

describe('landing page', () => {
  it('renders all major sections', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })

    expect(screen.getByRole('heading', { name: /twitch sidebar/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^roadmap$/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /how it works/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: /^resources$/i })).toBeTruthy()
  })

  it('routes hero CTAs correctly', async () => {
    renderLanding()
    const heading = await screen.findByRole('heading', { name: /actually reacted to/i })
    const hero = heading.closest('section')
    expect(hero).toBeTruthy()
    const heroScope = within(hero as HTMLElement)

    expect(heroScope.getByRole('link', { name: /open analytics/i }).getAttribute('href')).toBe('/analytics')
    expect(heroScope.getByRole('link', { name: /install chrome extension/i }).getAttribute('href')).toBe('/setup')
  })

  it('exposes sign-in and install in the top nav', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const nav = screen.getByRole('navigation', { name: /primary/i })
    const navScope = within(nav)
    expect(navScope.getByRole('link', { name: /sign in/i }).getAttribute('href')).toBe('/login')
    expect(navScope.getByRole('link', { name: /install extension/i }).getAttribute('href')).toBe('/setup')
  })

  it('shows the live emote and mover tickers', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    expect(screen.getByText(/trending emotes/i)).toBeTruthy()
    expect(screen.getByText(/trending channels/i)).toBeTruthy()
  })
})
