// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { isChartActionPointerTarget } from '../src/ui/PulseOverviewChart.tsx'

function pointerLike(target: EventTarget): PointerEvent {
  return {
    target,
    composedPath: () => [target],
  } as unknown as PointerEvent
}

describe('chart outside-click boundary', () => {
  it('recognizes an explicitly marked chart action outside the plot', () => {
    const button = document.createElement('button')
    button.dataset.chartAction = 'true'

    expect(isChartActionPointerTarget(pointerLike(button))).toBe(true)
  })

  it('does not classify a passive outside surface as a chart action', () => {
    const surface = document.createElement('div')

    expect(isChartActionPointerTarget(pointerLike(surface))).toBe(false)
  })

  it('falls back to the event target when a composed path is unavailable', () => {
    const button = document.createElement('button')
    button.dataset.chartAction = 'true'

    expect(isChartActionPointerTarget({
      target: button,
      composedPath: () => [],
    } as unknown as PointerEvent)).toBe(true)
  })
})
