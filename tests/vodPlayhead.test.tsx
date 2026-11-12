// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { useVodPlayhead, vodPlayheadOffset, type VodPlayhead } from '../src/hooks/useVodPlayhead.ts'
import { ChartReadoutBand } from '../src/ui/ChartReadoutBand.tsx'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('vodPlayheadOffset', () => {
  it('is the VOD time when the archive starts with the stream', () => {
    expect(vodPlayheadOffset(21_041.7, undefined)).toBe(21_041)
    expect(vodPlayheadOffset(21_041, null)).toBe(21_041)
    expect(vodPlayheadOffset(21_041, 0)).toBe(21_041)
  })

  it('adds the recorder delay, so the line sits on the stream minute playing', () => {
    expect(vodPlayheadOffset(600, 37)).toBe(637)
    expect(vodPlayheadOffset(600, -20)).toBe(580)
  })

  it('draws nothing for a delta it cannot trust or a time it cannot read', () => {
    expect(vodPlayheadOffset(600, 1.5)).toBeNull()
    expect(vodPlayheadOffset(600, 7 * 3600)).toBeNull()
    expect(vodPlayheadOffset(Number.NaN, 0)).toBeNull()
    expect(vodPlayheadOffset(-3, 0)).toBeNull()
  })
})

describe('ChartReadoutBand following the video', () => {
  it('names the playing minute and its numbers, quietly', () => {
    const markup = renderToStaticMarkup(
      <ChartReadoutBand
        mode="playing"
        offsetSeconds={21_000}
        viewerValue={15_769}
        chatValue={572}
        emoteValue={48}
        backendUrl="https://api.streampulse.stream"
      />,
    )
    expect(markup).toContain('data-chart-readout-state="playing"')
    expect(markup).toContain('>Playing<')
    expect(markup).toContain('05:50:00')
    expect(markup).toContain('15,769')
    expect(markup).toContain('aria-live="off"')
    expect(markup).not.toContain('pulse-rb-picked')
  })

  it('says Paused while the video is paused', () => {
    const markup = renderToStaticMarkup(
      <ChartReadoutBand mode="paused" offsetSeconds={60} chatValue={4} backendUrl="https://api.streampulse.stream" />,
    )
    expect(markup).toContain('>Paused<')
    expect(markup).toContain('data-chart-readout-state="paused"')
  })
})

describe('useVodPlayhead', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    document.querySelectorAll('video').forEach(video => video.remove())
    root = null
    host = null
  })

  function fakeVideo(state: { time: number; paused: boolean }): HTMLVideoElement {
    const video = document.createElement('video')
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => state.time })
    Object.defineProperty(video, 'paused', { configurable: true, get: () => state.paused })
    Object.defineProperty(video, 'duration', { configurable: true, get: () => 39_000 })
    document.body.append(video)
    return video
  }

  function mount(enabled: boolean): { current: VodPlayhead | null } {
    const seen: { current: VodPlayhead | null } = { current: null }
    function Probe() {
      seen.current = useVodPlayhead(enabled)
      return null
    }
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(<Probe />))
    return seen
  }

  it('follows the video as it plays, seeks and pauses', () => {
    const state = { time: 120.4, paused: false }
    const video = fakeVideo(state)
    const seen = mount(true)
    expect(seen.current).toEqual({ seconds: 120, paused: false })

    state.time = 3_600.9
    act(() => { video.dispatchEvent(new Event('timeupdate')) })
    expect(seen.current).toEqual({ seconds: 3_600, paused: false })

    state.paused = true
    act(() => { video.dispatchEvent(new Event('pause')) })
    expect(seen.current).toEqual({ seconds: 3_600, paused: true })
  })

  it('reads nothing when it is off', () => {
    fakeVideo({ time: 120, paused: false })
    expect(mount(false).current).toBeNull()
  })
})
