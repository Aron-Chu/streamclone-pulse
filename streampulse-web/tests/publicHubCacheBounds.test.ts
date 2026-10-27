import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizePublicHub, type PublicHub } from '../src/lib/publicHub'
import {
  clearPublicHubCacheForTests,
  PUBLIC_HUB_CACHE_HUB_STALE_MS,
  PUBLIC_HUB_CACHE_MAX_CHARS,
  PUBLIC_HUB_CACHE_STALE_MS,
  publicHubCacheEntrySize,
  readPublicHubCache,
  writePublicHubCache,
  publicHubCacheKey,
} from '../src/lib/publicHubCache'
import { isScreenerAtTwoTimesUsual, screenerUsual, screenerUsualTooltip } from '../src/lib/channelScreenerContract'

const origin = 'https://api.streampulse.stream'
describe('bounded public hub persistence', () => {
  beforeEach(() => {
    clearPublicHubCacheForTests()
    localStorage.clear()
  })
  it('retains at most two projections without removing unrelated preferences', () => {
    localStorage.setItem('preference', 'keep')
    const data = normalizePublicHub({})
    for (const window of ['30m', '24h', '7d'] as const) writePublicHubCache(origin, window, data)
    expect(localStorage.length).toBe(3)
    expect(localStorage.getItem('preference')).toBe('keep')
  })
  it('does not rewrite unchanged snapshots', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem')
    const data = normalizePublicHub({})
    writePublicHubCache(origin, '30m', data)
    writePublicHubCache(origin, '30m', structuredClone(data))
    expect(spy).toHaveBeenCalledTimes(1)
  })
  it('rejects oversized or future-dated cached input', () => {
    const key = publicHubCacheKey(origin, '30m')
    localStorage.setItem(key, 'x'.repeat(PUBLIC_HUB_CACHE_MAX_CHARS + 1))
    expect(readPublicHubCache(origin, '30m')).toBeNull()
    writePublicHubCache(origin, '30m', normalizePublicHub({}))
    const entry = JSON.parse(localStorage.getItem(key)!)
    entry.cachedAt = Date.now() + 10 * 60_000
    localStorage.setItem(key, JSON.stringify(entry))
    expect(readPublicHubCache(origin, '30m')).toBeNull()
  })

  it('shows a saved hub copy up to 6 hours old, and a saved projection up to 10 minutes', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_800_000_000_000)
      const generatedAt = new Date().toISOString()
      const hub = normalizePublicHub({ generatedAt, corpusPipeline: { generatedAt, state: 'healthy' } })
      writePublicHubCache(origin, '24h', hub)
      writePublicHubCache(origin, '30m', hub, 'moments')
      expect(PUBLIC_HUB_CACHE_HUB_STALE_MS).toBe(6 * 60 * 60_000)
      vi.setSystemTime(1_800_000_000_000 + PUBLIC_HUB_CACHE_STALE_MS - 60_000)
      expect(readPublicHubCache(origin, '30m', 'moments')?.cachedAt).toBe(1_800_000_000_000)
      vi.setSystemTime(1_800_000_000_000 + PUBLIC_HUB_CACHE_STALE_MS + 60_000)
      expect(readPublicHubCache(origin, '24h')).not.toBeNull()
      expect(readPublicHubCache(origin, '30m', 'moments')).toBeNull()
      vi.setSystemTime(1_800_000_000_000 + (5 * 60 + 59) * 60_000)
      expect(readPublicHubCache(origin, '24h')?.cachedAt).toBe(1_800_000_000_000)
      vi.setSystemTime(1_800_000_000_000 + (6 * 60 + 1) * 60_000)
      expect(readPublicHubCache(origin, '24h')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('projects a full hub body before persisting a projected snapshot', () => {
    const generatedAt = new Date().toISOString()
    const liveChannels = Array.from({ length: 1500 }, (_, i) => ({
      login: `channel${i}`, displayName: `Channel ${i}`, viewers: 100 + i, title: `A long live title ${'x'.repeat(80)} ${i}`,
    }))
    const full = normalizePublicHub({
      generatedAt,
      corpusPipeline: { generatedAt, state: 'healthy' },
      activity: { windowMinutes: 30, channelCount: 1500, points: [{ t: Date.now() - 60_000, viewers: 1, chat: 1, emotes: 1 }] },
      liveChannels,
      topEmotes: [{ name: 'KEKW', count: 10, sharePct: 1 }],
      livePulseMoments: [{ login: 'channel1', streamId: 's1', offsetSeconds: 60, at: Date.now() - 60_000, score: 50, label: 'Chat spike' }],
    } as never)
    expect(JSON.stringify(full).length).toBeGreaterThan(100_000)

    writePublicHubCache(origin, '30m', full, 'moments')
    const cached = readPublicHubCache(origin, '30m', 'moments')
    expect(cached).not.toBeNull()
    expect(cached!.data.livePulseMoments.map(moment => moment.streamId)).toEqual(['s1'])
    expect(cached!.data.liveChannels).toEqual([])
    expect(cached!.data.topEmotes).toEqual([])
    expect(cached!.data.activity.points).toEqual([])
    expect(cached!.data.activity.windowMinutes).toBe(30)
    // The full-hub key is untouched by a projected write.
    expect(localStorage.getItem(publicHubCacheKey(origin, '30m'))).toBeNull()
  })

  it('keeps fallback inputs when a projected hub has no network peaks', () => {
    const generatedAt = new Date().toISOString()
    const full = normalizePublicHub({
      generatedAt,
      corpusPipeline: { generatedAt, state: 'healthy' },
      liveChannels: [{ login: 'Featured', displayName: 'Featured', viewers: 5 }, { login: 'other', displayName: 'Other', viewers: 3 }],
      featuredSession: { login: 'featured', streamId: 's9' },
      moments: [{ login: 'featured', streamId: 's9', offsetSeconds: 120, label: 'Peak' }],
    } as never)
    writePublicHubCache(origin, '30m', full, 'moments')
    const cached = readPublicHubCache(origin, '30m', 'moments')!.data
    expect(cached.featuredSession.login).toBe('featured')
    expect(cached.moments).toHaveLength(1)
    expect(cached.liveChannels.map(channel => channel.login)).toEqual(['Featured'])
  })

  it('keeps only ticker lanes for the tickers projection', () => {
    const generatedAt = new Date().toISOString()
    const full = normalizePublicHub({
      generatedAt,
      corpusPipeline: { generatedAt, state: 'healthy' },
      topEmotes: [{ name: 'KEKW', count: 10, sharePct: 1 }],
      topMovers: [{ login: 'riser', seventvPerMin: 5 }],
      livePulseMoments: [{ login: 'channel1', streamId: 's1', offsetSeconds: 60, at: Date.now(), score: 50, label: 'Chat spike' }],
    } as never)
    writePublicHubCache(origin, '30m', full, 'tickers')
    const cached = readPublicHubCache(origin, '30m', 'tickers')!.data
    expect(cached.topEmotes.map(emote => emote.name)).toEqual(['KEKW'])
    expect(cached.topMovers).toHaveLength(1)
    expect(cached.livePulseMoments).toEqual([])
  })

  it('does not resurrect a normalized stats fallback as a healthy hub read', () => {
    const generatedAt = new Date().toISOString()
    const statsFallback = normalizePublicHub({ generatedAt, corpus: {
      streamsTracked: 10, momentsDetected: 0, chatMessagesProcessed: 0, emotesIndexed: 0, vodsAnalyzed: 0,
    } })
    writePublicHubCache(origin, '30m', statsFallback)
    expect(readPublicHubCache(origin, '30m')).toBeNull()

    const fullHub = normalizePublicHub({ generatedAt, corpusPipeline: { generatedAt, state: 'healthy' } })
    writePublicHubCache(origin, '30m', fullHub)
    expect(readPublicHubCache(origin, '30m')?.data.corpusPipeline.available).toBe(true)
  })
})

