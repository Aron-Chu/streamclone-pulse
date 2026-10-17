import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeApiError } from '../src/lib/apiClient'
import {
  appendMomentsFeed, isMomentsFeedItem, loadMomentsFeed, loadMomentsFeedItem, loadMomentsFeedRest, mergeMomentsFeed, momentsFeedFrom,
  momentsFeedIdFromLegacy, pollMomentsFeed, type MomentsFeedItem, type MomentsFeedSnapshot,
} from '../src/lib/momentsFeed'

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }))
vi.mock('../src/lib/apiClient', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/apiClient')>()), apiClient }))

/** 40 items of the moments-r2 capture (backend Go rules, 2026-10-12). */
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const page = (items: MomentsFeedItem[], nextCursor: string | null = null, extra: Record<string, unknown> = {}) =>
  ({ data: { schemaVersion: 1, generatedAt: fixture.generatedAt, stale: false, total: 120, nextCursor, items, ...extra } })
const cursorOf = (call: unknown[]) => new URL(call[0] as string, 'https://x').searchParams.get('cursor')
/** The later pages, as the page receives them. */
async function rest(cursor: string) {
  const pages: Array<{ ids: string[]; fresh: boolean }> = []
  const done = await loadMomentsFeedRest(Date.now(), cursor, (p: MomentsFeedSnapshot, fresh: boolean) => pages.push({ ids: p.items.map(item => item.id), fresh }))
  return { done, pages }
}

afterEach(() => {
  apiClient.mockReset()
  vi.unstubAllEnvs()
})

describe('moments feed client', () => {
  it('accepts every item the backend fixture sends', () => {
    expect(fixture.items.length).toBe(40)
    expect(fixture.items.every(isMomentsFeedItem)).toBe(true)
  })

  it('asks every reader in the same 10 minutes for the same URL', () => {
    const now = Date.UTC(2026, 9, 16, 18, 7, 31)
    expect(momentsFeedFrom(now)).toBe(Date.UTC(2026, 9, 16, 6, 0, 0))
    expect(momentsFeedFrom(now + 2 * 60_000)).toBe(momentsFeedFrom(now))
  })

  it('reads the first page only, with the feed’s counts, and drops malformed items', async () => {
    const [a, b, c] = fixture.items
    apiClient.mockResolvedValueOnce(page([a, b, { ...c, verdict: 'great' } as unknown as MomentsFeedItem], 'p2', { facets: { verdicts: { ok: 70, warn: 20, bad: 30 } } }))
    const snap = await loadMomentsFeed(Date.UTC(2026, 9, 16, 18, 0))
    expect(snap.items.map(item => item.id)).toEqual([a.id, b.id])
    expect(snap).toMatchObject({ total: 120, nextCursor: 'p2', verdicts: { ok: 70, warn: 20, bad: 30 } })
    expect(apiClient).toHaveBeenCalledTimes(1)
    const first = new URL(apiClient.mock.calls[0][0] as string, 'https://x')
    expect(first.pathname).toBe('/v1/public/moments')
    expect(Object.fromEntries(first.searchParams)).toEqual({ sort: 'new', from: String(Date.UTC(2026, 9, 16, 6, 0)), limit: '50' })
    // a capture without facets or total: the counts come from what loaded
    apiClient.mockResolvedValueOnce({ data: { schemaVersion: 1, generatedAt: 1, stale: false, nextCursor: null, items: [a] } })
    expect(await loadMomentsFeed(Date.now())).toMatchObject({ total: 1, verdicts: null, nextCursor: null })
  })

  it('loads every later page behind it, with no cap', async () => {
    const pages = Array.from({ length: 9 }, (_, i) => page([fixture.items[i]], i < 8 ? `p${i + 3}` : null))
    pages.forEach(p => apiClient.mockResolvedValueOnce(p))
    const { done, pages: got } = await rest('p2')
    expect(done).toBe(true)
    expect(got.map(p => p.ids[0])).toEqual(fixture.items.slice(0, 9).map(item => item.id))
    expect(apiClient.mock.calls.map(cursorOf)).toEqual(['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'])
  })

  it('keeps what arrived when a later page fails', async () => {
    apiClient.mockResolvedValueOnce(page([fixture.items[0]], 'p3')).mockRejectedValueOnce(normalizeApiError(500, { error: 'boom' }))
    const { done, pages } = await rest('p2')
    expect(done).toBe(false)
    expect(pages).toEqual([{ ids: [fixture.items[0].id], fresh: false }])
  })

  it('starts again once from a fresh first page when a cursor expires (409), then stops', async () => {
    apiClient.mockRejectedValueOnce(normalizeApiError(409, { error: 'cursor_expired' }))
      .mockResolvedValueOnce(page([fixture.items[1]], 'q2'))
      .mockResolvedValueOnce(page([fixture.items[2]]))
    expect(await rest('p2')).toEqual({ done: true, pages: [{ ids: [fixture.items[1].id], fresh: true }, { ids: [fixture.items[2].id], fresh: false }] })
    expect(apiClient.mock.calls.map(cursorOf)).toEqual(['p2', null, 'q2'])
    // the fresh first page skips the browser's cache, which could hand back the page with the expired cursor
    expect(apiClient.mock.calls[1][1]).toMatchObject({ cache: 'reload' })
    apiClient.mockReset()
    apiClient.mockRejectedValueOnce(normalizeApiError(409, { error: 'cursor_expired' })).mockResolvedValueOnce(page([fixture.items[1]], 'q2'))
      .mockRejectedValueOnce(normalizeApiError(409, { error: 'cursor_expired' }))
    expect(await rest('p2')).toEqual({ done: false, pages: [{ ids: [fixture.items[1].id], fresh: true }] })
    expect(apiClient).toHaveBeenCalledTimes(3)
  })

  it('stops on a cursor that comes back', async () => {
    apiClient.mockResolvedValue(page([fixture.items[0]], 'p2'))
    expect((await rest('p2')).done).toBe(false)
    expect(apiClient).toHaveBeenCalledTimes(1)
  })

  it('fails on a 404 (backend flag off) and on another schema, so the page falls back', async () => {
    apiClient.mockRejectedValueOnce(normalizeApiError(404, { error: 'not_found' }))
    await expect(loadMomentsFeed(Date.now())).rejects.toMatchObject({ status: 404 })
    apiClient.mockResolvedValueOnce({ data: { schemaVersion: 2, generatedAt: 1, items: [] } })
    await expect(loadMomentsFeed(Date.now())).rejects.toMatchObject({ code: 'schema' })
  })

  it('polls the first page only', async () => {
    apiClient.mockResolvedValueOnce(page([fixture.items[0]], 'p2'))
    expect((await pollMomentsFeed(Date.now())).items).toHaveLength(1)
    expect(apiClient).toHaveBeenCalledTimes(1)
  })

  it('looks one moment up by id, and a gone one is null', async () => {
    const item = fixture.items[3]
    apiClient.mockResolvedValueOnce({ data: { schemaVersion: 1, generatedAt: 1, stale: false, item } })
    expect(await loadMomentsFeedItem(item.id)).toEqual(item)
    expect(apiClient.mock.calls[0][0]).toBe(`/v1/public/moments?id=${encodeURIComponent(item.id)}`)
    apiClient.mockRejectedValueOnce(normalizeApiError(404, { error: 'not_found' }))
    expect(await loadMomentsFeedItem(item.id)).toBeNull()
  })

  it('adds a later page’s moments without replacing a newer copy', () => {
    const [a, b, c] = fixture.items
    const held = [a, { ...b, viewers: 1 }]
    expect(appendMomentsFeed(held, [b, c]).map(item => [item.id, item.viewers])).toEqual([[a.id, a.viewers], [b.id, 1], [c.id, c.viewers]])
    expect(appendMomentsFeed(held, [a])).toBe(held)
  })

  it('merges a poll: a resent moment is replaced, a new one added', () => {
    const [a, b, c] = fixture.items
    const merged = mergeMomentsFeed([a, b], [{ ...b, viewers: 1 }, c])
    expect(merged.added).toEqual([c.id])
    expect(merged.items.map(item => item.id)).toEqual([a.id, b.id, c.id])
    expect(merged.items[1].viewers).toBe(1)
  })

  it('names a moment the way the old page linked it', () => {
    expect(momentsFeedIdFromLegacy('Nico_La', '317638820087', '115649')).toBe('pulse-nico_la-317638820087-115649')
    expect(momentsFeedIdFromLegacy('nico_la', '317638820087', '1e3')).toBeNull()
    expect(momentsFeedIdFromLegacy('bad login!', '1', '1')).toBeNull()
    expect(momentsFeedIdFromLegacy(null, '1', '1')).toBeNull()
  })
})
