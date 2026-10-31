import { render, screen, waitFor, within } from '@testing-library/react'
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

/** The three plain rows, by name, with the word each shows. */
function rows() {
  const cards = [...document.querySelectorAll('.status-card')]
  return Object.fromEntries(cards.map(card => [
    card.querySelector('.status-card__label')!.textContent!,
    card.querySelector('.status-card__indicator')!.textContent!,
  ]))
}
const overall = () => screen.getByTestId('status-overall').textContent

describe('public Status', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows three plain rows, each Working, Slow or Down, and when it was checked', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'operational', components: { api: 'operational', corpus: 'degraded', coverage: 'operational' } }))
      .mockResolvedValueOnce(response({ ok: true, version: '0.2.41' })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(overall()).toBe('Slow'))
    expect(rows()).toEqual({ 'Website': 'Working', 'Live chat tracking': 'Slow', 'Twitch panel data': 'Working' })
    expect(screen.getByTestId('status-checked').textContent).toMatch(/^Checked \d{1,2}:\d{2}/)
    // No operator words on the page itself.
    const page = screen.getByTestId('status-page').cloneNode(true) as HTMLElement
    page.querySelector('[data-testid="status-details"]')?.remove()
    expect(page.textContent).not.toMatch(/IRC|Coverage Engine|Extension Ingest|Hosted API|Telemetry|Provenance|Operational|rollups|heatmaps/i)
  })

  it('reads a failing component as Down and a failing extension probe as a Down panel', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'operational', components: { api: 'operational', corpus: 'down', coverage: 'operational' } }))
      .mockResolvedValueOnce(response({}, 503)))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(overall()).toBe('Down'))
    expect(rows()).toEqual({ 'Website': 'Working', 'Live chat tracking': 'Down', 'Twitch panel data': 'Down' })
  })

  it('never reads a panel as working while its coverage is unknown', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'operational', components: { api: 'operational', corpus: 'operational' } }))
      .mockResolvedValueOnce(response({ ok: true })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('status-checked')).toBeTruthy())
    expect(rows()).toEqual({ 'Website': 'Working', 'Live chat tracking': 'Working', 'Twitch panel data': 'Unknown' })
  })

  it('keeps build and provenance facts behind a Details toggle, closed by default', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'up', updatedAt: '2026-08-01T12:00:00Z' }))
      .mockResolvedValueOnce(response({ ok: true, version: '0.2.41' })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(screen.getByTestId('status-checked')).toBeTruthy())
    const details = screen.getByTestId('status-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(within(details).getByText('Details', { selector: 'summary' })).toBeTruthy()
    expect(within(details).getByText('Portal Build')).toBeTruthy()
    expect(within(details).getByText('v1.2.3')).toBeTruthy()
    expect(within(details).getByText('API version v0.2.41')).toBeTruthy()
    expect(within(details).getByText('Public status does not expose fleet counts or packet loss')).toBeTruthy()
  })

  it('keeps an active incident in view, outside the Details toggle', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'degraded', incident: 'Chat tracking is catching up.' }))
      .mockResolvedValueOnce(response({ ok: true })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    const incident = await screen.findByText(/Chat tracking is catching up/)
    expect(incident.closest('[data-testid="status-details"]')).toBeNull()
  })

  it.each(['0001-01-01T00:00:00Z', '2099-01-01T00:00:00Z'])('rejects untrustworthy data-as-of %s', async (updatedAt) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'up', updatedAt }))
      .mockResolvedValueOnce(response({ ok: true })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(overall()).toBe('Working'))
    expect(screen.getByText('Unknown', { selector: 'dd' })).toBeTruthy()
  })

  it('keeps unavailable components unknown and normalizes API/version vocabulary', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'operational', api: 'up', degraded: false, updatedAt: 'bad-date' }))
      .mockResolvedValueOnce(response({ ok: true, version: 'vv0.2.41' })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(overall()).toBe('Working'))
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
    await waitFor(() => expect(overall()).toBe('Down'))
    expect(screen.getByText('API version v0.2.41')).toBeTruthy()
    expect(screen.getAllByText('Down').length).toBeGreaterThan(0)
    expect(screen.queryByText('Just now')).toBeNull()
  })

  it('does not report working when the extension probe fails despite a healthy public summary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ status: 'up' })).mockResolvedValueOnce(response({}, 503)))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(overall()).toBe('Down'))
    expect(screen.queryByText('Working')).toBeNull()
    expect(screen.queryByText(/Services Operational|All Systems Operational/)).toBeNull()
  })

  it('keeps source time distinct from browser completion time', async () => {
    const source = '2026-08-01T12:00:00Z'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ status: 'up', updatedAt: source })).mockResolvedValueOnce(response({ ok: true })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(overall()).toBe('Working'))
    const valueFor = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent
    expect(valueFor('Data as of')).toBe(new Date(source).toLocaleString())
    const checked = valueFor('Checked at')!
    expect(checked).not.toBe(valueFor('Data as of'))
    expect(Math.abs(Date.now() - new Date(checked).getTime())).toBeLessThan(5000)
  })

  it.each([{ v: 1 }, 2])('stays readable when the incident or API version has the wrong type (version %o)', async (version) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ status: 'up', incident: { hostile: true } }))
      .mockResolvedValueOnce(response({ ok: true, version })))
    render(<MemoryRouter><Status /></MemoryRouter>)
    await waitFor(() => expect(overall()).toBe('Working'))
    expect(screen.getByText('API version Unknown')).toBeTruthy()
    expect(screen.queryByText(/Active incident/)).toBeNull()
  })
})
