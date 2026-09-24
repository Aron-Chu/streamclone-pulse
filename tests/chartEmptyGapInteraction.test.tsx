// @vitest-environment jsdom

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseMultiSignalChartInner } from '../packages/pulse-charts/src/PulseMultiSignalChart.tsx'
import type { ChartMinuteRollup } from '../packages/pulse-charts/src/types.ts'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'
import { prepareChartRollups } from '../src/ui/chatActivityEmotes.ts'
import type { ExtensionRollup, PulsePayload } from '../src/shared/messages.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const streamStartedAt = '2026-09-19T00:00:00.000Z'

function sharedPoint(offsetSeconds: number, missing = false): ChartMinuteRollup {
  return {
    minuteTs: new Date(Date.parse(streamStartedAt) + offsetSeconds * 1000).toISOString(),
    viewerAvg: 100,
    viewerSamples: 1,
    chatCount: 20,
    totalEmoteCount: 5,
    missing,
  }
}

function overviewPoint(offsetSeconds: number, missing = false): ExtensionRollup {
  return { offsetSeconds, viewerCount: 100, chatCount: 20, sevenTvEmoteCount: 5, missing }
}

describe('chart empty-gap selection', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    vi.restoreAllMocks()
  })

  function renderChart(node: ReactNode): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(node))
  }

  function renderPlot(node: ReactNode, selector: string): SVGRectElement {
    renderChart(node)
    const plot = container?.querySelector<SVGRectElement>(selector)
    if (!plot) throw new Error('Chart plot did not render')
    const x = Number(plot.getAttribute('x'))
    const y = Number(plot.getAttribute('y'))
    const width = Number(plot.getAttribute('width'))
    const height = Number(plot.getAttribute('height'))
    vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
      x, y, left: x, top: y, width, height,
      right: x + width, bottom: y + height, toJSON: () => ({}),
    })
    return plot
  }

  function click(plot: SVGRectElement, clientX: number, clientY: number): void {
    act(() => {
      plot.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX, clientY }))
    })
  }

  function pressKey(target: Element, key: string, shiftKey = false): void {
    act(() => {
      target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, shiftKey }))
    })
  }

  it('skips missing overview buckets during keyboard navigation and keeps measured zeroes selectable', () => {
    const rollups = [
      overviewPoint(0, true),
      overviewPoint(60),
      overviewPoint(120, true),
      { ...overviewPoint(180), viewerCount: 0, chatCount: 0, sevenTvEmoteCount: 0 },
      overviewPoint(240, true),
      overviewPoint(300),
      overviewPoint(360, true),
    ]
    const select = vi.fn()
    const hover = vi.fn()
    let selectedIndex: number | null = null
    const render = () => (
      <PulseOverviewChart
        rollups={rollups}
        selectedIndex={selectedIndex}
        onSelectIndex={select}
        onHoverOffsetChange={hover}
        reducedMotion
      />
    )
    const plot = renderPlot(render(), '[data-chart-scrubber]')

    for (const [key, index, commit] of [
      ['Home', 1, 'Enter'],
      ['ArrowRight', 3, ' '],
      ['ArrowRight', 5, 'Enter'],
      ['ArrowLeft', 3, 'Enter'],
      ['End', 5, 'Enter'],
      ['Home', 1, 'Enter'],
    ] as const) {
      pressKey(plot, key)
      expect(hover).toHaveBeenLastCalledWith(rollups[index].offsetSeconds)
      pressKey(plot, commit)
      expect(select).toHaveBeenLastCalledWith(index)
      selectedIndex = index
      act(() => root?.render(render()))
    }
    expect(select.mock.calls.map(([index]) => index)).toEqual([1, 3, 5, 3, 5, 1])
  })

  it('skips missing shared-chart buckets during keyboard navigation and keeps measured zeroes selectable', () => {
    const rollups = [
      sharedPoint(0, true),
      sharedPoint(60),
      sharedPoint(120, true),
      { ...sharedPoint(180), viewerAvg: 0, chatCount: 0, totalEmoteCount: 0 },
      sharedPoint(240, true),
      sharedPoint(300),
      sharedPoint(360, true),
    ]
    const select = vi.fn()
    const hover = vi.fn()
    renderChart(
      <PulseMultiSignalChartInner
        rollups={rollups}
        streamStartedAt={streamStartedAt}
        durationSeconds={360}
        onSelectRollup={select}
        onHoverRollupChange={hover}
        motionEnabled={false}
        variant="console"
        chromeless
      />,
    )
    const chart = container?.querySelector('svg')
    if (!chart) throw new Error('Shared chart did not render')

    for (const [key, index, commit] of [
      ['Home', 1, 'Enter'],
      ['ArrowRight', 3, ' '],
      ['ArrowDown', 5, 'Enter'],
      ['ArrowUp', 3, 'Enter'],
      ['End', 5, 'Enter'],
      ['Home', 1, 'Enter'],
    ] as const) {
      pressKey(chart, key)
      expect(hover).toHaveBeenLastCalledWith(rollups[index])
      pressKey(chart, commit)
      expect(select).toHaveBeenLastCalledWith(rollups[index])
    }
    expect(select.mock.calls.map(([rollup]) => rollup)).toEqual([1, 3, 5, 3, 5, 1].map(index => rollups[index]))
  })

  it.each(['Enter', ' '])('rejects %s when an overview preview becomes missing after a refresh', key => {
    const select = vi.fn()
    const hover = vi.fn()
    const render = (missing: boolean) => (
      <PulseOverviewChart
        rollups={[overviewPoint(0, missing), overviewPoint(60)]}
        onSelectIndex={select}
        onHoverOffsetChange={hover}
        reducedMotion
      />
    )
    const plot = renderPlot(render(false), '[data-chart-scrubber]')
    pressKey(plot, 'Home')
    expect(hover).toHaveBeenLastCalledWith(0)
    act(() => root?.render(render(true)))

    pressKey(plot, key)
    expect(select).not.toHaveBeenCalled()
    expect(hover).toHaveBeenLastCalledWith(null)
  })

  it.each(['Enter', ' '])('rejects %s when a shared-chart preview becomes missing after a refresh', key => {
    const select = vi.fn()
    const hover = vi.fn()
    const render = (missing: boolean) => (
      <PulseMultiSignalChartInner
        rollups={[sharedPoint(0, missing), sharedPoint(60)]}
        streamStartedAt={streamStartedAt}
        durationSeconds={60}
        onSelectRollup={select}
        onHoverRollupChange={hover}
        motionEnabled={false}
        variant="console"
        chromeless
      />
    )
    renderChart(render(false))
    const chart = container?.querySelector('svg')
    if (!chart) throw new Error('Shared chart did not render')
    pressKey(chart, 'Home')
    expect(hover).toHaveBeenLastCalledWith(sharedPoint(0))
    act(() => root?.render(render(true)))

    pressKey(chart, key)
    expect(select).not.toHaveBeenCalled()
    expect(hover).toHaveBeenLastCalledWith(null)
  })

  it('does not preview or select all-missing overview buckets', () => {
    const select = vi.fn()
    const hover = vi.fn()
    const plot = renderPlot(
      <PulseOverviewChart
        rollups={[overviewPoint(0, true), overviewPoint(60, true)]}
        onSelectIndex={select}
        onHoverOffsetChange={hover}
        reducedMotion
      />,
      '[data-chart-scrubber]',
    )

    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight', 'Enter', ' ']) pressKey(plot, key)
    expect(select).not.toHaveBeenCalled()
    expect(hover).not.toHaveBeenCalled()
  })

  it('does not expose keyboard selection for an all-missing shared chart', () => {
    const select = vi.fn()
    renderChart(
      <PulseMultiSignalChartInner
        rollups={[sharedPoint(0, true), sharedPoint(60, true)]}
        streamStartedAt={streamStartedAt}
        durationSeconds={60}
        onSelectRollup={select}
        motionEnabled={false}
        variant="console"
        chromeless
      />,
    )

    expect(container?.querySelector('svg')).toBeNull()
    expect(select).not.toHaveBeenCalled()
  })

  it.each(['sparse', 'missing'] as const)('ignores shared-chart %s gaps but selects measured buckets', gap => {
    const rollups = [sharedPoint(0), ...(gap === 'missing' ? [sharedPoint(300, true)] : []), sharedPoint(600)]
    const select = vi.fn()
    const plot = renderPlot(
      <PulseMultiSignalChartInner
        rollups={rollups}
        selectedRollup={rollups[0]}
        streamStartedAt={streamStartedAt}
        durationSeconds={600}
        onSelectOffset={select}
        motionEnabled={false}
        variant="console"
        chromeless
      />,
      '[data-chart-touch-action]',
    )
    const bounds = plot.getBoundingClientRect()

    click(plot, bounds.left + bounds.width / 2, bounds.top + 1)
    expect(select).not.toHaveBeenCalled()

    click(plot, bounds.right, bounds.top + 1)
    expect(select).toHaveBeenCalledExactlyOnceWith(600)
  })

  it.each(['sparse', 'missing'] as const)('preserves overview selection inside %s gaps', gap => {
    const rollups = [overviewPoint(0), ...(gap === 'missing' ? [overviewPoint(300, true)] : []), overviewPoint(600)]
    const select = vi.fn()
    const clear = vi.fn()
    const plot = renderPlot(
      <PulseOverviewChart
        rollups={rollups}
        selectedIndex={0}
        onSelectIndex={select}
        onClearSelection={clear}
        reducedMotion
      />,
      '[data-chart-scrubber]',
    )
    const bounds = plot.getBoundingClientRect()

    click(plot, bounds.left + bounds.width / 2, bounds.top + 1)
    expect(select).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(container?.querySelector('svg')?.getAttribute('data-chart-locked-index')).toBe('0')

    click(plot, bounds.right, bounds.top + 1)
    expect(select).toHaveBeenCalledExactlyOnceWith(rollups.length - 1)
    expect(clear).not.toHaveBeenCalled()

    click(plot, bounds.left, bounds.top + 1)
    expect(clear).toHaveBeenCalledTimes(1)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it.each(['covered quiet', 'missing range', 'missing marker'] as const)(
    'keeps prepared %s minutes honest during overview selection',
    coverageCase => {
      const missing = coverageCase !== 'covered quiet'
      const source = [0, 60, 600, 660].map(offset => overviewPoint(offset))
      if (coverageCase === 'missing marker') {
        source.splice(2, 0, { offsetSeconds: 300, missing: true })
      }
      const payload: PulsePayload = {
        login: 'fixturechan',
        isLive: true,
        tracking: true,
        currentOffsetSeconds: 660,
        rollups: source,
        fullRollups: source,
        lanes: { composite: [], chat: [], seventv: [] },
        peaks: [],
        recap: null,
        coverage: {
          state: missing ? 'missing_ranges_detected' : 'full_stream_tracked',
          coverageStartOffsetSeconds: 0,
          coverageEndOffsetSeconds: 660,
          trackedFromStart: true,
          hasFullStreamCoverage: !missing,
          hasGaps: missing,
          missingRanges: missing ? [{ fromOffsetSeconds: 120, toOffsetSeconds: 600 }] : [],
          canBackfill: false,
        },
      }
      const rollups = prepareChartRollups(payload, {
        chartWindow: 'full',
        currentOffsetSeconds: 660,
      })
      expect(rollups).toHaveLength(12)
      expect(rollups[5]).toMatchObject({ offsetSeconds: 300, chatCount: 0, missing })

      const select = vi.fn()
      const clear = vi.fn()
      const plot = renderPlot(
        <PulseOverviewChart
          rollups={rollups}
          selectedIndex={0}
          onSelectIndex={select}
          onClearSelection={clear}
          reducedMotion
        />,
        '[data-chart-scrubber]',
      )
      const bounds = plot.getBoundingClientRect()
      click(plot, bounds.left + bounds.width * 300 / 660, bounds.top + 1)
      if (missing) expect(select).not.toHaveBeenCalled()
      else expect(select).toHaveBeenCalledExactlyOnceWith(5)
      expect(clear).not.toHaveBeenCalled()

      select.mockClear()
      click(plot, bounds.right, bounds.top + 1)
      expect(select).toHaveBeenCalledExactlyOnceWith(11)
    },
  )

  it('keeps irregular overview activity buckets aligned with their rendered bars', () => {
    const select = vi.fn()
    const plot = renderPlot(
      <PulseOverviewChart
        rollups={[overviewPoint(0), overviewPoint(60), overviewPoint(600)]}
        onSelectIndex={select}
        reducedMotion
      />,
      '[data-chart-scrubber]',
    )

    for (const signal of ['chat', 'emotes']) {
      const bar = container?.querySelectorAll(`[data-chart-signal-bar="${signal}"]`)[1]
      expect(bar).toBeTruthy()
      click(plot,
        Number(bar?.getAttribute('x')) + Number(bar?.getAttribute('width')) / 2,
        Number(bar?.getAttribute('y')) + Number(bar?.getAttribute('height')) / 2)
      expect(select).toHaveBeenLastCalledWith(1)
    }
    expect(select).toHaveBeenCalledTimes(2)
  })

  it('preserves shared rollup selection in a gap and still toggles the selected endpoint', () => {
    const rollups = [sharedPoint(0), sharedPoint(600)]
    const select = vi.fn()
    const plot = renderPlot(
      <PulseMultiSignalChartInner
        rollups={rollups}
        selectedRollup={rollups[0]}
        streamStartedAt={streamStartedAt}
        durationSeconds={600}
        onSelectRollup={select}
        motionEnabled={false}
        variant="console"
        chromeless
      />,
      '[data-chart-touch-action]',
    )
    const bounds = plot.getBoundingClientRect()

    click(plot, bounds.left + bounds.width / 2, bounds.top + 1)
    expect(select).not.toHaveBeenCalled()

    click(plot, bounds.left, bounds.top + 1)
    expect(select).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('keeps authored reaction selections available inside a rollup gap', () => {
    const reaction = { offsetSeconds: 300, score: 80, durationSeconds: 30 }
    const select = vi.fn()
    const plot = renderPlot(
      <PulseMultiSignalChartInner
        rollups={[sharedPoint(0), sharedPoint(600)]}
        reactionPoints={[reaction]}
        streamStartedAt={streamStartedAt}
        durationSeconds={600}
        onSelectReactionMoment={select}
        showSpikes
        motionEnabled={false}
        variant="console"
        chromeless
      />,
      '[data-chart-touch-action]',
    )
    const bar = container?.querySelector('[data-reaction-bar]')
    expect(bar).not.toBeNull()
    click(plot,
      Number(bar?.getAttribute('x')) + Number(bar?.getAttribute('width')) / 2,
      Number(bar?.getAttribute('y')) + Number(bar?.getAttribute('height')) / 2)
    expect(select).toHaveBeenCalledExactlyOnceWith(reaction)
  })

  it.each(['chat', 'emotes'] as const)('preserves measured %s lane selection', signal => {
    const select = vi.fn()
    const plot = renderPlot(
      <PulseMultiSignalChartInner
        rollups={[sharedPoint(0), sharedPoint(60), sharedPoint(120)]}
        streamStartedAt={streamStartedAt}
        durationSeconds={120}
        onSelectOffset={select}
        motionEnabled={false}
        variant="console"
        chromeless
      />,
      '[data-chart-touch-action]',
    )
    const bar = container?.querySelectorAll(`[data-activity-bar="${signal}"]`)[1]
    expect(bar).toBeTruthy()
    click(plot,
      Number(bar?.getAttribute('x')) + Number(bar?.getAttribute('width')) / 2,
      Number(bar?.getAttribute('y')) + Number(bar?.getAttribute('height')) / 2)
    expect(select).toHaveBeenCalledExactlyOnceWith(60)
  })
})
