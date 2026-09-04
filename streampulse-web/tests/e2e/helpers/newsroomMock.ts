import type { Page } from '@playwright/test'
import type { NewsroomWindow } from '../../../src/lib/newsroom'

export type NewsroomMockMode = 'ready' | 'empty' | 'stale' | 'unavailable' | 'malformed'

function eventAt(): number {
  const bucketMs = 6 * 60_000
  return Math.floor(Date.now() / bucketMs) * bucketMs - bucketMs
}

function comparison(at: number) {
  const end = Math.floor(at / 60_000) * 60_000
  const metric = {
    state: 'ready',
    currentPerMin: 120,
    baselinePerMin: 40,
    absoluteDeltaPerMin: 80,
    changePct: 200,
    multiplier: 3,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 24,
    baselineExpectedMinutes: 24,
    baselineCoveragePct: 100,
  }
  return {
    baselineKind: 'current_stream_measured_average_before_event',
    eventAt: at,
    baselineWindow: {
      start: end - 24 * 60_000,
      end,
      expectedMinutes: 24,
      measuredMinutes: 24,
      coveragePct: 100,
    },
    chat: metric,
    emotes: { ...metric, currentPerMin: 133, baselinePerMin: 32, multiplier: 4.2 },
    evidence: {
      ircBound: true,
      eventRollupAvailable: true,
      streamIdentityMatched: true,
      rollupChatSource: 'irc',
      rollupSourceConfidence: 'verified',
      rollupSourceDetail: 'closed minute IRC rollup',
      metadataStreamMatched: true,
      metadataSampledAt: at - 30_000,
      baselineMeasuredMinutes: 24,
      baselineExpectedMinutes: 24,
      baselineCoveragePct: 100,
    },
  }
}

function story(id: string, login: string, publicMomentId: string, at: number) {
  const streamId = login === 'xqc' ? 's1' : `stream-${login}`
  const headline = login === 'xqc'
    ? 'xQc emote reaction keeps building'
    : `${login} chat activity is developing`
  return {
    id,
    login,
    displayName: login === 'xqc' ? 'xQc' : login,
    category: 'Just Chatting',
    streamId,
    lifecycle: 'confirmed',
    primarySignal: login === 'xqc' ? 'emotes' : 'chat',
    headline,
    summary: 'A second measured episode confirmed this broadcast-specific story.',
    revision: 2,
    createdAt: new Date(at - 5 * 60_000).toISOString(),
    lastPublishedAt: new Date(at).toISOString(),
    sources: login === 'xqc' ? [
      {
        id: 'twitch-clip-xqc-1',
        source: 'twitch_clip',
        kind: 'clip',
        url: 'https://clips.twitch.tv/MockReactionClip',
        title: 'The reaction that set chat off',
        author: 'clip_editor',
        occurredAt: new Date(at - 30_000).toISOString(),
        metrics: { views: 18400 },
        matchConfidence: 0.94,
        reliabilityWeight: 1,
      },
      {
        id: 'reddit-lsf-xqc-1',
        source: 'reddit',
        kind: 'post',
        url: 'https://www.reddit.com/r/LivestreamFail/comments/mock/story/',
        title: 'LSF discussion follows the same stream moment',
        author: 'mock_redditor',
        occurredAt: new Date(at + 60_000).toISOString(),
        metrics: { score: 1260, comments: 184 },
        matchConfidence: 0.83,
        reliabilityWeight: 0.75,
      },
    ] : [],
    leadUpdate: {
      id: `update-${id}`,
      revision: 2,
      detectorEventKey: `episode-${id}`,
      updateKind: 'lifecycle',
      occurredAt: new Date(at).toISOString(),
      publishedAt: new Date(at + 1_000).toISOString(),
      signal: login === 'xqc' ? 'emotes' : 'chat',
      lifecycle: 'confirmed',
      headline,
      summary: 'Measured chat and emote evidence remains above this stream’s earlier baseline.',
      comparison: comparison(at),
      evidence: comparison(at).evidence,
      topEmotes: [{ name: 'KEKW', provider: '7TV', count: 80, sharePct: 50 }],
      momentRef: { publicMomentId, streamId, occurrenceAt: at, offsetSeconds: 240 },
      notificationEligible: true,
      isLate: false,
      sparkline: Array.from({ length: 6 }, (_, index) => ({
        at: at - (5 - index) * 60_000,
        currentPerMin: 30 + index * 18,
        baselinePerMin: 32,
      })),
    },
  }
}

