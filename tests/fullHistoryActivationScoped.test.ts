// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/shared/storage.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/shared/storage.ts')>()
  return {
    ...actual,
    getDefaultChartWindow: vi.fn(async () => '60m' as const),
    setDefaultChartWindow: vi.fn(async () => undefined),
    migrateDefaultChartWindowToRecentV2Once: vi.fn(async () => undefined),
  }
})

vi.mock('../src/ui/PulseOverviewChart.tsx', () => ({
  PulseOverviewChart: ({ rollups, loading }: { rollups: unknown[]; loading?: boolean }) =>
    createElement('div', {
      'data-chart-point-count': rollups.length,
      'data-chart-loading': loading ? 'true' : 'false',
    }),
}))

vi.mock('../src/ui/PulseEmoteImg.tsx', () => ({
  PulseEmoteImg: () => null,
}))

vi.mock('../src/ui/GamesPlayedStrip.tsx', () => ({
  GamesPlayedStrip: () => null,
}))

vi.mock('../src/ui/SevenTvEmotePanel.tsx', () => ({
  SevenTvEmotePanel: () => null,
}))

import type { PulsePayload } from '../src/shared/messages.ts'
import {
  fullHistoryActivationKey,
  hasStableFullHistoryActivation,
  hasValidatedFullHistory,
  isFullHistoryUnlockedFor,
  makeFullHistoryActivation,
  sameFullHistoryActivation,
} from '../src/shared/fullHistoryAuth.ts'
import { getDefaultChartWindow, setDefaultChartWindow } from '../src/shared/storage.ts'
import { chartWindowNeedsFullFetch } from '../src/ui/chatActivityEmotes.ts'
import { LiveStatsBand } from '../src/ui/LiveStatsBand.tsx'

function recentOnlyRollups(currentOffsetSeconds: number, minutes = 60) {
  return Array.from({ length: minutes }, (_, index) => ({
    offsetSeconds: currentOffsetSeconds - (minutes - 1 - index) * 60,
    chatCount: 12,
    sevenTvEmoteCount: 3,
    totalEmoteCount: 3,
  }))
}

function makePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  const currentOffsetSeconds = overrides.currentOffsetSeconds ?? 7200
  return {
    login: 'streamer_a',
    isLive: true,
    tracking: true,
    streamId: 'stream-a',
    currentOffsetSeconds,
    rollups: recentOnlyRollups(currentOffsetSeconds),
    lanes: { composite: [1], chat: [1], seventv: [1] },
    recap: null,
    ...overrides,
  }
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('fullHistoryAuth helpers (B1)', () => {
  it('normalizes login and stream identifiers', () => {
    const activation = makeFullHistoryActivation({
      login: ' Streamer_A ',
      streamId: 42,
      vodId: ' vod-1 ',
    })
    expect(activation).toEqual({
      login: 'streamer_a',
      streamId: '42',
      vodId: 'vod-1',
    })
    expect(fullHistoryActivationKey(activation)).toBe('streamer_a|stream:42')
    expect(hasStableFullHistoryActivation(activation)).toBe(true)
  })

  it('prefers stream identity so later VOD linking does not create a new activation', () => {
    const current = makeFullHistoryActivation({
      login: 'a',
      streamId: 's1',
      vodId: '',
    })
    const unlocked = makeFullHistoryActivation({
      login: 'a',
      streamId: 's1',
      vodId: '',
    })
    expect(sameFullHistoryActivation(unlocked, current)).toBe(true)
    expect(isFullHistoryUnlockedFor(unlocked, current)).toBe(true)
    expect(
      sameFullHistoryActivation(
        makeFullHistoryActivation({ login: 'a', streamId: 's1', vodId: 'vod-later' }),
        current,
      ),
    ).toBe(true)
    expect(
      isFullHistoryUnlockedFor(
        makeFullHistoryActivation({ login: 'a', streamId: 's2', vodId: '' }),
        current,
      ),
    ).toBe(false)
  })

  it('fixture recent-only rollups need Full fetch for full window', () => {
    const payload = makePayload()
    expect(chartWindowNeedsFullFetch('full', payload, payload.currentOffsetSeconds)).toBe(true)
  })

  it('rejects short incomplete fullRollups and accepts coverage-spanning sparse history', () => {
    const activation = makeFullHistoryActivation({ login: 'streamer_a', streamId: 'stream-a' })
    const incomplete = makePayload({
      fullRollups: [
        { offsetSeconds: 0, chatCount: 1 },
        { offsetSeconds: 60, chatCount: 2 },
      ],
    })
    expect(hasValidatedFullHistory(incomplete, activation)).toBe(false)

    const sparse = makePayload({
      coverageStartOffsetSeconds: 2700,
      coverage: {
        state: 'partial_tracking',
        coverageStartOffsetSeconds: 2700,
        coverageEndOffsetSeconds: 7140,
        hasFullStreamCoverage: false,
        hasGaps: true,
        missingRanges: [{ fromOffsetSeconds: 3600, toOffsetSeconds: 4200 }],
        canBackfill: false,
        message: 'Partial coverage',
      },
      fullRollups: [
        { offsetSeconds: 2700, chatCount: 12 },
        { offsetSeconds: 3540, chatCount: 18 },
        { offsetSeconds: 4260, chatCount: 9 },
        { offsetSeconds: 7140, chatCount: 22 },
      ],
    })
    expect(hasValidatedFullHistory(sparse, activation)).toBe(true)
  })
})

