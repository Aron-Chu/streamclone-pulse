import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLiveActivity } from '../src/hooks/useLiveActivity'
import type { LiveActivityResponse } from '../src/lib/liveActivity'

function samplePayload(overrides: Partial<LiveActivityResponse> = {}): LiveActivityResponse {
  return {
    asOf: '2026-07-23T12:00:00.000Z',
    window: '6h',
    completeness: 'tracked_channels_only',
    metadata: {
      state: 'current',
      lastSuccessfulPollAt: '2026-07-23T11:59:40.000Z',
    },
    events: [
      {
        id: 'evt-1',
        kind: 'went_live',
        channel: { id: '1', login: 'xqc', displayName: 'xQc' },
        streamId: 's1',
        occurredAt: '2026-07-23T11:53:12.000Z',
        detectedAt: '2026-07-23T11:54:01.000Z',
        lastSeenLiveAt: null,
        timestampPrecision: 'twitch_started_at',
        source: 'metadata_poll',
      },
    ],
    ...overrides,
  }
}

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const fetchLiveActivity = vi.hoisted(() => vi.fn())

vi.mock('../src/lib/liveActivity', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/liveActivity')>(
    '../src/lib/liveActivity',
  )
  return {
    ...actual,
    fetchLiveActivity,
  }
})

describe('useLiveActivity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchLiveActivity.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('unmount aborts in-flight fetch', async () => {
    const d = deferred<LiveActivityResponse>()
    fetchLiveActivity.mockImplementation(() => d.promise)

    const { unmount } = renderHook(() =>
      useLiveActivity({ pollMs: 30_000, portalReadEnabled: true }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchLiveActivity).toHaveBeenCalledTimes(1)
    const signal = fetchLiveActivity.mock.calls[0]?.[0]?.signal as AbortSignal
    expect(signal.aborted).toBe(false)

    unmount()
    expect(signal.aborted).toBe(true)
  })

  it('slow request does not overlap next interval — aborts previous', async () => {
    const first = deferred<LiveActivityResponse>()
    const second = deferred<LiveActivityResponse>()
    let calls = 0
    fetchLiveActivity.mockImplementation(() => {
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    renderHook(() => useLiveActivity({ pollMs: 5_000, portalReadEnabled: true }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchLiveActivity).toHaveBeenCalledTimes(1)
    const firstSignal = fetchLiveActivity.mock.calls[0]?.[0]?.signal as AbortSignal

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(fetchLiveActivity).toHaveBeenCalledTimes(2)
    expect(firstSignal.aborted).toBe(true)

    await act(async () => {
      first.resolve(samplePayload({ events: [{ ...samplePayload().events[0]!, id: 'stale' }] }))
      second.resolve(samplePayload({ events: [{ ...samplePayload().events[0]!, id: 'fresh' }] }))
      await Promise.resolve()
      await Promise.resolve()
    })
  })

  it('older response cannot overwrite newer', async () => {
    const slow = deferred<LiveActivityResponse>()
    const fast = deferred<LiveActivityResponse>()
    let calls = 0
    fetchLiveActivity.mockImplementation(() => {
      calls += 1
      return calls === 1 ? slow.promise : fast.promise
    })

    const { result } = renderHook(() =>
      useLiveActivity({ pollMs: 60_000, portalReadEnabled: true }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchLiveActivity).toHaveBeenCalledTimes(1)

    await act(async () => {
      result.current.refetch()
      await Promise.resolve()
    })
    expect(fetchLiveActivity).toHaveBeenCalledTimes(2)

    await act(async () => {
      fast.resolve(samplePayload({ events: [{ ...samplePayload().events[0]!, id: 'newer' }] }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.allEvents[0]?.id).toBe('newer')

    await act(async () => {
      slow.resolve(samplePayload({ events: [{ ...samplePayload().events[0]!, id: 'older' }] }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.allEvents[0]?.id).toBe('newer')
  })

  it('failure retains prior payload with unavailable status', async () => {
    fetchLiveActivity
      .mockResolvedValueOnce(samplePayload())
      .mockRejectedValueOnce(new Error('boom'))

    const { result } = renderHook(() =>
      useLiveActivity({ pollMs: 2_000, portalReadEnabled: true }),
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.allEvents).toHaveLength(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.status).toBe('unavailable')
    expect(result.current.allEvents).toHaveLength(1)
    expect(result.current.allEvents[0]?.id).toBe('evt-1')
  })

  it('recovery updates after failure', async () => {
    fetchLiveActivity
      .mockResolvedValueOnce(samplePayload())
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(
        samplePayload({
          events: [{ ...samplePayload().events[0]!, id: 'evt-2' }],
        }),
      )

    const { result } = renderHook(() =>
      useLiveActivity({ pollMs: 2_000, portalReadEnabled: true }),
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('ready')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.status).toBe('unavailable')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.allEvents.map((e) => e.id)).toContain('evt-2')
  })

  it('New markers baseline only after first success', async () => {
    fetchLiveActivity
      .mockResolvedValueOnce(samplePayload())
      .mockResolvedValueOnce(
        samplePayload({
          events: [
            samplePayload().events[0]!,
            { ...samplePayload().events[0]!, id: 'evt-new' },
          ],
        }),
      )

    const { result } = renderHook(() =>
      useLiveActivity({ pollMs: 2_000, portalReadEnabled: true }),
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('ready')
    expect(result.current.newIds.size).toBe(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.newIds.has('evt-new')).toBe(true)
    expect(result.current.newIds.has('evt-1')).toBe(false)
  })

  it('portal read disabled → unavailable, no fetch', async () => {
    fetchLiveActivity.mockResolvedValue(samplePayload())

    const { result } = renderHook(() =>
      useLiveActivity({ pollMs: 1_000, portalReadEnabled: false }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.status).toBe('unavailable')
    expect(fetchLiveActivity).not.toHaveBeenCalled()
  })

  it('manual refetch aborts in-flight then starts new request', async () => {
    const first = deferred<LiveActivityResponse>()
    const second = deferred<LiveActivityResponse>()
    let calls = 0
    fetchLiveActivity.mockImplementation(() => {
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    const { result } = renderHook(() =>
      useLiveActivity({ pollMs: 60_000, portalReadEnabled: true }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    const firstSignal = fetchLiveActivity.mock.calls[0]?.[0]?.signal as AbortSignal

    await act(async () => {
      result.current.refetch()
      await Promise.resolve()
    })
    expect(firstSignal.aborted).toBe(true)
    expect(fetchLiveActivity).toHaveBeenCalledTimes(2)

    await act(async () => {
      second.resolve(samplePayload())
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('ready')
  })
})
