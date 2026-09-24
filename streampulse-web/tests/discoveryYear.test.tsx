import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { normalizeDiscoveryYear } from '../src/lib/discoveryYear'
import { DiscoveryYearOverview as YearOverview } from '../src/ui/components/moments/DiscoveryYearOverview'
import { discoveryOverviewYears, readDiscoveryPresentation } from '../src/lib/discoveryPresentation'
import { apiClient } from '../src/lib/apiClient'
vi.mock('../src/lib/apiClient', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/apiClient')>(), apiClient: vi.fn() }))

function DiscoveryYearOverview({ initialYear, creator, onDay, years = 1 }: { initialYear: string; creator: string; onDay: (day: string) => void; years?: 1 | 3 }) {
  const [params, setParams] = React.useState(() => new URLSearchParams({ year: initialYear, years: String(years), calendar: 'year' }))
  return <YearOverview presentation={readDiscoveryPresentation(params, '2024-01')} creator={creator} onDay={onDay} onChange={values => setParams(previous => {
    const next = new URLSearchParams(previous)
    for (const [key, value] of Object.entries(values)) value == null ? next.delete(key) : next.set(key, value)
    return next
  })} />
}

function fixture(year = '2024', login = '', detections?: number) {
  const start = Date.UTC(Number(year), 0, 1)
  const count = (Date.UTC(Number(year) + 1, 0, 1) - start) / 86400000
  return { schemaVersion: 1, scope: 'indexed_public_irc_streams', calendarScope: 'year_and_creator_only', year, login, state: 'ready',
    asOf: '2026-09-05T12:00:00Z', dataThrough: null, projectionUpdatedAt: null, items: [] as unknown[],
    days: Array.from({ length: count }, (_, i) => ({ day: new Date(start + i * 86400000).toISOString().slice(0, 10), state: i === 0 && detections !== undefined ? 'measured' : 'no_measurement', coverage: i === 0 && detections !== undefined ? 'partial' : 'none', streams: i === 0 && detections !== undefined ? 1 : 0, measuredStreamMinutes: i === 0 && detections !== undefined ? 200 : 0, chatMessages: i === 0 && detections !== undefined ? 10000 : null, emoteUses: i === 0 && detections !== undefined ? 100 : null, detections: i === 0 && detections !== undefined ? detections : null })) }
}
function monthFixture(month: string, login = '', measuredDay = '', detections = 0, state: 'ready' | 'unavailable' = 'ready') {
  const [year, number] = month.split('-').map(Number)
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate()
  return { schemaVersion: 1, scope: 'indexed_public_irc_streams', calendarScope: 'month_and_creator_only', month, login, state,
    asOf: '2026-09-05T12:00:00Z', dataThrough: null, projectionUpdatedAt: null, items: [] as unknown[],
    days: Array.from({ length: count }, (_, i) => { const day = `${month}-${String(i + 1).padStart(2, '0')}`; const measured = day === measuredDay; return {
      day, state: measured ? 'measured' : 'no_measurement', coverage: measured ? 'partial' : 'none', streams: measured ? 1 : 0,
      measuredStreamMinutes: measured ? 60 : 0, chatMessages: measured ? 100 : null, emoteUses: measured ? 50 : null, detections: measured ? detections : null,
    } }) }
}
afterEach(() => { cleanup(); vi.resetAllMocks() })
describe('year activity contract', () => {
  it('normalizes URL display choices and bounds comparative reads to three real years', () => {
    expect(readDiscoveryPresentation(new URLSearchParams('calendar=year&year=2024&years=3&measure=emoteUses'), '2026-09')).toEqual({ mode: 'year', year: '2024', years: 3, measure: 'emoteUses' })
    expect(readDiscoveryPresentation(new URLSearchParams('calendar=unknown&year=9999&years=99&measure=score'), '2024-05')).toEqual({ mode: 'month', year: '2024', years: 1, measure: 'detections' })
    expect(discoveryOverviewYears('2024', 3)).toEqual(['2022', '2023', '2024'])
    expect(discoveryOverviewYears('2011', 3)).toEqual(['2011'])
    expect(discoveryOverviewYears('2012', 3)).toEqual(['2011', '2012'])
    expect(discoveryOverviewYears('9999', 3)).toEqual([])
  })
  it('uses one scale across three years and does not refetch when the measure changes', async () => {
    const api = vi.mocked(apiClient)
    api.mockImplementation(async path => {
      const year = new URL(String(path), 'https://test.invalid').searchParams.get('year')!
      return { data: fixture(year, '', year === '2024' ? 100 : 10), status: 200 }
    })
    render(<DiscoveryYearOverview initialYear="2024" years={3} creator="" onDay={() => {}} />)
    const lower = await screen.findByRole('button', { name: /^2022-01-01:/ })
    expect(lower.getAttribute('data-level')).toBe('1')
    expect(screen.getByRole('button', { name: /^2024-01-01:/ }).getAttribute('data-level')).toBe('4')
    expect(api).toHaveBeenCalledTimes(3)
    expect(api.mock.calls.map(([path]) => new URL(String(path), 'https://test.invalid').searchParams.get('year'))).toEqual(['2022', '2023', '2024'])
    fireEvent.change(screen.getByRole('combobox', { name: 'Year activity measure' }), { target: { value: 'emoteUses' } })
    expect(lower.getAttribute('data-level')).toBe('4')
    expect(api).toHaveBeenCalledTimes(3)
  })
  it('keeps an unavailable year distinct from measured zero and prevents opening its dates', async () => {
    vi.mocked(apiClient).mockImplementation(async path => {
      const year = new URL(String(path), 'https://test.invalid').searchParams.get('year')!
      if (year === '2023') throw new Error('unavailable')
      return { data: fixture(year, '', 0), status: 200 }
    })
    render(<DiscoveryYearOverview initialYear="2024" years={3} creator="" onDay={() => {}} />)
    await screen.findByRole('button', { name: 'Retry year overview' })
    expect(screen.queryByRole('button', { name: /^2023-01-01:/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^2022-01-01:/ }).getAttribute('data-level')).toBe('0')
    fireEvent.change(screen.getByLabelText('Year overview day'), { target: { value: '2023-01-01' } })
    expect((screen.getByRole('button', { name: 'Open day' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('does not paint empty-year cells when the server is unavailable', async () => {
    vi.mocked(apiClient).mockRejectedValue(new Error('503'))
    render(<DiscoveryYearOverview initialYear="2024" creator="" onDay={() => {}} />)
    await screen.findByRole('button', { name: 'Retry year overview' })
    expect(screen.queryByRole('button', { name: /^2024-01-01:/ })).toBeNull()
  })
  it('validates a complete leap year and rejects events, scope leakage and fabricated days', () => {
    expect(normalizeDiscoveryYear(fixture(), '2024', '').days[59].day).toBe('2024-02-29')
    for (const mutate of [
      (b: ReturnType<typeof fixture>) => { b.days.pop() },
      (b: ReturnType<typeof fixture>) => { b.items.push({ id: 'private-or-public-event' }) },
      (b: ReturnType<typeof fixture>) => { b.login = 'other' },
      (b: ReturnType<typeof fixture>) => { b.calendarScope = 'month_and_creator_only' },
      (b: ReturnType<typeof fixture>) => { b.days[0].day = '2024-02-01' },
    ]) { const body = fixture(); mutate(body); expect(() => normalizeDiscoveryYear(body, '2024', '')).toThrow() }
  })
  it('aborts an old creator read and prevents late results replacing the active scope', async () => {
    const api = vi.mocked(apiClient)
    let finish: (value: any) => void = () => {}
    api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    api.mockResolvedValueOnce({ data: fixture('2024', 'other'), status: 200 })
    const { rerender } = render(<DiscoveryYearOverview initialYear="2024" creator="first" onDay={() => {}} />)
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    const oldSignal = api.mock.calls[0][1]?.signal
    rerender(<DiscoveryYearOverview initialYear="2024" creator="other" onDay={() => {}} />)
    await waitFor(() => expect(screen.getByText(/@other/)).toBeTruthy())
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { finish({ data: fixture('2024', 'first'), status: 200 }); await Promise.resolve() })
    expect(screen.queryByText(/@first/)).toBeNull()
  })
  it('cancels the rest of an obsolete multi-year batch without overwriting the new creator', async () => {
    let finish: (value: any) => void = () => {}
    const api = vi.mocked(apiClient)
    api.mockImplementation(async path => {
      const params = new URL(String(path), 'https://test.invalid').searchParams
      if (params.get('login') === 'first') return new Promise(resolve => { finish = resolve })
      return { data: fixture(params.get('year')!, 'other', 30), status: 200 }
    })
    const { rerender } = render(<DiscoveryYearOverview initialYear="2024" years={3} creator="first" onDay={() => {}} />)
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    const oldSignal = api.mock.calls[0][1]?.signal
    rerender(<DiscoveryYearOverview initialYear="2024" years={3} creator="other" onDay={() => {}} />)
    const day = await screen.findByRole('button', { name: /^2022-01-01:.*30 detections/ })
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { finish({ data: fixture('2022', 'first', 100), status: 200 }); await Promise.resolve() })
    expect(day.getAttribute('aria-label')).toContain('30 detections')
    expect(api).toHaveBeenCalledTimes(4)
    expect(api.mock.calls.filter(([path]) => String(path).includes('login=first'))).toHaveLength(1)
  })
  it('uses one keyboard tab stop, preserves exact day and changes measure without another fetch', async () => {
    const api = vi.mocked(apiClient)
    api.mockResolvedValue({ data: fixture(), status: 200 })
    const onDay = vi.fn()
    render(<DiscoveryYearOverview initialYear="2024" creator="" onDay={onDay} />)
    const day = await screen.findByRole('button', { name: /^2024-01-01:/ })
    expect(day.tabIndex).toBe(0)
    fireEvent.keyDown(day, { key: 'ArrowRight' })
    const next = screen.getByRole('button', { name: /^2024-01-08:/ })
    expect(next.tabIndex).toBe(0); expect(document.activeElement).toBe(next)
    fireEvent.click(next); expect(onDay).toHaveBeenCalledWith('2024-01-08')
    fireEvent.change(screen.getByRole('combobox', { name: 'Year activity measure' }), { target: { value: 'emoteUses' } })
    expect(api).toHaveBeenCalledTimes(1)
  })
  it('loads only clipped months with one catalogue item each, including a three-month February crossing', async () => {
    const api = vi.mocked(apiClient)
    api.mockImplementation(async path => {
      const month = new URL(String(path), 'https://test.invalid').searchParams.get('month')!
      return { data: monthFixture(month, '', '2026-02-01', 7), status: 200 }
    })
    render(<YearOverview presentation={{ mode: 'year', year: '2026', years: 1, measure: 'detections' }} creator="" compact
      visibleFrom="2026-01-31" visibleTo="2026-03-01" onChange={() => {}} onDay={() => {}} />)
    await screen.findByRole('button', { name: /^2026-02-01:.*7 detections/ })
    expect(screen.queryByRole('button', { name: /^2026-01-30:/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^2026-03-02:/ })).toBeNull()
    expect(api.mock.calls.map(([path]) => new URL(String(path), 'https://test.invalid').search)).toEqual([
      '?month=2026-01&limit=1', '?month=2026-02&limit=1', '?month=2026-03&limit=1',
    ])
  })
  it('hides the whole recent heatmap when a month cannot be verified, without painting quiet days', async () => {
    vi.mocked(apiClient).mockImplementation(async path => {
      const month = new URL(String(path), 'https://test.invalid').searchParams.get('month')!
      return { data: monthFixture(month, '', month === '2026-08' ? '2026-08-31' : '', 5, month === '2026-09' ? 'unavailable' : 'ready'), status: 200 }
    })
    render(<YearOverview presentation={{ mode: 'year', year: '2026', years: 1, measure: 'detections' }} creator="" compact
      visibleFrom="2026-08-31" visibleTo="2026-09-02" onChange={() => {}} onDay={() => {}} />)
    await screen.findByText(/No indexed activity is available for this recent range/)
    expect(screen.queryByRole('button', { name: /^2026-08-31:/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^2026-09-01:/ })).toBeNull()
  })
  it('rejects oversized recent windows without requesting a full year or any catalogue month', async () => {
    render(<YearOverview presentation={{ mode: 'year', year: '2026', years: 1, measure: 'detections' }} creator="" compact
      visibleFrom="2026-01-01" visibleTo="2026-03-01" onChange={() => {}} onDay={() => {}} />)
    await screen.findByText('The recent date range could not be verified.')
    expect(apiClient).not.toHaveBeenCalled()
  })
})
