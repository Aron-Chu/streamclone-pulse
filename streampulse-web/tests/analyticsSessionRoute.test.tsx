import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppRoutes } from '../src/routes/index'

describe('analytics session route smoke', () => {
  it('redirects unauthenticated /analytics/xqc/s/123 to login', async () => {
    render(
      <MemoryRouter initialEntries={['/analytics/xqc/s/123']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: /connect streampulse/i })).toBeTruthy()
  })
})