describe('LiveStatsBand activation-scoped Full (B1)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    vi.clearAllMocks()
    vi.mocked(getDefaultChartWindow).mockResolvedValue('60m')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  function renderBand(
    props: Partial<ComponentProps<typeof LiveStatsBand>> & { payload: PulsePayload },
  ) {
    const successPayload = makeFullPayload(props.payload)
    const onRequestFullTimeline = props.onRequestFullTimeline ?? vi.fn(async () => ({
      ok: true as const,
      payload: successPayload,
    }))
    act(() => {
      root.render(
        createElement(LiveStatsBand, {
          backendUrl: 'http://localhost:8081',
          showLoadFromStart: true,
          onLoadFromStart: () => undefined,
          onRequestFullTimeline,
          ...props,
          payload: props.payload,
        }),
      )
    })
    return { onRequestFullTimeline }
  }

  function rerenderBand(props: Partial<ComponentProps<typeof LiveStatsBand>> & { payload: PulsePayload }) {
    act(() => {
      root.render(
        createElement(LiveStatsBand, {
          backendUrl: 'http://localhost:8081',
          showLoadFromStart: true,
          onLoadFromStart: () => undefined,
          onRequestFullTimeline: vi.fn(async () => ({ ok: true as const, payload: makeFullPayload(props.payload) })),
          ...props,
          payload: props.payload,
        }),
      )
    })
  }

  it('automatically requests Full exactly once for a stable activation despite rerenders', async () => {
    const payload = makePayload()
    const onRequestFullTimeline = vi.fn(async () => ({ ok: true as const, payload: makeFullPayload(payload) }))
    renderBand({ payload, onRequestFullTimeline })
    await flushMicrotasks()
    rerenderBand({ payload: { ...payload, currentOffsetSeconds: 7260 }, onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
  })

  it('resets the automatic latch when stream activation changes', async () => {
    const onRequestFullTimeline = vi.fn(async () => ({ ok: false as const, reason: 'incomplete_history' as const }))
    const payloadA = makePayload({ login: 'streamer_a', streamId: 'stream-a' })
    renderBand({ payload: payloadA, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    const payloadB = makePayload({ login: 'streamer_b', streamId: 'stream-b' })
    rerenderBand({ payload: payloadB, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(2)
  })

  it('stored Full preference still performs one automatic request', async () => {
    vi.mocked(getDefaultChartWindow).mockResolvedValue('full')
    const payload = makePayload()
    const onRequestFullTimeline = vi.fn(async () => ({ ok: true as const, payload: makeFullPayload(payload) }))
    renderBand({ payload: makePayload(), onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
  })

  it('failed automatic request exposes a bounded explicit retry', async () => {
    const payload = makePayload()
    const onRequestFullTimeline = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, reason: 'missing_payload' as const })
      .mockResolvedValueOnce({ ok: true as const, payload: makeFullPayload(payload) })
    renderBand({ payload, onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
    const retryButton = container.querySelector('[data-testid="load-full-history"]') as HTMLButtonElement
    expect(retryButton?.textContent).toMatch(/Retry full history/i)

    await act(async () => {
      retryButton.click()
      await Promise.resolve()
    })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(2)
  })

  it('keeps the recent chart points rendered after the Full request fails', async () => {
    const payload = makePayload({ currentOffsetSeconds: 7_200 })
    const onRequestFullTimeline = vi.fn(async () => ({
      ok: false as const,
      reason: 'request_failed' as const,
    }))
    renderBand({ payload, onRequestFullTimeline })
    await flushMicrotasks()

    const chart = container.querySelector('[data-chart-point-count]')
    expect(chart?.getAttribute('data-chart-point-count')).toBe(String(payload.rollups?.length ?? 0))
    expect(chart?.getAttribute('data-chart-loading')).toBe('false')
  })

  it('chart picker calls setDefaultChartWindow', async () => {
    vi.mocked(getDefaultChartWindow).mockResolvedValue('60m')
    renderBand({ payload: makePayload({ currentOffsetSeconds: 1800 }) })
    await flushMicrotasks()

    const fullStreamButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Full stream'),
    )
    expect(fullStreamButton).toBeDefined()

    await act(async () => {
      fullStreamButton!.click()
    })
    await flushMicrotasks()

    expect(setDefaultChartWindow).toHaveBeenCalledWith('full')
  })

  it('stream change while pending ignores the late result and requests the new activation once', async () => {
    let resolveA: ((result: { ok: false; reason: 'activation_changed' }) => void) | undefined
    const onRequestFullTimeline = vi.fn(
      () =>
        new Promise<{ ok: false; reason: 'activation_changed' }>(resolve => {
          resolveA = resolve
        }),
    )

    const payloadA = makePayload({ login: 'streamer_a', streamId: 'stream-a' })
    renderBand({ payload: payloadA, onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    const payloadB = makePayload({ login: 'streamer_b', streamId: 'stream-b' })
    rerenderBand({ payload: payloadB, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveA?.({ ok: false, reason: 'activation_changed' })
      await Promise.resolve()
    })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(2)
  })

  it('late storage hydration does not overwrite a user range pick', async () => {
    let resolveHydrate: ((value: '15m') => void) | undefined
    vi.mocked(getDefaultChartWindow).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveHydrate = resolve
        }),
    )

    const payloadA = makePayload({ login: 'streamer_a', streamId: 'stream-a' })
    const onRequestFullTimeline = vi.fn(async () => ({
      ok: false as const,
      reason: 'request_failed' as const,
    }))
    renderBand({ payload: payloadA, onRequestFullTimeline })
    await flushMicrotasks()

    const fullStreamButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Full stream'),
    )
    await act(async () => {
      fullStreamButton!.click()
    })

    await act(async () => {
      resolveHydrate?.('15m')
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushMicrotasks()

    const rangeButton = container.querySelector('button[aria-label="Chart time range"]')
    expect(rangeButton?.textContent).toContain('Full stream')
  })
})

function makeFullPayload(payload: PulsePayload): PulsePayload {
  const coverageStart = payload.coverageStartOffsetSeconds ?? payload.coverage?.coverageStartOffsetSeconds ?? 0
  const end = Math.max(coverageStart, payload.currentOffsetSeconds - 60)
  const fullRollups = Array.from(
    { length: Math.floor((end - coverageStart) / 60) + 1 },
    (_, index) => ({
      offsetSeconds: coverageStart + index * 60,
      chatCount: 12,
      sevenTvEmoteCount: 3,
      totalEmoteCount: 3,
    }),
  )
  return { ...payload, fullRollups }
}
