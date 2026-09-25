import { describe, expect, it, vi } from 'vitest'
import { rankedRange as certifiedRange, readRankedScope as parseExplore, readHistoryRankedScope as parseHistory, normalizeRankedDiscovery, fetchRankedDiscovery, appendRankedPage, rankedEmptyMessage } from '../src/lib/discoveryCatalogue'

const serverDay = (now: Date) => now.toISOString().slice(0, 10)
const rankedRange = (period: string, from: string, to: string, now: Date, through = serverDay(now)) => certifiedRange(period, from, to, now, through)
const readRankedScope = (params: URLSearchParams, now: Date, from: string, through = serverDay(now)) => parseExplore(params, now, from, through)
const readHistoryRankedScope = (params: URLSearchParams, now: Date, from: string, through = serverDay(now)) => parseHistory(params, now, from, through)

export const scope = { from: '2026-09-13', to: '2026-09-14', creator: '', category: '', categoryMissing: false }
export function rankedFixture(rank = 1) {
  return { schemaVersion: 1, state: 'ready', scope: 'indexed_completed_public_irc_streams', ...scope, login: undefined,
    category: null, sort: 'top', asOf: '2026-09-13T12:00:00Z', rankingVersion: 'synthetic-v1', indexedRetentionStart: '2026-08-16', indexedRetentionAttestedAt: '2026-09-13T11:59:00Z', certifiedThroughExclusive: '2026-09-14', certificateGeneration: 1,
    facets: [{ category: 'Games', categoryMissing: false, count: 2, artwork: null }, { category: 'Unknown', categoryMissing: true, count: 0, artwork: null }],
    items: [{ id: `dm_${rank.toString(16).padStart(32, '0')}`, login: 'creator', streamId: 'stream1', offsetSeconds: rank * 60,
      at: Date.parse('2026-09-13T10:00:00Z'), label: `Reaction ${rank}`, category: 'Games', categorySource: 'measured_segment',
      chatPerMin: 4, emotesPerMin: 2, source: 'stored_irc', revision: 1, rank, score: 3 - rank, rankingVersion: 'synthetic-v1',
      scoreExplanation: 'Synthetic measured reaction score', categoryMissing: false }], nextCursor: rank === 1 ? 'cursor-one' : null,
    coverage: { state: 'partial', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 2, measuredMinutes: 80 },
    eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 5, rankedDetections: 2, excludedDetections: 3 },
    freshness: 'ready', projectionUpdatedAt: '2026-09-13T11:00:00Z', dataThrough: '2026-09-13T11:00:00Z' }
}
describe('ranked contract', () => {
  it('uses UTC inclusive UI dates and exclusive API bounds across months', () => {
    const now = new Date('2026-09-13T23:00:00Z')
    expect(rankedRange('latest', '', '', now)).toEqual({ from: '2026-09-12', to: '2026-09-13' })
    expect(rankedRange('last7', '', '', now)).toEqual({ from: '2026-09-06', to: '2026-09-13' })
    expect(rankedRange('custom', '2026-08-14', '2026-09-12', now)).toEqual({ from: '2026-08-14', to: '2026-09-13' })
    expect(() => rankedRange('today', '', '', now)).toThrow(/certified period/)
    for (const [from, to] of [['2026-08-12', '2026-09-12'], ['2026-02-30', '2026-03-01'], ['2026-09-14', '2026-09-14'], ['2026-09-13', '2026-09-12']]) expect(() => rankedRange('custom', from, to, now)).toThrow()
  })
  it('distinguishes named Unknown from missing and rejects conflicting deep links', () => {
    const now = new Date('2026-09-13T12:00:00Z')
    const read = (query = '') => readRankedScope(new URLSearchParams(query), now, '2026-08-16')
    expect(read('category=Unknown').categoryMissing).toBe(false)
    expect(read('categoryMissing=true').categoryMissing).toBe(true)
    expect(read().sort).toBe('volume')
    expect(() => read('category=Games&categoryMissing=true')).toThrow()
    expect(read('sort=volume').sort).toBe('volume')
    expect(() => read('sort=top')).toThrow(/not certified/)
  })
  it('clips named ranges to an attested indexed boundary and rejects older custom dates', () => {
    const now = new Date('2026-09-13T12:00:00Z')
    expect(readHistoryRankedScope(new URLSearchParams(), now, '2026-09-10')).toMatchObject({ from: '2026-09-10', to: '2026-09-13' })
    expect(readRankedScope(new URLSearchParams('period=last7'), now, '2026-09-10')).toMatchObject({ from: '2026-09-10', to: '2026-09-13' })
    expect(() => readRankedScope(new URLSearchParams('period=custom&from=2026-09-09&to=2026-09-12'), now, '2026-09-10')).toThrow(/starts at 2026-09-10/)
    expect(() => readHistoryRankedScope(new URLSearchParams('day=2026-09-09'), now, '2026-09-10')).toThrow(/2026-09-10/)
  })
  it('maps History day controls to the recent retained window', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    expect(readHistoryRankedScope(new URLSearchParams('view=history&year=2026'), now, '2026-08-16')).toMatchObject({
      from: '2026-08-16', to: '2026-09-14', creator: '', sort: 'volume',
    })
    expect(readHistoryRankedScope(new URLSearchParams('view=history&year=2026&day=2026-08-16&scope=creator&creator=xqc&sort=volume'), now, '2026-08-16')).toMatchObject({
      from: '2026-08-16', to: '2026-08-17', creator: 'xqc', sort: 'volume',
    })
    expect(() => readHistoryRankedScope(new URLSearchParams('sort=top'), now, '2026-08-16')).toThrow(/not certified/)
    expect(() => readHistoryRankedScope(new URLSearchParams('year=2026&day=2026-08-15'), now, '2026-08-16')).toThrow(/not a durable archive/)
    expect(() => readHistoryRankedScope(new URLSearchParams('year=2026&day=2026-09-15'), now, '2026-08-16')).toThrow()
    expect(readHistoryRankedScope(new URLSearchParams('view=history&month=2026-09'), now, '2026-08-16')).toMatchObject({
      from: '2026-09-01', to: '2026-09-14', creator: '', sort: 'volume',
    })
    expect(readHistoryRankedScope(new URLSearchParams('view=history&month=2026-08'), now, '2026-08-16')).toMatchObject({
      from: '2026-08-16', to: '2026-09-01', creator: '', sort: 'volume',
    })
    expect(readHistoryRankedScope(new URLSearchParams('view=recent&collection=history&creator=xqc&month=2026-09'), now, '2026-08-16')).toMatchObject({
      from: '2026-09-01', to: '2026-09-14', creator: 'xqc', sort: 'volume',
    })
    expect(() => readHistoryRankedScope(new URLSearchParams('view=history&month=2026-07'), now, '2026-08-16')).toThrow(/not a durable archive/)
    expect(() => readHistoryRankedScope(new URLSearchParams('view=history&month=2026-13'), now, '2026-08-16')).toThrow(/valid UTC month/)
    expect(() => readHistoryRankedScope(new URLSearchParams('view=history&month=2026-08&day=2026-09-13'), now, '2026-08-16')).toThrow(/valid UTC day/)
  })
  it('keeps History global by default and rejects older year links', () => {
    const now = new Date('2026-09-14T12:00:00Z')
    expect(readHistoryRankedScope(new URLSearchParams('creator=xqc'), now, '2026-08-16')).toEqual({
      from: '2026-08-16', to: '2026-09-14', creator: '', category: '', categoryMissing: false, sort: 'volume',
    })
    for (const query of ['year=2024', 'year=2027', 'year=2010', 'year=2026&year=2025', 'year=2025&day=2026-01-01',
      'year=2025&day=2025-02-29', 'sort=newest', 'category=Games&categoryMissing=true']) {
      expect(() => readHistoryRankedScope(new URLSearchParams(query), now, '2026-08-16')).toThrow()
    }
  })
  it('offers the recent UTC days across New Year without claiming a full prior year', () => {
    const now = new Date('2027-01-05T12:00:00Z')
    expect(readHistoryRankedScope(new URLSearchParams(), now, '2026-12-01')).toMatchObject({ from: '2026-12-06', to: '2027-01-05' })
    expect(readHistoryRankedScope(new URLSearchParams('year=2026&day=2026-12-31'), now, '2026-12-01')).toMatchObject({ from: '2026-12-31', to: '2027-01-01' })
    expect(readHistoryRankedScope(new URLSearchParams('year=2026&month=2026-12'), now, '2026-12-01')).toMatchObject({ from: '2026-12-06', to: '2027-01-01' })
    expect(() => readHistoryRankedScope(new URLSearchParams('year=2026'), now, '2026-12-01')).toThrow(/recent day/)
  })
  it('sends the History volume ranking to the API', async () => {
    const historyScope = readHistoryRankedScope(new URLSearchParams('year=2026&day=2026-09-13&sort=volume'), new Date('2026-09-14T12:00:00Z'), '2026-08-16')
    const raw = rankedFixture()
    raw.items[0].score = raw.items[0].chatPerMin
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ...raw, sort: 'volume' })))
    try {
      const result = await fetchRankedDiscovery(historyScope, new AbortController().signal)
      expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get('sort')).toBe('volume')
      expect(result.sort).toBe('volume')
    } finally { fetch.mockRestore() }
  })
  it('rejects a volume rank that disagrees with its measured chat count', () => {
    const raw = { ...rankedFixture(), sort: 'volume' }
    expect(() => normalizeRankedDiscovery(raw, { ...scope, sort: 'volume' })).toThrow()
    raw.items[0].score = raw.items[0].chatPerMin
    expect(normalizeRankedDiscovery(raw, { ...scope, sort: 'volume' }).items[0].score).toBe(4)
  })
  it('requires the certified interval and generation on every volume response', () => {
    const raw = { ...rankedFixture(), sort: 'volume' }
    raw.items[0].score = raw.items[0].chatPerMin
    for (const boundary of [null, undefined, '2026-09-14', '2026-02-30']) {
      expect(() => normalizeRankedDiscovery({ ...raw, indexedRetentionStart: boundary }, { ...scope, sort: 'volume' })).toThrow(/could not be verified/)
    }
    for (const attestedAt of [null, undefined, '2026-09-13T12:01:00Z', '2026-09-13T09:59:00Z']) {
      expect(() => normalizeRankedDiscovery({ ...raw, indexedRetentionAttestedAt: attestedAt }, { ...scope, sort: 'volume' })).toThrow(/could not be verified/)
    }
    for (const through of [null, undefined, '2026-09-13', '2026-02-30']) {
      expect(() => normalizeRankedDiscovery({ ...raw, certifiedThroughExclusive: through }, { ...scope, sort: 'volume' })).toThrow(/could not be verified/)
    }
    for (const generation of [null, undefined, 0, 1.5]) {
      expect(() => normalizeRankedDiscovery({ ...raw, certificateGeneration: generation }, { ...scope, sort: 'volume' })).toThrow(/could not be verified/)
    }
    expect(normalizeRankedDiscovery(raw, { ...scope, sort: 'volume' }).indexedRetentionStart).toBe('2026-08-16')
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
      { coverage: { state: 'none', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 0, measuredMinutes: 0 } },
      { facets: [] },
    ]) expect(() => normalizeRankedDiscovery({ ...rankedFixture(), ...change }, scope)).toThrow()
  })
  it('accepts a healthy empty snapshot including missing measurement', () => {
    const raw = { ...rankedFixture(), items: [], nextCursor: null, facets: [],
      eligibility: { scope: 'time_creator_category_before_pagination', totalDetections: 0, rankedDetections: 0, excludedDetections: 0 },
      coverage: { state: 'none', scope: 'time_and_creator_completed_broadcasts_only', indexedStreams: 0, measuredMinutes: 0 } }
    const empty = normalizeRankedDiscovery(raw, scope)
    expect(empty.items).toEqual([])
    expect(rankedEmptyMessage(empty)).toContain('No indexed measurement')
    expect(() => normalizeRankedDiscovery({ ...raw, eligibility: { ...raw.eligibility, totalDetections: 1, excludedDetections: 1 } }, scope)).toThrow()
    expect(rankedEmptyMessage({ ...empty, coverage: { ...empty.coverage, state: 'partial', indexedStreams: 1, measuredMinutes: 1 } })).toContain('No stored detections')
    expect(rankedEmptyMessage({ ...empty, coverage: { ...empty.coverage, state: 'partial', indexedStreams: 1, measuredMinutes: 1 }, eligibility: { ...empty.eligibility, totalDetections: 1, excludedDetections: 1 } })).toContain('none qualify')
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
  it('continues a volume cursor after retention proof renewal, but rejects a moved boundary', async () => {
    const volumeScope = { ...scope, sort: 'volume' as const }
    const firstRaw = { ...rankedFixture(), sort: 'volume' }
    firstRaw.items[0].score = firstRaw.items[0].chatPerMin
    const secondRaw = { ...rankedFixture(2), sort: 'volume', indexedRetentionAttestedAt: '2026-09-13T12:02:00Z' }
    secondRaw.items[0].score = secondRaw.items[0].chatPerMin
    secondRaw.items[0].at = Date.parse('2026-09-13T09:59:00Z')

    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(firstRaw)))
      .mockResolvedValueOnce(new Response(JSON.stringify(secondRaw)))
    let first, second
    try {
      first = await fetchRankedDiscovery(volumeScope, new AbortController().signal)
      second = await fetchRankedDiscovery(volumeScope, new AbortController().signal, first.nextCursor!, 2)
      expect(new URL(String(fetch.mock.calls[1][0])).searchParams.get('cursor')).toBe(first.nextCursor)
    } finally { fetch.mockRestore() }
    expect(appendRankedPage(first, second)).toMatchObject({
      indexedRetentionStart: '2026-08-16', indexedRetentionAttestedAt: '2026-09-13T12:02:00Z',
      items: [{ rank: 1 }, { rank: 2 }],
    })
    expect(() => normalizeRankedDiscovery(secondRaw, volumeScope)).toThrow(/could not be verified/)
    expect(() => normalizeRankedDiscovery({ ...secondRaw, indexedRetentionAttestedAt: '2026-09-15T12:02:00Z' }, volumeScope, 2)).toThrow(/could not be verified/)
    expect(() => appendRankedPage(first, { ...second, indexedRetentionStart: '2026-08-17' })).toThrow(/could not be verified/)
    expect(() => appendRankedPage(first, { ...second, certificateGeneration: 2 })).toThrow(/could not be verified/)
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
