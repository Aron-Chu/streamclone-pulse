import type { Page } from '@playwright/test'

export type ExplorerMockMode = 'ready' | 'matched-source' | 'single-event' | 'multi-event' | 'stale' | 'empty' | 'malformed' | 'unavailable'

function eventAt(): number {
  const bucketMs = 6 * 60_000
  return Math.floor(Date.now() / bucketMs) * bucketMs - bucketMs
}

function comparison(at: number, multiplier = 3) {
  const evidence = {
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
  }
  const metric = {
    state: 'ready',
    currentPerMin: 120,
    baselinePerMin: 40,
    absoluteDeltaPerMin: 80,
    changePct: 200,
    multiplier,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 24,
    baselineExpectedMinutes: 24,
    baselineCoveragePct: 100,
  }
  return {
    baselineKind: 'current_stream_measured_average_before_event',
    eventAt: at,
    baselineWindow: { start: at - 24 * 60_000, end: at, expectedMinutes: 24, measuredMinutes: 24, coveragePct: 100 },
    chat: metric,
    emotes: { ...metric, currentPerMin: 164, baselinePerMin: 32, multiplier: multiplier + 1.2 },
    evidence,
  }
}

function moment(id: string, streamId: string, at: number, score: number, signal: 'chat' | 'emotes' | 'mixed' = 'emotes') {
  const compared = comparison(at, score / 30)
  return {
    id,
    revision: 1,
    detectorEventKey: `event-${id}`,
    updateKind: 'signal',
    occurredAt: new Date(at).toISOString(),
    publishedAt: new Date(at + 1_000).toISOString(),
    signal,
    lifecycle: 'confirmed',
    headline: signal === 'chat' ? 'Chat activity broke above the earlier stream baseline' : 'Emote activity rose well above the earlier stream baseline',
    summary: 'Verified chat and emote rollups identify a qualified broadcast moment.',
    score,
    comparison: compared,
    evidence: compared.evidence,
    topEmotes: [
      { name: 'KEKW', provider: '7TV', count: 90, sharePct: 40 },
      { name: 'OMEGALUL', provider: '7TV', count: 60, sharePct: 27 },
      { name: 'Pog', provider: 'Twitch', count: 35, sharePct: 16 },
    ],
    momentRef: { publicMomentId: `public-${id}`, streamId, occurrenceAt: at, offsetSeconds: 240 },
    notificationEligible: true,
    isLate: false,
  }
}

function broadcast(id: string, login: string, category: string, score: number, at: number, count = 2, state: 'live' | 'ended' = 'live') {
  const streamId = `stream-${login}-${id}`
  const moments = Array.from({ length: count }, (_, index) => moment(
    `${id}-${index + 1}`,
    streamId,
    at - (count - index - 1) * 6 * 60_000,
    Math.max(1, score - (count - index - 1) * 14),
    login === 'lirik' ? 'chat' : login === 'maya' ? 'mixed' : 'emotes',
  ))
  const strongest = moments.reduce((best, item) => item.score > best.score ? item : best)
  return {
    row: {
      id,
      login,
      displayName: login === 'xqc' ? 'xQc' : login[0].toUpperCase() + login.slice(1),
      category,
      streamId,
      state,
      primarySignal: login === 'lirik' ? 'chat' : login === 'maya' ? 'mixed' : 'emotes',
      momentCount: moments.length,
      strongestScore: strongest.score,
      firstActivityAt: moments[0].occurredAt,
      lastActivityAt: moments[moments.length - 1].occurredAt,
      strongestMoment: strongest,
      latestMoment: moments[moments.length - 1],
      sources: login === 'xqc' ? [
        { id: 'clip-xqc', source: 'twitch_clip', kind: 'clip', url: 'https://clips.twitch.tv/MockReactionClip', title: 'The reaction that set chat off', metrics: { views: 18400 } },
        { id: 'reddit-xqc', source: 'reddit', kind: 'post', url: 'https://www.reddit.com/r/LivestreamFail/comments/mock/story/', title: 'LSF discussion follows the same stream moment', metrics: { score: 1260, comments: 184 } },
      ] : [],
    },
    moments,
  }
}

