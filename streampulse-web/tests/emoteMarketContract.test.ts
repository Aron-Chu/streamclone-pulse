import { describe, expect, it } from 'vitest'
import {
  emoteMarketModuleAvailable,
  normalizeHubEmoteMarket,
} from '../src/lib/emoteMarketContract'

describe('emoteMarketContract', () => {
  it('rejects payloads without watermark', () => {
    expect(normalizeHubEmoteMarket({ breadth: [] })).toBeNull()
  })

  it('rejects hostile / malformed watermarks and client-invented keys', () => {
    expect(normalizeHubEmoteMarket(null)).toBeNull()
    expect(normalizeHubEmoteMarket([])).toBeNull()
    expect(
      normalizeHubEmoteMarket({
        watermark: { rangeStart: 2, rangeEnd: 1, measuredAt: '2026-07-10T12:00:00Z' },
      }),
    ).toBeNull()
    expect(
      normalizeHubEmoteMarket({
        watermark: { rangeStart: 1, rangeEnd: 2, measuredAt: '' },
      }),
    ).toBeNull()
    expect(
      normalizeHubEmoteMarket({
        watermark: { rangeStart: 1, rangeEnd: 2, measuredAt: '2026-07-10T12:00:00Z' },
        clientPollHistory: [],
      }),
    ).toBeNull()
  })

  it('normalizes watermarked market rows and drops malformed members', () => {
    const market = normalizeHubEmoteMarket({
      watermark: {
        rangeStart: 1,
        rangeEnd: 2,
        measuredAt: '2026-07-10T12:00:00Z',
        activityWindow: '24h',
      },
      breadth: [
        {
          name: 'KEKW',
          provider: '7tv',
          channelSharePct: 12,
          channelCount: 8,
          measuredChannels: 40,
        },
        { name: 'bad', channelSharePct: 200, channelCount: 1, measuredChannels: 1 },
      ],
      rotation: [{ name: 'KEKW', rank: 1, rankDelta: 2, status: 'gainer' }],
    })
    expect(market?.watermark.activityWindow).toBe('24h')
    expect(market?.breadth).toHaveLength(1)
    expect(market?.breadth?.[0]?.name).toBe('KEKW')
    expect(emoteMarketModuleAvailable(market, 'breadth')).toBe(true)
    expect(emoteMarketModuleAvailable(market, 'rotation')).toBe(true)
  })

  it('rejects when every breadth/rotation row is malformed', () => {
    expect(
      normalizeHubEmoteMarket({
        watermark: { rangeStart: 1, rangeEnd: 2, measuredAt: '2026-07-10T12:00:00Z' },
        breadth: [{ name: '', channelSharePct: -1, channelCount: 1, measuredChannels: 1 }],
      }),
    ).toBeNull()
    expect(
      normalizeHubEmoteMarket({
        watermark: { rangeStart: 1, rangeEnd: 2, measuredAt: '2026-07-10T12:00:00Z' },
        rotation: [{ name: 'x', rank: 0, status: 'gainer' }],
      }),
    ).toBeNull()
  })

  it('gates breadth/rotation without rows; leaders stay available', () => {
    expect(emoteMarketModuleAvailable(null, 'leaders')).toBe(true)
    expect(emoteMarketModuleAvailable(null, 'breadth')).toBe(false)
    expect(emoteMarketModuleAvailable(null, 'rotation')).toBe(false)
  })

  it('keeps concentration server-owned and rejects out-of-range shares', () => {
    const ok = normalizeHubEmoteMarket({
      watermark: { rangeStart: 1, rangeEnd: 2, measuredAt: '2026-07-10T12:00:00Z' },
      concentration: { top1SharePct: 22, top5SharePct: 48 },
    })
    expect(ok?.concentration?.top1SharePct).toBe(22)

    const bad = normalizeHubEmoteMarket({
      watermark: { rangeStart: 1, rangeEnd: 2, measuredAt: '2026-07-10T12:00:00Z' },
      concentration: { top1SharePct: 140 },
    })
    expect(bad?.concentration).toBeUndefined()
  })
})
