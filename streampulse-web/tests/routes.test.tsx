import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '../src/routes/index'

const publicPaths = ['/', '/setup', '/docs', '/status', '/login'] as const

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

  it('redirects unauthenticated /dashboard to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: /connect streampulse/i })).toBeTruthy()
  })
})