function payload(mode: ExplorerMockMode, detailId: string | undefined, requested: URL) {
  const at = eventAt()
  const xqcCount = mode === 'single-event' ? 1 : 3
  const rows = [
    broadcast('pulse-xqc-session-1', 'xqc', 'Just Chatting', 94, at, xqcCount),
    broadcast('pulse-lirik-session-2', 'lirik', 'Variety', 86, at - 3 * 60_000, 2),
    broadcast('pulse-maya-session-3', 'maya', 'IRL', 78, at - 8 * 60_000, 1, 'ended'),
    broadcast('pulse-soda-session-4', 'sodapoppin', 'Games + Demos', 72, at - 12 * 60_000, 2),
  ]
  const selected = detailId ? rows.find((item) => item.row.id === detailId) : undefined
  const window = ['live', '24h', '7d'].includes(requested.searchParams.get('window') || '') ? requested.searchParams.get('window')! : '24h'
  const signal = ['chat', 'emotes', 'mixed'].includes(requested.searchParams.get('signal') || '') ? requested.searchParams.get('signal')! : 'all'
  const state = ['live', 'ended'].includes(requested.searchParams.get('state') || '') ? requested.searchParams.get('state')! : 'all'
  const sort = ['recent', 'moments'].includes(requested.searchParams.get('sort') || '') ? requested.searchParams.get('sort')! : 'strongest'
  const isEmpty = mode === 'empty'
  const isUnavailable = mode === 'unavailable'
  return {
    schemaVersion: mode === 'malformed' ? 99 : 1,
    status: isUnavailable ? 'unavailable' : isEmpty ? 'empty' : mode === 'stale' ? 'stale' : 'ready',
    generatedAt: new Date(at + 2_000).toISOString(),
    dataThrough: new Date(at).toISOString(),
    window,
    query: {
      window,
      signal,
      category: requested.searchParams.get('category') || undefined,
      state,
      sort,
      q: requested.searchParams.get('q') || undefined,
    },
    summary: { broadcastCount: isEmpty || isUnavailable ? 0 : rows.length, momentCount: isEmpty || isUnavailable ? 0 : rows.reduce((sum, item) => sum + item.moments.length, 0), categoryCount: isEmpty || isUnavailable ? 0 : 4 },
    facets: {
      signals: [{ value: 'emotes', label: 'Emotes', count: 2 }, { value: 'chat', label: 'Chat', count: 1 }, { value: 'mixed', label: 'Mixed', count: 1 }],
      categories: rows.map((item) => ({ value: item.row.category.toLowerCase(), label: item.row.category, count: 1 })),
      states: [{ value: 'live', label: 'Live', count: 3 }, { value: 'ended', label: 'Ended', count: 1 }],
    },
    broadcasts: isEmpty || isUnavailable || detailId ? [] : rows.map((item) => item.row),
    networkContext: detailId || isEmpty || isUnavailable ? undefined : {
      currentStart: new Date(at - 30 * 60_000).toISOString(),
      currentEnd: new Date(at).toISOString(),
      baselineStart: new Date(at - 60 * 60_000).toISOString(),
      baselineEnd: new Date(at - 30 * 60_000).toISOString(),
      comparableChannels: 42,
      coveragePct: 96,
      chatChangePct: 18,
      emoteChangePct: 31,
    },
    reason: isEmpty ? 'no_material_broadcasts' : isUnavailable ? 'reads_disabled' : undefined,
    broadcast: selected?.row,
    moments: selected?.moments,
  }
}

export async function installExplorerMock(page: Page, mode: ExplorerMockMode = 'ready'): Promise<void> {
  await page.route(/\/v1\/public\/explorer(\/[^?]+)?(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url())
    const detailId = url.pathname.split('/explorer/')[1]
    const body = payload(mode, detailId, url)
    await route.fulfill({
      status: mode === 'unavailable' ? 503 : detailId && !body.broadcast ? 404 : 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  })
}
