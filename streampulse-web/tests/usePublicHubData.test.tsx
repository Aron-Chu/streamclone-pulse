import { Component, StrictMode, useEffect, type PropsWithChildren, type ReactNode } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendUrl } from '../src/lib/apiClient'
import * as publicHubCache from '../src/lib/publicHubCache'
import {
  clearPublicHubCacheForTests,
  hasPendingPublicHubCacheWrite,
  PUBLIC_HUB_CACHE_MAX_CHARS,
  publicHubCacheKey,
  readPublicHubCache,
  writePublicHubCache,
} from '../src/lib/publicHubCache'
import { normalizePublicHub, type PublicHub, type PublicHubActivityWindow } from '../src/lib/publicHub'
import { screenerUsual } from '../src/lib/channelScreenerContract'
import { resetHubBucketSelectionForTests, setHubGestureActive } from '../src/lib/hubBucketSelection'

const fetchPublicHubBase = vi.fn()
const fetchPublicHubStatsFallback = vi.fn()
const fetchPublicHub = vi.fn()

vi.mock('../src/lib/publicHub', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/publicHub')>('../src/lib/publicHub')
  return {
    ...actual,
    fetchPublicHubBase: (
      signal?: AbortSignal,
      activityWindow?: import('../src/lib/publicHub').PublicHubActivityWindow,
      projection?: import('../src/lib/publicHub').PublicHubProjection,
    ) => fetchPublicHubBase(signal, activityWindow, projection),
    fetchPublicHubStatsFallback: (signal?: AbortSignal) => fetchPublicHubStatsFallback(signal),
    fetchPublicHub: (
      signal?: AbortSignal,
      activityWindow?: import('../src/lib/publicHub').PublicHubActivityWindow,
    ) => fetchPublicHub(signal, activityWindow),
  }
})

import { HUB_DATA_MARK, HUB_TIMEOUT_MESSAGE, resetHubDataMarkForTests, usePublicHubData } from '../src/hooks/usePublicHubData'
import { PortalErrorBoundary } from '../src/ui/PortalErrorBoundary'

function sampleHub(poolSize: number): PublicHub {
  return normalizePublicHub({
    poolSize,
    generatedAt: '2026-06-30T12:00:00.000Z',
    activity: {
      points: [{ t: 1_700_000_000, chat: 40, emotes: 12, seventv: 5, viewers: 1000 }],
      windowMinutes: 7 * 24 * 60,
      channelCount: 3,
    },
    corpusPipeline: {
      topN: 500,
      state: 'healthy',
      generatedAt: '2026-06-30T12:00:00.000Z',
      collectorActive: 10,
      collectorMax: 50,
      roster: {
        live: 0,
        collectorTracking: 0,
        expectedCollectorRows: 0,
        liveCollectorDeficitRows: 0,
        metadataOnly: 0,
        metadataStale: 0,
        admissionDisabled: 0,
        capacityBlocked: 0,
        warming: 0,
        collecting: 0,
        viewerOnly: 0,
        zeroChatAfterAge: 0,
      },
    },
  })
}

function screenerMetricRow(currentPerMin: number, multiplier: number) {
  return {
    state: 'ready',
    currentPerMin,
    baselinePerMin: Math.round((currentPerMin / multiplier) * 100) / 100,
    absoluteDeltaPerMin: Math.round((currentPerMin - currentPerMin / multiplier) * 100) / 100,
    changePct: Math.round((multiplier - 1) * 10_000) / 100,
    multiplier,
    currentMeasuredMinutes: 5,
    currentExpectedMinutes: 5,
    baselineMeasuredMinutes: 285,
    baselineExpectedMinutes: 286,
    baselineCoveragePct: 99.65,
  }
}

/** A hub shaped like the 1.2 MB production 24 h body: 240 points with top emotes, 500 rows with screener v1. */
function fullSizeHub(): PublicHub {
  const bucketMs = 6 * 60_000
  const end = Math.floor(Date.now() / bucketMs) * bucketMs
  const points = Array.from({ length: 240 }, (_, i) => ({
    t: end - (239 - i) * bucketMs,
    chat: 50_000 + i * 37,
    emotes: 20_000 + i * 11,
    seventv: 6_000 + i,
    twitch: 13_000 + i,
    bttv: 160,
    ffz: 220,
    viewers: 280_000 + i * 97,
    providerCountsLowerBound: true,
    providerCoverage: {
      seventv: { measured: true, state: 'complete', complete: true },
      twitch: { measured: true, state: 'partial', lowerBound: true },
      other: { state: 'partial', lowerBound: true },
    },
    viewerContributors: 45,
    viewerExpectedContributors: 500,
    viewerCoverage: 'complete',
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
    topEmotes: Array.from({ length: 10 }, (_, k) => ({
      name: `Emote${k}x${i}`,
      provider: k % 2 ? 'seventv' : 'twitch',
      imageUrl: `https://cdn.7tv.app/emote/01HC9P5K70000${i}${k}/4x.webp`,
      count: 1_000 - k * 37,
    })),
  }))
  const liveChannels = Array.from({ length: 500 }, (_, i) => {
    const chatNow = 4 + ((i * 37) % 400)
    return {
      streamId: `10000000${2000 + i}`,
      login: `channel_${i}`,
      displayName: `Channel ${i}`,
      title: `Long running stream title number ${i} with a few words`,
      category: i % 3 ? 'Just Chatting' : 'Overwatch',
      profileImageUrl: `https://static-cdn.jtvnw.net/jtv_user_pictures/b532ac95-4050-42cb-${i}-profile_image-300x300.png`,
      startedAt: new Date(end - 4 * 3_600_000).toISOString(),
      viewers: 50_000 - i * 97,
      chatPerMin: chatNow,
      emotesPerMin: Math.round(chatNow * 0.3),
      seventvPerMin: Math.round(chatNow * 0.1),
      coverageState: 'synced',
      trendPct: (i % 40) - 20,
      screener: {
        version: 1,
        streamId: `10000000${2000 + i}`,
        measuredAt: end,
        baselineKind: 'current_stream_measured_average',
        state: i % 25 === 0 ? 'warming' : 'ready',
        currentWindow: { start: end - 300_000, end, expectedMinutes: 5, measuredMinutes: 5, coveragePct: 100 },
        baselineWindow: { start: end - 17_460_000, end: end - 300_000, expectedMinutes: 286, measuredMinutes: 285, coveragePct: 99.65 },
        evidence: { ircBound: true, chatObservedLast5m: true, rollupAvailable: true, metadataAgeSeconds: 124 },
        chat: screenerMetricRow(chatNow, 0.5 + (i % 9) * 0.4),
        emotes: screenerMetricRow(Math.round(chatNow * 0.3), 0.96),
      },
    }
  })
  return normalizePublicHub({
    ...sampleHub(500),
    activity: { points, windowMinutes: 1440, bucketMinutes: 6, channelCount: 500, state: 'ready', source: 'historical_projection' },
    liveChannels,
  } as unknown as Partial<PublicHub>)
}

function hubResult(poolSize: number) {
  const data = sampleHub(poolSize)
  return {
    data,
    loadSource: 'full' as const,
    hubEndpointOk: true,
    status: 200,
  }
}

function hubDown() {
  return {
    data: normalizePublicHub(null),
    loadSource: 'full' as const,
    hubEndpointOk: false,
    status: 0,
  }
}

function statsFallbackResult(poolSize: number) {
  return {
    data: sampleHub(poolSize),
    loadSource: 'stats-fallback' as const,
    hubEndpointOk: false,
    status: 200,
  }
}

function repairHubResult(poolSize = 3, windowMinutes = 1440) {
  const result = hubResult(poolSize)
  result.data.activity = {
    ...result.data.activity,
    windowMinutes,
    requestedWindowMinutes: windowMinutes,
    servedWindowMinutes: 30,
    availableWindowMinutes: 30,
    bucketMinutes: 6,
    state: 'degraded',
    source: 'live_pool_fallback',
    reason: 'historical_projection_unavailable',
  }
  result.data.livePulseMoments = [{ login: 'creator', offsetSeconds: 60, score: 42, label: 'Measured live peak' }]
  result.data.livePulseMomentsStatus = 'ready'
  return result
}

