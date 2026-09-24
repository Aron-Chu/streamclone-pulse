import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Status from '../src/routes/public/Status'

vi.mock('../src/lib/apiClient', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/apiClient')>(),
  getBackendUrl: () => 'https://api.streampulse.stream',
}))
vi.mock('../src/lib/sentry', () => ({ portalReleaseShort: () => 'v1.2.3' }))

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

describe('public Status', () => {
  beforeEach(() => vi.restoreAllMocks())

  it.each(['0001-01-01T00:00:00Z', '2099-01-01T00:00:00Z'])('rejects untrustworthy data-as-of %s', async (updatedAt) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'up', updatedAt }))
      .mockResolvedValueOnce(response({ ok: true })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Reported Services Operational')).toBeTruthy())
    expect(screen.getByText('Unknown', { selector: 'dd' })).toBeTruthy()
  })

  it('keeps unavailable components unknown and normalizes API/version vocabulary', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'operational', api: 'up', degraded: false, updatedAt: 'bad-date' }))
      .mockResolvedValueOnce(response({ ok: true, version: 'vv0.2.41' })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Reported Services Operational')).toBeTruthy())
    expect(screen.getByText('API version v0.2.41')).toBeTruthy()
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Public status does not expose fleet counts or packet loss')).toBeTruthy()
    expect(screen.queryByText(/500\/500|0% packet loss/i)).toBeNull()
    expect(screen.getByText('Unknown', { selector: 'dd' })).toBeTruthy()
  })

  it('preserves partial probe success instead of fabricating healthy defaults', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ ok: true, version: '0.2.41' })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Status Unavailable')).toBeTruthy())
    expect(screen.getByText('API version v0.2.41')).toBeTruthy()
    expect(screen.getAllByText('Unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByText('Just now')).toBeNull()
  })

  it('does not report operational when the extension probe fails despite a healthy public summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ status: 'up' })).mockResolvedValueOnce(response({}, 503)))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Status Unavailable')).toBeTruthy())
    expect(screen.queryByText(/Services Operational|All Systems Operational/)).toBeNull()
  })

  it('keeps source time distinct from browser completion time', async () => {
    const source = '2026-08-01T12:00:00Z'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ status: 'up', updatedAt: source })).mockResolvedValueOnce(response({ ok: true })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Reported Services Operational')).toBeTruthy())
    const valueFor = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
    expect(valueFor('Data as of')).toBe(new Date(source).toLocaleString())
    const checked = valueFor('Checked at')!
    expect(checked).not.toBe(valueFor('Data as of'))
    expect(Math.abs(Date.now() - new Date(checked).getTime())).toBeLessThan(5000)
  })
})
