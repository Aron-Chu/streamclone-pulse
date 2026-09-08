import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, cleanup, render, screen, fireEvent, renderHook, waitFor } from '@testing-library/react'
import { fetchDiscoveryCatalogue, normalizeDiscoveryCatalogue, validDiscoveryScope, type DiscoveryScope } from '../src/lib/discoveryCatalogue'
import { DiscoveryCalendar, discoveryDayLabel } from '../src/ui/components/moments/DiscoveryCalendar'
import { useDiscoveryCatalogue } from '../src/hooks/useDiscoveryCatalogue'
import { readDiscoveryPresentation } from '../src/lib/discoveryPresentation'
import { apiClient } from '../src/lib/momentsApiClient'
vi.mock('../src/lib/momentsApiClient', () => ({ apiClient: vi.fn() }))
const scope = { month: '2026-09', creator: '', day: '' }
export function catalogueFixture(creator = 'creator', offset = 60) {
  return { schemaVersion: 1, state: 'ready', scope: 'indexed_public_irc_streams', calendarScope: 'month_and_creator_only', month: '2026-09',
    asOf: '2026-09-05T12:00:00Z', projectionUpdatedAt: '2026-09-05T11:59:00Z', dataThrough: '2026-09-05T11:58:00Z',
    days: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, state: i === 0 ? 'measured' : 'no_measurement', coverage: i === 0 ? 'partial' : 'none',
      streams: i === 0 ? 1 : 0, measuredStreamMinutes: i === 0 ? 4 : 0, chatMessages: i === 0 ? 0 : null, emoteUses: i === 0 ? 0 : null, detections: i === 0 ? 0 : null })),
    items: [{ id: `dm_${offset.toString(16).padStart(32, '0')}`, login: creator, streamId: '123', offsetSeconds: offset, at: Date.parse('2026-09-01T00:00:00Z') + offset * 1000,
      label: 'Chat spike', chatPerMin: 5, emotesPerMin: 3, source: 'stored_irc', revision: 1, categorySource: 'measured_segment', category: 'Minecraft', topEmotes: [{ name: 'LOL', provider: '7tv', count: 2 }] }], nextCursor: '' }
}
function setFixtureArchiveArtwork(raw: ReturnType<typeof catalogueFixture>, archiveArtwork: unknown) {
  ;(raw.items[0] as typeof raw.items[number] & { archiveArtwork?: unknown }).archiveArtwork = archiveArtwork
}
function setFixtureCategoryMetadata(raw: ReturnType<typeof catalogueFixture>, categoryId: unknown, boxArtUrl: unknown) {
  const item = raw.items[0] as typeof raw.items[number] & { categoryId?: unknown; boxArtUrl?: unknown }
  item.categoryId = categoryId
  item.boxArtUrl = boxArtUrl
}
function renderCalendar(raw: ReturnType<typeof catalogueFixture>) {
  render(<DiscoveryCalendar scope={scope} data={normalizeDiscoveryCatalogue(raw, scope)} loading={false} onChange={() => {}} onRecent={() => {}}
    presentation={readDiscoveryPresentation(new URLSearchParams(), scope.month)} onPresentationChange={() => {}} />)
}
afterEach(() => { cleanup(); vi.resetAllMocks() })
describe('stored discovery contract', () => {
  it('presents ready stored activity with the two supplied collection timestamps', () => {
    renderCalendar(catalogueFixture())
    const status = screen.getByRole('region', { name: 'Collection status' })
    expect(status.textContent).toContain('Stored results ready')
    expect(status.textContent).toContain('Indexed tracked broadcasts · partial coverage')
    expect(status.querySelector('time[datetime="2026-09-05T11:59:00Z"]')).not.toBeNull()
    expect(status.querySelector('time[datetime="2026-09-05T11:58:00Z"]')).not.toBeNull()
  })
  it('presents the stale state and preserves the existing stale warning', () => {
    const raw = catalogueFixture()
    raw.state = 'stale'
    renderCalendar(raw)
    expect(screen.getByRole('region', { name: 'Collection status' }).textContent).toContain('May be stale')
    expect(screen.getByText(/Stored results may be stale\. Oldest projection check:/)).toBeTruthy()
  })
  it('labels null collection timestamps as unavailable', () => {
    const raw = catalogueFixture()
    raw.projectionUpdatedAt = null as unknown as string
    raw.dataThrough = null as unknown as string
    renderCalendar(raw)
    const status = screen.getByRole('region', { name: 'Collection status' })
    expect(status.querySelectorAll('dd')).toHaveLength(2)
    expect(status.querySelectorAll('dd')[0].textContent).toBe('Unavailable')
    expect(status.querySelectorAll('dd')[1].textContent).toBe('Unavailable')
  })
  it('states that the latest supplied measurement is not contiguous completeness', () => {
    renderCalendar(catalogueFixture())
    expect(screen.getByText('Latest supplied measured time is not a claim of contiguous or complete coverage.')).toBeTruthy()
    expect(screen.queryByText(/percent|global Twitch|activation/i)).toBeNull()
  })
  it('changes the displayed calendar measure without fetching or changing selection', () => {
    const raw = catalogueFixture()
    raw.days[0] = { ...raw.days[0], detections: 6, chatMessages: 1200, emoteUses: 300 }
    const onChange = vi.fn()
    function Calendar() {
      const [params, setParams] = React.useState(new URLSearchParams())
      return <DiscoveryCalendar scope={scope} data={normalizeDiscoveryCatalogue(raw, scope)} loading={false} onChange={onChange} onRecent={() => {}}
        presentation={readDiscoveryPresentation(params, scope.month)} onPresentationChange={values => setParams(previous => {
          const next = new URLSearchParams(previous)
          for (const [key, value] of Object.entries(values)) value == null ? next.delete(key) : next.set(key, value)
          return next
        })} />
    }
    render(<Calendar />)
    const day = screen.getByRole('button', { name: /^2026-09-01:/ })
    expect(day.querySelector('small')?.textContent).toBe('6')
    fireEvent.change(screen.getByRole('combobox', { name: 'Calendar measure' }), { target: { value: 'emoteUses' } })
    expect(day.querySelector('small')?.textContent).toBe('300')
    expect(screen.getByText(/emote uses · whole month/).textContent).toContain('300')
    expect(screen.getByRole('button', { name: /^2026-09-02:/ }).querySelector('small')?.textContent).toBe('—')
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(day)
    expect(onChange).toHaveBeenCalledWith({ day: '2026-09-01' })
  })
  it('preserves zero versus missing and never treats catalogue IDs as handoff/public IDs', () => {
    const data = normalizeDiscoveryCatalogue(catalogueFixture(), scope)
    expect(data.days[0].chatMessages).toBe(0); expect(data.days[1].chatMessages).toBeNull()
    expect(discoveryDayLabel(data.days[0])).toContain('0 measured chat messages')
    expect(discoveryDayLabel(data.days[1])).toContain('not a measured zero')
    expect(data.items[0].topEmotes?.[0].name).toBe('LOL')
    expect(data.items[0].publicMomentId).toBeUndefined(); expect(data.items[0].handoffRef).toBeUndefined()
  })
  it('accepts only allowlisted archive artwork as display metadata', () => {
    const raw = catalogueFixture()
    const archiveArtwork = {
      vodId: '123456', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fixture/thumb/preview.jpg',
    }
    setFixtureArchiveArtwork(raw, archiveArtwork)
    expect(normalizeDiscoveryCatalogue(raw, scope).items[0].archiveArtwork).toEqual(archiveArtwork)
  })
  it('discards malformed supplied archive artwork without withholding detections', () => {
    for (const archiveArtwork of [
      null,
      { vodId: '12345', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fixture/thumb/preview.jpg' },
      { vodId: '123456789012345678901', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fixture/thumb/preview.jpg' },
      { vodId: 'not-numeric', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fixture/thumb/preview.jpg' },
      { vodId: '123456', kind: 'live_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fixture/thumb/preview.jpg' },
      { vodId: '123456', kind: 'archive_thumbnail', url: 'https://untrusted.invalid/cf_vods/fixture/thumb/preview.jpg' },
      { vodId: '123456', kind: 'archive_thumbnail', url: 'https://static-cdn.jtvnw.net/cf_vods/fixture/thumb/preview.jpg?size=large' },
    ]) {
      const raw = catalogueFixture()
      setFixtureArchiveArtwork(raw, archiveArtwork)
      const data = normalizeDiscoveryCatalogue(raw, scope)
      expect(data.items).toHaveLength(1)
      expect(data.items[0].archiveArtwork).toBeUndefined()
    }
  })
  it('keeps only exact measured-segment category artwork without withholding detections', () => {
    const categoryId = '213490846'
    const boxArtUrl = `https://static-cdn.jtvnw.net/ttv-boxart/${categoryId}-144x192.jpg`
    const valid = catalogueFixture()
    valid.items[0].category = 'Wuthering Waves'
    setFixtureCategoryMetadata(valid, categoryId, boxArtUrl)
    expect(normalizeDiscoveryCatalogue(valid, scope).items[0]).toMatchObject({ categoryId, boxArtUrl })

    for (const [id, url] of [
      ['invalid', boxArtUrl],
      [categoryId, `https://static-cdn.jtvnw.net/ttv-boxart/999-144x192.jpg`],
      [categoryId, `${boxArtUrl}?width=144`],
      [categoryId, `https://static-cdn.jtvnw.net/previews-ttv/live_user_creator-144x192.jpg`],
    ]) {
      const raw = catalogueFixture()
      setFixtureCategoryMetadata(raw, id, url)
      const normalized = normalizeDiscoveryCatalogue(raw, scope)
      expect(normalized.items).toHaveLength(1)
      expect(normalized.items[0].boxArtUrl).toBeUndefined()
    }

    const inferred = catalogueFixture()
    setFixtureCategoryMetadata(inferred, categoryId, boxArtUrl)
    inferred.items[0].categorySource = 'unavailable'
    const normalized = normalizeDiscoveryCatalogue(inferred, scope)
    expect(normalized.items[0].categoryId).toBeUndefined()
    expect(normalized.items[0].boxArtUrl).toBeUndefined()
  })
  it('rejects wrong creator/month, missing days, bad numeric data and duplicate identities', () => {
    for (const mutate of [
      (b: ReturnType<typeof catalogueFixture>) => { b.month = '2026-08' },
      (b: ReturnType<typeof catalogueFixture>) => { b.days.pop() },
      (b: ReturnType<typeof catalogueFixture>) => { b.days[1].chatMessages = 0 },
      (b: ReturnType<typeof catalogueFixture>) => { b.items[0].chatPerMin = -1 },
      (b: ReturnType<typeof catalogueFixture>) => { b.items.push(b.items[0]) },
    ]) { const b = catalogueFixture(); mutate(b); expect(() => normalizeDiscoveryCatalogue(b, scope)).toThrow() }
    expect(() => normalizeDiscoveryCatalogue(catalogueFixture(), { ...scope, creator: 'other' })).toThrow()
    expect(() => normalizeDiscoveryCatalogue(catalogueFixture(), { ...scope, day: '2026-09-02' })).toThrow()
    expect(() => normalizeDiscoveryCatalogue(catalogueFixture(), { ...scope, category: 'VALORANT' })).toThrow()
    const prefixCollision = catalogueFixture()
    prefixCollision.items[0].category = `${'x'.repeat(150)}y`
    expect(() => normalizeDiscoveryCatalogue(prefixCollision, { ...scope, category: 'x'.repeat(150) })).toThrow()
  })
  it('validates real date bounds and creator syntax', () => {
    expect(validDiscoveryScope(scope)).toBe(true)
    for (const s of [{ ...scope, month: '2026-13' }, { ...scope, day: '2026-09-31' }, { ...scope, creator: 'bad/name' }, { ...scope, category: 'bad\ncategory' }]) expect(validDiscoveryScope(s)).toBe(false)
  })
  it('binds category to the server-side stored-result cursor scope', async () => {
    const api = vi.mocked(apiClient)
    api.mockResolvedValueOnce({ data: catalogueFixture(), status: 200 })
    await fetchDiscoveryCatalogue({ ...scope, category: 'Minecraft' }, new AbortController().signal, 'next-page')
    const requestPath = String(api.mock.calls[0]?.[0])
    const requestUrl = new URL(requestPath, 'https://api.streampulse.stream')
    expect(requestUrl.searchParams.get('category')).toBe('Minecraft')
    expect(requestUrl.searchParams.get('cursor')).toBe('next-page')
  })
})
describe('catalogue request ownership', () => {
  it('rejects cursor cycles without committing the looping page', async () => {
    const api = vi.mocked(apiClient)
    api.mockResolvedValueOnce({ status: 200, data: { ...catalogueFixture('creator', 1), nextCursor: 'A' } })
    api.mockResolvedValueOnce({ status: 200, data: { ...catalogueFixture('creator', 2), nextCursor: 'B' } })
    api.mockResolvedValueOnce({ status: 200, data: { ...catalogueFixture('creator', 3), nextCursor: 'A' } })
    const { result } = renderHook(() => useDiscoveryCatalogue(true, scope))
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.data?.items).toHaveLength(2)
    await act(async () => { await result.current.loadMore() })
    expect(result.current.data?.items).toHaveLength(2)
    expect(result.current.error).toMatch(/could not be loaded/i)
  })
  it('rejects a duplicate-only page that makes no identity progress', async () => {
    const api = vi.mocked(apiClient)
    api.mockResolvedValueOnce({ status: 200, data: { ...catalogueFixture('creator', 1), nextCursor: 'A' } })
    api.mockResolvedValueOnce({ status: 200, data: { ...catalogueFixture('creator', 1), nextCursor: 'B' } })
    const { result } = renderHook(() => useDiscoveryCatalogue(true, scope))
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1))
    await act(async () => { await result.current.loadMore() })
    expect(result.current.data?.items).toHaveLength(1)
    expect(result.current.error).toMatch(/could not be loaded/i)
  })
  it('caps a final overflowing page and reports withheld results even without a next cursor', async () => {
    const api=vi.mocked(apiClient)
    let start=0
    for(const amount of [95,...Array(9).fill(100),10]) {
      const first=start
      start+=amount
      api.mockResolvedValueOnce({status:200,data:{...catalogueFixture(),items:Array.from({length:amount},(_,i)=>catalogueFixture('creator',first+i+1).items[0]),nextCursor:start===1005?'':`next-${start}`}})
    }
    const {result}=renderHook(()=>useDiscoveryCatalogue(true,scope))
    await waitFor(()=>expect(result.current.data?.items).toHaveLength(95))
    for(let i=0;i<10;i++)await act(async()=>{await result.current.loadMore()})
    expect(result.current.data?.items).toHaveLength(1000)
    expect(result.current.limited).toBe(true)
    const calls=api.mock.calls.length
    await act(async()=>{await result.current.loadMore()})
    expect(api).toHaveBeenCalledTimes(calls)
  })
  it('discards a pagination response after creator changes and aborts its request', async () => {
    let finishOld: (v: unknown) => void = () => {}
    const api = vi.mocked(apiClient)
    api.mockResolvedValueOnce({ data: { ...catalogueFixture(), nextCursor: 'next' }, status: 200 })
    api.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve as (v: unknown) => void }))
    api.mockResolvedValueOnce({ data: { ...catalogueFixture('other'), login: 'other' }, status: 200 })
    const { result, rerender } = renderHook(({ filter }: { filter: DiscoveryScope }) => useDiscoveryCatalogue(true, filter), { initialProps: { filter: scope } })
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1))
    act(() => { void result.current.loadMore() })
    const oldSignal = api.mock.calls[1][1]?.signal
    rerender({ filter: { ...scope, creator: 'other' } })
    await waitFor(() => expect(result.current.data?.items[0].login).toBe('other'))
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { finishOld({ data: catalogueFixture('creator', 120), status: 200 }); await Promise.resolve() })
    expect(result.current.data?.items.map(m => m.login)).toEqual(['other'])
  })
  it('aborts a pending page and cannot commit it after the stored category scope changes', async () => {
    let finishOld: (v: unknown) => void = () => {}
    const api = vi.mocked(apiClient)
    api.mockResolvedValueOnce({ data: { ...catalogueFixture(), nextCursor: 'next' }, status: 200 })
    api.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve as (v: unknown) => void }))
    const valorant = catalogueFixture()
    valorant.items[0].category = 'VALORANT'
    api.mockResolvedValueOnce({ data: valorant, status: 200 })
    const { result, rerender } = renderHook(({ category }: { category: string }) => useDiscoveryCatalogue(true, { ...scope, category }), { initialProps: { category: 'Minecraft' } })
    await waitFor(() => expect(result.current.data?.items[0].category).toBe('Minecraft'))
    act(() => { void result.current.loadMore() })
    const oldSignal = api.mock.calls[1][1]?.signal
    rerender({ category: 'VALORANT' })
    await waitFor(() => expect(result.current.data?.items[0].category).toBe('VALORANT'))
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { finishOld({ data: catalogueFixture('creator', 120), status: 200 }); await Promise.resolve() })
    expect(result.current.data?.items.map(moment => moment.category)).toEqual(['VALORANT'])
  })
  it('does not fetch on selection-only rerenders, and aborts pagination on unmount', async () => {
    const api = vi.mocked(apiClient)
    api.mockResolvedValueOnce({ data: { ...catalogueFixture(), nextCursor: 'next' }, status: 200 })
    api.mockImplementationOnce(() => new Promise(() => {}))
    const { result, rerender, unmount } = renderHook(() => useDiscoveryCatalogue(true, { ...scope }))
    await waitFor(() => expect(result.current.data?.items).toHaveLength(1))
    rerender(); expect(api).toHaveBeenCalledTimes(1)
    act(() => { void result.current.loadMore() })
    const signal = api.mock.calls[1][1]?.signal
    unmount(); expect(signal?.aborted).toBe(true)
  })
})
