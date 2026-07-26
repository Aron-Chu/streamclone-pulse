// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/shared/storage.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/shared/storage.ts')>()
  return {
    ...actual,
    getDefaultChartWindow: vi.fn(async () => 'full' as const),
    setDefaultChartWindow: vi.fn(async () => undefined),
    migrateDefaultChartWindowToRecentV2Once: vi.fn(async () => undefined),
  }
})

vi.mock('../src/ui/PulseOverviewChart.tsx', () => ({
  PulseOverviewChart: () => null,
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
    expect(fullHistoryActivationKey(activation)).toBe('streamer_a|42|vod-1')
  })

  it('requires exact login+stream+vod for unlock', () => {
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
})

describe('LiveStatsBand activation-scoped Full (B1)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    vi.clearAllMocks()
    vi.mocked(getDefaultChartWindow).mockResolvedValue('full')
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
    const onRequestFullTimeline = props.onRequestFullTimeline ?? vi.fn(async () => undefined)
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
          onRequestFullTimeline: vi.fn(async () => undefined),
          ...props,
          payload: props.payload,
        }),
      )
    })
  }

  it('A→B stream change: zero Full requests after switch until explicit unlock', async () => {
    const onRequestFullTimeline = vi.fn(async () => undefined)
    const payloadA = makePayload({ login: 'streamer_a', streamId: 'stream-a' })
    renderBand({ payload: payloadA, onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).not.toHaveBeenCalled()

    const payloadB = makePayload({ login: 'streamer_b', streamId: 'stream-b' })
    rerenderBand({ payload: payloadB, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).not.toHaveBeenCalled()
  })

  it('ABA: returning to A does not auto Full until explicit', async () => {
    const onRequestFullTimeline = vi.fn(async () => undefined)
    const payloadA = makePayload({ login: 'streamer_a', streamId: 'stream-a' })
    const payloadB = makePayload({ login: 'streamer_b', streamId: 'stream-b' })

    renderBand({ payload: payloadA, onRequestFullTimeline })
    await flushMicrotasks()

    rerenderBand({ payload: payloadB, onRequestFullTimeline })
    await flushMicrotasks()

    rerenderBand({ payload: payloadA, onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).not.toHaveBeenCalled()
  })

  it('stored Full preference on mount: zero Full requests + Load full history visible', async () => {
    const onRequestFullTimeline = vi.fn(async () => undefined)
    renderBand({ payload: makePayload(), onRequestFullTimeline })
    await flushMicrotasks()

    expect(onRequestFullTimeline).not.toHaveBeenCalled()
    const loadButton = container.querySelector('[data-testid="load-full-history"]')
    expect(loadButton).not.toBeNull()
    expect(loadButton?.textContent).toMatch(/Load full history/i)
  })

  it('explicit load: exactly one Full request', async () => {
    const onRequestFullTimeline = vi.fn(async () => undefined)
    renderBand({ payload: makePayload(), onRequestFullTimeline })
    await flushMicrotasks()

    const loadButton = container.querySelector('[data-testid="load-full-history"]') as HTMLButtonElement
    expect(loadButton).not.toBeNull()

    await act(async () => {
      loadButton.click()
      await Promise.resolve()
    })
    await flushMicrotasks()

    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    await act(async () => {
      loadButton.click()
      await Promise.resolve()
    })
    await flushMicrotasks()

    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
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

  it('stream change while pending: late response does not re-request on new activation', async () => {
    let resolveA: (() => void) | undefined
    const onRequestFullTimeline = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveA = resolve
        }),
    )

    const payloadA = makePayload({ login: 'streamer_a', streamId: 'stream-a' })
    renderBand({ payload: payloadA, onRequestFullTimeline })
    await flushMicrotasks()

    const loadButton = container.querySelector('[data-testid="load-full-history"]') as HTMLButtonElement
    await act(async () => {
      loadButton.click()
    })
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    const payloadB = makePayload({ login: 'streamer_b', streamId: 'stream-b' })
    rerenderBand({ payload: payloadB, onRequestFullTimeline })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveA?.()
      await Promise.resolve()
    })
    await flushMicrotasks()
    expect(onRequestFullTimeline).toHaveBeenCalledTimes(1)
  })

  it('late storage hydration does not overwrite user range pick after stream change', async () => {
    let resolveHydrate: ((value: 'full') => void) | undefined
    vi.mocked(getDefaultChartWindow).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveHydrate = resolve
        }),
    )

    const payloadA = makePayload({ login: 'streamer_a', streamId: 'stream-a' })
    renderBand({ payload: payloadA })
    await flushMicrotasks()

    const fullStreamButton = Array.from(container.querySelectorAll('button')).find(button =>
      button.textContent?.includes('Full stream'),
    )
    await act(async () => {
      fullStreamButton!.click()
    })

    const payloadB = makePayload({ login: 'streamer_b', streamId: 'stream-b' })
    rerenderBand({ payload: payloadB })

    await act(async () => {
      resolveHydrate?.('full')
      await Promise.resolve()
      await Promise.resolve()
    })
    await flushMicrotasks()

    const loadButton = container.querySelector('[data-testid="load-full-history"]')
    expect(loadButton).not.toBeNull()
  })
})
