import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../src/routes/index'

const publicPaths = ['/', '/docs', '/status'] as const

describe('route smoke', () => {
  for (const path of publicPaths) {
    it(`renders ${path}`, async () => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>,
      )
      expect(await screen.findByRole('main')).toBeTruthy()
    })
  }

  it('redirects legacy /setup to analytics', async () => {
    render(
      <MemoryRouter initialEntries={['/setup']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('main', { name: /streampulse analytics/i })).toBeTruthy()
  })

  it('redirects the legacy /login path to the public analytics hub', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    // No beta-key login screen anymore — /login lands on the public analytics hub.
    expect(await screen.findByRole('main')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: /connect streampulse/i })).toBeNull()
  })

  it('sends gated /dashboard to public analytics when there is no beta key', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutes />
      </MemoryRouter>,
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
    render(
      <MemoryRouter initialEntries={['/dashboard/clips']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: /streamPulse clips/i })).toBeTruthy()
  })
})
