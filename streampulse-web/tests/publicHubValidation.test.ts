import { describe, expect, it } from 'vitest'
import { normalizePublicHub, validatePublicHubInvariants } from '../src/lib/publicHub'
import {
  hubActivityContractIssues,
  hubActivityNeedsRecentFallback,
  isHubActivityLivePoolFallback,
} from '../src/lib/hubActivityHonesty'

describe('validatePublicHubInvariants', () => {
  it('preserves explicit requested and served activity windows', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 1440,
        requestedWindowMinutes: 1440,
        servedWindowMinutes: 30,
        availableWindowMinutes: 30,
        state: 'degraded',
        source: 'live_pool_fallback',
        reason: 'historical_projection_unavailable',
        channelCount: 1,
        points: [],
      },
    })
    expect(hub.activity.requestedWindowMinutes).toBe(1440)
    expect(hub.activity.servedWindowMinutes).toBe(30)
  })

  it('withholds a fallback payload whose timestamps span beyond the served window', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 1440,
        requestedWindowMinutes: 1440,
        servedWindowMinutes: 30,
        availableWindowMinutes: 30,
        state: 'degraded',
        source: 'live_pool_fallback',
        reason: 'historical_projection_unavailable',
        channelCount: 1,
        points: [
          { t: 0, chat: 10, seventv: 1, viewers: 100 },
          { t: 32 * 60_000, chat: 10, seventv: 1, viewers: 100 },
        ],
      },
    })
    expect(hub.activity.source).toBe('live_pool_fallback')
    expect(hub.activity.points).toHaveLength(2)
    expect(hub.activity.points[0]?.t).toBe(0)
    expect(hub.activity.points[1]?.t).toBe(32 * 60_000)
    expect(hub.activity.servedWindowMinutes).toBe(30)
    expect(isHubActivityLivePoolFallback(hub.activity)).toBe(true)
    expect(hubActivityContractIssues(hub.activity)).toEqual([
      'payload spans 32 minutes but advertises 30 served minutes',
    ])
    expect(hubActivityNeedsRecentFallback(hub.activity)).toBe(true)
  })

  it('accepts only an explicitly minute-cadence long-window fallback', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 1440,
        requestedWindowMinutes: 1440,
        servedWindowMinutes: 30,
        availableWindowMinutes: 30,
        bucketMinutes: 1,
        state: 'degraded',
        source: 'live_pool_fallback',
        reason: 'historical_projection_unavailable',
        channelCount: 1,
        points: [
          { t: 0, chat: 10, seventv: 1, viewers: 100 },
          { t: 60_000, chat: 12, seventv: 1, viewers: 110 },
        ],
      },
    })
    expect(hubActivityNeedsRecentFallback(hub.activity)).toBe(false)
  })

  it('warns when roster live count exceeds bounded hub rows', () => {
    const hub = normalizePublicHub({
      poolSize: 50,
      liveChannels: [{ login: 'xqc', viewers: 1000, chatPerMin: 10, seventvPerMin: 2, coverageState: 'synced', trendPct: 0 }],
      corpusPipeline: {
        topN: 500,
        state: 'degraded',
        generatedAt: new Date().toISOString(),
        collectorActive: 40,
        collectorMax: 63,
        roster: {
          live: 82,
          collectorTracking: 42,
          expectedCollectorRows: 63,
          liveCollectorDeficitRows: 21,
          metadataOnly: 14,
          metadataStale: 0,
          admissionDisabled: 0,
          capacityBlocked: 0,
          warming: 2,
          collecting: 49,
          viewerOnly: 17,
          zeroChatAfterAge: 0,
        },
      },
      activity: {
        windowMinutes: 60 * 24 * 7,
        channelCount: 39,
        points: [
          { t: 1, chat: 10, seventv: 5, viewers: 100 },
          { t: 61_001, chat: 12, seventv: 6, viewers: 110 },
        ],
      },
    })

    const issues = validatePublicHubInvariants(hub)
    expect(issues.some((issue) => issue.code === 'live_roster_vs_hub_rows')).toBe(true)
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false)
  })

  it('flags unsorted activity timestamps', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 60,
        channelCount: 1,
        points: [
          { t: 1000, chat: 1, seventv: 0, viewers: 1 },
          { t: 500, chat: 1, seventv: 0, viewers: 1 },
        ],
      },
    })

    expect(validatePublicHubInvariants(hub).some((issue) => issue.code === 'activity_points_unsorted')).toBe(true)
  })

  it('warns when long-window activity viewers look like a single channel not global pool', () => {
    const hub = normalizePublicHub({
      poolSize: 3,
      liveChannels: [
        { login: 'alpha', viewers: 20_000, chatPerMin: 10, seventvPerMin: 1, coverageState: 'synced', trendPct: 0 },
        { login: 'beta', viewers: 18_000, chatPerMin: 8, seventvPerMin: 1, coverageState: 'synced', trendPct: 0 },
        { login: 'gamma', viewers: 15_000, chatPerMin: 6, seventvPerMin: 1, coverageState: 'synced', trendPct: 0 },
      ],
      activity: {
        windowMinutes: 60 * 24 * 7,
        channelCount: 3,
        points: [{ t: 1_700_000_000_000, chat: 120, seventv: 40, viewers: 19_500 }],
      },
    })

    const liveSum = hub.liveChannels.reduce((sum, ch) => sum + ch.viewers, 0)
    const peakActivity = Math.max(...hub.activity.points.map((p) => p.viewers))
    expect(liveSum).toBeGreaterThan(peakActivity * 1.5)
    expect(validatePublicHubInvariants(hub).some((issue) => issue.code === 'activity_viewers_below_live_pool')).toBe(true)
  })

  it('errors when IRC collectors are up but roster collecting is zero', () => {
    const hub = normalizePublicHub({
      ingest: {
        tieringEnabled: true,
        coreEnabled: true,
        dualReadMode: false,
        shadowMode: false,
        activeCollectors: 250,
        desiredCollectors: 250,
        boundCollectors: 250,
        joinAcknowledged: 250,
        awaitingJoin: 0,
        connectedQuiet: 250,
        chatActive5m: 0,
        chatActive15m: 0,
        reconnecting: 0,
        unexpectedParts: 0,
        admitLagSeconds: 0,
        joinRate1m: 1,
        partRate1m: 1,
        state: 'operational',
      },
      corpusPipeline: {
        roster: { live: 100, collecting: 0, warming: 100, collectorTracking: 100 },
      },
      activity: {
        windowMinutes: 30,
        channelCount: 100,
        points: [
          { t: 1, chat: 0, seventv: 0, viewers: 1000 },
          { t: 60_001, chat: 0, seventv: 0, viewers: 1100 },
        ],
      },
    })

    const issues = validatePublicHubInvariants(hub)
    expect(issues.some((issue) => issue.code === 'irc_collectors_without_chat_rollups')).toBe(true)
    expect(issues.some((issue) => issue.code === 'irc_active_but_activity_chat_empty')).toBe(true)
  })
})
