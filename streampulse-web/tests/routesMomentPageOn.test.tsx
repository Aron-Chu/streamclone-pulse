import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The route reads its build flag when the routes module loads, so the flag is
// set before anything is imported (tests/routes.test.tsx covers the flag off).
vi.hoisted(() => { vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on') })

import { AppRoutes } from '../src/routes/index'
import { resetMomentReads } from '../src/lib/momentReads'

vi.mock('../src/routes/analytics/MomentWatchPage', () => ({ default: () => <main aria-label="Moment page">Moment route</main> }))
vi.mock('../src/routes/analytics/ChannelAnalyticsPage', () => ({ default: () => <main aria-label="Stream page">Stream route</main> }))

// The route starts the Moment's reads as it mounts; they stay unanswered here.
let reads: string[] = []
beforeEach(() => {
  reads = []
  resetMomentReads()
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    reads.push(new URL(String(input), 'http://localhost').pathname)
    return new Promise<Response>(() => {})
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
afterAll(() => { vi.unstubAllEnvs() })

describe('Moment page address with the flag on', () => {
  it.each(['/analytics/moments/9000001/20261114T2031Z', '/analytics/moments/9000001/20261114T2031Z/'])('%s mounts the Moment page, not NotFound', async path => {
    render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)
    expect(await screen.findByRole('main', { name: 'Moment page' })).toBeTruthy()
    expect(screen.queryByTestId('not-found')).toBeNull()
  })

  it('starts the stream and recap reads as the route mounts, beside the page code, once', async () => {
    render(<MemoryRouter initialEntries={['/analytics/moments/9000001/20261114T2031Z']}><AppRoutes /></MemoryRouter>)
    await screen.findByRole('main', { name: 'Moment page' })
    expect(reads.filter(path => path.includes('/analytics/streams/')).sort())
      .toEqual(['/v1/portal/analytics/streams/9000001', '/v1/portal/analytics/streams/9000001/recap'])
  })

  it('warms once per address: a re-render asks nothing again, the next Moment warms its own', async () => {
    function Next() {
      const navigate = useNavigate()
      return <button type="button" onClick={() => navigate('/analytics/moments/9000002/20261114T2040Z')}>Next</button>
    }
    const tree = () => <MemoryRouter initialEntries={['/analytics/moments/9000001/20261114T2031Z']}><AppRoutes /><Next /></MemoryRouter>
    const { rerender } = render(tree())
    await screen.findByRole('main', { name: 'Moment page' })
    const streamReads = () => reads.filter(path => path.includes('/analytics/streams/')).sort()
    expect(streamReads()).toEqual(['/v1/portal/analytics/streams/9000001', '/v1/portal/analytics/streams/9000001/recap'])
    // Forget what the reads hold, so only another warm from the route could ask again.
    resetMomentReads()
    rerender(tree())
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(streamReads()).toHaveLength(2)
    screen.getByRole('button', { name: 'Next' }).click()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(streamReads()).toEqual(['/v1/portal/analytics/streams/9000001', '/v1/portal/analytics/streams/9000001/recap',
      '/v1/portal/analytics/streams/9000002', '/v1/portal/analytics/streams/9000002/recap'])
  })

  it('reads nothing for an address that is not a Moment', async () => {
    render(<MemoryRouter initialEntries={['/analytics/moments/not-a-stream/20261114T2031Z']}><AppRoutes /></MemoryRouter>)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reads.filter(path => path.includes('/analytics/streams/'))).toEqual([])
  })
})
