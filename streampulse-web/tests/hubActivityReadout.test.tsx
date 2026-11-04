import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createSpHoverStore, type SpBar, type SpHit } from '@streampulse/pulse-charts/spchart'
import type { HubActivityPoint } from '../src/lib/publicHub'
import { formatHubCardInt, hubCardClock, hubCardClockRange } from '../src/lib/hubBucketCardModel'
import { HubActivityReadout, hubReadoutView } from '../src/ui/components/hub/HubActivityReadout'
import { buildHubActivitySpModel } from '../src/ui/components/hub/hubActivitySpModel'

const MIN = 60_000
const END = Date.UTC(2026, 9, 13, 18, 0, 0)

function points(count = 20): HubActivityPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    t: END - (count - 1 - index) * 6 * MIN,
    chat: (100 + index) * 6,
    emotes: (50 + index) * 6,
    seventv: 20 * 6,
    viewers: 300_000 + (index === 7 ? 50_000 : index * 10),
    hasChatRollup: true,
    hasViewerRollup: true,
    bucketComplete: true,
    viewerCoverage: 'complete',
    viewerContributors: 90 + index,
    viewerExpectedContributors: 120,
    topEmotes: [{ name: index === 19 ? 'Pog' : 'KEKW', count: 40 + index }],
  }))
}

const model = buildHubActivitySpModel(points(), 120, { bucketMinutes: 6 })!

const dateShort = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' })

function bar(fromIndex: number, toIndex: number, more: Partial<SpBar> = {}): SpBar {
  return {
    startMs: model.data.startMs + fromIndex * model.bucketMs,
    endMs: model.data.startMs + toIndex * model.bucketMs,
    fromIndex,
    toIndex,
    chat: 123.4,
    emotes: 55.2,
    viewers: 301_234,
    overlay: null,
    chatPeak: 130,
    chatPeakIndex: fromIndex,
    emotesPeak: 60,
    emotesPeakIndex: fromIndex,
    observed: toIndex - fromIndex,
    expected: toIndex - fromIndex,
    partial: false,
    ...more,
  }
}

function hit(b: SpBar): SpHit {
  return {
    index: b.fromIndex,
    ms: b.startMs,
    sample: { chat: b.chat, emotes: b.emotes ?? 0, viewers: b.viewers ?? 0, overlay: 0, coverage: 0 },
    bar: b,
    levelMinutes: ((b.endMs - b.startMs) / MIN),
    fine: false,
    x: 100,
    source: 'pointer',
  }
}

describe('hubReadoutView', () => {
  it('shows Now at rest: the newest closed bucket and the window peaks', () => {
    const view = hubReadoutView(model, null)!
    expect(view.mode).toBe('now')
    expect(view.time).toBe('Now')
    expect(view.time2).toBe(hubCardClockRange(model.latest!.t, model.latest!.t + model.bucketMs))
    expect(view.chat).toBe(formatHubCardInt(119))
    expect(view.chatPeak).toEqual({ value: formatHubCardInt(119), at: hubCardClock(model.peakChat!.t) })
    expect(view.viewers2).toBe(`peak ${formatHubCardInt(350_000)} · ${hubCardClock(model.data.startMs + 7 * model.bucketMs)} · 97 live`)
    expect(view.live).toBe('109 of 120 live')
    expect(view.top.map((emote) => emote.name)).toEqual(['Pog'])
    expect(view.top2).toBe('top emote')
  })

  it('shows the hovered bar with an ≈ live count over a merged bar', () => {
    const view = hubReadoutView(model, bar(2, 4))!
    expect(view.mode).toBe('hover')
    expect(view.time).toBe(hubCardClockRange(model.data.startMs + 2 * model.bucketMs, model.data.startMs + 4 * model.bucketMs))
    expect(view.chat).toBe('123')
    expect(view.chatPeak).toBeNull()
    expect(view.live).toBe('≈93 of 120 live')
    expect(view.top2).toBe('KEKW')
  })

  it('says a bar without a viewer value is not a full sample', () => {
    expect(hubReadoutView(model, bar(3, 4, { viewers: null }))!.viewers2).toBe('Not a full sample')
  })

  it('marks emote figures that are only a minimum with a leading ≥ (providerCountsLowerBound)', () => {
    const rows = points().map((point, index) => (index === 4 || index === 19 ? { ...point, providerCountsLowerBound: true } : point))
    const lower = buildHubActivitySpModel(rows, 120, { bucketMinutes: 6 })!
    const now = hubReadoutView(lower, null)!
    expect(now.emotes).toBe(`≥${formatHubCardInt(69)}`)
    expect(now.emotesPeak!.value).toBe(`≥${formatHubCardInt(69)}`)
    expect(now.chat).toBe(formatHubCardInt(119))
    expect(hubReadoutView(lower, bar(3, 5))!.emotes).toBe('≥55')
    expect(hubReadoutView(lower, bar(5, 7))!.emotes).toBe('55')
    expect(hubReadoutView(model, null)!.emotes).toBe(formatHubCardInt(69))
  })

  it('says Saved, not Now, at rest on a saved copy (S1, 10-28); the hovered bar keeps its time', () => {
    const saved = hubReadoutView(model, null, true)!
    expect(saved.time).toBe('Saved')
    expect(saved.time2).toBe(hubReadoutView(model, null)!.time2)
    expect(saved.chat).toBe(formatHubCardInt(119))
    expect(hubReadoutView(model, bar(2, 4), true)!.time).toBe(hubReadoutView(model, bar(2, 4))!.time)
  })

  it('holds the locked bar at rest with "· locked" (R1, 11-01); hover still shows other bars', () => {
    const b = bar(5, 6)
    const locked = { startMs: b.startMs, endMs: b.endMs, bar: b }
    const view = hubReadoutView(model, null, false, locked)!
    expect(view.mode).toBe('lock')
    expect(view.time).toBe(hubCardClockRange(b.startMs, b.endMs))
    expect(view.time2).toBe(`${dateShort(b.startMs)} · locked`)
    expect(view.chat).toBe('123')
    expect(view.chatPeak).toBeNull()
    // A saved copy on screen: the lock still wins at rest.
    expect(hubReadoutView(model, null, true, locked)!.mode).toBe('lock')
    expect(hubReadoutView(model, bar(2, 4), false, locked)!.mode).toBe('hover')
    // Hovering the locked bar itself keeps its mark.
    expect(hubReadoutView(model, bar(5, 6), false, locked)!.mode).toBe('lock')
  })

  it('shows a locked bar the chart did not measure as its time and dashes, never zeros', () => {
    const startMs = model.data.startMs + 3 * model.bucketMs
    const view = hubReadoutView(model, null, false, { startMs, endMs: startMs + model.bucketMs, bar: null })!
    expect(view).toMatchObject({ mode: 'lock', chat: '—', emotes: '—', viewers: '—', live: '', viewers2: 'Not measured', top: [] })
    expect(view.time).toBe(hubCardClockRange(startMs, startMs + model.bucketMs))
    expect(view.time2).toBe(`${dateShort(startMs)} · locked`)
  })
})

