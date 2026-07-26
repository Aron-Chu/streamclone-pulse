import type { FigmaMomentRow } from '../../src/lib/figmaSessionAnalytics'
import type { HubLivePulseMoment, PublicHub } from '../../src/lib/publicHub'

/** Edge-case hub payload for HUB-AUDIT-055 regression coverage. */
export function hubAuditEdgeCaseMoment(): FigmaMomentRow & HubLivePulseMoment {
  return {
    login: 'fixture',
    streamId: 'fixture-stream',
    offsetSeconds: 120,
    score: 88,
    label: 'Emote spike',
    source: undefined,
    vodState: 'vod_ready',
    confidence: 91,
    topEmotes: [{ name: 'KEKW', provider: '7tv', count: 42, sharePct: 0 }],
  }
}

export function hubAuditEdgeCaseHub(): PublicHub {
  return {
    generatedAt: new Date().toISOString(),
    poolSize: 1,
    corpus: {
      streamsTracked: 1,
      momentsDetected: 1,
      chatMessagesProcessed: 100,
      emotesIndexed: 10,
      vodsAnalyzed: 0,
    },
    coverage: {
      liveChannels: 1,
      trackingMax: 5,
      backfillActive: 0,
      backfillMax: 0,
      syncActive: 0,
      emotesIndexed: 10,
      databaseOk: true,
      state: 'operational',
    },
    corpusPipeline: {
      generatedAt: new Date().toISOString(),
      state: 'healthy',
      topN: 500,
      liveAdmissionEnabled: true,
      liveAdmissionTopN: 500,
      maxActiveIrcChannels: 69,
      collectorActive: 10,
      collectorMax: 69,
      roster: {
        live: 1,
        collectorTracking: 1,
        expectedCollectorRows: 1,
        liveCollectorDeficitRows: 0,
        metadataOnly: 0,
        metadataStale: 0,
        admissionFeatureDisabled: 0,
        admissionDisabled: 0,
        capacityBlocked: 0,
        warming: 0,
        connectedQuiet: 0,
        collecting: 1,
        viewerOnly: 0,
        zeroChatAfterAge: 0,
        configuredRosterConfirmed: 1,
        configuredRosterUnresolved: 0,
      },
      silver: {
        queued: 0,
        running: 0,
        done: 0,
        skipped: 0,
        failed: 0,
        total: 0,
        eligible: 0,
      },
      gold: {
        queued: 0,
        running: 0,
        done: 0,
        skipped: 0,
        failed: 0,
        total: 0,
        eligible: 0,
      },
    },
    activity: { points: [], windowMinutes: 60, channelCount: 1 },
    emoteIntel: {
      emotesPerMin: 10,
      topEmoteSharePct: 20,
      uniqueEmotes: 5,
      biggestPeakPerMin: 100,
      seventvSharePct: 50,
      providerShares: [],
    },
    topEmotes: [],
    topMovers: [],
    liveChannels: [],
    moments: [],
    livePulseMoments: [hubAuditEdgeCaseMoment()],
    featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
  }
}
