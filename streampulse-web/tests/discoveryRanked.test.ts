import { describe, expect, it, vi } from 'vitest'
import { rankedRange, readRankedScope, normalizeRankedDiscovery, fetchRankedDiscovery, appendRankedPage } from '../src/lib/discoveryCatalogue'

export const scope = { from: '2026-09-13', to: '2026-09-14', creator: '', category: '', categoryMissing: false }
export function rankedFixture(rank = 1) {
  return { schemaVersion: 1, state: 'ready', scope: 'indexed_public_irc_streams', ...scope, login: undefined,
    category: null, sort: 'top', asOf: '2026-09-13T12:00:00Z', rankingVersion: 'synthetic-v1',
    facets: [{ category: 'Games', categoryMissing: false, count: 2, artwork: null }, { category: 'Unknown', categoryMissing: true, count: 0, artwork: null }],
    items: [{ id: `dm_${rank.toString(16).padStart(32, '0')}`, login: 'creator', streamId: 'stream1', offsetSeconds: rank * 60,
      at: Date.parse('2026-09-13T10:00:00Z'), label: `Reaction ${rank}`, category: 'Games', categorySource: 'measured_segment',
      chatPerMin: 4, emotesPerMin: 2, source: 'stored_irc', revision: 1, rank, score: 3 - rank, rankingVersion: 'synthetic-v1',
      scoreExplanation: 'Synthetic measured reaction score', categoryMissing: false }], nextCursor: rank === 1 ? 'cursor-one' : null,
    coverage: { state: 'partial', scope: 'time_and_creator_only', indexedStreams: 2, measuredMinutes: 80 },
    eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 5, rankedDetections: 2, excludedDetections: 3 },
    freshness: 'ready', projectionUpdatedAt: '2026-09-13T11:00:00Z', dataThrough: '2026-09-13T11:00:00Z' }
}
describe('ranked contract', () => {
  it('uses UTC inclusive UI dates and exclusive API bounds across months', () => {
    const now = new Date('2026-09-13T23:00:00Z')
    expect(rankedRange('today', '', '', now)).toEqual({ from: '2026-09-13', to: '2026-09-14' })
    expect(rankedRange('yesterday', '', '', now)).toEqual({ from: '2026-09-12', to: '2026-09-13' })
    expect(rankedRange('week', '', '', now)).toEqual({ from: '2026-09-07', to: '2026-09-14' })
    expect(rankedRange('custom', '2026-08-14', '2026-09-13', now)).toEqual({ from: '2026-08-14', to: '2026-09-14' })
    for (const [from, to] of [['2026-08-13', '2026-09-13'], ['2026-02-30', '2026-03-01'], ['2026-09-14', '2026-09-14'], ['2026-09-13', '2026-09-12']]) expect(() => rankedRange('custom', from, to, now)).toThrow()
  })
  it('distinguishes named Unknown from missing and rejects conflicting deep links', () => {
    expect(readRankedScope(new URLSearchParams('category=Unknown')).categoryMissing).toBe(false)
    expect(readRankedScope(new URLSearchParams('categoryMissing=true')).categoryMissing).toBe(true)
    expect(() => readRankedScope(new URLSearchParams('category=Games&categoryMissing=true'))).toThrow()
  })
  it('keeps server scores, ranks and full-scope zero facets without sorting', () => {
    const raw = rankedFixture(); raw.items[0].score = 0
    const data = normalizeRankedDiscovery(raw, scope)
    expect(data.items[0].score).toBe(0)
    expect(data.facets[1].count).toBe(0)
    expect(data.items[0].publicMomentId).toBeUndefined()
  })
  it.each([NaN, Infinity, undefined, '2'])('rejects invalid score %s', score => {
    const raw = rankedFixture(); Object.assign(raw.items[0], { score })
    expect(() => normalizeRankedDiscovery(raw, scope)).toThrow()
  })
  it('rejects malformed metadata, rank gaps, out-of-window records and fabricated authority', () => {
    for (const change of [{ rank: 0 }, { rank: 1.2 }, { at: Date.parse(scope.to) }, { rankingVersion: 'other' }, { categoryMissing: true }]) {
      const raw = rankedFixture(); Object.assign(raw.items[0], change)
      expect(() => normalizeRankedDiscovery(raw, scope)).toThrow()
    }
    expect(() => normalizeRankedDiscovery({ ...rankedFixture(), coverage: {} }, scope)).toThrow()
  })
  it('fails closed on invalid facets, timestamps, response limits and none coverage with rows', () => {
    for (const change of [
      { nextCursor: 'x'.repeat(2049) }, { asOf: 'not-a-date' }, { rankingVersion: '' },
      { dataThrough: '2026-09-14T00:00:00Z' }, { projectionUpdatedAt: undefined },
      { facets: [rankedFixture().facets[0], rankedFixture().facets[0]] },
      { coverage: { state: 'none', scope: 'time_and_creator_only', indexedStreams: 0, measuredMinutes: 0 } },
      { facets: [] },
    ]) expect(() => normalizeRankedDiscovery({ ...rankedFixture(), ...change }, scope)).toThrow()
  })
  it('accepts a healthy empty snapshot including missing measurement', () => {
    const raw = { ...rankedFixture(), items: [], nextCursor: null, facets: [],
      eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 0, rankedDetections: 0, excludedDetections: 0 },
      coverage: { state: 'none', scope: 'time_and_creator_only', indexedStreams: 0, measuredMinutes: 0 } }
    expect(normalizeRankedDiscovery(raw, scope).items).toEqual([])
  })
  it('validates response identity and drops arbitrary playback and artwork authority', () => {
    const raw = rankedFixture()
    Object.assign(raw.items[0], { vodId: '123456', handoffRef: 'cr_not_authority', archiveArtwork: {}, playbackUrl: 'https://example.com' })
    const moment = normalizeRankedDiscovery(raw, scope).items[0]
    expect(moment.vodId).toBeUndefined(); expect(moment.handoffRef).toBeUndefined(); expect(moment.archiveArtwork).toBeUndefined()
    for (const change of [{ login: 'Wrong Case' }, { streamId: '' }, { offsetSeconds: Infinity }, { revision: 0 }]) {
      expect(() => normalizeRankedDiscovery({ ...raw, items: [{ ...raw.items[0], ...change }] }, scope)).toThrow()
    }
  })
  it('rejects fractional source offsets and invalid RFC3339 calendar timestamps', () => {
    expect(() => normalizeRankedDiscovery({ ...rankedFixture(), items: [{ ...rankedFixture().items[0], offsetSeconds: 1.5 }] }, scope)).toThrow()
    expect(() => normalizeRankedDiscovery({ ...rankedFixture(), projectionUpdatedAt: '2026-02-30T00:00:00Z' }, scope)).toThrow()
  })
  it('preserves separate named Unknown and missing facets without using current creator category', () => {
    const raw = rankedFixture()
    Object.assign(raw, { category: 'Unknown', categoryMissing: true, nextCursor: null })
    raw.eligibility = { ...raw.eligibility, totalDetections: 4, rankedDetections: 1 }
    Object.assign(raw.items[0], { category: undefined, categoryMissing: true, categorySource: 'unavailable' })
    raw.facets = [{ category: 'Unknown', categoryMissing: false, count: 0, artwork: null }, { category: 'Unknown', categoryMissing: true, count: 1, artwork: null }]
    const data = normalizeRankedDiscovery(raw, { ...scope, categoryMissing: true })
    expect(data.facets).toHaveLength(2)
    expect(data.items[0].category).toBeUndefined()
  })
  it('appends one snapshot only and rejects duplicates, reorder and metadata changes', () => {
    const first = normalizeRankedDiscovery(rankedFixture(), scope)
    const second = normalizeRankedDiscovery(rankedFixture(2), scope, 2)
    expect(appendRankedPage(first, second).items.map(row => row.rank)).toEqual([1, 2])
    expect(() => appendRankedPage(first, { ...second, asOf: '2026-09-13T13:00:00Z' })).toThrow()
    expect(() => appendRankedPage(first, first)).toThrow()
    expect(() => appendRankedPage(first, { ...second, rankingVersion: 'other' })).toThrow()
  })
  it('requests 50 with missing predicate and never makes a chronological fallback', async () => {
    const raw = { ...rankedFixture(), category: 'Unknown', categoryMissing: true, items: [], nextCursor: null }
    raw.eligibility = { ...raw.eligibility, totalDetections: 3, rankedDetections: 0 }
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(raw)))
    await fetchRankedDiscovery({ ...scope, categoryMissing: true }, new AbortController().signal)
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.pathname).toBe('/v1/public/discovery/ranked')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('categoryMissing')).toBe('true')
    expect(url.searchParams.has('category')).toBe(false)
    fetch.mockRestore()
  })
  it('requires nonnegative safe eligibility counts with the exact scope and consistent totals', () => {
    const raw = rankedFixture()
    for (const eligibility of [undefined, null, {}, { ...raw.eligibility, scope: 'time_and_creator_only' },
      { ...raw.eligibility, totalDetections: 4 }, { ...raw.eligibility, excludedDetections: -1 },
      { ...raw.eligibility, rankedDetections: 1.5 }, { ...raw.eligibility, totalDetections: Number.MAX_SAFE_INTEGER + 1 },
      { ...raw.eligibility, rankedDetections: NaN }, { ...raw.eligibility, excludedDetections: '3' }]) {
      expect(() => normalizeRankedDiscovery({ ...raw, eligibility }, scope)).toThrow()
    }
  })
  it('retains eligibility metadata and rejects counts inconsistent with facets, ranks or continuation', () => {
    const raw = rankedFixture()
    const first = normalizeRankedDiscovery(raw, scope)
    expect(first).toHaveProperty('eligibility', raw.eligibility)
    expect(() => normalizeRankedDiscovery({ ...raw, eligibility: { ...raw.eligibility, rankedDetections: 1, totalDetections: 4 } }, scope)).toThrow()
    expect(() => normalizeRankedDiscovery({ ...raw, nextCursor: null }, scope)).toThrow()
    const second = normalizeRankedDiscovery(rankedFixture(2), scope, 2)
    expect(() => appendRankedPage(first, { ...second, eligibility: { ...second.eligibility, totalDetections: 6, excludedDetections: 4 } })).toThrow()
  })
  it('accepts excluded-only selections without manufacturing ranked rows', () => {
    const raw = { ...rankedFixture(), items: [], nextCursor: null,
      facets: [{ category: 'Games', categoryMissing: false, count: 0, artwork: null }],
      eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 2, rankedDetections: 0, excludedDetections: 2 } }
    const data = normalizeRankedDiscovery(raw, scope)
    expect(data).toHaveProperty('eligibility', raw.eligibility)
    expect(data.items).toEqual([])
  })
})
