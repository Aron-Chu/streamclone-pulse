// @vitest-environment jsdom

import { useSmoothedChartViewport } from '../src/useSmoothedChartViewport.ts'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function ViewportProbe({ target, enabled }: { target: { startSeconds: number; endSeconds: number }; enabled: boolean }) {
  const viewport = useSmoothedChartViewport(target, enabled)
  return createElement(
    'output',
    {
      'data-start': String(viewport.startSeconds),
      'data-end': String(viewport.endSeconds),
    },
    `${viewport.startSeconds}-${viewport.endSeconds}`,
  )
}

function renderProbe(root: Root, target: { startSeconds: number; endSeconds: number }, enabled: boolean) {
  act(() => {
    root.render(createElement(ViewportProbe, { target, enabled }) as ReactNode)
  })
}

describe('useSmoothedChartViewport', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
  })

  it('tracks a direct-manipulation target immediately when motion is disabled', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    renderProbe(root, { startSeconds: 0, endSeconds: 600 }, false)
    renderProbe(root, { startSeconds: 1800, endSeconds: 2400 }, false)

    expect(container.querySelector('output')?.getAttribute('data-start')).toBe('1800')
    expect(container.querySelector('output')?.getAttribute('data-end')).toBe('2400')
  })

  it('still lands on the target when requestAnimationFrame never fires', () => {
    // A background tab, an occluded window, or power saving stops rAF. The tween
    // is decoration; the requested viewport is not optional.
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(1 as never)
    vi.useFakeTimers()
    try {
      container = document.createElement('div')
      document.body.appendChild(container)
      root = createRoot(container)

      renderProbe(root, { startSeconds: 0, endSeconds: 12480 }, true)
      renderProbe(root, { startSeconds: 1310, endSeconds: 2210 }, true)

      expect(container.querySelector('output')?.getAttribute('data-start')).toBe('0')

      act(() => {
        vi.advanceTimersByTime(400)
      })

      expect(container.querySelector('output')?.getAttribute('data-start')).toBe('1310')
      expect(container.querySelector('output')?.getAttribute('data-end')).toBe('2210')
    } finally {
      vi.useRealTimers()
      raf.mockRestore()
    }
  })
})
