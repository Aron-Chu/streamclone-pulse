import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LegacyMomentSession from '../src/routes/analytics/LegacyMomentSession'

const newsroom = vi.hoisted(() => ({
  data: null as null | { status: string; story: { id: string; login: string; streamId: string } },
  loading: false,
  refresh: vi.fn(),
}))

vi.mock('../src/hooks/useNewsroomData', () => ({ useNewsroomData: () => newsroom }))
vi.mock('../src/ui/components/analytics/AnalyticsFigmaShell', () => ({
  AnalyticsFigmaShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

function LocationProbe() {
  const { pathname, search, hash } = useLocation()
  return <output data-testid="location">{pathname}{search}{hash}</output>
}

function renderPath(path: string) {
  render(<MemoryRouter initialEntries={[path]}>
    <LocationProbe />
    <Routes>
      <Route path="/analytics/moments" element={<LegacyMomentSession />} />
      <Route path="/analytics/:login/:streamId" element={<div>Broadcast</div>} />
      <Route path="/analytics/explore/*" element={<div>Explorer</div>} />
    </Routes>
  </MemoryRouter>)
}

afterEach(() => {
  cleanup()
  newsroom.data = null
  newsroom.refresh.mockClear()
})

describe('legacy Moments story resolution', () => {
  it('preserves browse context and hash in the broadcast return destination', async () => {
    newsroom.data = { status: 'ready', story: { id: 'story-1', login: 'forsen', streamId: '123' } }
    renderPath('/analytics/moments?view=sessions&story=story-1&window=7d&category=VALORANT&q=chat&creator=forsen&month=2026-09&login=forsen&stream=123&offset=120#evidence')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/analytics/forsen/123?'))
    const url = new URL(screen.getByTestId('location').textContent!, 'https://portal.invalid')
    expect(url.hash).toBe('#t=120')
    expect(url.searchParams.get('returnTo')).toBe('/analytics/explore/story-1?window=7d&category=VALORANT&q=chat#evidence')
  })

  it('does not carry an offset for a different broadcast identity', async () => {
    newsroom.data = { status: 'ready', story: { id: 'story-1', login: 'forsen', streamId: '123' } }
    renderPath('/analytics/moments?view=sessions&story=story-1&login=xqc&stream=other&offset=120#evidence')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/analytics/forsen/123?'))
    const url = new URL(screen.getByTestId('location').textContent!, 'https://portal.invalid')
    expect(url.hash).toBe('')
    expect(url.searchParams.get('returnTo')).toBe('/analytics/explore/story-1#evidence')
  })

  it('does not reinterpret an empty legacy offset as the start of the broadcast', async () => {
    newsroom.data = { status: 'ready', story: { id: 'story-1', login: 'forsen', streamId: '123' } }
    renderPath('/analytics/moments?view=sessions&story=story-1&login=forsen&stream=123&offset=#evidence')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/analytics/forsen/123?'))
    const url = new URL(screen.getByTestId('location').textContent!, 'https://portal.invalid')
    expect(url.hash).toBe('')
    expect(url.searchParams.get('returnTo')).toBe('/analytics/explore/story-1#evidence')
  })

  it('keeps the unresolved URL and offers a context-preserving Explorer fallback', () => {
    const path = '/analytics/moments?view=sessions&story=missing&window=24h&category=VALORANT#evidence'
    renderPath(path)
    expect(screen.getByTestId('location').textContent).toBe(path)
    expect(screen.getByRole('link', { name: 'Browse Pulse Explorer' }).getAttribute('href'))
      .toBe('/analytics/explore?window=24h&category=VALORANT#evidence')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
  it('routes a bare retired Sessions bookmark to Pulse Explorer', async () => {
    renderPath('/analytics/moments?view=sessions&window=live#evidence')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/analytics/explore?window=live#evidence'))
  })
})
