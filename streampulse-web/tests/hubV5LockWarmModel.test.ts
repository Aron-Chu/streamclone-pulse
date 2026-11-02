import { describe, expect, it } from 'vitest'
import type { HubActivityPoint } from '../src/lib/publicHub'
import { lockWarmBar, lockWarmTargets } from '../src/ui/components/hub/v5/hubV5LockWarmModel'

const MIN = 60_000
const B = 5 * MIN
const T0 = Math.floor(Date.UTC(2026, 10, 1, 12, 0) / B) * B

const em = (name: string, count: number) => ({ name, count, provider: 'twitch', imageUrl: `https://e/${name}` })

function point(i: number, chat: number, emotes: Array<ReturnType<typeof em>> = [], extra: Partial<HubActivityPoint> = {}): HubActivityPoint {
  return { t: T0 + i * B, chat, emotes: 10, viewers: 1000, topEmotes: emotes, ...extra } as HubActivityPoint
}

describe('lockWarmTargets', () => {
  it('lists the 3 busiest closed bars, never the newest', () => {
    const points = [point(0, 50), point(1, 400), point(2, 90), point(3, 300), point(4, 200), point(5, 999)]
    expect(lockWarmTargets(points, 5)).toEqual([T0 + B, T0 + 3 * B, T0 + 4 * B])
  })

  it('leaves out gaps and unmeasured bars', () => {
    const points = [point(0, 500, [], { gapKind: 'outage' } as Partial<HubActivityPoint>), point(1, 400, [], { hasChatRollup: false }), point(2, 10), point(3, 1)]
    expect(lockWarmTargets(points, 5)).toEqual([T0 + 2 * B])
  })

  it('adds each top emote’s spike bar once, up to 8 in all', () => {
    const points = Array.from({ length: 12 }, (_, i) => point(i, i === 0 ? 1000 : 10, [
      em(`a${i}`, 100 - i),
      em('Kappa', i === 6 ? 900 : 5),
    ]))
    const out = lockWarmTargets(points, 5)
    // busiest: bar 0, then the first 10-chat bars; Kappa's spike is bar 6; a0…a4 spike on their own bars
    expect(out.length).toBeLessThanOrEqual(8)
    expect(out).toContain(T0 + 6 * B)
    expect(new Set(out).size).toBe(out.length)
    expect(out[0]).toBe(T0)
  })

  it('reads nothing without a bucket size', () => {
    expect(lockWarmTargets([point(0, 10), point(1, 10)], 0)).toEqual([])
  })
})

describe('lockWarmBar', () => {
  it('is true only for a bar holding a measured bucket', () => {
    const points = [point(0, 10), point(1, 10, [], { hasChatRollup: false })]
    expect(lockWarmBar(points, T0, T0 + B)).toBe(true)
    expect(lockWarmBar(points, T0 + B, T0 + 2 * B)).toBe(false)
  })
})
