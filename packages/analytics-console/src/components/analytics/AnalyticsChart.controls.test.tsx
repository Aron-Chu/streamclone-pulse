import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { AnalyticsStreamDetail } from '../../api.ts'
import type { AnalyticsViewMode } from './AnalyticsChart.tsx'
import AnalyticsChart from './AnalyticsChart.tsx'
import { scrollZoomToggle } from './__fixtures__/sessionChartHarness.ts'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

const START = Date.parse('2026-07-31T00:00:00.000Z')

function streamDetail(minutes: number): AnalyticsStreamDetail {
  return {
    stream: {
      streamId: `controls-chart-stream-${minutes}`,
      startedAt: new Date(START).toISOString(),
      peakViewers: 200,
      avgViewers: 120,
    },
    rollups: Array.from({ length: minutes }, (_, index) => ({
      minuteTs: new Date(START + index * 60_000).toISOString(),
      viewerAvg: 100 + (index % 40),
      chatCount: 10 + (index % 12),
      totalEmoteCount: 2 + (index % 9),
      emotes: { Kappa: 4 + (index % 5), PogChamp: 1 + (index % 3) },
    })),
    topEmotes: [
      { key: 'Kappa', name: 'Kappa', count: 11, provider: '7tv' },
      { key: 'PogChamp', name: 'PogChamp', count: 6, provider: 'twitch' },
    ],
    sources: [],
  } as unknown as AnalyticsStreamDetail
}

afterEach(() => cleanup())

function Harness({ minutes = 180, initial = [] as string[] }: { minutes?: number; initial?: string[] }) {
  const [mode, setMode] = useState<AnalyticsViewMode>('overview')
  const [selected, setSelected] = useState<Set<string>>(new Set(initial))
  const [detail] = useState(() => streamDetail(minutes))

  return (
    <div data-testid="harness" data-selected-emotes={[...selected].join(',')} data-mode={mode}>
      <AnalyticsChart
        detail={detail}
        selectedEmotes={selected}
        onSelectEmote={key => setSelected(current => {
          const next = new Set(current)
          if (next.has(key)) next.delete(key)
          else next.add(key)
          return next
        })}
        onClearEmotePlots={() => setSelected(new Set())}
        onResetEmotePlots={() => setSelected(new Set(['Kappa']))}
        selectedRollup={null}
        onSelectRollup={() => {}}
        viewMode={mode}
        onViewModeChange={setMode}
      />
    </div>
  )
}

const navigatorWindow = (container: HTMLElement) =>
  container.querySelector('[data-hub-chart-navigator]')!.getAttribute('data-hub-chart-navigator-window')!
const spanOf = (window: string) => {
  const [start, end] = window.split(':').map(Number)
  return end! - start! + 1
}

