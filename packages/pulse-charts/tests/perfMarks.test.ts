// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  resetSpPerfForTests,
  spMark,
  spMeasure,
  spPerf,
  spPerfEnabled,
  spPerfFrame,
  spPerfGesture,
  spPerfLevelChange,
  spProfilerOnRender,
} from '../src/perfMarks.ts'

describe('perfMarks', () => {
  let marks: string[]
  let measures: string[][]

  beforeEach(() => {
    resetSpPerfForTests()
    delete window.__spPerf
    marks = []
    measures = []
    for (const k of ['mark', 'measure'] as const) if (typeof performance[k] !== 'function') (performance as unknown as Record<string, () => void>)[k] = () => undefined
    vi.spyOn(performance, 'mark').mockImplementation(((name: string) => void marks.push(name)) as unknown as typeof performance.mark)
    vi.spyOn(performance, 'measure').mockImplementation(((...a: string[]) => void measures.push(a)) as unknown as typeof performance.measure)
  })
  afterEach(() => {
    history.replaceState(null, '', '/')
    vi.restoreAllMocks()
  })

  it('marks and measures once per load, flag or not', () => {
    spMark('sp:hub-data')
    spMark('sp:hub-data')
    spMark('sp:chart-ready')
    spMeasure('sp:hub', 'sp:hub-data', 'sp:chart-ready')
    spMeasure('sp:hub', 'sp:hub-data', 'sp:chart-ready')
    expect(marks).toEqual(['sp:hub-data', 'sp:chart-ready'])
    expect(measures).toEqual([['sp:hub', 'sp:hub-data', 'sp:chart-ready']])
    resetSpPerfForTests()
    spMark('sp:hub-data')
    expect(marks).toHaveLength(3)
  })

  it('a missing mark or no User Timing never throws', () => {
    vi.spyOn(performance, 'measure').mockImplementation(() => {
      throw new Error('no such mark')
    })
    vi.spyOn(performance, 'mark').mockImplementation(() => {
      throw new Error('no User Timing')
    })
    expect(() => spMeasure('sp:x', 'missing')).not.toThrow()
    expect(() => spMark('sp:y')).not.toThrow()
  })

  it('with the flag off: no debug state, the debug calls return at once', () => {
    history.replaceState(null, '', '/analytics?debug=wheel')
    expect(spPerfEnabled()).toBe(false)
    spPerfGesture(true)
    spPerfFrame(16)
    spPerfGesture(false)
    spPerfLevelChange()
    spProfilerOnRender('hub')
    spMark('sp:hub-data')
    expect(spPerf()).toBeNull()
    expect(window.__spPerf).toBeUndefined()
  })

  it('with ?debug=perf: window.__spPerf with marks, frame stats, level changes and commits', () => {
    history.replaceState(null, '', '/analytics?debug=wheel,perf')
    expect(spPerfEnabled()).toBe(true)
    spMark('sp:hub-data')
    const s = window.__spPerf!
    expect(s).toBe(spPerf())
    expect(typeof s.marks['sp:hub-data']).toBe('number')
    // frames count only while a gesture runs
    spPerfFrame(99)
    spPerfGesture(true)
    for (const ms of [16, 17, 16, 18, 33, 16, 17, 16, 16, 50]) spPerfFrame(ms)
    spPerfGesture(false)
    spPerfFrame(99)
    expect(s.wheel).toEqual({ frames: 10, p50: 17, p95: 50, max: 50, loaf: 0 })
    // a later gesture adds to the stats
    spPerfGesture(true)
    spPerfFrame(16)
    spPerfGesture(false)
    expect(s.wheel.frames).toBe(11)
    spPerfLevelChange()
    spPerfLevelChange()
    expect(s.levelChanges).toBe(2)
    spProfilerOnRender('hub')
    spProfilerOnRender('hub')
    spProfilerOnRender('session')
    expect(s.renders).toEqual({ hub: 2, session: 1 })
  })

  it('reads the flag once per load', () => {
    expect(spPerfEnabled()).toBe(false)
    history.replaceState(null, '', '/analytics?debug=perf')
    expect(spPerfEnabled()).toBe(false)
    resetSpPerfForTests()
    expect(spPerfEnabled()).toBe(true)
  })
})
