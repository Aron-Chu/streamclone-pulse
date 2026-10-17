import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { createSpHoverStore, createSpViewportStore } from '@streampulse/pulse-charts/spchart'
import type { AnalyticsTopEmote } from '../../api.ts'
import type { AnalyticsViewMode } from './AnalyticsChart.tsx'
import {
  SessionExpandButton,
  SessionOverlayControl,
  SessionRangeSeg,
  SessionReadout,
  SessionSeriesSeg,
  readoutCount,
  sessionSeriesKey,
  sessionSeriesVisibility,
} from './SessionChartToolbar.tsx'
import { buildSessionChartModel, presetPressed, presetRange, sessionRangePresets } from './sessionSpChartModel.ts'
import { HARNESS_STARTED_AT, harnessDetail } from './__fixtures__/sessionChartHarness.ts'

afterEach(() => cleanup())

const labels = (presets: { label: string }[]) => presets.map(p => p.label)

describe('session range presets', () => {
  it('offers the presets shorter than the stream, then Full (long presets hidden)', () => {
    expect(labels(sessionRangePresets(10 * 60, false))).toEqual(['Full'])
    expect(labels(sessionRangePresets(45 * 60, false))).toEqual(['15m', 'Full'])
    expect(labels(sessionRangePresets(195 * 60, false))).toEqual(['15m', '1h', '2h', 'Full'])
    expect(labels(sessionRangePresets(748 * 60, false))).toEqual(['15m', '1h', '2h', '4h', 'Full'])
  })

  it('keeps 1h, 4h and Full on phones', () => {
    expect(labels(sessionRangePresets(748 * 60, true))).toEqual(['1h', '4h', 'Full'])
    expect(labels(sessionRangePresets(90 * 60, true))).toEqual(['1h', 'Full'])
  })

  it('anchors a preset at the stream end, and presses it only while the view is that window', () => {
    // 180 one-minute samples (0..179): 1h is the last 60 minute steps.
    expect(presetRange(180, 60_000, 3_600)).toEqual({ startIndex: 119, endIndex: 179 })
    expect(presetRange(180, 60_000, 0)).toEqual({ startIndex: 0, endIndex: 179 })
    expect(presetRange(30, 60_000, 3_600)).toEqual({ startIndex: 0, endIndex: 29 })
    const oneHour = { label: '1h', seconds: 3_600 }
    const full = { label: 'Full', seconds: 0 }
    expect(presetPressed(oneHour, { startIndex: 119, endIndex: 179 }, 180, 60_000)).toBe(true)
    expect(presetPressed(oneHour, { startIndex: 100, endIndex: 160 }, 180, 60_000)).toBe(false)
    expect(presetPressed(full, { startIndex: 0, endIndex: 179 }, 180, 60_000)).toBe(true)
    expect(presetPressed(full, { startIndex: 119, endIndex: 179 }, 180, 60_000)).toBe(false)
  })
})

