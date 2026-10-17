import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeApiError } from '../src/lib/apiClient'
import {
  isMomentsFeedItem, loadMomentsFeed, loadMomentsFeedItem, mergeMomentsFeed, momentsFeedEnabled, momentsFeedFrom, momentsFeedIdFromLegacy,
  pollMomentsFeed, type MomentsFeedItem,
} from '../src/lib/momentsFeed'

const { apiClient } = vi.hoisted(() => ({ apiClient: vi.fn() }))
vi.mock('../src/lib/apiClient', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/lib/apiClient')>()), apiClient }))

/** 40 items of the moments-r2 capture (backend Go rules, 2026-10-12). */
const fixture = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/moments_feed_v1.json'), 'utf8')) as { generatedAt: number; items: MomentsFeedItem[] }
const page = (items: MomentsFeedItem[], nextCursor: string | null = null) => ({ data: { schemaVersion: 1, generatedAt: fixture.generatedAt, stale: false, nextCursor, items } })

afterEach(() => {
  apiClient.mockReset()
  vi.unstubAllEnvs()
})

describe('moments feed flag', () => {
  it('is off unless the build says on', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '')
    expect(momentsFeedEnabled()).toBe(false)
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'off')
    expect(momentsFeedEnabled()).toBe(false)
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', 'on')
    expect(momentsFeedEnabled()).toBe(true)
    vi.stubEnv('VITE_PUBLIC_MOMENTS_FEED', '1')
    expect(momentsFeedEnabled()).toBe(true)
  })
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

  it('reads every page, drops malformed items and repeats', async () => {
    const [a, b, c] = fixture.items
    apiClient
      .mockResolvedValueOnce(page([a, b, { ...c, verdict: 'great' } as unknown as MomentsFeedItem], 'p2'))
      .mockResolvedValueOnce(page([b, c]))
    const snap = await loadMomentsFeed(Date.UTC(2026, 9, 16, 18, 0))
    expect(snap.items.map(item => item.id)).toEqual([a.id, b.id, c.id])
    const [first, second] = apiClient.mock.calls.map(call => new URL(call[0] as string, 'https://x'))
    expect(first.pathname).toBe('/v1/public/moments')
    expect(Object.fromEntries(first.searchParams)).toEqual({ sort: 'new', from: String(Date.UTC(2026, 9, 16, 6, 0)), limit: '50' })
    expect(second.searchParams.get('cursor')).toBe('p2')
  })

  it('starts again once when a cursor expires (409), then gives up', async () => {
    apiClient.mockResolvedValueOnce(page([fixture.items[0]], 'p2')).mockRejectedValueOnce(normalizeApiError(409, { error: 'cursor_expired' }))
      .mockResolvedValueOnce(page([fixture.items[1]]))
    expect((await loadMomentsFeed(Date.now())).items.map(item => item.id)).toEqual([fixture.items[1].id])
    apiClient.mockReset()
    apiClient.mockRejectedValue(normalizeApiError(409, { error: 'cursor_expired' }))
    await expect(loadMomentsFeed(Date.now())).rejects.toMatchObject({ status: 409 })
    expect(apiClient).toHaveBeenCalledTimes(2)
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
