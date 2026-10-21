// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'

const rollups: ExtensionRollup[] = [
  { offsetSeconds: 0, viewerCount: 100, chatCount: 10, sevenTvEmoteCount: 3 },
  { offsetSeconds: 60, viewerCount: 140, chatCount: 25, sevenTvEmoteCount: 9 },
  { offsetSeconds: 120, viewerCount: 120, chatCount: 18, sevenTvEmoteCount: 5 },
]

function makePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'test-channel',
    isLive: false,
    tracking: true,
    streamId: 'stream-a',
    vodId: 'vod-a',
    currentOffsetSeconds: 120,
    rollups,
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...overrides,
  }
}

describe('recap chart Spikes choice', () => {
  let container: HTMLDivElement
  let root: Root
  let stored: Record<string, unknown>
  let setCalls: Record<string, unknown>[]

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.resetModules()
    stored = {}
    setCalls = []
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-extension' },
      storage: {
        sync: {
          get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})),
          set: vi.fn(async (items: Record<string, unknown>) => {
            setCalls.push(items)
            Object.assign(stored, items)
          }),
        },
      },
    })
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  async function renderChart(options: { pins?: readonly number[]; streamId?: string } = {}): Promise<HTMLButtonElement> {
    const { RecapTimelineChart } = await import('../src/ui/RecapTimelineChart.tsx')
    await act(async () => {
      root.render(
        <RecapTimelineChart
          payload={makePayload({ streamId: options.streamId ?? 'stream-a', vodId: `vod-${options.streamId ?? 'a'}` })}
          backendUrl="https://api.example.test"
          peakOffsets={[60]}
          catalog={[]}
          onSelectPoint={() => undefined}
          pins={options.pins}
        />,
      )
    })
    const button = container.querySelector('[data-chart-moment-toggle="true"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('Spikes toggle did not render')
    return button
  }

  it('starts off everywhere, pins or not, until pressed', async () => {
    expect((await renderChart({ pins: [] })).getAttribute('aria-pressed')).toBe('false')
    expect((await renderChart({ streamId: 'b' })).getAttribute('aria-pressed')).toBe('false')
    expect(setCalls).toEqual([])
  })

  it('keeps the pressed choice for every recap after, and stores it', async () => {
    const button = await renderChart({ pins: [] })
    act(() => button.click())
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Hide spike markers')
    expect(setCalls).toEqual([{ recapSpikeMarkers: true }])

    // A new chart, as when the viewer opens another recap.
    act(() => root.unmount())
    root = createRoot(container)
    const next = await renderChart({ pins: [], streamId: 'b' })
    expect(next.getAttribute('aria-pressed')).toBe('true')
  })

  it('reads the stored choice on a fresh page', async () => {
    stored.recapSpikeMarkers = true
    const button = await renderChart({ streamId: 'b' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Hide spike markers')
  })
})
