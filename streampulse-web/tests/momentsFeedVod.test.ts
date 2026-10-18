import { describe, expect, it, vi } from 'vitest'
import type { MomentsFeedItem } from '../src/lib/momentsFeed'
import { momentVodCache } from '../src/lib/momentsFeedVod'

const at = (streamId: string, offsetSeconds: number) => ({ id: `pulse-a-${streamId}-${offsetSeconds}`, streamId, offsetSeconds }) as MomentsFeedItem
const vod = { vodId: '1', alignSeconds: 30 }

describe('momentVodCache', () => {
  it('reads a stream’s record once for every moment an answer covers', async () => {
    const load = vi.fn(async (item: MomentsFeedItem) => (item.offsetSeconds <= 600 ? vod : null))
    const vods = momentVodCache(load)
    expect(vods.peek(at('s', 500))).toBeUndefined()
    expect(await vods.read(at('s', 500))).toBe(vod)
    // a VOD found at 500 serves every earlier moment of the stream
    expect(vods.peek(at('s', 100))).toBe(vod)
    expect(await vods.read(at('s', 500))).toBe(vod)
    expect(load).toHaveBeenCalledTimes(1)
    // a later one needs a read; none found at 900 serves every later moment
    expect(vods.peek(at('s', 900))).toBeUndefined()
    expect(await vods.read(at('s', 900))).toBeNull()
    expect(vods.peek(at('s', 1200))).toBeNull()
    expect(vods.peek(at('s', 700))).toBeUndefined()
    // another stream is its own
    expect(vods.peek(at('t', 100))).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('shares a read that is still running, and forgets one that failed', async () => {
    let fail = true
    const load = vi.fn(async () => { if (fail) throw new Error('down'); return vod })
    const vods = momentVodCache(load)
    const one = vods.read(at('s', 10)), two = vods.read(at('s', 10))
    expect(load).toHaveBeenCalledTimes(1)
    await expect(one).rejects.toThrow('down')
    await expect(two).rejects.toThrow('down')
    expect(vods.peek(at('s', 10))).toBeUndefined()
    fail = false
    expect(await vods.read(at('s', 10))).toBe(vod)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