describe('HubActivityReadout', () => {
  it('follows the hover store: Now at rest, the bar under the cursor, Now again on leave', () => {
    const hover = createSpHoverStore()
    const { container } = render(<HubActivityReadout model={model} hover={hover} series={{ chat: true, emotes: true, viewers: true }} />)
    const row = container.querySelector('[data-hub-readout]')!
    expect(row.getAttribute('data-hub-readout-mode')).toBe('now')
    expect(row.querySelector('.tm .l1')!.textContent).toBe('Now')
    act(() => hover.set(hit(bar(5, 6))))
    expect(row.getAttribute('data-hub-readout-mode')).toBe('hover')
    expect(row.querySelector('[data-k="chat"] .fig')!.textContent).toBe('123')
    act(() => hover.set(null))
    expect(row.getAttribute('data-hub-readout-mode')).toBe('now')
  })

  it('marks the locked bar at rest and returns to it when the hover leaves', () => {
    const hover = createSpHoverStore()
    const b = bar(5, 6)
    const { container } = render(
      <HubActivityReadout model={model} hover={hover} series={{ chat: true, emotes: true, viewers: true }} locked={{ startMs: b.startMs, endMs: b.endMs, bar: b }} />,
    )
    const row = container.querySelector('[data-hub-readout]')!
    expect(row.getAttribute('data-hub-readout-mode')).toBe('lock')
    expect(row.querySelector('.tm .l1 .mk')).not.toBeNull()
    expect(row.querySelector('.tm .l1')!.textContent).toBe(hubCardClockRange(b.startMs, b.endMs))
    expect(row.querySelector('.tm .l2')!.textContent).toBe(`${dateShort(b.startMs)} · locked`)
    act(() => hover.set(hit(bar(2, 3))))
    expect(row.getAttribute('data-hub-readout-mode')).toBe('hover')
    expect(row.querySelector('.tm .mk')).toBeNull()
    act(() => hover.set(null))
    expect(row.getAttribute('data-hub-readout-mode')).toBe('lock')
  })

  it('stays quiet while it holds the locked bar, which the lock’s status line says (review 11-01)', () => {
    const hover = createSpHoverStore()
    const b = bar(5, 6)
    const { container } = render(
      <HubActivityReadout model={model} hover={hover} series={{ chat: true, emotes: true, viewers: true }} locked={{ startMs: b.startMs, endMs: b.endMs, bar: b }} />,
    )
    const row = container.querySelector('[data-hub-readout]')!
    expect(row.getAttribute('aria-live')).toBe('off')
    act(() => hover.set(hit(bar(2, 3))))
    expect(row.getAttribute('aria-live')).toBe('polite')
  })

  it('reads Saved at rest while a saved copy is on screen', () => {
    const hover = createSpHoverStore()
    const { container } = render(<HubActivityReadout model={model} hover={hover} series={{ chat: true, emotes: true, viewers: true }} saved />)
    expect(container.querySelector('.tm .l1')!.textContent).toBe('Saved')
    act(() => hover.set(hit(bar(5, 6))))
    expect(container.querySelector('.tm .l1')!.textContent).not.toBe('Saved')
  })

  it('dims a series that is switched off without moving the row', () => {
    const hover = createSpHoverStore()
    const { container } = render(<HubActivityReadout model={model} hover={hover} series={{ chat: true, emotes: false, viewers: true }} />)
    expect(container.querySelector('[data-k="emotes"]')!.className).toBe('slot off')
    expect(container.querySelector('[data-k="chat"]')!.className).toBe('slot')
    expect(container.querySelectorAll('.lr .slot')).toHaveLength(5)
  })
})
