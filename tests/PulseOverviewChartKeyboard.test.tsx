// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PulseOverviewChart } from '../src/ui/PulseOverviewChart.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const rollups = [
  { offsetSeconds: 0, viewerCount: 100, chatCount: 10, sevenTvEmoteCount: 3 },
  { offsetSeconds: 60, viewerCount: 140, chatCount: 25, sevenTvEmoteCount: 9 },
  { offsetSeconds: 120, viewerCount: 120, chatCount: 18, sevenTvEmoteCount: 5 },
]

describe('PulseOverviewChart keyboard focus (A11Y-3)', () => {
  let node: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    node = document.createElement('div')
    document.body.append(node)
    root = createRoot(node)
  })

  afterEach(() => {
    act(() => root.unmount())
    node.remove()
    vi.unstubAllGlobals()
  })

  it('Escape releases the locked minute but keeps focus on the plot', async () => {
    const onClearSelection = vi.fn()
    await act(async () => {
      root.render(
        <PulseOverviewChart
          reducedMotion
          rollups={rollups}
          selectedIndex={1}
          onSelectIndex={vi.fn()}
          onClearSelection={onClearSelection}
        />,
      )
    })
    const plot = node.querySelector<SVGElement>('[data-chart-scrubber="true"]')
    expect(plot).not.toBeNull()
    plot!.focus()
    expect(document.activeElement).toBe(plot)

    await act(async () => {
      plot!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })

    expect(onClearSelection).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(plot)
  })
})
