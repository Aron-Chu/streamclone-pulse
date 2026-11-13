import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import AnalyticsChart from './AnalyticsChart.tsx'
import { harnessDetail, holdFrames, showOnChart, type HeldFrames } from './__fixtures__/sessionChartHarness.ts'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: false }) }))

let frames: HeldFrames | null = null
const realMatchMedia = window.matchMedia
afterEach(() => {
  cleanup()
  frames?.restore()
  frames = null
  window.matchMedia = realMatchMedia
})

type Props = ComponentProps<typeof AnalyticsChart>

// 180 minutes: chat 10..21 (avg 15.5), emotes 2..10 (avg 6), viewers 100..139.
function renderCaption(overrides: Partial<Props> = {}) {
  frames = holdFrames(act)
  const view = render(
    <AnalyticsChart
      detail={harnessDetail(180)}
      selectedEmotes={new Set()}
      onSelectEmote={vi.fn()}
      selectedRollup={null}
      onSelectRollup={vi.fn()}
      viewMode="overview"
      onViewModeChange={vi.fn()}
      {...overrides}
    />,
  )
  frames.flush()
  return view
}

type Lane = 'viewers' | 'chat' | 'emotes' | 'overlay'
const chip = (container: HTMLElement, lane: Lane) => container.querySelector<HTMLElement>(`[data-chart-lane-caption="${lane}"]`)
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? null
const chips = (container: HTMLElement) => [...container.querySelectorAll('[data-chart-lane-caption]')].map(c => c.getAttribute('data-chart-lane-caption'))

describe('SessionSpChart lane captions (session-original, D5)', () => {
  it('captions each lane in its head: label, then the peak in the stat cards’ format', () => {
    const { container } = renderCaption()
    expect(chips(container)).toEqual(['viewers', 'chat', 'emotes'])
    // no header peak: the viewers lane names its busiest plotted minute
    expect(text(chip(container, 'viewers'))).toBe('Viewers·, peak 139')
    expect(text(chip(container, 'chat'))).toBe('Chat·, peak 21/min')
    expect(text(chip(container, 'emotes'))).toBe('Emotes·, peak 10/min')
    expect(container.querySelector('.spc-avg')?.getAttribute('d') ?? '').toBe('')
  })

  it('takes the viewers peak from the header figures, not the plotted minutes (D5)', () => {
    const { container } = renderCaption({ viewerCaption: { peak: 31_337, avg: 12_000.4 } })
    expect(text(chip(container, 'viewers'))).toBe('Viewers·, peak 31.3K')
    expect(chip(container, 'viewers')?.querySelector('[data-chart-scale-value="viewers-peak"]')?.textContent).toBe('31.3K')
  })

  it('adds each lane’s average and its dotted hairline only with Show on chart’s Averages', () => {
    const { container } = renderCaption({ viewerCaption: { peak: 31_337, avg: 12_000.4 } })
    expect(container.querySelector('[data-chart-scale-value$="-avg"]')).toBeNull()
    showOnChart(act, container, 'avg')
    frames!.flush()
    expect(text(chip(container, 'viewers'))).toBe('Viewers·, peak 31.3K·, avg 12.0K')
    expect(text(chip(container, 'chat'))).toBe('Chat·, peak 21/min·, avg 16/min')
    expect(text(chip(container, 'emotes'))).toBe('Emotes·, peak 10/min·, avg 6/min')
    // one hairline per lane
    expect(container.querySelector('.spc-avg')!.getAttribute('d')!.match(/M0 /g)).toHaveLength(3)
  })

  it('shows only the picked series’ lane, which takes the whole plot', () => {
    const { container } = renderCaption({ viewMode: 'emotes' })
    expect(chips(container)).toEqual(['emotes'])
    expect(chip(container, 'emotes')!.style.top).toBe('23px')
  })

  it('stacks the lanes under the 22 px band at 440 px, and at 580 px expanded', () => {
    const { container } = renderCaption()
    const tops = () => chips(container).map(k => chip(container, k as Lane)!.style.top)
    expect(container.querySelector<HTMLElement>('.spc-plot')?.style.height).toBe('440px')
    // (440 - 22 - 8) / 3 = 137: viewers 22-159, chat 167-304, emotes 304-440
    expect(tops()).toEqual(['23px', '168px', '305px'])
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }))
    frames!.flush()
    expect(container.querySelector<HTMLElement>('.spc-plot')?.style.height).toBe('580px')
    // (580 - 22 - 8) / 3 = 183: viewers 22-205, chat 213-396, emotes 396-580
    expect(tops()).toEqual(['23px', '214px', '397px'])
  })

  it('uses 340 px on a phone, with each lane’s max tick inside the lane head', () => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width: 719px'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    const { container } = renderCaption()
    expect(container.querySelector<HTMLElement>('.spc-plot')?.style.height).toBe('340px')
    const ticks = [...container.querySelectorAll('text.spc-tk[data-lane]')]
    // laneFit: each lane's max tick is the max in view plus 10 %, rounded up to two figures
    expect(ticks.map(t => t.textContent)).toEqual(['160', '24', '11'])
    expect(ticks.every(t => t.getAttribute('class') === 'spc-tk spc-tk-in')).toBe(true)
  })
})