describe('AnalyticsChart session toolbar', () => {
  it('keeps one series seg with exactly one pressed button, mapped to the console view mode', () => {
    const { container } = render(<Harness />)
    const seg = container.querySelector('[data-session-series-seg]')!
    const buttons = within(seg as HTMLElement).getAllByRole('button')
    expect(buttons.map(b => b.textContent)).toEqual(['All', 'Viewers', 'Chat/min', 'Emotes/min'])
    const pressed = () => buttons.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
    expect(pressed()).toEqual(['All'])
    expect(container.querySelectorAll('rect.spc-bar').length).toBeGreaterThan(0)

    fireEvent.click(buttons[1]!)
    expect(pressed()).toEqual(['Viewers'])
    expect(screen.getByTestId('harness').getAttribute('data-mode')).toBe('viewers')
    // Viewers only: the chat bars and the emotes line leave the plot.
    expect(container.querySelectorAll('rect.spc-bar')).toHaveLength(0)
    expect(container.querySelector('.spc-line-emotes')).toBeNull()

    fireEvent.click(buttons[2]!)
    expect(pressed()).toEqual(['Chat/min'])
    expect(container.querySelectorAll('rect.spc-bar').length).toBeGreaterThan(0)

    fireEvent.click(buttons[0]!)
    expect(pressed()).toEqual(['All'])
    expect(screen.getByTestId('harness').getAttribute('data-mode')).toBe('overview')
  })

  // d3-v2 session-original (2026-10-15, Aron): the plotted emotes are one line
  // under the chart, each in its trace colour with a remove ×, plus Add emote.
  it('plots emotes from the Emotes on chart line: Add emote checklist, coloured tokens, remove ×', () => {
    const { container } = render(<Harness />)
    const selected = () => screen.getByTestId('harness').getAttribute('data-selected-emotes')
    const line = container.querySelector<HTMLElement>('[data-session-emotes-on-chart]')!
    expect(line.textContent).toContain('Emotes on chart')
    expect(line.querySelectorAll('[data-session-emote-token]')).toHaveLength(0)
    expect(container.querySelector('[data-session-overlay-line], .spc-line-overlay')).toBeNull()

    const add = within(line).getByRole('button', { name: 'Add emote' })
    expect(add.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(add)
    expect(add.getAttribute('aria-expanded')).toBe('true')
    const panel = within(line).getByRole('group', { name: 'Emotes on chart' })
    expect(panel.hidden).toBe(false)
    expect(panel.hasAttribute('data-chart-wheel-exempt')).toBe(true)
    const box = (key: string) => panel.querySelector<HTMLInputElement>(`[data-session-emote="${key}"]`)!
    expect([box('Kappa').checked, box('PogChamp').checked]).toEqual([false, false])

    fireEvent.click(box('Kappa'))
    fireEvent.click(box('PogChamp'))
    expect(selected()).toBe('Kappa,PogChamp')
    // prod's per-emote palette, in plot order; solid lines, never the core's dashed overlay
    // the emotes lane's lines (session-original lanes), the stroke on each path
    const lines = [...container.querySelectorAll('path[data-lane-line]')]
    expect(lines.map(g => [g.getAttribute('data-lane-line'), g.getAttribute('stroke')])).toEqual([
      ['Kappa', '#fb7185'],
      ['PogChamp', '#fbbf24'],
    ])
    expect(container.querySelector('.spc-line-overlay')).toBeNull()
    const tokens = [...line.querySelectorAll<HTMLElement>('[data-session-emote-token]')]
    expect(tokens.map(t => [t.querySelector('.ssc-eo-c')?.textContent, t.style.getPropertyValue('--c')])).toEqual([
      ['Kappa', '#fb7185'],
      ['PogChamp', '#fbbf24'],
    ])
    expect(panel.querySelector('.ssc-eo-max')).toBeNull()

    // Escape closes the list and, from inside it, returns focus to Add emote.
    box('Kappa').focus()
    fireEvent.keyDown(box('Kappa'), { key: 'Escape' })
    expect(panel.hidden).toBe(true)
    expect(document.activeElement).toBe(add)

    // × removes one; focus lands on Add emote and the colours follow the new order.
    fireEvent.click(within(line).getByRole('button', { name: 'Remove Kappa from the chart' }))
    expect(selected()).toBe('PogChamp')
    expect(document.activeElement).toBe(add)
    expect(line.querySelector<HTMLElement>('[data-session-emote-token]')?.style.getPropertyValue('--c')).toBe('#fb7185')
  })

  it('draws the plotted emotes with All and Emotes, not with Chat or Viewers', () => {
    const { container } = render(<Harness initial={['Kappa', 'PogChamp']} />)
    const seg = container.querySelector<HTMLElement>('[data-session-series-seg]')!
    const drawn = () => container.querySelectorAll('path[data-lane-line]').length
    expect(drawn()).toBe(2)
    fireEvent.click(within(seg).getByRole('button', { name: /Chat/ }))
    expect(drawn()).toBe(0)
    fireEvent.click(within(seg).getByRole('button', { name: /Emotes/ }))
    expect(drawn()).toBe(2)
    fireEvent.click(within(seg).getByRole('button', { name: /Viewers/ }))
    expect(drawn()).toBe(0)
    // The line under the chart keeps listing them.
    expect(container.querySelectorAll('[data-session-emote-token]')).toHaveLength(2)
  })

  it('keeps every chart marker off on load: Show on chart lists Moments and Averages, count on the button', () => {
    const { container } = render(<Harness />)
    const show = container.querySelector<HTMLButtonElement>('[data-session-show-toggle]')!
    expect(show.getAttribute('aria-label')).toBe('Show on chart')
    fireEvent.click(show)
    const panel = screen.getByRole('group', { name: 'Show on chart' })
    expect(panel.hasAttribute('data-chart-wheel-exempt')).toBe(true)
    const boxes = [...panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    // not live: no Live edge row
    expect(boxes.map(b => [b.getAttribute('data-session-marker'), b.checked])).toEqual([['moments', false], ['avg', false]])
    expect(container.querySelector('.spc-avg')).toBeNull()
    fireEvent.click(boxes[1]!)
    expect(container.querySelector('.spc-avg')).not.toBeNull()
    expect(show.getAttribute('aria-label')).toBe('Show on chart, 1 on')
    expect(show.querySelector('.ssc-cnt')?.textContent).toBe('1')
  })

  it('offers end-anchored range presets shorter than the stream, pressed while they are the view', () => {
    const { container } = render(<Harness minutes={180} />)
    const seg = container.querySelector<HTMLElement>('[data-session-range-seg]')!
    expect(container.querySelectorAll('[data-session-range-seg]')).toHaveLength(1)
    const labels = within(seg).getAllByRole('button').map(b => b.textContent)
    // 2h59: the 4h preset is at least as long as the stream, so it is hidden.
    expect(labels).toEqual(['15m', '1h', '2h', 'Full'])
    const pressed = () => within(seg).getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
    expect(pressed()).toEqual(['Full'])

    fireEvent.click(within(seg).getByRole('button', { name: '1h' }))
    // 60 minutes ending at the last minute (index 179).
    expect(navigatorWindow(container)).toBe('119:179')
    expect(pressed()).toEqual(['1h'])

    fireEvent.click(within(seg).getByRole('button', { name: 'Full' }))
    expect(navigatorWindow(container)).toBe('0:179')
    expect(pressed()).toEqual(['Full'])
  })

  it('has no zoom buttons of its own: -/+/Reset/Scroll zoom stay in the navigator', () => {
    const { container } = render(<Harness minutes={180} />)
    const navigator = container.querySelector<HTMLElement>('[data-hub-chart-navigator]')!
    for (const name of ['Zoom in', 'Zoom out', 'Reset zoom']) {
      const buttons = screen.getAllByRole('button', { name })
      expect(buttons).toHaveLength(1)
      expect(navigator.contains(buttons[0]!)).toBe(true)
    }
    // Scroll zoom and the hint sit in the navigator's (i) (d3-v2 session-original).
    const info = screen.getByRole('button', { name: 'How to zoom and pan the chart' })
    expect(navigator.contains(info)).toBe(true)
    fireEvent.click(info)
    expect(navigator.contains(screen.getByRole('button', { name: /Scroll zoom/ }))).toBe(true)
    expect(screen.getByRole('button', { name: /Scroll zoom/ })).toBe(scrollZoomToggle(container))
    expect(container.querySelector('[data-session-chart-part] [data-chart-viewport-controls], [data-chart-range-row]')).toBeNull()
  })
})

// The same behaviour as AnalyticsChart.zoomParity's stream tests, read the way
// the d3 navigator exposes it (aria-disabled) and on the SpChart plot
// (role="application"): ART/core-requests/u08-1.json and u08-2.json.
describe('session zoom matches the Global activity chart (d3 navigator)', () => {
  it('stops Zoom in at five minutes and marks it unavailable, without creeping the window', () => {
    const { container } = render(<Harness minutes={748} />)
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' })
    const windows: string[] = []
    for (let click = 0; click < 16 && zoomIn.getAttribute('aria-disabled') !== 'true'; click += 1) {
      fireEvent.click(zoomIn)
      windows.push(navigatorWindow(container))
    }
    expect(zoomIn.getAttribute('aria-disabled')).toBe('true')
    expect(spanOf(windows[windows.length - 1]!)).toBe(6)
    for (let index = 1; index < windows.length; index += 1) {
      expect(spanOf(windows[index]!)).toBeLessThan(spanOf(windows[index - 1]!))
    }
    const floor = navigatorWindow(container)
    fireEvent.click(zoomIn)
    expect(navigatorWindow(container)).toBe(floor)
    const plot = container.querySelector('[data-chart-touch-action]')!
    const viewport = Number(plot.getAttribute('data-chart-viewport-end')) - Number(plot.getAttribute('data-chart-viewport-start'))
    expect(viewport).toBe(300)
  })

  it('steps the plot + / - / 0 keys exactly like Zoom in / Zoom out / Reset zoom', () => {
    const viaButtons = render(<Harness minutes={748} />)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    const afterButtonIn = navigatorWindow(viaButtons.container)
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    const afterButtonOut = navigatorWindow(viaButtons.container)
    cleanup()

    const { container } = render(<Harness minutes={748} />)
    const plot = container.querySelector('svg[role="application"]')!
    expect(plot).not.toBeNull()
    fireEvent.keyDown(plot, { key: '+' })
    expect(navigatorWindow(container)).toBe(afterButtonIn)
    fireEvent.keyDown(plot, { key: '=' })
    fireEvent.keyDown(plot, { key: '-' })
    expect(navigatorWindow(container)).toBe(afterButtonOut)
    const scrollZoom = scrollZoomToggle(container)
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('true')
    fireEvent.keyDown(plot, { key: '0' })
    expect(navigatorWindow(container)).toBe('0:747')
    expect(scrollZoom.getAttribute('aria-pressed')).toBe('true')
    // With Ctrl, Cmd or Alt held, + and - stay the browser's page zoom.
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(fireEvent.keyDown(plot, { key: '+', ...modifier })).toBe(true)
      expect(fireEvent.keyDown(plot, { key: '-', ...modifier })).toBe(true)
    }
    expect(navigatorWindow(container)).toBe('0:747')
    for (let press = 0; press < 12; press += 1) fireEvent.keyDown(plot, { key: '+' })
    const floor = navigatorWindow(container)
    expect(spanOf(floor)).toBe(6)
    fireEvent.keyDown(plot, { key: '+' })
    expect(navigatorWindow(container)).toBe(floor)
  })
})
