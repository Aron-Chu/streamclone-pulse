import { beforeEach, describe, expect, it, vi } from 'vitest'

const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/apiClient', async importOriginal => ({ ...(await importOriginal<typeof import('../src/lib/apiClient')>()), apiClient: request }))
import { loadMomentsFeedItem, MOMENTS_FEED_SCHEMA_VERSION } from '../src/lib/momentsFeed'

const spark = () => Array.from({ length: 25 }, () => 1)
const item = {
  id: 'pulse-fakechan01-9000001-2430', login: 'fakechan01', displayName: 'fakechan01', streamId: '9000001', offsetSeconds: 2430,
  minuteStart: Date.parse('2026-11-14T10:40:00Z'), streamLive: true, tier: 'strong', verdict: 'ok', score: 80,
  label: { kind: 'chat', text: 'chat burst' }, reaction: { key: 'other', label: 'Other' }, category: null, topEmotes: [], hero: 'chat',
  chat: { perMin: 1, baselinePerMin: 1, x: 1, state: 'ok' }, emotes: { perMin: 1, baselinePerMin: 1, x: 1, state: 'ok' }, spanMinutes: 1,
  spark: { chat: spark(), emotes: spark(), momentIndex: 16, sparkStartIndex: 0 }, checks: { history: { level: 'ok', code: 'ok' } },
}

describe('loadMomentsFeedItem', () => {
  beforeEach(() => request.mockReset())
  it('returns the item of a well-formed answer', async () => {
    request.mockResolvedValue({ data: { schemaVersion: MOMENTS_FEED_SCHEMA_VERSION, item } })
    expect((await loadMomentsFeedItem(item.id))?.id).toBe(item.id)
  })
  it('returns null for a 404: the feed no longer has it', async () => {
    request.mockRejectedValue({ kind: 'http', status: 404 })
    expect(await loadMomentsFeedItem(item.id)).toBeNull()
  })
  it.each([
    ['another schema version', { schemaVersion: MOMENTS_FEED_SCHEMA_VERSION + 1, item }],
    ['a malformed item', { schemaVersion: MOMENTS_FEED_SCHEMA_VERSION, item: { id: 'x' } }],
    ['no item', { schemaVersion: MOMENTS_FEED_SCHEMA_VERSION }],
    ['no body', null],
  ])('throws for a 200 with %s: unknown, not "gone"', async (_name, data) => {
    request.mockResolvedValue({ data })
    await expect(loadMomentsFeedItem(item.id)).rejects.toThrow()
  })
  it('throws for other failures', async () => {
    request.mockRejectedValue({ kind: 'http', status: 503 })
    await expect(loadMomentsFeedItem(item.id)).rejects.toBeTruthy()
  })
})
