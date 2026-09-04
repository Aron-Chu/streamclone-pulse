import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetchNewsroom: vi.fn() }))

vi.mock('../src/lib/newsroom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/newsroom')>()),
  fetchNewsroom: mocks.fetchNewsroom,
}))

import { useNewsroomData } from '../src/hooks/useNewsroomData'
import type { NewsroomEnvelope, NewsroomLifecycle } from '../src/lib/newsroom'

const at = Date.UTC(2026, 7, 27, 12, 40)

function envelope(overrides: {
  id?: string
  revision?: number
  lifecycle?: NewsroomLifecycle
  notificationEligible?: boolean
  isLate?: boolean
} = {}): NewsroomEnvelope {
  const id = overrides.id ?? 'story-1'
  const lifecycle = overrides.lifecycle ?? 'developing'
  const revision = overrides.revision ?? 1
  const metric = {
    state: 'ready' as const,
    currentPerMin: 80,
    baselinePerMin: 40,
    absoluteDeltaPerMin: 40,
    changePct: 100,
    multiplier: 2,
    currentMeasuredMinutes: 1,
    currentExpectedMinutes: 1,
    baselineMeasuredMinutes: 24,
    baselineExpectedMinutes: 24,
    baselineCoveragePct: 100,
  }
  const evidence = {
    ircBound: true,
    eventRollupAvailable: true,
    streamIdentityMatched: true,
    rollupChatSource: 'irc' as const,
    rollupSourceConfidence: 'verified' as const,
    rollupSourceDetail: 'closed minute IRC rollup',
    metadataStreamMatched: true,
    metadataSampledAt: at,
    baselineMeasuredMinutes: 24,
    baselineExpectedMinutes: 24,
    baselineCoveragePct: 100,
  }
  const update = {
    id: `update-${id}-${revision}`,
    revision,
    detectorEventKey: `episode-${id}-${revision}`,
    updateKind: lifecycle === 'confirmed' ? 'lifecycle' as const : 'signal' as const,
    occurredAt: new Date(at + revision * 60_000).toISOString(),
    publishedAt: new Date(at + revision * 60_000 + 1_000).toISOString(),
    signal: 'emotes' as const,
    lifecycle,
    headline: `${id} is ${lifecycle}`,
    summary: 'Verified activity compared with this stream’s earlier measured baseline.',
    comparison: {
      baselineKind: 'current_stream_measured_average_before_event' as const,
      eventAt: at + revision * 60_000,
      baselineWindow: {
        start: at - 24 * 60_000,
        end: at,
        expectedMinutes: 24,
        measuredMinutes: 24,
        coveragePct: 100,
      },
      chat: metric,
      emotes: metric,
      evidence: {
        ...evidence,
      },
    },
    evidence,
    topEmotes: [],
    momentRef: {
      publicMomentId: `moment-${id}`,
      streamId: `stream-${id}`,
      occurrenceAt: at + revision * 60_000,
      offsetSeconds: 120,
    },
    notificationEligible: overrides.notificationEligible ?? true,
    isLate: overrides.isLate ?? false,
  }
  const story = {
    id,
    login: id,
    streamId: `stream-${id}`,
    lifecycle,
    primarySignal: 'emotes' as const,
    headline: update.headline,
    summary: update.summary,
    revision,
    createdAt: new Date(at).toISOString(),
    lastPublishedAt: update.publishedAt,
    leadUpdate: update,
    sources: [],
  }
  return {
    schemaVersion: 1,
    status: 'ready',
    generatedAt: update.publishedAt,
    dataThrough: update.occurredAt,
    snapshotAt: new Date(at + 10 * 60_000).toISOString(),
    window: 'live',
    leadStoryId: id,
    stories: [story],
  }
}

