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
    const { container } = renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })

    expect(container.querySelectorAll('[data-brand-mark="peak"]')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: /pulse tab, feature by feature/i })).toBeTruthy()
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
    expect(heroScope.getByRole('link', { name: /install extension/i }).getAttribute('href')).toBe('/docs#extension')
  })

  it('does not expose legacy /setup or /login nav CTAs', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    const nav = screen.getByRole('navigation', { name: /streampulse/i })
    const navScope = within(nav)
    expect(navScope.queryByRole('link', { name: /sign in/i })).toBeNull()
    expect(navScope.queryByRole('link', { name: /\/setup/i })).toBeNull()
    expect(navScope.getByRole('link', { name: /open analytics/i }).getAttribute('href')).toBe('/analytics')
  })

  it('shows the live emote and mover tickers', async () => {
    renderLanding()
    await screen.findByRole('heading', { name: /actually reacted to/i })
    expect(screen.getByText(/trending emotes/i)).toBeTruthy()
    expect(screen.getByText(/trending channels/i)).toBeTruthy()
  })
})
