import { describe, expect, it } from 'vitest'
import { normalizePublicHub } from '../src/lib/publicHub'
import { coverageMeta } from '../src/ui/components/analytics/hubFormat'

describe('normalizePublicHub', () => {
  it('keeps total emotes at least as high as 7TV activity', () => {
    const hub = normalizePublicHub({
      activity: {
        windowMinutes: 30,
        channelCount: 1,
        points: [{ t: 1, chat: 100, emotes: 0, seventv: 37, viewers: 1000 }],
      },
    })

    expect(hub.activity.points[0].emotes).toBe(37)
  })

  it('promotes critical corpus pipeline state into coverage', () => {
    const hub = normalizePublicHub({
      coverage: {
        liveChannels: 95,
        trackingMax: 50,
        backfillActive: 0,
        backfillMax: 0,
        syncActive: 0,
        emotesIndexed: 0,
        databaseOk: true,
        state: 'operational',
      },
      corpusPipeline: {
        generatedAt: new Date().toISOString(),
        state: 'critical',
        topN: 500,
        collectorActive: 3,
        collectorMax: 50,
        roster: {
          live: 95,
          collectorTracking: 2,
          expectedCollectorRows: 50,
          liveCollectorDeficitRows: 48,
          metadataOnly: 13,
          metadataStale: 95,
          admissionDisabled: 95,
          capacityBlocked: 0,
          warming: 0,
          collecting: 2,
          viewerOnly: 80,
          zeroChatAfterAge: 0,
        },
        silver: { queued: 0, running: 0, done: 0, skipped: 0, failed: 0, total: 0, eligible: 0 },
        gold: { queued: 0, running: 0, done: 0, skipped: 0, failed: 0, total: 0, eligible: 0 },
      },
    })

    expect(hub.coverage.state).toBe('critical')
    expect(hub.corpusPipeline.roster.metadataStale).toBe(95)
    expect(hub.corpusPipeline.roster.liveCollectorDeficitRows).toBe(48)
  })
})

describe('coverageMeta', () => {
  it('maps collecting and chat-only states to distinct tones', () => {
    expect(coverageMeta('collecting').tone).toBe('collecting')
    expect(coverageMeta('chat_only').tone).toBe('chat')
    expect(coverageMeta('viewer_only').tone).toBe('viewer')
    expect(coverageMeta('synced').tone).toBe('synced')
  })
})
