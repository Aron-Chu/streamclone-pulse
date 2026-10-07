import { Component, StrictMode, useEffect, type PropsWithChildren, type ReactNode } from 'react'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBackendUrl } from '../src/lib/apiClient'
import * as publicHubCache from '../src/lib/publicHubCache'
import {
  clearPublicHubCacheForTests,
  publicHubCacheKey,
  readPublicHubCache,
  writePublicHubCache,
} from '../src/lib/publicHubCache'
import { normalizePublicHub, type PublicHub, type PublicHubActivityWindow } from '../src/lib/publicHub'

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

import { usePublicHubData } from '../src/hooks/usePublicHubData'
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
  let resolve!: (value: ReturnType<typeof hubResult>) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<ReturnType<typeof hubResult>>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('usePublicHubData', () => {
  beforeEach(() => {
    clearPublicHubCacheForTests()
    fetchPublicHub.mockReset()
    fetchPublicHubBase.mockReset()
    fetchPublicHubStatsFallback.mockReset()
    fetchPublicHubBase.mockResolvedValue(hubDown())
    fetchPublicHubStatsFallback.mockRejectedValue(new Error('Public hub unavailable'))
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

  describe('independent live lanes during activity repair', () => {
    afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

    it('publishes verified live moments before repair, accepting and caching exactly one final snapshot', async () => {
      const primary = repairHubResult()
      const repair = deferredHub()
      const persist = vi.spyOn(publicHubCache, 'writePublicHubCacheForCurrentBackend')
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

  it('manual refresh aborts an in-flight fetch and applies the latest result', async () => {
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

    result.current.refresh()
    resolveFirst?.(hubResult(1))
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
  })
})