describe('SessionRangeSeg', () => {
  it('moves the shared viewport store to the end-anchored window and presses the matching preset', () => {
    const model = buildSessionChartModel({ rollups: harnessDetail(180).rollups, streamStartedAt: HARNESS_STARTED_AT })!
    const store = createSpViewportStore({ count: model.n, reducedMotion: () => true })
    render(<SessionRangeSeg store={store} model={model} phone={false} />)
    const seg = screen.getByRole('group', { name: 'Range' })
    expect([...seg.querySelectorAll('button')].map(b => b.textContent)).toEqual(['15m', '1h', '2h', 'Full'])
    expect(screen.getByRole('button', { name: 'Full' }).getAttribute('aria-pressed')).toBe('true')
    act(() => { fireEvent.click(screen.getByRole('button', { name: '1h' })) })
    expect(store.getTarget()).toEqual({ startIndex: model.n - 61, endIndex: model.n - 1 })
    expect(screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Full' }).getAttribute('aria-pressed')).toBe('false')
    store.destroy()
  })
})

describe('SessionSeriesSeg', () => {
  function Seg() {
    const [mode, setMode] = useState<AnalyticsViewMode>('overview')
    return <SessionSeriesSeg viewMode={mode} onViewModeChange={setMode} />
  }

  it('always has exactly one series button on, All by default', () => {
    render(<Seg />)
    const seg = screen.getByRole('group', { name: 'Series' })
    const pressed = () => [...seg.querySelectorAll('button[aria-pressed="true"]')].map(b => b.textContent)
    expect([...seg.querySelectorAll('button')].map(b => b.textContent)).toEqual(['All', 'Viewers', 'Chat/min', 'Emotes/min'])
    expect(pressed()).toEqual(['All'])
    fireEvent.click(screen.getByRole('button', { name: 'Chat/min' }))
    expect(pressed()).toEqual(['Chat/min'])
    // Pressing the pressed button keeps it on (never zero series).
    fireEvent.click(screen.getByRole('button', { name: 'Chat/min' }))
    expect(pressed()).toEqual(['Chat/min'])
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(pressed()).toEqual(['All'])
  })

  it('maps console view modes to the seg (Spikes and series focus fall back to All) and hides, not fades, the rest', () => {
    expect(sessionSeriesKey('overview')).toBe('all')
    expect(sessionSeriesKey('viewers')).toBe('viewers')
    expect(sessionSeriesKey('chat')).toBe('chat')
    expect(sessionSeriesKey('emotes')).toBe('emotes')
    expect(sessionSeriesVisibility('all', true)).toEqual({ chat: true, emotes: true, viewers: true, overlay: true })
    expect(sessionSeriesVisibility('chat', true)).toEqual({ chat: true, emotes: false, viewers: false, overlay: true })
    expect(sessionSeriesVisibility('viewers', true)).toEqual({ chat: false, emotes: false, viewers: true, overlay: false })
    expect(sessionSeriesVisibility('emotes', false)).toEqual({ chat: false, emotes: true, viewers: false, overlay: false })
  })
})

describe('SessionExpandButton', () => {
  it('is one Expand toggle with aria-pressed', () => {
    const onToggle = vi.fn()
    const { rerender } = render(<SessionExpandButton expanded={false} onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: 'Expand' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledTimes(1)
    rerender(<SessionExpandButton expanded onToggle={onToggle} />)
    expect(screen.getByRole('button', { name: 'Expand' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('SessionOverlayControl', () => {
  const emotes: AnalyticsTopEmote[] = Array.from({ length: 8 }, (_, i) => ({
    key: `7tv:${i}`,
    name: `Emote${i}`,
    id: String(i),
    provider: '7tv',
    count: 1000 - i * 100,
  })) as AnalyticsTopEmote[]

  function Overlay() {
    const [key, setKey] = useState<string | null>(null)
    const [last, setLast] = useState(emotes[0]!.key)
    return (
      <SessionOverlayControl
        topEmotes={emotes}
        overlayKey={key}
        onToggle={() => setKey(current => (current ? null : last))}
        onChoose={next => {
          setLast(next)
          setKey(next)
        }}
      />
    )
  }

  it('shows one teal overlay at most, toggled on and off', () => {
    const { container } = render(<Overlay />)
    const toggle = container.querySelector<HTMLElement>('[data-session-overlay-toggle]')!
    expect(toggle.textContent).toBe('Emotes on chart · 0')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('Emotes on chart · 1')
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('Emotes on chart · 0')
  })

  it('Edit opens a top-6 menu (wheel-exempt); choosing one draws it, Esc closes and returns focus to Edit', () => {
    const { container } = render(<Overlay />)
    const edit = screen.getByRole('button', { name: 'Edit' })
    expect(edit.getAttribute('aria-haspopup')).toBe('menu')
    fireEvent.click(edit)
    const menu = screen.getByRole('menu', { name: 'Emote on chart' })
    expect(menu.hasAttribute('data-chart-wheel-exempt')).toBe(true)
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map(item => item.querySelector('.ssc-mt')?.textContent)).toEqual(['Emote0', 'Emote1', 'Emote2', 'Emote3', 'Emote4', 'Emote5'])
    expect(items[0]!.querySelector('.ssc-sub')?.textContent).toBe('1,000')
    fireEvent.click(items[2]!)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(edit)
    expect(container.querySelector('[data-session-overlay-toggle]')?.textContent).toBe('Emotes on chart · 1')
    fireEvent.click(edit)
    expect(screen.getByRole('menuitemradio', { checked: true }).querySelector('.ssc-mt')?.textContent).toBe('Emote2')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(edit)
  })

  it('has no Edit without top emotes', () => {
    render(<SessionOverlayControl topEmotes={[]} overlayKey={null} onToggle={vi.fn()} onChoose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })
})

describe('SessionReadout', () => {
  const detail = harnessDetail(30)
  const model = buildSessionChartModel({ rollups: detail.rollups, streamStartedAt: HARNESS_STARTED_AT })!
  const none = { moment: null, pinned: null }
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ') ?? ''

  it('rests on the newest minute, led by "Latest" live or not, as one polite live region', () => {
    const hover = createSpHoverStore()
    const resting = detail.rollups[29]!
    const { container, rerender } = render(<SessionReadout hover={hover} model={model} isLive resting={resting} selection={none} />)
    const readout = container.querySelector('[data-session-readout]')!
    expect(readout.getAttribute('aria-live')).toBe('polite')
    // Minute 29: viewers 129, chat 15, emotes 2 + 29 % 9 = 4.
    expect(text(readout)).toMatch(/^Latest · 0:29:00 · viewers 129 · chat 15\/min · emotes 4\/min$/)
    rerender(<SessionReadout hover={hover} model={model} isLive={false} resting={resting} selection={none} />)
    expect(text(container.querySelector('[data-session-readout]'))).toMatch(/^Latest · 0:29:00 · /)
  })

  it('formats counts like the mockup: K/M with one decimal, en-US integers, a dash for no data', () => {
    expect(readoutCount(34_312)).toBe('34.3K')
    expect(readoutCount(2_450_000)).toBe('2.5M')
    expect(readoutCount(812)).toBe('812')
    expect(readoutCount(null)).toBe('—')
    expect(readoutCount(Number.NaN)).toBe('—')
  })

  it('ends a pointer hover with "click for details" only while nothing is pinned', () => {
    const hover = createSpHoverStore()
    const hit = (source: 'pointer' | 'keyboard') => ({
      index: 12,
      ms: Date.parse(HARNESS_STARTED_AT) + 12 * 60_000,
      x: 0,
      fine: true,
      bar: null,
      levelMinutes: 1,
      source,
      sample: { viewers: 112, chat: 22, emotes: 5, overlay: null, coverage: 0 },
    }) as never
    const pinned = { offsetSeconds: 10 * 60, rollup: detail.rollups[10]! }
    const { container, rerender } = render(<SessionReadout hover={hover} model={model} resting={detail.rollups[29]!} selection={none} />)
    const tip = () => container.querySelector('[data-session-readout-tip]')
    act(() => hover.set(hit('pointer')))
    expect(tip()?.textContent).toBe(' · click for details')
    expect(tip()?.getAttribute('aria-hidden')).toBe('true')
    act(() => hover.set(hit('keyboard')))
    expect(tip()).toBeNull()
    rerender(<SessionReadout hover={hover} model={model} resting={detail.rollups[29]!} selection={{ moment: null, pinned }} />)
    act(() => hover.set(hit('pointer')))
    expect(tip()).toBeNull()
  })

  it('reads a pinned minute, then the hover over it, and back', () => {
    const hover = createSpHoverStore()
    const pinned = { offsetSeconds: 10 * 60, rollup: detail.rollups[10]! }
    const { container } = render(
      <SessionReadout hover={hover} model={model} isLive={false} resting={detail.rollups[29]!} selection={{ moment: null, pinned }} />,
    )
    const readout = () => text(container.querySelector('[data-session-readout]'))
    expect(readout()).toMatch(/^Pinned 0:10:00 · viewers /)
    act(() => hover.set({
      index: 12,
      ms: Date.parse(HARNESS_STARTED_AT) + 12 * 60_000,
      x: 0,
      fine: true,
      bar: null,
      source: 'pointer',
      sample: { viewers: 112, chat: 22, emotes: 5, overlay: null, coverage: 0 },
    } as never))
    expect(readout()).toMatch(/^0:12:00 · /)
    expect(readout()).toContain('chat 22/min')
    act(() => hover.set(null))
    expect(readout()).toMatch(/^Pinned 0:10:00/)
  })

  it('reads a locked bar above 1-minute bars as "Pinned bar", ahead of the moment it holds (F23)', () => {
    const hover = createSpHoverStore()
    const start = Date.parse(HARNESS_STARTED_AT)
    const bar = {
      startMs: start + 10 * 60_000,
      endMs: start + 20 * 60_000,
      fromIndex: 10,
      toIndex: 20,
      chat: 18,
      emotes: 6,
      viewers: 34_312,
      overlay: null,
      chatPeak: 22,
      chatPeakIndex: 12,
      emotesPeak: 9,
      emotesPeakIndex: 12,
      observed: 7,
      expected: 10,
      partial: true,
    }
    const pinned = { offsetSeconds: 12 * 60, rollup: detail.rollups[12]! }
    const { container, rerender } = render(
      <SessionReadout hover={hover} model={model} resting={detail.rollups[29]!} selection={{ moment: null, pinned, bar: { bar, levelMinutes: 10 } }} />,
    )
    const readout = () => text(container.querySelector('[data-session-readout]'))
    expect(readout()).toBe('Pinned bar 0:10:00–0:20:00 · 10-min avg · viewers 34.3K · chat 18/min · emotes 6/min · 7 of 10 min measured')
    // a lock at 1-minute bars is the pinned minute itself
    rerender(<SessionReadout hover={hover} model={model} resting={detail.rollups[29]!} selection={{ moment: null, pinned, bar: { bar, levelMinutes: 1 } }} />)
    expect(readout()).toMatch(/^Pinned 0:12:00 · viewers /)
  })
})