describe('useNewsroomData', () => {
  afterEach(() => mocks.fetchNewsroom.mockReset())

  it('silently baselines the first healthy response and announces only a later lifecycle transition', async () => {
    mocks.fetchNewsroom
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(envelope({ revision: 2, lifecycle: 'developing' }))
      .mockResolvedValueOnce(envelope({ revision: 3, lifecycle: 'confirmed' }))
    const { result } = renderHook(() => useNewsroomData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.data?.stories[0].revision).toBe(1))
    expect(result.current.announcement).toBe('')

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.stories[0].revision).toBe(2))
    expect(result.current.announcement).toBe('')

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.stories[0].revision).toBe(3))
    expect(result.current.announcement).toMatch(/story is now confirmed/i)
  })

  it('does not announce late corrections or stale recovery and resumes announcements afterward', async () => {
    mocks.fetchNewsroom
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(envelope({ revision: 2, lifecycle: 'developing', isLate: true }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(envelope({ revision: 3, lifecycle: 'confirmed' }))
      .mockResolvedValueOnce(envelope({ revision: 4, lifecycle: 'cooling' }))
    const { result } = renderHook(() => useNewsroomData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.data?.stories[0].revision).toBe(1))

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.stories[0].revision).toBe(2))
    expect(result.current.announcement).toBe('')

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.status).toBe('stale'))
    expect(result.current.data?.stories[0].revision).toBe(2)
    expect(result.current.error).toBe('offline')

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.stories[0].revision).toBe(3))
    expect(result.current.data?.status).toBe('ready')
    expect(result.current.announcement).toBe('')

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.stories[0].revision).toBe(4))
    expect(result.current.announcement).toMatch(/story is now cooling/i)
  })

  it('announces a genuinely new notification-eligible story after the baseline', async () => {
    mocks.fetchNewsroom
      .mockResolvedValueOnce(envelope())
      .mockResolvedValueOnce(envelope({ id: 'story-2' }))
    const { result } = renderHook(() => useNewsroomData({ pollMs: 0 }))
    await waitFor(() => expect(result.current.data?.leadStoryId).toBe('story-1'))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.data?.leadStoryId).toBe('story-2'))
    expect(result.current.announcement).toMatch(/^New Pulse story:/)
  })

  it('aborts and ignores old-window pagination after the canonical query changes', async () => {
    const live = { ...envelope(), nextCursor: 'live-next' }
    const oldPage = {
      ...envelope({ id: 'story-old-page' }),
      snapshotAt: live.snapshotAt,
      window: 'live' as const,
      nextCursor: undefined,
    }
    const sevenDay = {
      ...envelope({ id: 'story-seven-day' }),
      window: '7d' as const,
      snapshotAt: new Date(at + 20 * 60_000).toISOString(),
    }
    let resolveOldPage!: (value: NewsroomEnvelope) => void
    let oldPageSignal: AbortSignal | undefined
    mocks.fetchNewsroom
      .mockResolvedValueOnce(live)
      .mockImplementationOnce((options: { signal?: AbortSignal }) => {
        oldPageSignal = options.signal
        return new Promise<NewsroomEnvelope>((resolve) => { resolveOldPage = resolve })
      })
      .mockResolvedValueOnce(sevenDay)
    const { result, rerender } = renderHook(
      ({ window }) => useNewsroomData({ window, pollMs: 0 }),
      { initialProps: { window: 'live' as 'live' | '7d' } },
    )
    await waitFor(() => expect(result.current.data?.leadStoryId).toBe('story-1'))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.loadingMore).toBe(true))

    rerender({ window: '7d' })
    await waitFor(() => expect(result.current.data?.leadStoryId).toBe('story-seven-day'))
    expect(oldPageSignal?.aborted).toBe(true)
    await act(async () => {
      resolveOldPage(oldPage)
      await Promise.resolve()
    })
    expect(result.current.data?.window).toBe('7d')
    expect(result.current.data?.leadStoryId).toBe('story-seven-day')
    expect(result.current.error).toBeNull()
    expect(result.current.loadingMore).toBe(false)
  })
})