function deferredHub() {
  let resolve!: (value: ReturnType<typeof hubResult> & { dataAsOf?: number | null }) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<ReturnType<typeof hubResult> & { dataAsOf?: number | null }>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type IdleCallback = (deadline: IdleDeadline) => void
type IdleScheduler = (callback: IdleCallback, options?: IdleRequestOptions) => number

const IDLE_DEADLINE = { didTimeout: false, timeRemaining: () => 50 } as IdleDeadline

/** jsdom has no requestIdleCallback; tests install one (synchronous unless a test queues callbacks). */
function installIdleCallback(schedule: IdleScheduler): void {
  Object.defineProperty(window, 'requestIdleCallback', { configurable: true, writable: true, value: schedule })
  Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, writable: true, value: () => {} })
}

function removeIdleCallback(): void {
  Reflect.deleteProperty(window, 'requestIdleCallback')
  Reflect.deleteProperty(window, 'cancelIdleCallback')
}

function queueIdleCallbacks() {
  const queued: Array<{ callback: IdleCallback; options?: IdleRequestOptions }> = []
  installIdleCallback((callback, options) => {
    queued.push({ callback, options })
    return queued.length
  })
  return {
    queued,
    runAll() {
      for (const entry of queued.splice(0)) entry.callback(IDLE_DEADLINE)
    },
  }
}

