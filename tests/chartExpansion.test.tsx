// @vitest-environment jsdom
import { act, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'
import {
  CHART_EXPANSION_MS,
  interpolateChartExpansionFrame,
  useChartExpansion,
} from '../src/ui/motion/useChartExpansion.ts'
import { LiveStatsBand } from '../src/ui/LiveStatsBand.tsx'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'
import { RecapTimelineChart } from '../src/ui/RecapTimelineChart.tsx'
import { shadowStyles } from '../src/ui/theme.ts'

interface ProbeProps {
  identity: string
  reducedMotion: boolean
}

function ExpansionProbe({ identity, reducedMotion }: ProbeProps) {
  const expansion = useChartExpansion({
    identity,
    heights: { collapsed: 184, expanded: 232 },
    reducedMotion,
  })
  return (
    <div
      data-testid="chart-expansion"
      data-expanded={expansion.expanded}
      data-height={expansion.height}
      data-progress={expansion.progress}
    >
      <button
        type="button"
        onClick={() => (expansion.expanded ? expansion.reset() : expansion.expand())}
      >
        {expansion.expanded ? 'Reset' : 'Expand'}
      </button>
    </div>
  )
}

function readProbe(container: HTMLDivElement) {
  const node = container.querySelector('[data-testid="chart-expansion"]')
  if (!node) throw new Error('chart expansion probe did not render')
  return {
    expanded: node.getAttribute('data-expanded') === 'true',
    height: Number(node.getAttribute('data-height')),
    progress: Number(node.getAttribute('data-progress')),
  }
}

const rollups: ExtensionRollup[] = [
  { offsetSeconds: 0, viewerCount: 100, chatCount: 10, sevenTvEmoteCount: 3 },
  { offsetSeconds: 60, viewerCount: 140, chatCount: 25, sevenTvEmoteCount: 9 },
  { offsetSeconds: 120, viewerCount: 120, chatCount: 18, sevenTvEmoteCount: 5 },
]

function makePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'test-channel',
    isLive: true,
    tracking: true,
    streamId: 'stream-a',
    currentOffsetSeconds: 120,
    rollups,
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...overrides,
  }
}

function shellHeight(html: string): number {
  const match = html.match(/style="[^"]*height:([0-9.]+)px/)
  if (!match) throw new Error(`chart shell height missing: ${html}`)
  return Number(match[1])
}

function chatClipGeometry(html: string): { y: number; height: number } {
  const match = html.match(
    /id="[^"]*-chat-clip"><rect[^>]*y="([0-9.]+)"[^>]*height="([0-9.]+)"/,
  )
  if (!match) throw new Error(`chat clip geometry missing: ${html}`)
  return { y: Number(match[1]), height: Number(match[2]) }
}

describe('interpolateChartExpansionFrame', () => {
  it('preserves endpoints and moves intermediate frames monotonically', () => {
    const from = { height: 184, progress: 0 }
    const to = { height: 232, progress: 1 }
    const frames = [0, 45, 90, 135, CHART_EXPANSION_MS].map(elapsed =>
      interpolateChartExpansionFrame(from, to, elapsed),
    )

    expect(frames[0]).toEqual(from)
    expect(frames.at(-1)).toEqual(to)
    expect(frames[2].height).toBeGreaterThan(frames[1].height)
    expect(frames[3].height).toBeGreaterThan(frames[2].height)
    expect(frames[2].progress).toBeGreaterThan(frames[1].progress)
  })

  it('reverses from the current frame and snaps only for reduced motion', () => {
    const midpoint = interpolateChartExpansionFrame(
      { height: 184, progress: 0 },
      { height: 232, progress: 1 },
      90,
    )
    const reversal = interpolateChartExpansionFrame(
      midpoint,
      { height: 184, progress: 0 },
      90,
    )

    expect(reversal.height).toBeLessThan(midpoint.height)
    expect(reversal.height).toBeGreaterThan(184)
    expect(reversal.progress).toBeLessThan(midpoint.progress)
    expect(
      interpolateChartExpansionFrame(midpoint, { height: 184, progress: 0 }, 1, true),
    ).toEqual({ height: 184, progress: 0 })
  })
})

