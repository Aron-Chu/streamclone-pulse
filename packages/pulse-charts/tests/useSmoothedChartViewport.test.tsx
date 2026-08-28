// @vitest-environment jsdom

import { useSmoothedChartViewport } from '../src/useSmoothedChartViewport.ts'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
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
})