function metricRow(currentPerMin: number, multiplier: number | null) {
  return {
    state: 'ready',
    currentPerMin,
    baselinePerMin: multiplier ? Math.round((currentPerMin / multiplier) * 100) / 100 : null,
    absoluteDeltaPerMin: null,
    changePct: null,
    multiplier,
    currentMeasuredMinutes: 5,
    currentExpectedMinutes: 5,
    baselineMeasuredMinutes: 120,
    baselineExpectedMinutes: 121,
    baselineCoveragePct: 99.2,
  }
}

/** 240 six-minute points with ten top emotes each and 500 live rows with screener v1 (the production shape). */
function fullSizeHub(): PublicHub {
  const generatedAt = new Date().toISOString()
  const bucketMs = 6 * 60_000
  const end = Math.floor(Date.now() / bucketMs) * bucketMs
  return normalizePublicHub({
    generatedAt,
    poolSize: 500,
    corpusPipeline: { generatedAt, state: 'healthy' },
    activity: {
      windowMinutes: 1440,
      bucketMinutes: 6,
      channelCount: 500,
      source: 'historical_projection',
      points: Array.from({ length: 240 }, (_, i) => ({
        t: end - (239 - i) * bucketMs,
        chat: 40_000 + i * 13,
        emotes: 18_000 + i * 7,
        seventv: 5_000 + i,
        twitch: 12_000,
        viewers: 300_000 + i * 31,
        providerCountsLowerBound: i % 2 === 0,
        providerCoverage: { seventv: { measured: true, state: 'complete', complete: true }, twitch: { measured: true, state: 'partial', lowerBound: true } },
        viewerContributors: 40 + (i % 9),
        viewerExpectedContributors: 500,
        viewerCoverage: 'complete',
        bucketComplete: true,
        topEmotes: Array.from({ length: 10 }, (_, k) => ({
          name: `Emote${i}_${k}`, provider: k % 2 ? 'seventv' : 'twitch', count: 900 - k * 50,
          imageUrl: `https://cdn.7tv.app/emote/01HC9P5K7000${i}${k}/4x.webp`,
        })),
      })),
    },
    liveChannels: Array.from({ length: 500 }, (_, i) => {
      const chat = 3 + ((i * 53) % 420)
      return {
        streamId: `stream-${i}`,
        login: `channel${i}`,
        displayName: `Channel ${i}`,
        title: `A live title for channel ${i} that runs a little long`,
        category: i % 4 ? 'Just Chatting' : 'Counter-Strike',
        profileImageUrl: `https://static-cdn.jtvnw.net/jtv_user_pictures/profile-${i}-300x300.png`,
        viewers: 60_000 - i * 111,
        chatPerMin: chat,
        emotesPerMin: Math.round(chat / 4),
        seventvPerMin: Math.round(chat / 9),
        coverageState: 'synced',
        trendPct: (i % 30) - 10,
        screener: {
          version: 1,
          streamId: `stream-${i}`,
          measuredAt: end,
          baselineKind: 'current_stream_measured_average',
          state: i % 20 === 0 ? 'partial' : 'ready',
          reason: i % 20 === 0 ? 'baseline_coverage_low' : undefined,
          currentWindow: { start: end - 300_000, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
          baselineWindow: { start: end - 7_560_000, end: end - 300_000, expectedMinutes: 121, measuredMinutes: 120, coveragePct: 99.2 },
          evidence: { ircBound: true, chatObservedLast5m: true, rollupAvailable: true, metadataAgeSeconds: 90 },
          chat: metricRow(chat, i % 11 === 0 ? null : 0.6 + (i % 8) * 0.35),
          emotes: metricRow(Math.round(chat / 4), 1.1),
        },
      }
    }),
  } as never)
}

describe('compact full-hub snapshot (plan §2.6)', () => {
  beforeEach(() => {
    clearPublicHubCacheForTests()
    localStorage.clear()
  })

  it('stores a full-size hub as a compact entry under 150 KB and reads the same rows back', () => {
    const hub = fullSizeHub()
    expect(JSON.stringify(hub).length).toBeGreaterThan(500_000)
    const size = publicHubCacheEntrySize(hub, '24h', origin)
    expect(size?.version).toBe(2)
    expect(size!.chars).toBeLessThanOrEqual(PUBLIC_HUB_CACHE_MAX_CHARS)

    writePublicHubCache(origin, '24h', hub)
    const raw = localStorage.getItem(publicHubCacheKey(origin, '24h'))!
    expect(raw.length).toBe(size!.chars)
    const cached = readPublicHubCache(origin, '24h')!.data
    expect(cached.poolSize).toBe(500)
    expect(cached.activity.points.map(point => [point.t, point.chat, point.emotes, point.seventv, point.twitch, point.viewers, point.providerCountsLowerBound]))
      .toEqual(hub.activity.points.map(point => [point.t, point.chat, point.emotes, point.seventv, point.twitch, point.viewers, point.providerCountsLowerBound]))
    expect(cached.activity.points.map(point => point.providerCoverage)).toEqual(hub.activity.points.map(point => point.providerCoverage))
    expect(cached.activity.points.every(point => !point.topEmotes?.length)).toBe(true)
    expect(cached.liveChannels.map(channel => [channel.login, channel.viewers, channel.chatPerMin, channel.emotesPerMin, channel.category]))
      .toEqual(hub.liveChannels.map(channel => [channel.login, channel.viewers, channel.chatPerMin, channel.emotesPerMin, channel.category]))
    // Every gate reads the same backend values after the round trip.
    expect(cached.liveChannels.map(channel => screenerUsual(channel.screenerV1))).toEqual(hub.liveChannels.map(channel => screenerUsual(channel.screenerV1)))
    expect(cached.liveChannels.map(channel => isScreenerAtTwoTimesUsual(channel.screenerV1)))
      .toEqual(hub.liveChannels.map(channel => isScreenerAtTwoTimesUsual(channel.screenerV1)))
    expect(cached.liveChannels.map(channel => screenerUsualTooltip(channel.screenerV1)))
      .toEqual(hub.liveChannels.map(channel => screenerUsualTooltip(channel.screenerV1)))
    expect(cached.liveChannels[20].screenerV1).toMatchObject({ state: 'partial', reason: 'baseline_coverage_low' })
    expect(cached.liveChannels[11].screenerV1?.chat?.multiplier).toBeNull()
    // Avatars stay for the rows a first paint shows (Busiest now, top of Channels).
    expect(cached.liveChannels[0].profileImageUrl).toBe(hub.liveChannels[0].profileImageUrl)
    expect(cached.liveChannels.filter(channel => channel.profileImageUrl).length).toBeLessThanOrEqual(48)
  })

  it('drops the kept avatars before giving up on a body that is still too large', () => {
    const hub = fullSizeHub()
    hub.liveChannels = hub.liveChannels.map(channel => ({ ...channel, profileImageUrl: `${channel.profileImageUrl}?pad=${'x'.repeat(2_500)}` }))
    writePublicHubCache(origin, '24h', hub)
    const raw = localStorage.getItem(publicHubCacheKey(origin, '24h'))!
    expect(raw.length).toBeLessThanOrEqual(PUBLIC_HUB_CACHE_MAX_CHARS)
    const cached = readPublicHubCache(origin, '24h')!.data
    expect(cached.liveChannels).toHaveLength(500)
    expect(cached.liveChannels.every(channel => channel.profileImageUrl === undefined)).toBe(true)
  })

  it('projects a poll once, however often it is sized or written', () => {
    const hub = fullSizeHub()
    publicHubCacheEntrySize(hub, '24h', origin)
    const stringify = vi.spyOn(JSON, 'stringify')
    writePublicHubCache(origin, '24h', hub)
    writePublicHubCache(origin, '24h', hub)
    // Only the small head fields (backend URL, window, generatedAt) are stringified again.
    expect(stringify.mock.calls.every(([value]) => typeof value === 'string')).toBe(true)
    stringify.mockRestore()
  })

  it('evicts by the cachedAt prefix without parsing other entries', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_800_000_000_000)
      writePublicHubCache(origin, '30m', normalizePublicHub({ generatedAt: 'a', corpusPipeline: { generatedAt: 'a', state: 'healthy' } }))
      vi.setSystemTime(1_800_000_060_000)
      writePublicHubCache(origin, '7d', normalizePublicHub({ generatedAt: 'b', corpusPipeline: { generatedAt: 'b', state: 'healthy' } }))
      vi.setSystemTime(1_800_000_120_000)
      const parse = vi.spyOn(JSON, 'parse')
      writePublicHubCache(origin, '24h', fullSizeHub())
      expect(parse).not.toHaveBeenCalled()
      parse.mockRestore()
      expect(localStorage.getItem(publicHubCacheKey(origin, '30m'))).toBeNull()
      expect(localStorage.getItem(publicHubCacheKey(origin, '7d'))).not.toBeNull()
      expect(localStorage.getItem(publicHubCacheKey(origin, '24h'))).toMatch(/^\{"version":2,"cachedAt":1800000120000,/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps small hubs in the plain version 1 entry', () => {
    const generatedAt = new Date().toISOString()
    const hub = normalizePublicHub({
      generatedAt,
      corpusPipeline: { generatedAt, state: 'healthy' },
      liveChannels: [{ login: 'one', viewers: 5, chatPerMin: 3 }, { login: 'two', viewers: 4, chatPerMin: 2 }],
    } as never)
    writePublicHubCache(origin, '24h', hub)
    const entry = JSON.parse(localStorage.getItem(publicHubCacheKey(origin, '24h'))!)
    expect(entry.version).toBe(1)
    expect(entry.data.liveChannels.map((channel: { login: string }) => channel.login)).toEqual(['one', 'two'])
    expect(entry.columns).toBeUndefined()
  })

  it('rejects malformed compact entries instead of hydrating them', () => {
    const hub = fullSizeHub()
    writePublicHubCache(origin, '24h', hub)
    const key = publicHubCacheKey(origin, '24h')
    const good = localStorage.getItem(key)!
    const mutate = (change: (entry: Record<string, any>) => void) => {
      const entry = JSON.parse(good)
      change(entry)
      localStorage.setItem(key, JSON.stringify(entry))
      return readPublicHubCache(origin, '24h')
    }
    expect(mutate(() => {})).not.toBeNull()
    expect(mutate(entry => { entry.columns.points.n += 1 })).toBeNull()
    expect(mutate(entry => { entry.columns.liveChannels.cols.login.pop() })).toBeNull()
    expect(mutate(entry => { entry.columns.points.cols.providerCoverage.i[0] = 999 })).toBeNull()
    // A column named __proto__ (only possible in hand-written JSON) is refused.
    localStorage.setItem(key, good.replace('"points":{"n":240,"cols":{', '"points":{"n":240,"cols":{"__proto__":[],'))
    expect(localStorage.getItem(key)).toContain('"__proto__"')
    expect(readPublicHubCache(origin, '24h')).toBeNull()
    expect(mutate(entry => { delete entry.columns })).toBeNull()
    // A compact entry is never accepted under a projection key.
    localStorage.setItem(publicHubCacheKey(origin, '24h', 'moments'), good)
    expect(readPublicHubCache(origin, '24h', 'moments')).toBeNull()
  })
})

/**
 * The 1.22 MB production capture (plan §2.6 budget). Opt-in: set
 * SP_HUB_CAPTURE_PATH to the capture JSON; SP_U03_EVIDENCE_DIR also writes the
 * measured sizes there.
 */
const capturePath = process.env.SP_HUB_CAPTURE_PATH
// Read once (no exists/stat check before the read): a missing file skips.
const capture = (() => {
  if (!capturePath) return null
  try {
    return readFileSync(capturePath)
  } catch {
    return null
  }
})()
describe.skipIf(!capture)('production hub capture', () => {
  beforeEach(() => {
    clearPublicHubCacheForTests()
    localStorage.clear()
  })

  it('stores the 24 h capture under 150 KB and keeps every "× usual" gate after hydrate', () => {
    const bytes = capture!.length
    const raw = JSON.parse(capture!.toString('utf8'))
    raw.generatedAt = new Date().toISOString()
    if (raw.corpusPipeline) raw.corpusPipeline.generatedAt = raw.generatedAt

    let started = performance.now()
    const hub = normalizePublicHub(raw)
    const normalizeMs = performance.now() - started
    started = performance.now()
    const size = publicHubCacheEntrySize(hub, '24h', origin)
    const prepareMs = performance.now() - started
    started = performance.now()
    writePublicHubCache(origin, '24h', hub)
    const writeMs = performance.now() - started
    started = performance.now()
    const cached = readPublicHubCache(origin, '24h')
    const readMs = performance.now() - started

    expect(size).not.toBeNull()
    expect(size!.chars).toBeLessThanOrEqual(PUBLIC_HUB_CACHE_MAX_CHARS)
    expect(cached).not.toBeNull()
    const data = cached!.data
    expect(data.activity.points.map(point => [point.t, point.chat, point.emotes, point.seventv, point.viewers]))
      .toEqual(hub.activity.points.map(point => [point.t, point.chat, point.emotes, point.seventv, point.viewers]))
    expect(data.liveChannels.map(channel => channel.login)).toEqual(hub.liveChannels.map(channel => channel.login))
    expect(data.liveChannels.map(channel => screenerUsual(channel.screenerV1))).toEqual(hub.liveChannels.map(channel => screenerUsual(channel.screenerV1)))
    expect(data.liveChannels.map(channel => screenerUsualTooltip(channel.screenerV1)))
      .toEqual(hub.liveChannels.map(channel => screenerUsualTooltip(channel.screenerV1)))
    const twoTimes = (rows: PublicHub['liveChannels']) => rows.filter(channel => isScreenerAtTwoTimesUsual(channel.screenerV1)).length
    expect(twoTimes(data.liveChannels)).toBe(twoTimes(hub.liveChannels))
    expect(data.livePulseMoments).toEqual(hub.livePulseMoments)

    const evidenceDir = process.env.SP_U03_EVIDENCE_DIR
    if (evidenceDir) {
      const entry = JSON.parse(localStorage.getItem(publicHubCacheKey(origin, '24h'))!)
      const fieldChars: Record<string, number> = {}
      for (const [key, value] of Object.entries(entry.data)) fieldChars[`data.${key}`] = JSON.stringify(value ?? null).length
      for (const table of ['points', 'liveChannels'] as const) {
        for (const [key, value] of Object.entries(entry.columns?.[table]?.cols ?? {})) fieldChars[`${table}.${key}`] = JSON.stringify(value).length
      }
      const largestFields = Object.fromEntries(Object.entries(fieldChars).sort((a, b) => b[1] - a[1]).slice(0, 25))
      mkdirSync(evidenceDir, { recursive: true })
      writeFileSync(join(evidenceDir, 'cache-projection-size.json'), JSON.stringify({
        capture: capturePath,
        captureBytes: bytes,
        normalizedPlainChars: JSON.stringify(hub).length,
        entryVersion: size!.version,
        entryChars: size!.chars,
        budgetChars: PUBLIC_HUB_CACHE_MAX_CHARS,
        points: hub.activity.points.length,
        liveChannels: hub.liveChannels.length,
        screenerV1Rows: hub.liveChannels.filter(channel => channel.screenerV1).length,
        usualShownRows: hub.liveChannels.filter(channel => screenerUsual(channel.screenerV1)).length,
        twoTimesUsualRows: twoTimes(hub.liveChannels),
        avatarsKept: data.liveChannels.filter(channel => channel.profileImageUrl).length,
        largestFields,
        timingsMs: {
          normalizeCapture: Math.round(normalizeMs * 10) / 10,
          prepareProjection: Math.round(prepareMs * 10) / 10,
          writeAfterPrepare: Math.round(writeMs * 10) / 10,
          readAndHydrate: Math.round(readMs * 10) / 10,
        },
        environment: 'vitest jsdom (Node), not a browser',
        measuredAt: new Date().toISOString(),
      }, null, 2) + '\n')
    }
  })
})
