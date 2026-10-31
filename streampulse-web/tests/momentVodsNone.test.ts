import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MomentVod } from '../src/lib/momentsChecked'
import { MOMENT_VOD_NONE_MS, momentVodCache, type MomentVodRef } from '../src/lib/momentsFeedVod'

const ref = (id: string, offsetSeconds: number): MomentVodRef => ({ id, login: 'alpha', streamId: 's-alpha', offsetSeconds })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.UTC(2026, 9, 30, 12))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the shared VOD cache', () => {
  it('serves a "no VOD" to the stream’s later moments for 2 minutes, then reads the record again', async () => {
    const load = vi.fn<(item: MomentVodRef) => Promise<MomentVod | null>>().mockResolvedValue(null)
    const cache = momentVodCache(load)
    expect(await cache.read(ref('a', 600))).toBeNull()
    expect(cache.peek(ref('b', 900))).toBeNull()
    expect(cache.peek(ref('c', 300))).toBeUndefined()
    vi.setSystemTime(Date.now() + MOMENT_VOD_NONE_MS - 1)
    expect(cache.peek(ref('a', 600))).toBeNull()
    // the record also says none while the stream is live or its archive is still read: asked again
    vi.setSystemTime(Date.now() + 1)
    expect(cache.peek(ref('a', 600))).toBeUndefined()
    const vod = { vodId: '42', alignSeconds: -60 }
    load.mockResolvedValueOnce(vod)
    expect(await cache.read(ref('a', 600))).toEqual(vod)
    expect(load).toHaveBeenCalledTimes(2)
    expect(cache.peek(ref('c', 300))).toEqual(vod)
  })

  it('starts a later "no VOD" afresh once the earlier one ran out', async () => {
    const load = vi.fn<(item: MomentVodRef) => Promise<MomentVod | null>>().mockResolvedValue(null)
    const cache = momentVodCache(load)
    await cache.read(ref('a', 600))
    vi.setSystemTime(Date.now() + MOMENT_VOD_NONE_MS)
    await cache.read(ref('b', 900))
    expect(cache.peek(ref('b', 900))).toBeNull()
    expect(cache.peek(ref('a', 600))).toBeUndefined()
  })
})