describe('usePublicHubData', () => {
  beforeEach(() => {
    installIdleCallback((callback) => {
      callback(IDLE_DEADLINE)
      return 0
    })
    resetHubBucketSelectionForTests()
    clearPublicHubCacheForTests()
    fetchPublicHub.mockReset()
    fetchPublicHubBase.mockReset()
    fetchPublicHubStatsFallback.mockReset()
    fetchPublicHubBase.mockResolvedValue(hubDown())
    fetchPublicHubStatsFallback.mockRejectedValue(new Error('Public hub unavailable'))
  })

  afterEach(() => {
    removeIdleCallback()
    resetHubBucketSelectionForTests()
  })

  it('loads, then exposes normalized data with liveEmpty false when channels exist', async () => {
    fetchPublicHubBase.mockResolvedValue(hubResult(3))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.data?.poolSize).toBe(3)
    expect(result.current.data?.corpus.streamsTracked).toBe(0)
    expect(result.current.liveEmpty).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.loadSource).toBe('full')
    expect(result.current.hubEndpointOk).toBe(true)
    expect(result.current.lastUpdated).not.toBeNull()
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(fetchPublicHub).not.toHaveBeenCalled()
  })

  it('keeps a projected Moments response out of the full-hub cache', async () => {
    writePublicHubCache(getBackendUrl(), '30m', sampleHub(42))
    fetchPublicHubBase.mockResolvedValue(hubResult(7))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m', projection: 'moments' }))
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.data?.poolSize).toBe(7))
    expect(fetchPublicHubBase.mock.calls[0]?.[2]).toBe('moments')
    expect(readPublicHubCache(getBackendUrl(), '30m')?.data.poolSize).toBe(42)
    expect(readPublicHubCache(getBackendUrl(), '30m', 'moments')?.data.poolSize).toBe(7)
  })

  it('replaces a legacy coarse long-window fallback with the canonical 30m feed', async () => {
    const longWindow = normalizePublicHub({
      generatedAt: '2026-06-30T12:00:00.000Z',
      activity: {
        points: [
          { t: 1_700_000_000_000, chat: 900, emotes: 90, seventv: 90, viewers: 1000 },
          { t: 1_700_000_360_000, chat: 900, emotes: 90, seventv: 90, viewers: 1000 },
        ],
        windowMinutes: 1440,
        requestedWindowMinutes: 1440,
        servedWindowMinutes: 30,
        availableWindowMinutes: 30,
        state: 'degraded',
        source: 'live_pool_fallback',
        reason: 'historical_projection_unavailable',
        channelCount: 1,
      },
    })
    const recent = normalizePublicHub({
      generatedAt: '2026-06-30T12:00:00.000Z',
      activity: {
        points: [
          { t: 1_700_001_000_000, chat: 12, emotes: 3, seventv: 3, viewers: 1200 },
          { t: 1_700_001_060_000, chat: 18, emotes: 4, seventv: 4, viewers: 1300 },
        ],
        windowMinutes: 30,
        bucketMinutes: 1,
        channelCount: 1,
      },
    })
    fetchPublicHubBase.mockImplementation((_signal?: AbortSignal, window?: PublicHubActivityWindow) =>
      Promise.resolve(
        window === '30m'
          ? { data: recent, loadSource: 'full' as const, hubEndpointOk: true, status: 200 }
          : { data: longWindow, loadSource: 'full' as const, hubEndpointOk: true, status: 200 },
      ),
    )

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.data?.activity.points[0]?.chat).toBe(12))

    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubBase.mock.calls[0]?.[1]).toBe('24h')
    expect(fetchPublicHubBase.mock.calls[1]?.[1]).toBe('30m')
    expect(result.current.data?.activity.windowMinutes).toBe(1440)
    expect(result.current.data?.activity.servedWindowMinutes).toBe(30)
    expect(result.current.data?.activity.points.map((point) => point.chat)).toEqual([12, 18])
  })

  it.each([
    [120_000, 300_000, 300_000],
    [300_000, 120_000, 300_000],
    [120_000, null, null],
    [null, 120_000, null],
  ])('uses the oldest known data time for merged long-window and recent reads (%s, %s)', async (baseAge, recentAge, expectedAge) => {
    const now = Date.now()
    const base = { ...repairHubResult(), dataAsOf: baseAge === null ? null : now - baseAge }
    const recent = { ...hubResult(99), dataAsOf: recentAge === null ? null : now - recentAge }
    recent.data.activity.windowMinutes = 30
    recent.data.activity.points = [{ t: 1_700_001_000_000, chat: 777, emotes: 3, seventv: 3, viewers: 1200 }]
    fetchPublicHubBase.mockImplementation((_signal?: AbortSignal, window?: PublicHubActivityWindow) =>
      Promise.resolve(window === '30m' ? recent : base),
    )
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.activityRefreshing).toBe(false))
    await waitFor(() => expect(result.current.data?.activity.points[0]?.chat).toBe(777))
    expect(result.current.dataAsOf).toBe(expectedAge === null ? null : now - expectedAge)
    publicHubCache.flushPublicHubCacheWritesForTests()
    expect(readPublicHubCache(getBackendUrl(), '24h')?.dataAsOf).toBe(expectedAge === null ? null : now - expectedAge)
  })

  it('replaces the interim recent view age with the later long-window answer age', async () => {
    const pending = deferredHub()
    const recentAsOf = Date.now() - 60_000
    const primaryAsOf = recentAsOf - 60_000
    const recent = { ...hubResult(99), dataAsOf: recentAsOf }
    recent.data.activity.windowMinutes = 30
    fetchPublicHubBase.mockImplementation((_signal?: AbortSignal, window?: PublicHubActivityWindow) =>
      window === '30m' ? Promise.resolve(recent) : pending.promise,
    )
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(99), { timeout: 2500 })
    expect(result.current.dataAsOf).toBe(recentAsOf)
    await act(async () => { pending.resolve({ ...hubResult(42), dataAsOf: primaryAsOf }) })
    await waitFor(() => expect(result.current.data?.poolSize).toBe(42))
    expect(result.current.dataAsOf).toBe(primaryAsOf)
  })

  it('preserves the recent recovery response age after a long-window failure', async () => {
    const asOf = Date.now() - 60_000
    const recent = { ...hubResult(99), dataAsOf: asOf }
    recent.data.activity.windowMinutes = 30
    fetchPublicHubBase.mockImplementation((_signal?: AbortSignal, window?: PublicHubActivityWindow) =>
      window === '30m' ? Promise.resolve(recent) : Promise.reject({ kind: 'server', status: 503, message: 'unavailable' }),
    )
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(99))
    expect(result.current.dataAsOf).toBe(asOf)
    publicHubCache.flushPublicHubCacheWritesForTests()
    expect(readPublicHubCache(getBackendUrl(), '24h')?.dataAsOf).toBe(asOf)
  })

  describe('independent live lanes during activity repair', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

    it('publishes verified live moments before repair, accepting and caching exactly one final snapshot', async () => {
      const primary = repairHubResult()
      const repair = deferredHub()
      const persist = vi.spyOn(publicHubCache, 'schedulePublicHubCacheWrite')
      fetchPublicHubBase.mockResolvedValueOnce(primary).mockReturnValueOnce(repair.promise)
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      await waitFor(() => expect(result.current.activityRefreshing).toBe(true))

      expect(result.current.loading).toBe(false)
      expect(result.current.loadSource).toBe('full')
      expect(result.current.hubEndpointOk).toBe(true)
      expect(result.current.data?.livePulseMoments).toEqual(primary.data.livePulseMoments)
      expect(result.current.data?.activity.points).toEqual([])
      expect(result.current.data?.generatedAt).toBe(primary.data.generatedAt)
      expect(result.current.lastSuccessfulPollAt).toBeNull()
      expect(result.current.pollSequence).toBe(0)
      expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
      expect(persist).not.toHaveBeenCalled()

      const recent = hubResult(99)
      recent.data.generatedAt = '2026-06-30T12:01:00.000Z'
      recent.data.activity.windowMinutes = 30
      recent.data.activity.points = [{ t: 1_700_001_000_000, chat: 12, emotes: 3, seventv: 3, viewers: 1200 }]
      await act(async () => { repair.resolve(recent) })

      expect(result.current.activityRefreshing).toBe(false)
      expect(result.current.pollSequence).toBe(1)
      expect(result.current.lastSuccessfulPollAt).not.toBeNull()
      expect(result.current.data?.poolSize).toBe(primary.data.poolSize)
      expect(result.current.data?.livePulseMoments).toEqual(primary.data.livePulseMoments)
      expect(result.current.data?.activity.points).toEqual(recent.data.activity.points)
      expect(result.current.data?.activity).toMatchObject({ requestedWindowMinutes: 1440, servedWindowMinutes: 30 })
      expect(result.current.data?.generatedAt).toBe(recent.data.generatedAt)
      expect(readPublicHubCache(getBackendUrl(), '24h')?.data.activity.points).toEqual(recent.data.activity.points)
      expect(persist).toHaveBeenCalledTimes(1)
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
      expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    })

    it('does not overwrite the prior cache or freshness during a repair refresh', async () => {
      writePublicHubCache(getBackendUrl(), '24h', sampleHub(42))
      const repair = deferredHub()
      fetchPublicHubBase.mockResolvedValueOnce(repairHubResult(7)).mockReturnValueOnce(repair.promise)
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      const priorTimestamp = result.current.lastSuccessfulPollAt
      await waitFor(() => expect(result.current.activityRefreshing).toBe(true))
      expect(result.current.data?.poolSize).toBe(7)
      expect(result.current.data?.activity.points).toEqual([])
      expect(result.current.pollSequence).toBe(1)
      expect(result.current.lastSuccessfulPollAt).toBe(priorTimestamp)
      expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(42)
      await act(async () => { repair.resolve(hubResult(99)) })
      expect(result.current.pollSequence).toBe(2)
      expect(result.current.activityRefreshing).toBe(false)
      expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(7)
    })

    it.each(['rate_limited', 'unauthorized'])('associates a new repair shell with its own display time after %s', async kind => {
      writePublicHubCache(getBackendUrl(), '24h', sampleHub(42))
      const key = publicHubCacheKey(getBackendUrl(), '24h')
      const saved = JSON.parse(localStorage.getItem(key)!)
      const startedAt = Date.now()
      saved.cachedAt = startedAt - 2 * 60 * 60_000
      localStorage.setItem(key, JSON.stringify(saved))
      fetchPublicHubBase.mockResolvedValueOnce(repairHubResult(7))
        .mockRejectedValueOnce({ kind, status: kind === 'rate_limited' ? 429 : 401, message: 'stop' })

      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      expect(result.current.displayedSnapshotAt).toBe(saved.cachedAt)
      await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(result.current.activityRefreshing).toBe(false))

      expect(result.current.data?.poolSize).toBe(7)
      expect(result.current.loadSource).toBe('full')
      expect(result.current.displayedSnapshotAt).toBeGreaterThanOrEqual(startedAt)
      expect(result.current.displayedSnapshotAt).toBeLessThanOrEqual(Date.now())
      expect(result.current.lastSuccessfulPollAt).toBe(saved.cachedAt)
      expect(result.current.pollSequence).toBe(1)
      expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(42)
      expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    })

    it.each(['server', 'timeout', 'unreachable', 'unhealthy'])('accepts an honest empty activity projection after %s repair failure', async kind => {
      const repair = deferredHub()
      fetchPublicHubBase.mockResolvedValueOnce(repairHubResult()).mockReturnValueOnce(repair.promise)
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      await waitFor(() => expect(result.current.activityRefreshing).toBe(true))
      await act(async () => {
        if (kind === 'unhealthy') repair.resolve(hubDown())
        else repair.reject({ kind, status: 503, message: 'repair unavailable' })
      })
      expect(result.current.activityRefreshing).toBe(false)
      expect(result.current.pollSequence).toBe(1)
      expect(result.current.hubEndpointOk).toBe(true)
      expect(result.current.error).toBeNull()
      expect(result.current.data?.livePulseMomentsStatus).toBe('ready')
      expect(result.current.data?.activity).toMatchObject({ points: [], state: 'degraded', reason: 'historical_projection_unavailable' })
      expect(readPublicHubCache(getBackendUrl(), '24h')?.data.activity.points).toEqual([])
      expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    })

    it.each(['unauthorized', 'aborted'])('does not accept provisional lanes as a successful poll after %s repair refusal', async kind => {
      fetchPublicHubBase.mockResolvedValueOnce(repairHubResult())
        .mockRejectedValueOnce({ kind, status: 401, message: 'stop' })
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(result.current.activityRefreshing).toBe(false))
      expect(result.current.loading).toBe(false)
      expect(result.current.pollSequence).toBe(0)
      expect(result.current.lastSuccessfulPollAt).toBeNull()
      expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
      expect(result.current.data?.activity.points).toEqual([])
      expect(result.current.error).toBe(kind === 'aborted' ? null : 'stop')
      expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    })

    it('honors repair Retry-After without accepting provisional data or refreshing early', async () => {
      vi.useFakeTimers()
      fetchPublicHubBase.mockResolvedValueOnce(repairHubResult())
        .mockRejectedValueOnce({ kind: 'rate_limited', status: 429, message: 'wait', retryAfterMs: 75_000 })
        .mockResolvedValue(hubResult(9))
      const { result } = renderHook(() => usePublicHubData({ pollMs: 45_000, random: () => 0.5 }))
      await act(async () => { await Promise.resolve() })
      expect(result.current.activityRefreshing).toBe(false)
      expect(result.current.error).toBe('wait')
      expect(result.current.hubEndpointOk).toBe(false)
      expect(result.current.pollSequence).toBe(0)
      expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(74_999)
        result.current.refresh()
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
      expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(3)
      expect(result.current.data?.poolSize).toBe(9)
      expect(result.current.pollSequence).toBe(1)
    })

    it('keeps the new repair loading state when a superseded range repair finishes late', async () => {
      const oldRepair = deferredHub()
      const newRepair = deferredHub()
      fetchPublicHubBase.mockResolvedValueOnce(repairHubResult(3))
        .mockReturnValueOnce(oldRepair.promise)
        .mockResolvedValueOnce(repairHubResult(7, 10080))
        .mockReturnValueOnce(newRepair.promise)
      const { result, rerender } = renderHook(
        ({ range }: { range: PublicHubActivityWindow }) => usePublicHubData({ pollMs: 0, activityWindow: range }),
        { initialProps: { range: '24h' as PublicHubActivityWindow } },
      )
      await waitFor(() => expect(result.current.activityRefreshing).toBe(true))
      const oldSignal = fetchPublicHubBase.mock.calls[1]?.[0] as AbortSignal
      rerender({ range: '7d' })
      await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(4))
      expect(oldSignal.aborted).toBe(true)
      expect(result.current.data?.poolSize).toBe(7)
      await act(async () => { oldRepair.resolve(hubResult(500)) })
      expect(result.current.data?.poolSize).toBe(7)
      expect(result.current.activityRefreshing).toBe(true)
      expect(result.current.pollSequence).toBe(0)
      expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
      await act(async () => { newRepair.resolve(hubResult(99)) })
      expect(result.current.activityRefreshing).toBe(false)
      expect(result.current.pollSequence).toBe(1)
      expect(result.current.data?.activity.requestedWindowMinutes).toBe(10080)
      expect(readPublicHubCache(getBackendUrl(), '7d')?.data.poolSize).toBe(7)
    })

    it('does not let a superseded repair override a manual refresh', async () => {
      const repair = deferredHub()
      fetchPublicHubBase.mockResolvedValueOnce(repairHubResult())
        .mockReturnValueOnce(repair.promise).mockResolvedValueOnce(hubResult(9))
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      await waitFor(() => expect(result.current.activityRefreshing).toBe(true))
      const signal = fetchPublicHubBase.mock.calls[1]?.[0] as AbortSignal
      await act(async () => { result.current.refresh() })
      expect(signal.aborted).toBe(true)
      expect(result.current.data?.poolSize).toBe(9)
      expect(result.current.activityRefreshing).toBe(false)
      await act(async () => { repair.resolve(hubResult(500)) })
      expect(result.current.data?.poolSize).toBe(9)
      expect(result.current.pollSequence).toBe(1)
      expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(9)
    })

    it('clears repair loading on disable and does not cache a late result', async () => {
      writePublicHubCache(getBackendUrl(), '24h', sampleHub(42))
      const repair = deferredHub()
      fetchPublicHubBase.mockResolvedValueOnce(hubResult(42))
        .mockResolvedValueOnce(repairHubResult(7, 10080)).mockReturnValueOnce(repair.promise)
      const { result, rerender } = renderHook(
        ({ enabled, range }: { enabled: boolean; range: PublicHubActivityWindow }) => usePublicHubData({ pollMs: 0, enabled, activityWindow: range }),
        { initialProps: { enabled: true, range: '24h' as PublicHubActivityWindow } },
      )
      await waitFor(() => expect(result.current.pollSequence).toBe(2))
      rerender({ enabled: true, range: '7d' })
      await waitFor(() => expect(result.current.activityRefreshing).toBe(true))
      await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(3))
      const signal = fetchPublicHubBase.mock.calls[2]?.[0] as AbortSignal
      rerender({ enabled: false, range: '7d' })
      expect(signal.aborted).toBe(true)
      expect(result.current.activityRefreshing).toBe(false)
      await act(async () => { repair.resolve(hubResult(99)) })
      expect(result.current.pollSequence).toBe(2)
      expect(readPublicHubCache(getBackendUrl(), '7d')).toBeNull()
    })
  })

  it.each(['server', 'timeout', 'unreachable'])('recovers a typed %s history failure with explicitly scoped live health', async (kind) => {
    const recent = hubResult(500)
    recent.data.activity.windowMinutes = 30
    fetchPublicHubBase.mockRejectedValueOnce({ kind, status: 503, message: 'history unavailable' })
      .mockResolvedValueOnce(recent)
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHubBase.mock.calls.map(call => call[1])).toEqual(['24h', '30m'])
    expect(result.current.data?.poolSize).toBe(500)
    expect(result.current.data?.activity).toMatchObject({
      windowMinutes: 1440, requestedWindowMinutes: 1440, servedWindowMinutes: 30,
      source: 'live_pool_fallback', state: 'degraded',
    })
    expect(result.current.hubEndpointOk).toBe(true)
    expect(result.current.loadSource).toBe('full')
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(readPublicHubCache(getBackendUrl(), '30m')).toBeNull()
    expect(readPublicHubCache(getBackendUrl(), '24h')?.data.activity.servedWindowMinutes).toBe(30)
  })

  it('uses totals only when both historical and recent reads fail without a prior snapshot', async () => {
    fetchPublicHubBase.mockRejectedValue({ kind: 'server', status: 503, message: 'unavailable' })
    fetchPublicHubStatsFallback.mockResolvedValue(statsFallbackResult(0))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(result.current.loadSource).toBe('stats-fallback')
    expect(result.current.hubEndpointOk).toBe(false)
  })

  it.each(['moments', 'tickers'] as const)('passes a failed %s projection read on without waiting on totals', async (projection) => {
    fetchPublicHubBase.mockRejectedValue({ kind: 'timeout', status: 0, message: 'Request deadline exceeded' })
    fetchPublicHubStatsFallback.mockResolvedValue(statsFallbackResult(0))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m', projection }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(result.current.error).toBe(HUB_TIMEOUT_MESSAGE)
    expect(result.current.data).toBeNull()
    expect(result.current.loadSource).toBeNull()
    expect(result.current.hubEndpointOk).toBe(false)
  })

  it('keeps an unhealthy projection read off totals too', async () => {
    fetchPublicHubStatsFallback.mockResolvedValue(statsFallbackResult(2))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m', projection: 'moments' }))
    await waitFor(() => expect(result.current.error).toBe('hub offline'))
    expect(result.current.loading).toBe(false)
    expect(result.current.data).toBeNull()
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
  })

  it('still shows totals after a failed read without a projection', async () => {
    fetchPublicHubBase.mockRejectedValue({ kind: 'timeout', status: 0, message: 'Request deadline exceeded' })
    fetchPublicHubStatsFallback.mockResolvedValue(statsFallbackResult(0))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m' }))
    await waitFor(() => expect(result.current.loadSource).toBe('stats-fallback'))
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()
  })

  it('preserves a prior measured snapshot when both window reads fail', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(42))
    fetchPublicHubBase.mockRejectedValue({ kind: 'server', status: 503, message: 'unavailable' })
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.error).toBe('unavailable'))
    expect(result.current.data?.poolSize).toBe(42)
    expect(result.current.hubEndpointOk).toBe(false)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
  })

  it.each(['rate_limited', 'unauthorized', 'bad_request', 'aborted'])('never bypasses %s via a recovery request', async (kind) => {
    fetchPublicHubBase.mockRejectedValue({ kind, status: 429, message: 'stop' })
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
  })

  it.each(['invalid_json_response', 'invalid_hub_response'])('shows an error for %s instead of treating another window as healthy', async (code) => {
    fetchPublicHubBase.mockRejectedValue({ kind: 'server', status: 200, code, message: 'Invalid hub response' })
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Invalid hub response')
    expect(result.current.hubEndpointOk).toBe(false)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
  })

  it('does not apply a late recovery result after switching ranges', async () => {
    let resolveRecent!: (value: ReturnType<typeof hubResult>) => void
    fetchPublicHubBase.mockRejectedValueOnce({ kind: 'server', status: 503, message: 'history unavailable' })
      .mockImplementationOnce(() => new Promise(resolve => { resolveRecent = resolve }))
      .mockResolvedValueOnce(hubResult(7))
    const { result, rerender } = renderHook(
      ({ range }: { range: PublicHubActivityWindow }) => usePublicHubData({ pollMs: 0, activityWindow: range }),
      { initialProps: { range: '24h' as PublicHubActivityWindow } },
    )
    await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(2))
    rerender({ range: '7d' })
    await waitFor(() => expect(result.current.data?.poolSize).toBe(7))
    await act(async () => { resolveRecent(hubResult(500)) })
    expect(result.current.data?.poolSize).toBe(7)
    expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
  })

  it('stops the range-loading skeleton after both reads fail and retains measured data', async () => {
    fetchPublicHubBase.mockResolvedValueOnce(hubResult(42))
      .mockRejectedValue({ kind: 'server', status: 503, message: 'unavailable' })
    const { result, rerender } = renderHook(
      ({ range }: { range: PublicHubActivityWindow }) => usePublicHubData({ pollMs: 0, activityWindow: range }),
      { initialProps: { range: '24h' as PublicHubActivityWindow } },
    )
    await waitFor(() => expect(result.current.data?.poolSize).toBe(42))
    rerender({ range: '7d' })
    await waitFor(() => expect(result.current.error).toBe('unavailable'))
    expect(result.current.data?.poolSize).toBe(42)
    expect(result.current.refreshing).toBe(false)
    expect(result.current.activityRefreshing).toBe(false)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
  })

  it('restarts an aborted initial load during StrictMode effect replay', async () => {
    fetchPublicHubBase
      .mockImplementationOnce(
        (signal?: AbortSignal) =>
          new Promise((_, reject) => {
            signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            )
          }),
      )
      .mockResolvedValueOnce(hubResult(3))

    const wrapper = ({ children }: PropsWithChildren) => (
      <StrictMode>{children}</StrictMode>
    )
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }), { wrapper })

    await waitFor(() => expect(result.current.data?.poolSize).toBe(3))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
    expect(result.current.loading).toBe(false)
  })

  it('marks liveEmpty when the pool is empty', async () => {
    fetchPublicHubBase.mockResolvedValue(hubResult(0))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.liveEmpty).toBe(true)
  })

  it('surfaces an error message when the fetch rejects', async () => {
    fetchPublicHubStatsFallback.mockRejectedValue(new Error('hub offline'))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('hub offline')
    expect(result.current.data).toBeNull()
  })

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() => usePublicHubData({ enabled: false, pollMs: 0 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchPublicHubBase).not.toHaveBeenCalled()
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
    expect(fetchPublicHub).not.toHaveBeenCalled()
  })

  it('initializes from cache immediately and does not stay in loading state', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubResult(99))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loading).toBe(false)
    expect(result.current.data?.poolSize).toBe(8)
    expect(result.current.loadSource).toBe('cache')
    expect(result.current.cachedAt).not.toBeNull()
    await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalled())
  })

  it('keeps source data age separate from polling and across a six-hour saved copy', async () => {
    const receipt = Date.now()
    fetchPublicHubBase.mockResolvedValue({ ...hubResult(42), dataAsOf: receipt - 15 * 60_000 })
    const { result, unmount } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(42))
    expect(result.current.dataAsOf).toBe(receipt - 15 * 60_000)
    expect(result.current.lastSuccessfulPollAt).toBeGreaterThanOrEqual(receipt)
    publicHubCache.flushPublicHubCacheWritesForTests()
    const key = publicHubCacheKey(getBackendUrl(), '24h')
    const stored = JSON.parse(localStorage.getItem(key)!)
    expect(stored.dataAsOf).toBe(receipt - 15 * 60_000)
    unmount()
    // Move both anchors together to model an unchanged copy after 5h59m.
    stored.cachedAt -= (5 * 60 + 59) * 60_000
    stored.dataAsOf -= (5 * 60 + 59) * 60_000
    localStorage.setItem(key, JSON.stringify(stored))
    fetchPublicHubBase.mockReturnValue(new Promise(() => {}))
    const restored = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    expect(restored.result.current.dataAsOf).toBe(stored.dataAsOf)
    expect(Date.now() - restored.result.current.dataAsOf!).toBeGreaterThanOrEqual((6 * 60 + 14) * 60_000)
  })

  it.each([undefined, null])('upgrades a legacy or unknown saved age without extending lifetime (%s)', (priorAge) => {
    const now = Date.now()
    const hub = sampleHub(8)
    writePublicHubCache(getBackendUrl(), '24h', hub, undefined, priorAge)
    const key = publicHubCacheKey(getBackendUrl(), '24h')
    const previous = JSON.parse(localStorage.getItem(key)!)
    previous.cachedAt = now - 60_000
    localStorage.setItem(key, JSON.stringify(previous))
    writePublicHubCache(getBackendUrl(), '24h', hub, undefined, now - 15_000)
    const updated = JSON.parse(localStorage.getItem(key)!)
    expect(updated.cachedAt).toBe(previous.cachedAt)
    expect(updated.dataAsOf).toBe(previous.cachedAt)
    expect(readPublicHubCache(getBackendUrl(), '24h')?.dataAsOf).toBe(previous.cachedAt)
  })

  it('fetches fresh data after cache hydration', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubResult(42))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.data?.poolSize).toBe(8)
    expect(result.current.loadSource).toBe('cache')
    await waitFor(() => expect(result.current.data?.poolSize).toBe(42))
    expect(fetchPublicHubBase).toHaveBeenCalled()
    expect(result.current.loadSource).toBe('full')
    expect(result.current.refreshing).toBe(false)
  })

  it('shows a saved copy up to 6 hours old as cached data until the fresh read replaces it', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    const key = publicHubCacheKey(getBackendUrl(), '24h')
    const savedAt = Date.now() - (5 * 60 + 59) * 60_000
    localStorage.setItem(key, localStorage.getItem(key)!.replace(/"cachedAt":\d+/, `"cachedAt":${savedAt}`))
    const fresh = deferredHub()
    fetchPublicHubBase.mockReturnValue(fresh.promise)

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.data?.poolSize).toBe(8)
    expect(result.current).toMatchObject({ loading: false, refreshing: true, loadSource: 'cache', cachedAt: savedAt, lastUpdated: savedAt })
    await act(async () => { fresh.resolve(hubResult(42)) })
    expect(result.current).toMatchObject({ refreshing: false, loadSource: 'full', cachedAt: null })
    expect(result.current.data?.poolSize).toBe(42)
  })

  it.each([
    ['a 24h copy that is a 30m live-pool fallback', '24h'],
    ['a 30m tab copy', '30m'],
  ] as const)('does not show %s saved 30 minutes ago', async (_label, window) => {
    writePublicHubCache(getBackendUrl(), window, window === '24h' ? repairHubResult(8).data : sampleHub(8))
    const key = publicHubCacheKey(getBackendUrl(), window)
    const savedAt = Date.now() - 30 * 60_000
    localStorage.setItem(key, localStorage.getItem(key)!.replace(/"cachedAt":\d+/, `"cachedAt":${savedAt}`))
    fetchPublicHubBase.mockReturnValue(deferredHub().promise)

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: window }))

    expect(result.current).toMatchObject({ data: null, loading: true, loadSource: null, cachedAt: null })
  })

  it('shows refreshing while background fetch runs after cache hydration', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(hubResult(42)), 40)
        }),
    )

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loadSource).toBe('cache')
    expect(result.current.refreshing).toBe(true)
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    expect(result.current.data?.poolSize).toBe(42)
  })

  // D3 (10-28): the origin may still be building the read; starting over would only push its answer back.
  it('manual refresh waits on the read under way instead of starting it over', async () => {
    let resolveFirst: ((value: ReturnType<typeof hubResult>) => void) | undefined
    fetchPublicHubBase
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockResolvedValueOnce(hubResult(99))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(1))

    act(() => result.current.refresh())
    expect(result.current.loading).toBe(true)
    expect((fetchPublicHubBase.mock.calls[0][0] as AbortSignal).aborted).toBe(false)
    await act(async () => { resolveFirst?.(hubResult(1)) })
    await waitFor(() => expect(result.current.data?.poolSize).toBe(1))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

    // Once it has settled, refresh reads anew.
    await act(async () => { result.current.refresh() })
    await waitFor(() => expect(result.current.data?.poolSize).toBe(99))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
  })

  it('writes successful fresh hub data to cache', async () => {
    fetchPublicHubBase.mockResolvedValue(hubResult(17))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(17))

    const cached = readPublicHubCache(getBackendUrl(), '24h')
    expect(cached?.data.poolSize).toBe(17)
    expect(typeof cached?.cachedAt).toBe('number')
  })

  it('never persists a poll that crashes its page, so a reload refetches instead of re-crashing', async () => {
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
      state = { failed: false }
      static getDerivedStateFromError() { return { failed: true } }
      render() { return this.state.failed ? <p>crashed</p> : this.props.children }
    }
    let refresh = () => {}
    function Page() {
      const hub = usePublicHubData({ pollMs: 0 })
      refresh = hub.refresh
      // Stands in for any row the page cannot render.
      if (hub.data?.poolSize === 13) throw new Error('unrenderable snapshot')
      return <p>pool {hub.data?.poolSize ?? 'loading'}</p>
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchPublicHubBase.mockResolvedValueOnce(hubResult(5)).mockResolvedValueOnce(hubResult(13))
    render(<Boundary><Page /></Boundary>)
    expect(await screen.findByText('pool 5')).toBeTruthy()
    expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(5)

    await act(async () => { refresh() })
    expect(await screen.findByText('crashed')).toBeTruthy()
    expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(5)
  })

  it('drops a snapshot saved by a crash in a child effect, so a retry reads fresh instead of re-hydrating it', async () => {
    function EffectCrash({ poolSize }: { poolSize?: number }) {
      useEffect(() => { if (poolSize === 13) throw new Error('unrenderable snapshot') }, [poolSize])
      return null
    }
    let refresh = () => {}
    function Page() {
      const hub = usePublicHubData({ pollMs: 0 })
      refresh = hub.refresh
      return <><p>pool {hub.data?.poolSize ?? 'loading'}</p><EffectCrash poolSize={hub.data?.poolSize} /></>
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchPublicHubBase.mockResolvedValueOnce(hubResult(5)).mockResolvedValueOnce(hubResult(13)).mockResolvedValue(hubResult(5))
    const view = render(<PortalErrorBoundary resetKey="/analytics"><Page /></PortalErrorBoundary>)
    expect(await screen.findByText('pool 5')).toBeTruthy()

    await act(async () => { refresh() })
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    // The effect crash committed, and so saved, the snapshot before the boundary caught it.
    expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()

    // Following a link clears the error; the page must not re-hydrate the crash.
    view.rerender(<PortalErrorBoundary resetKey="/analytics/moments"><Page /></PortalErrorBoundary>)
    expect(await screen.findByText('pool 5')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).toBeNull()
  })

  it('stops saving snapshots once a boundary below the polling page has caught a crash', async () => {
    function RenderCrash({ poolSize }: { poolSize?: number }) {
      if (poolSize === 13) throw new Error('unrenderable snapshot')
      return <p>pool {poolSize ?? 'loading'}</p>
    }
    let refresh = () => {}
    function Page() {
      const hub = usePublicHubData({ pollMs: 0 })
      refresh = hub.refresh
      // The page (and its polling hook) stays mounted around its layout's boundary.
      return <PortalErrorBoundary><RenderCrash poolSize={hub.data?.poolSize} /></PortalErrorBoundary>
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchPublicHubBase.mockResolvedValueOnce(hubResult(5)).mockResolvedValueOnce(hubResult(13)).mockResolvedValue(hubResult(7))
    render(<Page />)
    expect(await screen.findByText('pool 5')).toBeTruthy()
    expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(5)

    await act(async () => { refresh() })
    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeTruthy()
    expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()

    await act(async () => { refresh() })
    expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
  })

  it('re-validates a cached snapshot so a wrong-typed row cannot crash the hydrate', () => {
    const poisoned = sampleHub(4)
    poisoned.liveChannels = [
      { login: 'xqc', displayName: { hostile: true }, viewers: 1, chatPerMin: 1, seventvPerMin: 1, coverageState: 'synced', trendPct: 0 },
      { login: null, viewers: 1, chatPerMin: 1, seventvPerMin: 1, coverageState: 'synced', trendPct: 0 },
    ] as unknown as PublicHub['liveChannels']
    writePublicHubCache(getBackendUrl(), '24h', poisoned)
    fetchPublicHubBase.mockReturnValue(new Promise(() => {}))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loadSource).toBe('cache')
    expect(result.current.data?.liveChannels.map((channel) => channel.login)).toEqual(['xqc'])
    expect(result.current.data?.liveChannels[0].displayName).toBeUndefined()
  })

  it('ignores corrupted cache and cold-starts loading', async () => {
    localStorage.setItem(publicHubCacheKey(getBackendUrl(), '24h'), '{not-json')
    fetchPublicHubBase.mockResolvedValue(hubResult(5))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loading).toBe(true)
    expect(result.current.data).toBeNull()
    await waitFor(() => expect(result.current.data?.poolSize).toBe(5))
  })

  it('rejects a stale coarse fallback from the browser cache', () => {
    const staleFallback = normalizePublicHub({
      activity: {
        windowMinutes: 1440,
        requestedWindowMinutes: 1440,
        servedWindowMinutes: 30,
        availableWindowMinutes: 30,
        source: 'live_pool_fallback',
        state: 'degraded',
        channelCount: 1,
        points: [
          { t: 1_700_000_000_000, chat: 10, emotes: 2, seventv: 0, viewers: 100 },
          { t: 1_700_003_600_000, chat: 12, emotes: 3, seventv: 0, viewers: 110 },
        ],
      },
    })

    writePublicHubCache(getBackendUrl(), '24h', staleFallback)

    expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
  })

  it('cache key changes by activityWindow', async () => {
    writePublicHubCache(getBackendUrl(), '7d', sampleHub(7))
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(24))

    // Defer network so cache hydrate can be asserted before the in-flight response lands.
    const pendingResolvers: Array<(value: ReturnType<typeof hubResult>) => void> = []
    fetchPublicHubBase.mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingResolvers.push(resolve)
        }),
    )

    const { result, rerender } = renderHook(
      ({ activityWindow }: { activityWindow: PublicHubActivityWindow }) =>
        usePublicHubData({ pollMs: 0, activityWindow }),
      { initialProps: { activityWindow: '7d' } },
    )

    expect(result.current.data?.poolSize).toBe(7)
    expect(result.current.loadSource).toBe('cache')
    expect(result.current.loading).toBe(false)

    act(() => {
      rerender({ activityWindow: '24h' })
    })
    expect(result.current.data?.poolSize).toBe(24)
    expect(result.current.loadSource).toBe('cache')
    expect(result.current.loading).toBe(false)

    await act(async () => {
      for (const resolve of pendingResolvers.splice(0)) {
        resolve(hubResult(100))
      }
    })
    await waitFor(() => expect(result.current.data?.poolSize).toBe(100))
  })

  it('reads public-hub cache once on mount across unrelated rerenders', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubResult(42))
    const spy = vi.spyOn(publicHubCache, 'readPublicHubCacheForCurrentBackend')

    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => usePublicHubData({ pollMs: 0, activityWindow: '24h' }),
      { initialProps: { tick: 0 } },
    )

    expect(result.current.data?.poolSize).toBe(8)
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ tick: 1 })
      rerender({ tick: 2 })
    })
    expect(spy).toHaveBeenCalledTimes(1)

    await waitFor(() => expect(result.current.data?.poolSize).toBe(42))
    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })

  it('reads public-hub cache once per real activity-window transition', async () => {
    writePublicHubCache(getBackendUrl(), '7d', sampleHub(7))
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(24))
    fetchPublicHubBase.mockResolvedValue(hubResult(100))
    const spy = vi.spyOn(publicHubCache, 'readPublicHubCacheForCurrentBackend')

    const { result, rerender } = renderHook(
      ({ activityWindow }: { activityWindow: PublicHubActivityWindow }) =>
        usePublicHubData({ pollMs: 0, activityWindow }),
      { initialProps: { activityWindow: '7d' as PublicHubActivityWindow } },
    )

    expect(result.current.data?.poolSize).toBe(7)
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => {
      rerender({ activityWindow: '24h' })
    })
    await waitFor(() => expect(result.current.data?.poolSize).toBe(24))
    expect(spy).toHaveBeenCalledTimes(2)

    act(() => {
      rerender({ activityWindow: '24h' })
    })
    expect(spy).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('uses stats fallback without a second full-hub request when base is unhealthy', async () => {
    fetchPublicHubStatsFallback.mockResolvedValue(statsFallbackResult(2))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data?.poolSize).toBe(2)
    expect(result.current.loadSource).toBe('stats-fallback')
    expect(result.current.hubEndpointOk).toBe(false)
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(fetchPublicHubStatsFallback).toHaveBeenCalledTimes(1)
    expect(fetchPublicHub).not.toHaveBeenCalled()
    expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
  })

  it('does not call stats fallback after a successful base hub fetch', async () => {
    fetchPublicHubBase.mockResolvedValue(hubResult(9))
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    await waitFor(() => expect(result.current.data?.poolSize).toBe(9))
    expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
    expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
  })

  it('clears hubEndpointOk when a refresh fails after cache hydration', async () => {
    writePublicHubCache(getBackendUrl(), '24h', sampleHub(8))
    fetchPublicHubBase.mockResolvedValue(hubDown())
    fetchPublicHubStatsFallback.mockRejectedValue(new Error('hub offline'))

    const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))

    expect(result.current.loadSource).toBe('cache')
    expect(result.current.hubEndpointOk).toBe(true)

    await waitFor(() => expect(result.current.error).toBe('hub offline'))
    expect(result.current.data?.poolSize).toBe(8)
    expect(result.current.hubEndpointOk).toBe(false)
  })

  describe('visibility controls (P4-L05)', () => {
    let visibilityState = 'visible'

    beforeEach(() => {
      visibilityState = 'visible'
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => visibilityState,
      })
    })

    afterEach(() => {
      vi.useRealTimers()
      visibilityState = 'visible'
    })

    it('skips interval fetch while the tab is hidden', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      fetchPublicHubBase.mockResolvedValue(hubResult(3))

      const { result } = renderHook(() => usePublicHubData({ pollMs: 10_000 }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(3))
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

      visibilityState = 'hidden'
      fetchPublicHubBase.mockClear()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      expect(fetchPublicHubBase).not.toHaveBeenCalled()
    })

    it('catch-up fetches when the tab becomes visible after the poll window', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      fetchPublicHubBase.mockResolvedValue(hubResult(3))

      const { result } = renderHook(() => usePublicHubData({ pollMs: 10_000 }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(3))
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

      visibilityState = 'hidden'
      fetchPublicHubBase.mockClear()

      // Expire catch-up gate: sinceLastFetch < min(pollMs/2, 15s) → 5s for pollMs=10s
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000)
      })
      expect(fetchPublicHubBase).not.toHaveBeenCalled()

      visibilityState = 'visible'
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(1))
    })

    it('does not catch-up when becoming visible inside the debounce window', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      fetchPublicHubBase.mockResolvedValue(hubResult(3))

      const { result } = renderHook(() => usePublicHubData({ pollMs: 10_000 }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(3))

      visibilityState = 'hidden'
      fetchPublicHubBase.mockClear()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })

      visibilityState = 'visible'
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
      })

      expect(fetchPublicHubBase).not.toHaveBeenCalled()
    })
  })

  describe('failure backoff + Retry-After', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('does not poll faster than healthy cadence after hub soft-failure', async () => {
      vi.useFakeTimers()
      fetchPublicHubBase
        .mockResolvedValueOnce(hubResult(5))
        .mockResolvedValue(hubDown())

      renderHook(() =>
        usePublicHubData({ pollMs: 45_000, random: () => 0.5 }),
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(44_999)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(3)
    })

    it('honors 429 Retry-After when longer than healthy cadence', async () => {
      vi.useFakeTimers()
      fetchPublicHubBase
        .mockResolvedValueOnce(hubResult(5))
        .mockRejectedValueOnce({
          kind: 'rate_limited',
          message: 'rate limited',
          status: 429,
          retryAfterMs: 75_000,
        })
        .mockResolvedValue(hubResult(5))

      const { result } = renderHook(() =>
        usePublicHubData({ pollMs: 45_000, random: () => 0.5 }),
      )

      await act(async () => {
        await Promise.resolve()
      })
      expect(result.current.data?.poolSize).toBe(5)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
      expect(result.current.hubEndpointOk).toBe(false)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(74_999)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(3)
    })

    it('honors an initial Retry-After across refresh and visibility without fallback fan-out', async () => {
      vi.useFakeTimers()
      fetchPublicHubBase.mockRejectedValueOnce({ kind: 'rate_limited', status: 429, message: 'wait', retryAfterMs: 75_000 })
        .mockResolvedValue(hubResult(5))
      const { result } = renderHook(() => usePublicHubData({ pollMs: 45_000, random: () => 0.5 }))
      await act(async () => { await Promise.resolve() })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000)
        result.current.refresh()
        document.dispatchEvent(new Event('visibilitychange'))
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)
      expect(fetchPublicHubStatsFallback).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
      expect(result.current.data?.poolSize).toBe(5)
    })

    it('floors short Retry-After at healthy cadence', async () => {
      vi.useFakeTimers()
      fetchPublicHubBase
        .mockResolvedValueOnce(hubResult(5))
        .mockRejectedValueOnce({
          kind: 'rate_limited',
          message: 'rate limited',
          status: 429,
          retryAfterMs: 5_000,
        })
        .mockResolvedValue(hubResult(5))

      renderHook(() => usePublicHubData({ pollMs: 45_000, random: () => 0.5 }))

      await act(async () => {
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(45_000)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(44_999)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
        await Promise.resolve()
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(3)
    })

    it('ends retryBlocked when the Retry-After pause ends, with no read to clear it', async () => {
      vi.useFakeTimers()
      fetchPublicHubBase
        .mockRejectedValueOnce({ kind: 'rate_limited', status: 429, message: 'wait', retryAfterMs: 60_000 })
        .mockResolvedValue(hubResult(5))
      // Polling off: nothing reads again on its own, so only the pause ending can offer Try again.
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(result.current.retryBlocked).toBe(true)

      await act(async () => { await vi.advanceTimersByTimeAsync(59_999) })
      expect(result.current.retryBlocked).toBe(true)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(result.current.retryBlocked).toBe(false)
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(1)

      await act(async () => {
        result.current.refresh()
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)
      expect(result.current.data?.poolSize).toBe(5)
    })

    it('offers Try again and polls when a pressed read\'s pause ends, though a poll fell inside it', async () => {
      vi.useFakeTimers()
      const pressed = deferredHub()
      fetchPublicHubBase
        .mockResolvedValueOnce(hubResult(5))
        // A healthy poll, settled before Try again is pressed (a press waits on a read under way).
        .mockResolvedValueOnce(hubResult(5))
        .mockImplementationOnce(() => pressed.promise)
        .mockResolvedValue(hubResult(6))
      // random 0: a healthy poll comes 15% early, every 38.25 s.
      const { result } = renderHook(() => usePublicHubData({ pollMs: 45_000, random: () => 0 }))
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(result.current.data?.poolSize).toBe(5)
      await act(async () => { await vi.advanceTimersByTimeAsync(38_250) })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(2)

      // The poll arms the next one 38.25 s out; then the pressed read names a 60 s pause.
      await act(async () => {
        result.current.refresh()
        await vi.advanceTimersByTimeAsync(1_000)
      })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(3)
      await act(async () => {
        pressed.reject({ kind: 'rate_limited', status: 429, message: 'wait', retryAfterMs: 60_000 })
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.retryBlocked).toBe(true)

      // The armed poll falls inside the pause and makes no request.
      await act(async () => { await vi.advanceTimersByTimeAsync(59_999) })
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(3)
      expect(result.current.retryBlocked).toBe(true)

      // The pause ends: Try again is offered and the next poll reads, not a full pause later.
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(result.current.retryBlocked).toBe(false)
      expect(fetchPublicHubBase).toHaveBeenCalledTimes(4)
      expect(result.current.data?.poolSize).toBe(6)
    })
  })
  describe('idle snapshot persistence and the hub-data mark (plan §2.6, §4.5)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      setHubGestureActive(false)
    })

    it('saves the committed snapshot in idle time with a 2 s timeout, not inside the commit', async () => {
      const idle = queueIdleCallbacks()
      fetchPublicHubBase.mockResolvedValue(hubResult(17))
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(17))

      expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
      expect(hasPendingPublicHubCacheWrite()).toBe(true)
      expect(idle.queued).toHaveLength(1)
      expect(idle.queued[0].options).toEqual({ timeout: 2_000 })

      act(() => idle.runAll())
      expect(hasPendingPublicHubCacheWrite()).toBe(false)
      expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(17)
    })

    it('waits while a chart gesture is in progress, then saves once it settles', async () => {
      fetchPublicHubBase.mockResolvedValue(hubResult(23))
      setHubGestureActive(true)
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0 }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(23))

      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)) })
      expect(readPublicHubCache(getBackendUrl(), '24h')).toBeNull()
      expect(hasPendingPublicHubCacheWrite()).toBe(true)

      setHubGestureActive(false)
      await waitFor(() => expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(23))
      expect(hasPendingPublicHubCacheWrite()).toBe(false)
    })

    it('never parses JSON on the write path, including when it evicts older windows', async () => {
      writePublicHubCache(getBackendUrl(), '7d', sampleHub(7))
      writePublicHubCache(getBackendUrl(), '30m', sampleHub(30))
      const idle = queueIdleCallbacks()
      fetchPublicHubBase.mockResolvedValue(hubResult(24))
      const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
      await waitFor(() => expect(result.current.data?.poolSize).toBe(24))

      const parse = vi.spyOn(JSON, 'parse')
      act(() => idle.runAll())
      expect(parse).not.toHaveBeenCalled()
      parse.mockRestore()

      const keys = Object.keys(localStorage).filter((key) => key.startsWith('sp:publicHub:v1:'))
      expect(keys).toHaveLength(2)
      expect(readPublicHubCache(getBackendUrl(), '24h')?.data.poolSize).toBe(24)
    })

    it('hydrates a repeat mount from the compact snapshot of a full-size hub', async () => {
      const big = fullSizeHub()
      fetchPublicHubBase.mockResolvedValue({ data: big, loadSource: 'full' as const, hubEndpointOk: true, status: 200 })
      const first = renderHook(() => usePublicHubData({ pollMs: 0 }))
      await waitFor(() => expect(first.result.current.data?.liveChannels).toHaveLength(500))

      const raw = localStorage.getItem(publicHubCacheKey(getBackendUrl(), '24h'))
      expect(raw).not.toBeNull()
      expect(raw!.length).toBeLessThanOrEqual(PUBLIC_HUB_CACHE_MAX_CHARS)
      expect(JSON.parse(raw!).version).toBe(2)
      first.unmount()

      fetchPublicHubBase.mockReturnValue(new Promise(() => {}))
      const second = renderHook(() => usePublicHubData({ pollMs: 0 }))
      const hydrated = second.result.current.data
      expect(second.result.current.loadSource).toBe('cache')
      expect(second.result.current.loading).toBe(false)
      expect(hydrated?.activity.points.map((point) => [point.t, point.chat, point.emotes, point.seventv, point.viewers]))
        .toEqual(big.activity.points.map((point) => [point.t, point.chat, point.emotes, point.seventv, point.viewers]))
      expect(hydrated?.activity.points[10].providerCoverage).toEqual(big.activity.points[10].providerCoverage)
      // Per-point top emotes are not kept; the next network read restores them.
      expect(hydrated?.activity.points.some((point) => (point.topEmotes?.length ?? 0) > 0)).toBe(false)
      expect(hydrated?.liveChannels.map((channel) => channel.login)).toEqual(big.liveChannels.map((channel) => channel.login))
      expect(hydrated?.liveChannels.map((channel) => [channel.viewers, channel.chatPerMin, channel.emotesPerMin]))
        .toEqual(big.liveChannels.map((channel) => [channel.viewers, channel.chatPerMin, channel.emotesPerMin]))
      // "× usual" and its tooltip N read the same gated backend values after hydrate.
      expect(hydrated?.liveChannels.map((channel) => screenerUsual(channel.screenerV1)))
        .toEqual(big.liveChannels.map((channel) => screenerUsual(channel.screenerV1)))
      expect(hydrated?.liveChannels.every((channel) => channel.screenerV1?.baselineMeasuredMinutes === 285)).toBe(true)
      second.unmount()
    })

    it('marks sp:hub-data once per page load: first full-hub read only', async () => {
      const marks: string[] = []
      const original = Object.getOwnPropertyDescriptor(performance, 'mark')
      Object.defineProperty(performance, 'mark', {
        configurable: true,
        writable: true,
        value: (name: string) => { marks.push(name) },
      })
      try {
        // Earlier tests in this file marked through the real API; start this load clean.
        performance.clearMarks?.(HUB_DATA_MARK)
        resetHubDataMarkForTests()
        fetchPublicHubBase.mockResolvedValue(hubResult(5))
        const projected = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '30m', projection: 'moments' }))
        await waitFor(() => expect(projected.result.current.data?.poolSize).toBe(5))
        expect(marks).toEqual([])
        projected.unmount()

        const first = renderHook(() => usePublicHubData({ pollMs: 0 }))
        await waitFor(() => expect(first.result.current.data?.poolSize).toBe(5))
        expect(marks).toEqual([HUB_DATA_MARK])
        fetchPublicHubBase.mockResolvedValue(hubResult(6))
        await act(async () => { first.result.current.refresh() })
        await waitFor(() => expect(first.result.current.data?.poolSize).toBe(6))
        first.unmount()

        const again = renderHook(() => usePublicHubData({ pollMs: 0 }))
        await waitFor(() => expect(fetchPublicHubBase).toHaveBeenCalledTimes(4))
        await waitFor(() => expect(again.result.current.loadSource).toBe('full'))
        expect(marks).toEqual([HUB_DATA_MARK])
        again.unmount()
      } finally {
        if (original) Object.defineProperty(performance, 'mark', original)
        else Reflect.deleteProperty(performance, 'mark')
        resetHubDataMarkForTests()
      }
    })
  })
})

