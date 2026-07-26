import { describe, expect, it } from 'vitest'
import {
  computeSharePctFromCounts,
  isBackendSharePct,
  resolveEmoteShare,
  withComputedBurstShare,
  withComputedSharePct,
} from '../src/lib/emoteShare'
import type { HubEmote } from '../src/lib/publicHub'

describe('emoteShare', () => {
  it('isBackendSharePct accepts positive finite values only', () => {
    expect(isBackendSharePct(12.5)).toBe(true)
    expect(isBackendSharePct(0)).toBe(false)
    expect(isBackendSharePct(undefined)).toBe(false)
  })

  it('computeSharePctFromCounts rounds to one decimal', () => {
    expect(computeSharePctFromCounts(1, 3)).toBe(33.3)
    expect(computeSharePctFromCounts(0, 10)).toBeUndefined()
  })

  it('resolveEmoteShare prefers backend share when present', () => {
    expect(resolveEmoteShare(100, 22, 500)).toEqual({ sharePct: 22, shareEstimated: false })
  })

  it('resolveEmoteShare estimates when sharePct is zero', () => {
    expect(resolveEmoteShare(30, 0, 100)).toEqual({ sharePct: 30, shareEstimated: true })
  })

  it('withComputedSharePct flags estimated rows', () => {
    const emotes: HubEmote[] = [
      { name: 'A', count: 60, sharePct: 0 },
      { name: 'B', count: 40, sharePct: 0 },
    ]
    const ranked = withComputedSharePct(emotes)
    expect(ranked[0]?.shareEstimated).toBe(true)
    expect(ranked[0]?.sharePct).toBe(60)
  })

  it('withComputedSharePct keeps backend-provided share', () => {
    const emotes: HubEmote[] = [{ name: 'A', count: 60, sharePct: 55 }]
    const ranked = withComputedSharePct(emotes)
    expect(ranked[0]?.shareEstimated).toBe(false)
    expect(ranked[0]?.sharePct).toBe(55)
  })

  it('withComputedBurstShare mirrors burst rows', () => {
    const bursts = withComputedBurstShare([
      { code: 'KEKW', count: 80, sharePct: 0 },
      { code: 'LUL', count: 20, sharePct: 0 },
    ])
    expect(bursts[0]?.shareEstimated).toBe(true)
    expect(bursts[0]?.sharePct).toBe(80)
  })
})
