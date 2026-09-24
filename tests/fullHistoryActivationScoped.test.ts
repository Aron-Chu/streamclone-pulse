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
    migrateDefaultChartWindowToFullV3Once: vi.fn(async () => undefined),
  }
})

vi.mock('../src/ui/PulseOverviewChart.tsx', () => ({
  PulseOverviewChart: ({ rollups, loading, viewport }: {
    rollups: unknown[]
    loading?: boolean
    viewport?: { startSeconds: number; endSeconds: number }
  }) =>
    createElement('div', {
      'data-chart-point-count': rollups.length,
      'data-chart-loading': loading ? 'true' : 'false',
      'data-viewport-start': viewport?.startSeconds,
      'data-viewport-end': viewport?.endSeconds,
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

  it('treats a changed start epoch as a new activation even when the stream ID is reused', () => {
    const first = makeFullHistoryActivation({
      login: 'xqc',
      streamId: 'reused-stream',
      startedAt: '2026-08-24T23:00:00-07:00',
    })
    const same = makeFullHistoryActivation({
      login: 'xqc',
      streamId: 'reused-stream',
      startedAt: '2026-08-25T06:00:00.000Z',
    })
    const corrected = makeFullHistoryActivation({
      login: 'xqc',
      streamId: 'reused-stream',
      startedAt: '2026-08-25T06:01:00.000Z',
    })

    expect(first.startedAt).toBe('2026-08-25T06:00:00.000Z')
    expect(sameFullHistoryActivation(first, same)).toBe(true)
    expect(sameFullHistoryActivation(first, corrected)).toBe(false)
    expect(fullHistoryActivationKey(first)).not.toBe(fullHistoryActivationKey(corrected))
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
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1440)
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
    vi.restoreAllMocks()
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

  async function selectRange(label: string) {
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Chart time range"]')!
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 120, 24))
    expect(trigger.disabled).toBe(false)
    await act(async () => trigger.click())
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .find(element => element.textContent?.includes(label))!
    expect(option).toBeDefined()
    await act(async () => option.click())
    expect(trigger.textContent).toContain(label)
  }

  function viewport() {
    const chart = container.querySelector('[data-chart-point-count]')!
    return {
      start: Number(chart.getAttribute('data-viewport-start')),
      end: Number(chart.getAttribute('data-viewport-end')),
    }
  }

  async function revealZoomControls() {
    if (!container.querySelector('[aria-label="Zoom in chart"]')) {
      const rail = container.querySelector<HTMLElement>('[role="slider"]')!
      expect(rail).not.toBeNull()
      await act(async () => { rail.dispatchEvent(new KeyboardEvent('keydown', { key: '[', bubbles: true })) })
    }
  }

  it('every preset controls the actual span and reselecting it resets a zoom', async () => {
    const payload = makeFullPayload(makePayload({ currentOffsetSeconds: 18000 }))
    renderBand({ payload })
    await flushMicrotasks()
    for (const [label, seconds] of [
      ['15 min', 900], ['30 min', 1800], ['1 hour', 3600],
      ['2 hours', 7200], ['4 hours', 14400], ['Full stream', 18000],
      ['1 hour', 3600], ['Full stream', 18000],
    ] as const) {
      await selectRange(label)
      const selected = viewport()
      expect(selected.end - selected.start).toBe(seconds)
      expect(selected.end).toBe(18000)
      await revealZoomControls()
      const zoom = container.querySelector<HTMLButtonElement>('[aria-label="Zoom in chart"]')!
      await act(async () => zoom.click())
      expect(viewport().end - viewport().start).toBeLessThan(seconds)
      await selectRange(label)
      expect(viewport()).toEqual(selected)
    }
  })

  it.each([120, 600, 21600])('all range presets keep zoom/reset inside a %s-second stream', async duration => {
    const payload = makeFullPayload(makePayload({ currentOffsetSeconds: duration }))
    renderBand({ payload })
    await flushMicrotasks()
    for (const [label, seconds] of [
      ['15 min', 900], ['30 min', 1800], ['1 hour', 3600],
      ['2 hours', 7200], ['4 hours', 14400], ['Full stream', duration],
    ] as const) {
      await selectRange(label)
      const span = Math.min(seconds, duration)
      expect(viewport()).toEqual({ start: duration - span, end: duration })
      if (duration <= 300) {
        expect(container.querySelector('[aria-label="Zoom in chart"]')).toBeNull()
        expect(container.querySelector('[role="slider"]')).not.toBeNull()
        continue
      }
      await revealZoomControls()
      const beforeZoom = viewport()
      const zoomIn = container.querySelector<HTMLButtonElement>('[aria-label="Zoom in chart"]')!
      const zoomOut = container.querySelector<HTMLButtonElement>('[aria-label="Zoom out chart"]')!
      const reset = container.querySelector<HTMLButtonElement>('[aria-label="Reset chart view"]')!
      expect(zoomIn.disabled).toBe(duration <= 300)
      expect(zoomOut.disabled).toBe(beforeZoom.end - beforeZoom.start >= span)
      if (!zoomIn.disabled) {
        await act(async () => zoomIn.click())
        const zoomed = viewport()
        expect(zoomed.end - zoomed.start).toBeLessThan(span)
        expect(zoomed.start).toBeGreaterThanOrEqual(0)
        expect(zoomed.end).toBeLessThanOrEqual(duration)
        await act(async () => zoomOut.click())
        expect(viewport().end - viewport().start).toBeCloseTo(beforeZoom.end - beforeZoom.start)
        await act(async () => reset.click())
        expect(viewport()).toEqual({ start: duration - span, end: duration })
      }
    }
  })

  it.each([true, false])('all presets remain usable during history loading (live=%s)', async isLive => {
    vi.mocked(getDefaultChartWindow).mockResolvedValue('full')
    const payload = makePayload({ currentOffsetSeconds: 18000, isLive })
    let finish!: (value: { ok: true; payload: PulsePayload }) => void
    const onRequestFullTimeline = vi.fn(() => new Promise<{ ok: true; payload: PulsePayload }>(resolve => { finish = resolve }))
    renderBand({ payload, isLive, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    for (const label of ['15 min', '30 min', '1 hour', '2 hours', '4 hours', 'Full stream', '1 hour']) {
      await selectRange(label)
    }
    await revealZoomControls()
    const zoom = container.querySelector<HTMLButtonElement>('[aria-label="Zoom in chart"]')!
    expect(zoom.disabled).toBe(false)
    await act(async () => zoom.click())
    const chosenViewport = viewport()
    await act(async () => finish({ ok: true, payload: makeFullPayload(payload) }))
    expect(viewport()).toEqual(chosenViewport)
    expect(setDefaultChartWindow).not.toHaveBeenCalled()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])('Full restores the stream prefix after a bounded range with partial history (validated=%s)', async validated => {
    const partial = makePayload({ currentOffsetSeconds: 18000, coverageStartOffsetSeconds: 14400 })
    const payload = validated ? makeFullPayload(partial) : partial
    renderBand({
      payload,
      coverageStartOffsetSeconds: 14400,
      onRequestFullTimeline: vi.fn(async () => ({ ok: false as const, reason: 'request_failed' as const })),
    })
    await flushMicrotasks()
    const fullViewport = viewport()
    expect(fullViewport.start).toBe(0)
    for (const label of ['15 min', '30 min', '1 hour', '2 hours', '4 hours']) {
      await selectRange(label)
      expect(viewport().start).toBeGreaterThanOrEqual(14400)
      await selectRange('Full stream')
      expect(viewport()).toEqual(fullViewport)
    }
  })

  it('late full history preserves a manually zoomed Full stream view', async () => {
    vi.mocked(getDefaultChartWindow).mockResolvedValue('full')
    const payload = makePayload()
    let finish!: (value: { ok: true; payload: PulsePayload }) => void
    renderBand({
      payload,
      onRequestFullTimeline: () => new Promise(resolve => { finish = resolve }),
    })
    await flushMicrotasks()
    await revealZoomControls()
    const zoom = container.querySelector<HTMLButtonElement>('[aria-label="Zoom in chart"]')!
    expect(zoom.disabled).toBe(false)
    await act(async () => zoom.click())
    const chosenViewport = viewport()
    await act(async () => finish({ ok: true, payload: makeFullPayload(payload) }))
    expect(viewport()).toEqual(chosenViewport)
  })

  it('a stale history failure cannot add a retry error to a different stream', async () => {
    vi.mocked(getDefaultChartWindow).mockResolvedValue('full')
    let fail!: (value: { ok: false; reason: 'request_failed' }) => void
    renderBand({
      payload: makePayload(),
      onRequestFullTimeline: () => new Promise(resolve => { fail = resolve }),
    })
    await flushMicrotasks()
    rerenderBand({ payload: makeFullPayload(makePayload({ login: 'streamer_b', streamId: 'stream-b' })) })
    await flushMicrotasks()
    await act(async () => fail({ ok: false, reason: 'request_failed' }))
    expect(container.textContent).not.toContain('Retry full history')
  })

  it('requests Full once on activation and does not repeat it on rerender or range changes', async () => {
    const payload = makePayload()
    const onRequestFullTimeline = vi.fn(async () => ({ ok: true as const, payload: makeFullPayload(payload) }))
    renderBand({ payload, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    await selectRange('30 min')
    await selectRange('Full stream')
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    rerenderBand({ payload: { ...payload, currentOffsetSeconds: 7260 }, onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
  })

  it('resets a local range and requests history once for each new activation', async () => {
    const onRequestFullTimeline = vi.fn(async () => ({ ok: false as const, reason: 'incomplete_history' as const }))
    const payloadA = makePayload({ login: 'streamer_a', streamId: 'stream-a' })
    renderBand({ payload: payloadA, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
    await selectRange('30 min')

    const payloadB = makePayload({ login: 'streamer_b', streamId: 'stream-b' })
    rerenderBand({ payload: payloadB, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[aria-label="Chart time range"]')?.textContent).toContain('Full stream')
  })

  it.each(['15m', '30m', '60m', '2h', '4h', 'full'] as const)(
    'opens Full regardless of the legacy stored %s range and keeps recent data visible',
    async stored => {
    vi.mocked(getDefaultChartWindow).mockResolvedValue(stored)
    const payload = makePayload()
    const onRequestFullTimeline = vi.fn(async () => ({ ok: true as const, payload: makeFullPayload(payload) }))
    renderBand({ payload: makePayload(), onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
    expect(getDefaultChartWindow).not.toHaveBeenCalled()
    expect(container.querySelector('[aria-label="Chart time range"]')?.textContent).toContain('Full stream')
    expect(container.querySelector('[data-chart-point-count]')?.getAttribute('data-chart-point-count'))
      .toBe(String(payload.rollups?.length ?? 0))
  })

  it('refreshes Full history once when the live category changes', async () => {
    const initial = makeFullPayload(makePayload({ category: 'Just Chatting' }))
    const onRequestFullTimeline = vi.fn(async () => ({
      ok: true as const,
      payload: makeFullPayload({ ...initial, category: 'Who Wants To Be a Millionaire' }),
    }))
    renderBand({ payload: initial, isLive: true, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(0)

    const changed = { ...initial, category: 'Who Wants To Be a Millionaire' }
    rerenderBand({ payload: changed, isLive: true, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    rerenderBand({
      payload: { ...changed, currentOffsetSeconds: changed.currentOffsetSeconds + 60 },
      isLive: true,
      onRequestFullTimeline,
    })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
  })

  it('failed activation request exposes a bounded explicit retry', async () => {
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

  it('range browsing does not persist a startup preference', async () => {
    vi.mocked(getDefaultChartWindow).mockResolvedValue('60m')
    renderBand({ payload: makePayload({ currentOffsetSeconds: 1800 }) })
    await flushMicrotasks()

    await selectRange('15 min')
    await selectRange('1 hour')
    await selectRange('Full stream')
    await flushMicrotasks()

    expect(setDefaultChartWindow).not.toHaveBeenCalled()
  })

  it('stream change while pending ignores the late result and requests the new activation once', async () => {
    const pending: Array<(result: { ok: false; reason: 'activation_changed' }) => void> = []
    const onRequestFullTimeline = vi.fn(
      () =>
        new Promise<{ ok: false; reason: 'activation_changed' }>(resolve => {
          pending.push(resolve)
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
      pending[0]?.({ ok: false, reason: 'activation_changed' })
      await Promise.resolve()
    })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(2)
  })

  it('demo mode also opens Full without reading storage or requesting history', async () => {
    const payload = makeFullPayload(makePayload({ currentOffsetSeconds: 18000 }))
    const onRequestFullTimeline = vi.fn()
    renderBand({ payload, demoMode: true, onRequestFullTimeline })
    await flushMicrotasks()
    expect(viewport()).toEqual({ start: 0, end: 18000 })
    expect(getDefaultChartWindow).not.toHaveBeenCalled()
    expect(onRequestFullTimeline).not.toHaveBeenCalled()
  })

  it('keeps a selected preset during polling but opens a changed VOD at Full', async () => {
    const payload = makeFullPayload(makePayload({ streamId: '', vodId: 'vod-a', currentOffsetSeconds: 18000 }))
    renderBand({ payload })
    await flushMicrotasks()
    await selectRange('30 min')
    rerenderBand({ payload: { ...payload, currentOffsetSeconds: 18060 } })
    await flushMicrotasks()
    expect(container.querySelector('[aria-label="Chart time range"]')?.textContent).toContain('30 min')
    expect(viewport().end - viewport().start).toBe(1800)

    rerenderBand({ payload: makeFullPayload({ ...payload, vodId: 'vod-b', currentOffsetSeconds: 21600 }) })
    await flushMicrotasks()
    expect(container.querySelector('[aria-label="Chart time range"]')?.textContent).toContain('Full stream')
    expect(viewport()).toEqual({ start: 0, end: 21600 })
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