function storyUpdates(detail: ReturnType<typeof story>) {
  const leadAt = Date.parse(detail.leadUpdate.occurredAt)
  const priorAt = leadAt - 5 * 60_000
  const priorComparison = comparison(priorAt)
  priorComparison.chat = { ...priorComparison.chat, currentPerMin: 72, absoluteDeltaPerMin: 32, changePct: 80, multiplier: 1.8 }
  priorComparison.emotes = { ...priorComparison.emotes, currentPerMin: 64, absoluteDeltaPerMin: 32, changePct: 100, multiplier: 2 }
  const previous = {
    ...detail.leadUpdate,
    id: `update-${detail.id}-1`,
    revision: 1,
    detectorEventKey: `episode-${detail.id}-1`,
    updateKind: 'signal',
    occurredAt: new Date(priorAt).toISOString(),
    publishedAt: new Date(priorAt + 1_000).toISOString(),
    lifecycle: 'developing',
    headline: `${detail.displayName || detail.login}: first measured reaction`,
    summary: 'The first verified activity peak opened this broadcast-specific story.',
    comparison: priorComparison,
    evidence: priorComparison.evidence,
    momentRef: {
      ...detail.leadUpdate.momentRef,
      publicMomentId: `${detail.leadUpdate.momentRef.publicMomentId}-earlier`,
      occurrenceAt: priorAt,
      offsetSeconds: Math.max(0, detail.leadUpdate.momentRef.offsetSeconds - 300),
    },
    notificationEligible: false,
    sparkline: Array.from({ length: 6 }, (_, index) => ({
      at: priorAt - (5 - index) * 60_000,
      currentPerMin: 22 + index * 8,
      baselinePerMin: 32,
    })),
  }
  return [previous, detail.leadUpdate]
}

function envelope(mode: NewsroomMockMode, detailId?: string, window: NewsroomWindow = 'live') {
  const at = eventAt()
  const stories = [
    story('story-xqc', 'xqc', 'public-xqc-1', at),
    story('story-lirik', 'lirik', 'not-loaded-lirik', at - 60_000),
    story('story-maya', 'maya', 'not-loaded-maya', at - 2 * 60_000),
  ]
  const detail = detailId ? stories.find((candidate) => candidate.id === detailId) ?? stories[0] : undefined
  return {
    schemaVersion: 1,
    status: mode === 'empty' ? 'empty' : mode === 'stale' ? 'stale' : mode === 'unavailable' ? 'unavailable' : 'ready',
    generatedAt: new Date(at + 2_000).toISOString(),
    dataThrough: new Date(at).toISOString(),
    snapshotAt: new Date(at + 2_000).toISOString(),
    window,
    leadStoryId: mode === 'empty' ? undefined : detail?.id ?? 'story-xqc',
    stories: mode === 'empty' || detailId ? [] : stories,
    story: detail,
    updates: detail ? storyUpdates(detail) : undefined,
    networkBrief: mode === 'empty' || detailId ? undefined : {
      currentStart: new Date(at - 30 * 60_000).toISOString(),
      currentEnd: new Date(at).toISOString(),
      baselineStart: new Date(at - 60 * 60_000).toISOString(),
      baselineEnd: new Date(at - 30 * 60_000).toISOString(),
      comparableChannels: 42,
      coveragePct: 96,
      chatChangePct: 18,
      emoteChangePct: 31,
    },
    reason: mode === 'empty' ? 'no_material_stories' : mode === 'unavailable' ? 'reads_disabled' : undefined,
  }
}

export async function installNewsroomMock(page: Page, mode: NewsroomMockMode = 'ready'): Promise<void> {
  await page.route(/\/v1\/public\/newsroom(\/[^?]+)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    const detailId = url.pathname.split('/newsroom/')[1]
    const requestedWindow = url.searchParams.get('window')
    const window: NewsroomWindow = requestedWindow === '24h' || requestedWindow === '7d' ? requestedWindow : 'live'
    if (mode === 'unavailable') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify(envelope(mode, undefined, window)) })
      return
    }
    const body = envelope(mode, detailId, window)
    if (mode === 'malformed') (body as any).schemaVersion = 99
    await route.fulfill({ status: detailId === 'missing' ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}