// IRC-10 (fix, 10-30): the portal's own 30m read standing in for a longer window is tagged as such. It never
// carries the backend's historical_projection_unavailable, which only a backend fallback may state.
describe('usePublicHubData stand-in reason (IRC-10 fix, 10-30)', () => {
  beforeEach(() => {
    installIdleCallback((callback) => {
      callback(IDLE_DEADLINE)
      return 0
    })
    resetHubBucketSelectionForTests()
    clearPublicHubCacheForTests()
    fetchPublicHubBase.mockReset()
    fetchPublicHubStatsFallback.mockReset()
    fetchPublicHubStatsFallback.mockRejectedValue(new Error('Public hub unavailable'))
  })

  afterEach(() => {
    removeIdleCallback()
    resetHubBucketSelectionForTests()
  })

  const recentRead = () => {
    const recent = hubResult(99)
    recent.data.activity.windowMinutes = 30
    return recent
  }

  it('tags the early 30m view as the portal stand-in while the long window loads', async () => {
    const pending = deferredHub()
    fetchPublicHubBase.mockImplementation((_signal?: AbortSignal, window?: PublicHubActivityWindow) =>
      window === '30m' ? Promise.resolve(recentRead()) : pending.promise,
    )
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(99), { timeout: 2500 })
    expect(result.current.activityRefreshing).toBe(true)
    expect(result.current.data?.activity).toMatchObject({ source: 'live_pool_fallback', reason: 'portal_stand_in', requestedWindowMinutes: 1440 })
    await act(async () => { pending.resolve(hubResult(42)) })
  })

  it('tags the recovery after a failed long-window read as the portal stand-in, saved copy included', async () => {
    fetchPublicHubBase.mockImplementation((_signal?: AbortSignal, window?: PublicHubActivityWindow) =>
      window === '30m' ? Promise.resolve(recentRead()) : Promise.reject({ kind: 'server', status: 503, message: 'unavailable' }),
    )
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(99))
    await waitFor(() => expect(result.current.activityRefreshing).toBe(false))
    expect(result.current.data?.activity).toMatchObject({ source: 'live_pool_fallback', reason: 'portal_stand_in' })
    publicHubCache.flushPublicHubCacheWritesForTests()
    expect(readPublicHubCache(getBackendUrl(), '24h')?.data.activity.reason).toBe('portal_stand_in')
  })

  it('keeps the backend reason when the backend itself sent the fallback', async () => {
    fetchPublicHubBase.mockImplementation((_signal?: AbortSignal, window?: PublicHubActivityWindow) =>
      Promise.resolve(window === '30m' ? recentRead() : repairHubResult()),
    )
    const { result } = renderHook(() => usePublicHubData({ pollMs: 0, activityWindow: '24h' }))
    await waitFor(() => expect(result.current.data?.poolSize).toBe(3))
    await waitFor(() => expect(result.current.activityRefreshing).toBe(false))
    expect(result.current.data?.activity).toMatchObject({ source: 'live_pool_fallback', reason: 'historical_projection_unavailable' })
  })
})
