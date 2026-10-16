import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom'
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

/** Mirrors AnalyticsMomentsPage: only ?view=sessions opens the legacy resolver. */
function MomentsRoute() {
  const [params] = useSearchParams()
  return params.get('view') === 'sessions' ? <LegacyMomentSession /> : <div>Moments</div>
}

function renderPath(path: string) {
  render(<MemoryRouter initialEntries={[path]}>
    <LocationProbe />
    <Routes>
      <Route path="/analytics/moments" element={<MomentsRoute />} />
      <Route path="/analytics/:login/:streamId" element={<div>Broadcast</div>} />
    </Routes>
  </MemoryRouter>)
}

afterEach(() => {
  cleanup()
  newsroom.data = null
  newsroom.refresh.mockClear()
})

describe('legacy Moments story resolution', () => {
  it('opens the resolved broadcast at its offset with Moments as the way back', async () => {
    newsroom.data = { status: 'ready', story: { id: 'story-1', login: 'forsen', streamId: '123' } }
    renderPath('/analytics/moments?view=sessions&story=story-1&window=7d&category=VALORANT&q=chat&creator=forsen&month=2026-09&login=forsen&stream=123&offset=120#evidence')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/analytics/forsen/123?'))
    const url = new URL(screen.getByTestId('location').textContent!, 'https://portal.invalid')
    expect(url.hash).toBe('#t=120')
    expect(url.searchParams.get('returnTo')).toBe('/analytics/moments')
  })

  it('does not carry an offset for a different broadcast identity', async () => {
    newsroom.data = { status: 'ready', story: { id: 'story-1', login: 'forsen', streamId: '123' } }
    renderPath('/analytics/moments?view=sessions&story=story-1&login=xqc&stream=other&offset=120#evidence')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/analytics/forsen/123?'))
    const url = new URL(screen.getByTestId('location').textContent!, 'https://portal.invalid')
    expect(url.hash).toBe('')
    expect(url.searchParams.get('returnTo')).toBe('/analytics/moments')
  })

  it('does not reinterpret an empty legacy offset as the start of the broadcast', async () => {
    newsroom.data = { status: 'ready', story: { id: 'story-1', login: 'forsen', streamId: '123' } }
    renderPath('/analytics/moments?view=sessions&story=story-1&login=forsen&stream=123&offset=#evidence')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain('/analytics/forsen/123?'))
    const url = new URL(screen.getByTestId('location').textContent!, 'https://portal.invalid')
    expect(url.hash).toBe('')
    expect(url.searchParams.get('returnTo')).toBe('/analytics/moments')
  })

  it('keeps the unresolved URL and offers Moments instead of the retired Explorer', () => {
    const path = '/analytics/moments?view=sessions&story=missing&window=24h&category=VALORANT#evidence'
    renderPath(path)
    expect(screen.getByTestId('location').textContent).toBe(path)
    expect(screen.getByRole('link', { name: 'Browse moments' }).getAttribute('href')).toBe('/analytics/moments')
    expect(screen.queryByRole('link', { name: /Pulse Explorer/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('routes a bare retired Sessions bookmark to Moments', async () => {
    renderPath('/analytics/moments?view=sessions&window=live#evidence')
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/analytics/moments'))
    expect(screen.getByText('Moments')).toBeTruthy()
  })
})
