// @vitest-environment jsdom

import { act, createElement, useLayoutEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSmoothedScalar } from '../src/useSmoothedScalar.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PAD_LEFT = 58

function Probe({ target, enabled, seen }: { target: number; enabled: boolean; seen: number[] }) {
  const value = useSmoothedScalar(target, enabled, { settleMs: 180 })
  // Record committed values only (a render React discards is never painted).
  useLayoutEffect(() => {
    seen.push(value)
  })
  return createElement('output', { 'data-value': String(value) })
}

describe('useSmoothedScalar', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null
  const frames: FrameRequestCallback[] = []
  let now = 0

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    container?.remove()
    container = null
    frames.length = 0
    vi.unstubAllGlobals()
  })

  const render = (target: number, enabled: boolean, seen: number[]) =>
    act(() => {
      root!.render(createElement(Probe, { target, enabled, seen }) as ReactNode)
    })
  const step = (ms: number) =>
    act(() => {
      now += ms
      const pending = frames.splice(0)
      pending.forEach(callback => callback(now))
    })
  const value = () => Number(container!.querySelector('output')!.getAttribute('data-value'))

  it('starts a newly enabled value at its target instead of sweeping in', () => {
    const seen: number[] = []
    // No pin: disabled, parked at the plot's left edge.
    render(PAD_LEFT, false, seen)
    expect(value()).toBe(PAD_LEFT)

    // A pin appears at x=640 and motion turns on in the same render.
    seen.length = 0
    render(640, true, seen)
    expect(value()).toBe(640)
    // No committed render showed the parked left-edge value.
    expect(seen.filter(v => v !== 640)).toEqual([])
    step(16)
    expect(value()).toBe(640)
  })

  it('still eases between two targets while enabled', () => {
    const seen: number[] = []
    render(640, true, seen)
    expect(value()).toBe(640)
    render(900, true, seen)
    step(16)
    const mid = value()
    expect(mid).toBeGreaterThan(640)
    expect(mid).toBeLessThan(900)
    for (let i = 0; i < 100; i += 1) step(16)
    expect(value()).toBe(900)
  })
})