describe('useChartExpansion', () => {
  let container: HTMLDivElement
  let root: Root
  let now = 0
  let nextFrameId = 0
  let frameCallbacks: Map<number, FrameRequestCallback>

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    now = 0
    nextFrameId = 0
    frameCallbacks = new Map()
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = ++nextFrameId
      frameCallbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frameCallbacks.delete(id)
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderProbe(props: ProbeProps): void {
    act(() => {
      root.render(<ExpansionProbe {...props} />)
    })
  }

  function advanceFrame(time: number): void {
    now = time
    const pending = [...frameCallbacks.values()]
    frameCallbacks.clear()
    act(() => {
      pending.forEach(callback => callback(time))
    })
  }

  it('animates the +48px endpoints and reverses from an intermediate frame', () => {
    renderProbe({ identity: 'channel:stream-a:vod-a', reducedMotion: false })
    expect(readProbe(container)).toEqual({ expanded: false, height: 184, progress: 0 })

    act(() => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })
    expect(readProbe(container)).toEqual({ expanded: true, height: 184, progress: 0 })

    advanceFrame(60)
    const midpoint = readProbe(container)
    advanceFrame(120)
    const later = readProbe(container)
    expect(later.height).toBeGreaterThan(midpoint.height)
    expect(later.progress).toBeGreaterThan(midpoint.progress)
    advanceFrame(180)
    expect(readProbe(container)).toEqual({ expanded: true, height: 232, progress: 1 })

    act(() => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })
    expect(readProbe(container)).toEqual({ expanded: false, height: 232, progress: 1 })
    advanceFrame(240)
    const reversing = readProbe(container)
    expect(reversing.height).toBeLessThan(232)
    expect(reversing.height).toBeGreaterThan(184)
    advanceFrame(360)
    expect(readProbe(container)).toEqual({ expanded: false, height: 184, progress: 0 })
  })

  it('applies a reduced-motion change immediately at the current target', () => {
    renderProbe({ identity: 'channel:stream-a:vod-a', reducedMotion: false })
    act(() => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })
    advanceFrame(60)

    renderProbe({ identity: 'channel:stream-a:vod-a', reducedMotion: true })
    expect(readProbe(container)).toEqual({ expanded: true, height: 232, progress: 1 })
    expect(frameCallbacks.size).toBe(0)

    act(() => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })
    expect(readProbe(container)).toEqual({ expanded: false, height: 184, progress: 0 })
  })

  it('resets identity atomically before the next stream/VOD can paint', () => {
    renderProbe({ identity: 'channel:stream-a:vod-a', reducedMotion: false })
    act(() => {
      ;(container.querySelector('button') as HTMLButtonElement).click()
    })
    advanceFrame(60)
    expect(readProbe(container).progress).toBeGreaterThan(0)

    renderProbe({ identity: 'channel:stream-b:vod-b', reducedMotion: false })
    expect(readProbe(container)).toEqual({ expanded: false, height: 184, progress: 0 })
    advanceFrame(240)
    expect(readProbe(container)).toEqual({ expanded: false, height: 184, progress: 0 })
  })
})

