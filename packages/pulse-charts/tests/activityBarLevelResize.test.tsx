// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseMultiSignalChartInner } from '../src/PulseMultiSignalChart.tsx'
import type { ChartMinuteRollup } from '../src/types.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const START_MS = Date.parse('2026-09-20T00:00:00.000Z')

function minutes(count: number): ChartMinuteRollup[] {
  return Array.from({ length: count }, (_, index) => ({
    minuteTs: new Date(START_MS + index * 60_000).toISOString(),
    viewerAvg: 20_000 + index,
    viewerSamples: 2,
    chatCount: 100 + (index % 7) * 10,
    totalEmoteCount: 40 + (index % 5) * 5,
  }))
}

describe('time-bucketed bar level after the console chart measures its width', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    vi.restoreAllMocks()
  })

  it('picks the level afresh at the measured width instead of holding the 1000-unit fallback level', () => {
    // 180 minutes: 1000 units give 5.6 px per minute (1-minute bars); the
    // measured 786 px give 4.4 px, so bars must become 2 minutes wide.
    const rollups = minutes(180)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root!.render(
        <PulseMultiSignalChartInner
          rollups={rollups}
          streamStartedAt={new Date(START_MS).toISOString()}
          durationSeconds={180 * 60}
          variant="console"
          motionEnabled={false}
          activityBucketing="time"
        />,
      )
    })
    const svg = () => container!.querySelector('svg[data-activity-bucket-minutes]')
    expect(svg()?.getAttribute('data-activity-bucket-minutes')).toBe('1')

    const original = Element.prototype.getBoundingClientRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this instanceof SVGSVGElement || this.hasAttribute('data-chart-touch-action')) {
        return { left: 0, right: 786, top: 0, bottom: 400, width: 786, height: 400, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
      }
      return original.call(this)
    })
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(svg()?.getAttribute('data-activity-bucket-minutes')).toBe('2')
  })
})
