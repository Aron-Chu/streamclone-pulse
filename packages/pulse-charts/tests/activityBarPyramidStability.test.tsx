// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as barPyramid from '../src/barPyramid.ts'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'
import type { ChartMinuteRollup } from '../src/types.ts'

vi.mock('../src/barPyramid.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/barPyramid.ts')>()
  return { ...actual, buildBarPyramid: vi.fn(actual.buildBarPyramid) }
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const START_MS = Date.parse('2026-09-20T00:00:00.000Z')
const MINUTES = 720

function minutes(count: number): ChartMinuteRollup[] {
  return Array.from({ length: count }, (_, index) => ({
    minuteTs: new Date(START_MS + index * 60_000).toISOString(),
    viewerAvg: 20_000 + index,
    viewerSamples: 2,
    chatCount: 100 + (index % 7) * 10,
    totalEmoteCount: 40 + (index % 5) * 5,
  }))
}

const detail = minutes(MINUTES)
// Long streams hand the chart a thinned series (one row every 3 minutes) and
// the full-resolution minutes separately.
const thinned = detail.filter((_, index) => index % 3 === 0)

describe('time-bucketed bar pyramid', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    vi.mocked(barPyramid.buildBarPyramid).mockClear()
  })

  it('is built once per data load, not on each zoomed viewport change', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const renderAt = (viewport: { startSeconds: number; endSeconds: number } | null) => act(() => {
      root!.render(
        <PulseMultiSignalChartInner
          rollups={thinned}
          detailRollups={detail}
          streamStartedAt={new Date(START_MS).toISOString()}
          durationSeconds={MINUTES * 60}
          viewport={viewport}
          variant="console"
          motionEnabled={false}
          activityBucketing="time"
        />,
      )
    })
    renderAt(null)
    const built = vi.mocked(barPyramid.buildBarPyramid).mock.calls.length
    expect(built).toBeGreaterThanOrEqual(1)
    // Full range, then twenty zoomed wheel/pan steps.
    renderAt({ startSeconds: 0, endSeconds: (MINUTES - 1) * 60 })
    for (let step = 0; step < 20; step += 1) {
      const start = (60 + step * 7.3) * 60
      renderAt({ startSeconds: start, endSeconds: start + (240 - step * 4) * 60 })
    }
    expect(vi.mocked(barPyramid.buildBarPyramid).mock.calls.length).toBe(built)
    expect(container.querySelector('svg[data-activity-bucket-minutes]')).not.toBeNull()
  })
})

describe('time-bucketed bars at the plot edges while zoomed', () => {
  const rects = (markup: string, lane: 'chat' | 'emotes') =>
    [...markup.matchAll(new RegExp(`<rect[^>]*data-activity-bar="${lane}"[^>]*>`, 'g'))]
      .map(([rect]) => ({
        x: Number(rect.match(/ x="([^"]+)"/)?.[1]),
        width: Number(rect.match(/ width="([^"]+)"/)?.[1]),
      }))
      .sort((a, b) => a.x - b.x)

  it('never overlaps a neighbour and stays inside the plot, whatever the pan offset', () => {
    let checked = 0
    for (let offset = 0; offset < 30; offset += 1) {
      // Pan a 6-hour view in 0.37-minute steps so edge slots straddle the plot edges.
      const startSeconds = (100 + offset * 0.37) * 60
      const markup = renderToStaticMarkup(
        <PulseMultiSignalChartInner
          rollups={thinned}
          detailRollups={detail}
          streamStartedAt={new Date(START_MS).toISOString()}
          durationSeconds={MINUTES * 60}
          viewport={{ startSeconds, endSeconds: startSeconds + 360 * 60 }}
          variant="console"
          motionEnabled={false}
          activityBucketing="time"
        />,
      )
      expect(Number(markup.match(/data-activity-bucket-minutes="(\d+)"/)?.[1])).toBeGreaterThan(1)
      for (const lane of ['chat', 'emotes'] as const) {
        const bars = rects(markup, lane)
        expect(bars.length).toBeGreaterThan(10)
        expect(bars[0]!.x).toBeGreaterThanOrEqual(0)
        expect(bars.at(-1)!.x + bars.at(-1)!.width).toBeLessThanOrEqual(1000 + 1e-6)
        for (let index = 1; index < bars.length; index += 1) {
          expect(bars[index]!.x).toBeGreaterThanOrEqual(bars[index - 1]!.x + bars[index - 1]!.width - 1e-6)
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(600)
  })
})