describe('chart shells and controls', () => {
  it('keeps the recap viewer lane for explicit zero samples', () => {
    const html = renderToStaticMarkup(
      <RecapTimelineChart
        payload={makePayload({
          isLive: false,
          vodId: 'vod-zero-viewers',
          rollups: [
            { offsetSeconds: 0, viewerCount: 0, chatCount: 10, sevenTvEmoteCount: 2 },
            { offsetSeconds: 60, viewerCount: 0, chatCount: 12, sevenTvEmoteCount: 3 },
          ],
          currentOffsetSeconds: 120,
        })}
        backendUrl="https://api.example.test"
        peakOffsets={[]}
        catalog={[]}
        onSelectPoint={() => undefined}
      />,
    )

    expect(html).toContain('data-chart-series="viewers"')
    expect(html).toContain('data-chart-viewer-axis-min="0"')
  })

  it('keeps populated, loading, and empty shells at the same animated height', () => {
    const loading = renderToStaticMarkup(
      <PulseOverviewChart rollups={[]} loading height={216} chartRegionId="chart-region" />,
    )
    const empty = renderToStaticMarkup(
      <PulseOverviewChart rollups={[]} emptyMessage="No data" height={216} chartRegionId="chart-region" />,
    )
    const populated = renderToStaticMarkup(
      <PulseOverviewChart rollups={rollups} height={216} chartRegionId="chart-region" />,
    )
    const expandedEmpty = renderToStaticMarkup(
      <PulseOverviewChart rollups={[]} emptyMessage="No data" height={264} chartRegionId="chart-region" />,
    )

    expect(shellHeight(loading)).toBe(216)
    expect(shellHeight(empty)).toBe(shellHeight(loading))
    expect(shellHeight(populated)).toBe(shellHeight(loading))
    expect(shellHeight(expandedEmpty) - shellHeight(empty)).toBe(48)
    expect(loading).toContain('height:100%')
    expect(empty).toContain('height:100%')
  })

  it('moves lane geometry with the same intermediate expansion progress', () => {
    const renderAt = (progress: number) => renderToStaticMarkup(
      <PulseOverviewChart
        rollups={rollups}
        height={184 + 48 * progress}
        activityExpanded={progress === 1}
        activityExpansionProgress={progress}
        focusedSeriesKey="chat"
        normalizeOverlaySeries
        overlayLines={[{
          key: 'trace:one',
          label: 'Trace',
          color: '#f97316',
          values: [1, 2, 3],
          dashed: true,
        }]}
      />,
    )
    const collapsed = chatClipGeometry(renderAt(0))
    const intermediate = chatClipGeometry(renderAt(0.5))
    const expanded = chatClipGeometry(renderAt(1))

    expect(intermediate.height).toBeGreaterThan(collapsed.height)
    expect(intermediate.height).toBeLessThan(expanded.height)
    expect(intermediate.y).not.toBe(collapsed.y)
    expect(intermediate.y).not.toBe(expanded.y)
    expect(intermediate.y).toBeGreaterThan(Math.min(collapsed.y, expanded.y))
    expect(intermediate.y).toBeLessThan(Math.max(collapsed.y, expanded.y))
  })

  it('keeps both live and recap controls native, focusable, and ARIA-linked', () => {
    const live = renderToStaticMarkup(
      <LiveStatsBand payload={makePayload()} backendUrl="https://api.example.test" />,
    )
    const recap = renderToStaticMarkup(
      <RecapTimelineChart
        payload={makePayload({ isLive: false, vodId: 'vod-a' })}
        backendUrl="https://api.example.test"
        peakOffsets={[]}
        catalog={[]}
        onSelectPoint={() => undefined}
      />,
    )

    for (const html of [live, recap]) {
      const control = html.match(/<button type="button"[^>]*class="pulse-chart-expand-btn[^>]*>/)?.[0]
      expect(control).toBeDefined()
      expect(control).toContain('aria-expanded="false"')
      expect(control).toMatch(/aria-controls="pulse-(live|recap)-chart-[^"]+"/)
      expect(control).toContain('aria-label="Expand stream activity chart"')
      expect(control).not.toContain('tabindex="-1"')
      const controlledId = control?.match(/aria-controls="([^"]+)"/)?.[1]
      expect(controlledId).toBeDefined()
      expect(html).toContain(`id="${controlledId}"`)
    }
  })

  it('provides a visible two-pixel focus treatment for Expand and Reset', () => {
    expect(shadowStyles).toContain('.pulse-chart-expand-btn:focus-visible')
    expect(shadowStyles).toContain('outline: 2px solid rgba(103, 232, 249, 0.95) !important;')
    expect(shadowStyles).toContain('outline-offset: 2px !important;')
  })
})

describe('interactive chart controls', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.stubGlobal('requestAnimationFrame', () => 1)
    vi.stubGlobal('cancelAnimationFrame', () => undefined)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  })

  function renderChart(element: ReactElement): HTMLButtonElement {
    act(() => root.render(element))
    const button = container.querySelector('.pulse-chart-expand-btn')
    if (!(button instanceof HTMLButtonElement)) throw new Error('chart expand control did not render')
    return button
  }

  it('keeps live and recap Expand/Reset active styling, focus, and ARIA in sync', () => {
    const charts = [
      <LiveStatsBand payload={makePayload()} backendUrl="https://api.example.test" />,
      <RecapTimelineChart
        payload={makePayload({ isLive: false, vodId: 'vod-a' })}
        backendUrl="https://api.example.test"
        peakOffsets={[]}
        catalog={[]}
        onSelectPoint={() => undefined}
      />,
    ]

    for (const chart of charts) {
      const button = renderChart(chart)
      button.focus()
      expect(document.activeElement).toBe(button)
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(button.classList.contains('pulse-chart-expand-btn-active')).toBe(false)

      act(() => button.click())
      expect(document.activeElement).toBe(button)
      expect(button.getAttribute('aria-expanded')).toBe('true')
      expect(button.getAttribute('aria-label')).toBe('Reset stream activity chart')
      expect(button.classList.contains('pulse-chart-expand-btn-active')).toBe(true)
      expect(button.style.background).toBe('rgba(139, 92, 246, 0.12)')

      act(() => button.click())
      expect(document.activeElement).toBe(button)
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(button.getAttribute('aria-label')).toBe('Expand stream activity chart')
      expect(button.classList.contains('pulse-chart-expand-btn-active')).toBe(false)
      expect(button.style.background).toBe('rgba(255, 255, 255, 0.05)')
    }
  })
})
