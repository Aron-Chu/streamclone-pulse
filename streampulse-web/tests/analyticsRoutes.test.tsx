import { render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation, useParams } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@streampulse/analytics-console', () => ({
  configureAnalyticsApi: vi.fn(),
  configureEmoteAssetBase: vi.fn(),
  AnalyticsConsole: ({
    mode,
    showGameSegments,
  }: {
    mode?: string
    showGameSegments?: boolean
  }) => {
    const { streamId } = useParams<{ login: string; streamId?: string }>()
    // The real console renders no <main>; ConsoleChannelView owns the landmark.
    return (
      <div>
        <span data-testid="console-mode">{mode ?? 'internal'}</span>
        <span data-testid="show-game-segments">{String(showGameSegments)}</span>
        <span data-testid="stream-id">{streamId ?? ''}</span>
      </div>
    )
  },
}))

import { AppRoutes } from '../src/routes/index'

function LocationProbe() {
  const { pathname } = useLocation()
  return <span data-testid="pathname">{pathname}</span>
}

function renderPath(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('public channel analytics routes', () => {
  it('renders the shared console in public mode for /analytics/:channel', async () => {
    renderPath('/analytics/xqc')
    expect(await screen.findByRole('main', { name: /analytics for xqc/i })).toBeTruthy()
    expect(screen.getByTestId('console-mode').textContent).toBe('public')
    expect(screen.getByTestId('show-game-segments').textContent).toBe('true')
    expect(screen.getByTestId('stream-id').textContent).toBe('')
  })

  it('renders the same console for the canonical /analytics/:channel/:streamId', async () => {
    renderPath('/analytics/xqc/12345')
    expect(await screen.findByRole('main', { name: /analytics for xqc/i })).toBeTruthy()
    expect(screen.getByTestId('stream-id').textContent).toBe('12345')
    expect(screen.getByTestId('console-mode').textContent).toBe('public')
    expect(screen.getByTestId('show-game-segments').textContent).toBe('true')
  })

  it('redirects the legacy /analytics/:channel/s/:streamId alias to the canonical route', async () => {
    renderPath('/analytics/xqc/s/12345')
    expect(await screen.findByRole('main', { name: /analytics for xqc/i })).toBeTruthy()
    expect(screen.getByTestId('pathname').textContent).toBe('/analytics/xqc/12345')
    expect(screen.getByTestId('stream-id').textContent).toBe('12345')
  })

  it('redirects short /s/:login to canonical analytics and preserves query/hash', async () => {
    renderPath('/s/xqc?ref=share#t=120')
    expect(await screen.findByRole('main', { name: /analytics for xqc/i })).toBeTruthy()
    expect(screen.getByTestId('pathname').textContent).toBe('/analytics/xqc')
  })

  it('redirects short /s/:login/:streamId to canonical session route', async () => {
    renderPath('/s/xqc/12345?utm=1#t=90')
    expect(await screen.findByRole('main', { name: /analytics for xqc/i })).toBeTruthy()
    expect(screen.getByTestId('pathname').textContent).toBe('/analytics/xqc/12345')
    expect(screen.getByTestId('stream-id').textContent).toBe('12345')
  })

  it('keeps unknown paths on NotFound', async () => {
    renderPath('/definitely-missing-path')
    expect(await screen.findByText(/not found/i)).toBeTruthy()
  })
})
