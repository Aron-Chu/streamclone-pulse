// @vitest-environment jsdom
import { act, useCallback, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactionAnalyticalOffset } from '@streampulse/pulse-core'
import type { ExtensionPeak, PulsePayload } from '../src/shared/messages.ts'
import { LiveStatsBand } from '../src/ui/LiveStatsBand.tsx'
import { MomentCardSlot } from '../src/ui/MomentCardSlot.tsx'
import { MostReactedSection } from '../src/ui/MostReactedSection.tsx'
import { StreamRecapSection } from '../src/ui/StreamRecapSection.tsx'
import { liveHeatPointKey, resolveMostReactedHeat } from '../src/ui/mostReacted.ts'

// SavedMoments (recap) lists bookmarks through the background worker.
vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ type: 'BOOKMARKS', items: [] })),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Top Moments opens a moment picked in the list as a card directly under its
 * row. The card under the chart is for minutes and markers picked on the
 * chart. One card at a time.
 */

const peaks: ExtensionPeak[] = [120, 240, 360].map((offsetSeconds, index) => ({
  offsetSeconds,
  score: 95 - index * 5,
  reasons: ['chat_spike'],
  reasonLabel: 'Chat spike',
  dominantSignal: 'chat',
  chatCount: 40 + index,
  emoteCount: 3,
}))

function makePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'test',
    streamId: 'stream-1',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 600,
    startedAt: '2026-06-11T12:00:00.000Z',
    rollups: Array.from({ length: 10 }, (_, index) => ({
      offsetSeconds: index * 60,
      chatCount: 20 + index,
      sevenTvEmoteCount: 4,
      totalEmoteCount: 8 + index,
    })),
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    peaks,
    ...overrides,
  }
}

const payload = makePayload()
const defaultPayload = payload
/** Eight moments two minutes apart: five show before the fold. */
const manyPeaks: ExtensionPeak[] = Array.from({ length: 8 }, (_, index) => ({
  ...peaks[0],
  offsetSeconds: (index + 1) * 120,
  score: 99 - index,
}))
const manyPayload = makePayload({
  peaks: manyPeaks,
  rollups: Array.from({ length: 30 }, (_, index) => ({ offsetSeconds: index * 60, chatCount: 20 + index })),
  currentOffsetSeconds: 1800,
})

/**
 * The panel's wiring of the two sections, as Overlay has it: one pinned
 * moment, plus the offset a Top Moments row picked. While that is still the
 * pinned moment, the card belongs to the list. Callbacks are stable, as in
 * Overlay: LiveStatsBand resets the pin when its onPinOffset changes.
 */
function Panel({ onJumpToOffset = () => undefined, onOpenAnalytics = () => undefined, payload = defaultPayload }: {
  onJumpToOffset?: (offsetSeconds: number) => void
  onOpenAnalytics?: (offsetSeconds?: number) => void
  payload?: PulsePayload
}) {
  const [chartPin, setChartPin] = useState<number | null>(null)
  const [momentPin, setMomentPin] = useState<number | null>(null)
  const [listPin, setListPin] = useState<number | null>(null)
  const pinMoment = useCallback((offsetSeconds: number | null, fromList?: boolean) => {
    setMomentPin(offsetSeconds)
    setChartPin(offsetSeconds)
    setListPin(fromList ? offsetSeconds : null)
  }, [])
  const pinChart = useCallback((offsetSeconds: number | null) => {
    setChartPin(offsetSeconds)
    setMomentPin(null)
  }, [])
  const cardInList = listPin != null && listPin === momentPin
  return (
    <div>
      <LiveStatsBand
        payload={payload}
        backendUrl="https://api.example.test"
        isLive
        currentOffsetSeconds={600}
        pinOffsetSeconds={chartPin}
        selectedMomentOffsetSeconds={momentPin}
        cardInList={cardInList}
        onPinOffset={pinChart}
        onMomentSelect={peak => pinMoment(reactionAnalyticalOffset(peak))}
        onJumpToOffset={onJumpToOffset}
        onOpenAnalytics={onOpenAnalytics}
      />
      <MostReactedSection
        payload={payload}
        backendUrl="https://api.example.test"
        pinnedOffsetSeconds={momentPin}
        cardInList={cardInList}
        onPinOffset={pinMoment}
        onJump={() => undefined}
        onAnalytics={() => undefined}
        onJumpToOffset={onJumpToOffset}
        onAnalyticsAtOffset={onOpenAnalytics}
      />
    </div>
  )
}

let root: Root | null = null
let container: HTMLDivElement | null = null

function mount(element: JSX.Element): HTMLDivElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(element))
  return container
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => undefined)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const rows = (host: ParentNode) => [...host.querySelectorAll<HTMLButtonElement>('button.pulse-moment-row-button')]
/** Cards that are open, not the ones still collapsing out. */
const openCards = (host: ParentNode) => [
  ...host.querySelectorAll('[data-selected-moment-card="true"], [data-chart-minute-card="true"]'),
].filter(card => !card.closest('.pulse-moment-slot-exit'))
const chartCard = (host: ParentNode) => {
  const slot = host.querySelector('[data-chart-inspector-owner="activity-chart"]')
  return slot && !slot.classList.contains('pulse-moment-slot-exit') ? slot : null
}
/** The card a row opened, which sits in the slot right after the row button. */
const rowCard = (row: Element) => {
  const slot = row.nextElementSibling
  return slot?.classList.contains('pulse-moment-slot') && !slot.classList.contains('pulse-moment-slot-exit')
    ? slot.querySelector('[data-selected-moment-card="true"]')
    : null
}
const click = (element: Element) => act(() => (element as HTMLElement).click())
const key = (element: Element, value: string) => act(() => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
})

describe('Top Moments inline card (live panel)', () => {
  it('opens a list pick under its row, not in the chart inspector, and still pins the chart', () => {
    const host = mount(<Panel onJumpToOffset={vi.fn()} onOpenAnalytics={vi.fn()} />)
    const [first, second, third] = rows(host)

    click(second)

    expect(rowCard(second)).not.toBeNull()
    expect(rowCard(second)!.getAttribute('aria-label')).toMatch(/^Selected moment at 00:04/)
    // The slot is the very next element: nothing sits between the row and its card.
    expect(second.parentElement!.lastElementChild).toBe(second.nextElementSibling)
    expect(rowCard(first)).toBeNull()
    expect(rowCard(third)).toBeNull()
    expect(chartCard(host)).toBeNull()
    expect(openCards(host)).toHaveLength(1)
    // The chart still marks the picked minute.
    expect(host.querySelector('[data-chart-readout-state="selected"]')).not.toBeNull()
  })

  it('exposes the card with aria-expanded and keeps focus on the picked row', () => {
    const host = mount(<Panel onJumpToOffset={vi.fn()} onOpenAnalytics={vi.fn()} />)
    const [first, second] = rows(host)
    expect(rows(host).map(row => row.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false'])

    act(() => second.focus())
    click(second)

    expect(document.activeElement).toBe(second)
    expect(second.getAttribute('aria-expanded')).toBe('true')
    expect(second.getAttribute('aria-pressed')).toBe('true')
    expect(first.getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps a chart pick under the chart and opens no list card', () => {
    const host = mount(<Panel onJumpToOffset={vi.fn()} onOpenAnalytics={vi.fn()} />)

    // The strongest-moment shortcut sits with the chart and picks its top marker.
    click(host.querySelector('[data-featured-moment="true"]')!)

    expect(chartCard(host)?.getAttribute('data-chart-inspector-kind')).toBe('moment')
    expect(rows(host).map(rowCard)).toEqual([null, null, null])
    expect(rows(host).map(row => row.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false'])
    expect(rows(host)[0].getAttribute('aria-pressed')).toBe('true')
    expect(openCards(host)).toHaveLength(1)

    // A raw minute picked on the plot also opens under the chart.
    const plot = host.querySelector('[data-chart-scrubber="true"]')!
    key(plot, 'Home')
    key(plot, 'Enter')
    expect(chartCard(host)?.getAttribute('data-chart-inspector-kind')).toBe('minute')
    expect(rows(host).map(rowCard)).toEqual([null, null, null])
    expect(openCards(host)).toHaveLength(1)
  })

  it('moves the single card between rows and between the list and the chart', () => {
    const host = mount(<Panel onJumpToOffset={vi.fn()} onOpenAnalytics={vi.fn()} />)
    const [first, , third] = rows(host)

    click(first)
    expect(rowCard(first)).not.toBeNull()

    click(third)
    expect(rowCard(third)).not.toBeNull()
    expect(rowCard(first)).toBeNull()
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(openCards(host)).toHaveLength(1)

    // The chart takes the card back...
    click(host.querySelector('[data-featured-moment="true"]')!)
    expect(chartCard(host)).not.toBeNull()
    expect(rowCard(third)).toBeNull()
    expect(openCards(host)).toHaveLength(1)

    // ...and the list again, even for the moment the chart already shows.
    click(first)
    expect(rowCard(first)).not.toBeNull()
    expect(chartCard(host)).toBeNull()
    expect(openCards(host)).toHaveLength(1)
  })

  it('closes with Escape and with its close button, returning focus to the row', () => {
    vi.useFakeTimers()
    const host = mount(<Panel onJumpToOffset={vi.fn()} onOpenAnalytics={vi.fn()} />)
    const [, second] = rows(host)

    click(second)
    const jump = rowCard(second)!.querySelector<HTMLButtonElement>('[data-moment-inspector-action="jump"]')!
    act(() => jump.focus())
    key(jump, 'Escape')
    expect(document.activeElement).toBe(second)
    expect(second.getAttribute('aria-expanded')).toBe('false')
    expect(second.getAttribute('aria-pressed')).toBe('false')
    expect(openCards(host)).toHaveLength(0)
    act(() => { vi.advanceTimersByTime(400) })
    expect(second.nextElementSibling).toBeNull()

    click(second)
    click(rowCard(second)!.querySelector('[aria-label="Clear selected moment"]')!)
    expect(document.activeElement).toBe(second)
    expect(second.getAttribute('aria-expanded')).toBe('false')
    expect(openCards(host)).toHaveLength(0)
  })

  it('jumps and opens analytics exactly like the chart card for the same moment', () => {
    const onJumpToOffset = vi.fn()
    const onOpenAnalytics = vi.fn()
    const host = mount(<Panel onJumpToOffset={onJumpToOffset} onOpenAnalytics={onOpenAnalytics} />)
    const action = (card: Element, name: string) => card.querySelector(`[data-moment-inspector-action="${name}"]`)!

    click(host.querySelector('[data-featured-moment="true"]')!)
    const chart = chartCard(host)!
    expect(action(chart, 'jump').textContent).toContain('Jump in player')
    click(action(chart, 'jump'))
    click(action(chart, 'analytics'))

    click(rows(host)[0])
    const list = rowCard(rows(host)[0])!
    expect(action(list, 'jump').textContent).toContain('Jump in player')
    click(action(list, 'jump'))
    click(action(list, 'analytics'))

    expect(onJumpToOffset.mock.calls).toEqual([[120], [120]])
    expect(onOpenAnalytics.mock.calls).toEqual([[120], [120]])
  })
})

describe('Top Moments list', () => {
  it('keeps the row with an open card listed when it ranks past the fold', () => {
    const many: ExtensionPeak[] = Array.from({ length: 8 }, (_, index) => ({
      ...peaks[0],
      offsetSeconds: (index + 1) * 120,
      score: 99 - index,
    }))
    const rollups = Array.from({ length: 30 }, (_, index) => ({ offsetSeconds: index * 60, chatCount: 20 + index }))
    const render = (cardInList: boolean) => renderToStaticMarkup(
      <MostReactedSection
        payload={makePayload({ peaks: many, rollups, currentOffsetSeconds: 1800 })}
        backendUrl="https://api.example.test"
        pinnedOffsetSeconds={840}
        cardInList={cardInList}
        onJump={() => undefined}
        onAnalytics={() => undefined}
      />,
    )
    // Five rows show before the fold; the seventh-ranked row has the card.
    expect(render(false).match(/pulse-moment-row-button/g)).toHaveLength(5)
    const html = render(true)
    expect(html.match(/pulse-moment-row-button/g)).toHaveLength(6)
    expect(html).toMatch(/aria-label="Selected moment at 00:14/)
  })

  it('opens no list card for a moment picked on the chart', () => {
    const html = renderToStaticMarkup(
      <MostReactedSection
        payload={payload}
        backendUrl="https://api.example.test"
        pinnedOffsetSeconds={240}
        onJump={() => undefined}
        onAnalytics={() => undefined}
      />,
    )
    expect(html).toContain('aria-pressed="true"')
    expect(html).not.toContain('data-selected-moment-card')
  })
})

describe('chart inspector with a list card', () => {
  it('takes the card back when the listed moment is no longer in the payload', () => {
    // The list pinned 08:00, which this payload no longer ranks as a moment.
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload({ peaks: [peaks[0]] })}
        backendUrl="https://api.example.test"
        currentOffsetSeconds={600}
        pinOffsetSeconds={480}
        selectedMomentOffsetSeconds={480}
        cardInList
      />,
    )
    expect(markup).toContain('data-chart-inspector-kind="minute"')
  })

  it('marks the minute but leaves the card to the list', () => {
    const props = {
      payload,
      backendUrl: 'https://api.example.test',
      currentOffsetSeconds: 600,
      pinOffsetSeconds: 240,
      selectedMomentOffsetSeconds: 240,
    }
    const listPick = renderToStaticMarkup(<LiveStatsBand {...props} cardInList />)
    const chartPick = renderToStaticMarkup(<LiveStatsBand {...props} />)

    expect(listPick).not.toContain('data-chart-inspector-owner')
    expect(listPick).toContain('data-chart-readout-state="selected"')
    expect(chartPick).toContain('data-chart-inspector-kind="moment"')
  })
})

describe('Stream recap Top moments', () => {
  const recapMoments = [120, 240, 360].map((offsetSeconds, index) => ({
    offsetSeconds,
    score: 90 - index * 5,
    reasons: ['chat_spike'],
    chatCount: 40 + index,
    emoteCount: 3,
  }))
  const recapPayload = makePayload({
    isLive: false,
    vodId: 'vod-1',
    endedAt: '2026-06-11T13:00:00.000Z',
    recap: {
      streamId: 'stream-1',
      login: 'test',
      durationSeconds: 3600,
      totalMessages: 4000,
      peakChatPerMin: 90,
      topMoments: recapMoments,
      topEmotes: [],
      clipCandidates: [],
    },
  })

  for (const variant of [
    { name: 'recap', payload: recapPayload },
    { name: 'peaks fallback', payload: { ...recapPayload, recap: null } },
  ]) {
    it(`opens a list pick under its row and a chart pick above the list (${variant.name})`, () => {
      const host = mount(
        <StreamRecapSection
          payload={variant.payload}
          backendUrl="https://api.example.test"
          uiState="ready"
          isLive={false}
          onJump={() => undefined}
          onAnalytics={() => undefined}
          onOpenAnalytics={() => undefined}
        />,
      )
      const list = rows(host)
      expect(list.length).toBeGreaterThanOrEqual(3)
      // The first moment starts highlighted, with no card until someone picks one.
      expect(openCards(host)).toHaveLength(0)

      click(list[1])
      expect(rowCard(list[1])).not.toBeNull()
      expect(list[1].getAttribute('aria-expanded')).toBe('true')
      expect(openCards(host)).toHaveLength(1)

      click(list[2])
      expect(rowCard(list[2])).not.toBeNull()
      expect(rowCard(list[1])).toBeNull()
      expect(openCards(host)).toHaveLength(1)

      // A chart pick opens its card above the list, as before.
      const plot = host.querySelector('[data-chart-scrubber="true"]')!
      key(plot, 'Home')
      key(plot, 'Enter')
      expect(rows(host).map(rowCard).filter(Boolean)).toHaveLength(0)
      expect(openCards(host)).toHaveLength(1)
      const slot = openCards(host)[0].closest('.pulse-moment-slot')!
      expect(slot.compareDocumentPosition(list[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

      click(list[0])
      act(() => list[0].focus())
      key(list[0], 'Escape')
      expect(document.activeElement).toBe(list[0])
      expect(openCards(host)).toHaveLength(0)
    })
  }
})

describe('review fixes', () => {
  const expander = (host: ParentNode) => [...host.querySelectorAll<HTMLButtonElement>('button')]
    .find(button => /^Show (less|\d+ more moments?)/.test(button.textContent ?? ''))!

  it('leaves an expanded 7TV panel open for a list pick and folds it for a chart pick', () => {
    const host = mount(<Panel payload={makePayload({ topEmotes: [{ id: '1', name: 'KEKW', count: 12 }] })} />)
    const toggle = host.querySelector<HTMLButtonElement>('.pulse-seven-tv-toggle')!
    click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    click(rows(host)[1])
    expect(rowCard(rows(host)[1])).not.toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    click(host.querySelector('[data-featured-moment="true"]')!)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('hands the card back to the chart when a poll drops the picked moment', () => {
    const host = mount(<Panel />)
    click(rows(host)[1])
    expect(rowCard(rows(host)[1])).not.toBeNull()

    // The next poll no longer ranks the 00:04 moment.
    act(() => root!.render(<Panel payload={makePayload({ peaks: [peaks[0], peaks[2]] })} />))
    expect(openCards(host)).toHaveLength(1)
    expect(chartCard(host)?.getAttribute('data-chart-inspector-kind')).toBe('minute')
    expect(host.querySelector('[data-chart-readout-state="selected"]')).not.toBeNull()
  })

  it('keeps the row, its card and focus mounted while a poll refines the moment', () => {
    vi.useFakeTimers()
    const host = mount(<Panel />)
    const row = rows(host)[1]
    act(() => row.focus())
    click(row)
    act(() => { vi.advanceTimersByTime(500) })
    const slot = row.nextElementSibling!
    expect(slot.classList.contains('pulse-moment-slot-opening')).toBe(false)

    const refined = makePayload({
      peaks: [peaks[0], { ...peaks[1], reactionApexOffsetSeconds: 251, refinementStatus: 'refined' }, peaks[2]],
    })
    // The refinement changes the moment's selection identity...
    const identity = (data: PulsePayload) => liveHeatPointKey(data.streamId, resolveMostReactedHeat(data).points[1])
    expect(identity(refined)).not.toBe(identity(payload))
    act(() => root!.render(<Panel payload={refined} />))

    // ...but not its row: no remount, no replayed opening, focus kept.
    expect(rows(host)[1]).toBe(row)
    expect(row.nextElementSibling).toBe(slot)
    expect(slot.classList.contains('pulse-moment-slot-opening')).toBe(false)
    expect(rowCard(row)).not.toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('counts only the hidden rows and moves focus to Show more when a row past the fold closes', () => {
    vi.useFakeTimers()
    const host = mount(<Panel payload={manyPayload} />)
    expect(rows(host)).toHaveLength(5)
    expect(expander(host).textContent).toContain('Show 3 more moments')

    click(expander(host))
    click(rows(host)[6])
    click(expander(host))
    // Collapsed again, the picked row stays listed with its card.
    expect(rows(host)).toHaveLength(6)
    expect(rowCard(rows(host)[5])).not.toBeNull()
    expect(expander(host).textContent).toContain('Show 2 more moments')

    click(rowCard(rows(host)[5])!.querySelector('[aria-label="Clear selected moment"]')!)
    act(() => { vi.advanceTimersByTime(1) })
    expect(rows(host)).toHaveLength(5)
    expect(expander(host).textContent).toContain('Show 3 more moments')
    expect(document.activeElement).toBe(expander(host))
  })

  for (const variant of ['recap', 'peaks fallback'] as const) {
    it(`keeps a picked row past the fold listed when the recap list collapses (${variant})`, () => {
      vi.useFakeTimers()
      const moments = manyPeaks.map(({ offsetSeconds, score }) => ({ offsetSeconds, score, reasons: ['chat_spike'], chatCount: 40, emoteCount: 3 }))
      const recapPayload: PulsePayload = {
        ...manyPayload,
        isLive: false,
        vodId: 'vod-1',
        endedAt: '2026-06-11T13:00:00.000Z',
        recap: variant === 'recap'
          ? { streamId: 'stream-1', login: 'test', durationSeconds: 3600, totalMessages: 4000, peakChatPerMin: 90, topMoments: moments, topEmotes: [], clipCandidates: [] }
          : null,
      }
      const host = mount(
        <StreamRecapSection
          payload={recapPayload}
          backendUrl="https://api.example.test"
          uiState="ready"
          isLive={false}
          onJump={() => undefined}
          onAnalytics={() => undefined}
          onOpenAnalytics={() => undefined}
        />,
      )
      expect(rows(host)).toHaveLength(5)
      click(expander(host))
      click(rows(host)[6])
      click(expander(host))

      expect(rows(host)).toHaveLength(6)
      expect(rowCard(rows(host)[5])).not.toBeNull()
      expect(openCards(host)).toHaveLength(1)
      expect(expander(host).textContent).toContain('Show 2 more moments')

      click(rowCard(rows(host)[5])!.querySelector('[aria-label="Clear selected moment"]')!)
      act(() => { vi.advanceTimersByTime(1) })
      expect(rows(host)).toHaveLength(5)
      expect(expander(host).textContent).toContain('Show 3 more moments')
      expect(document.activeElement).toBe(expander(host))
    })
  }

  it('announces no card state on the read-only landing rows', () => {
    const host = mount(
      <MostReactedSection payload={payload} backendUrl="https://api.example.test" demoMode onJump={() => undefined} onAnalytics={() => undefined} />,
    )
    expect(rows(host)).toHaveLength(3)
    expect(rows(host).filter(row => row.hasAttribute('aria-expanded'))).toHaveLength(0)
  })
})

describe('a card slot on its own', () => {
  it('never scrolls the panel, even when its card opens past the bottom', () => {
    vi.useFakeTimers()
    const host = mount(
      <div className="pulse-panel-body">
        <button type="button" className="pulse-moment-row-button">row</button>
        <MomentCardSlot exiting={false}>
          <p>card</p>
        </MomentCardSlot>
      </div>,
    )
    const panel = host.querySelector<HTMLElement>('.pulse-panel-body')!
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height } as DOMRect)
    panel.getBoundingClientRect = () => rect(0, 500)
    panel.querySelector('button')!.getBoundingClientRect = () => rect(400 - panel.scrollTop, 40)
    panel.querySelector<HTMLElement>('.pulse-moment-slot')!.getBoundingClientRect = () => rect(440 - panel.scrollTop, 120)
    const scrollBy = vi.fn()
    panel.scrollBy = scrollBy as unknown as HTMLElement['scrollBy']
    act(() => { vi.advanceTimersByTime(1000) })
    // Only a press on the row reveals its card (keepPressedInPlace); a card
    // that a poll or a chart pick opens leaves the panel where it is.
    expect(panel.scrollTop).toBe(0)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})

describe('Top Moments row keys', () => {
  /** Two refined moments 20 s apart in the 02:00 bucket, plus two more. */
  const refinedPair = (scores: [number, number, number, number]): ExtensionPeak[] => [
    { ...peaks[0], offsetSeconds: 120, score: scores[0], precisionSeconds: 1, refinementStatus: 'refined', reactionOnsetOffsetSeconds: 125 },
    { ...peaks[0], offsetSeconds: 120, score: scores[1], precisionSeconds: 1, refinementStatus: 'refined', reactionOnsetOffsetSeconds: 145 },
    { ...peaks[0], offsetSeconds: 240, score: scores[2] },
    { ...peaks[0], offsetSeconds: 360, score: scores[3] },
  ]
  const duplicateKeyWarnings = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls
    .filter(call => String(call[0]).includes('same key')).length
  const labels = (host: ParentNode) => rows(host).map(row => row.getAttribute('aria-label'))

  it('keeps two moments that share a minute bucket apart, through a re-rank', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const live = (scores: [number, number, number, number]) => (
      <MostReactedSection
        payload={makePayload({ peaks: refinedPair(scores) })}
        backendUrl="https://api.example.test"
        onJump={() => undefined}
        onAnalytics={() => undefined}
      />
    )
    const host = mount(live([90, 85, 80, 75]))
    expect(rows(host)).toHaveLength(4)
    // The next poll ranks the later 02:00 moment first.
    act(() => root!.render(live([80, 95, 70, 60])))
    expect(rows(host)).toHaveLength(4)
    expect(new Set(labels(host)).size).toBe(4)
    expect(duplicateKeyWarnings(spy)).toBe(0)
    spy.mockRestore()
  })

  it('does the same in the peaks fallback of the recap', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const recap = (scores: [number, number, number, number]) => (
      <StreamRecapSection
        payload={makePayload({ isLive: false, vodId: 'vod-1', endedAt: '2026-06-11T13:00:00.000Z', peaks: refinedPair(scores) })}
        backendUrl="https://api.example.test"
        uiState="ready"
        isLive={false}
        onJump={() => undefined}
        onAnalytics={() => undefined}
        onOpenAnalytics={() => undefined}
      />
    )
    const host = mount(recap([90, 85, 80, 75]))
    expect(rows(host)).toHaveLength(4)
    act(() => root!.render(recap([80, 95, 70, 60])))
    expect(rows(host)).toHaveLength(4)
    expect(new Set(labels(host)).size).toBe(4)
    expect(duplicateKeyWarnings(spy)).toBe(0)
    spy.mockRestore()
  })

  /** A refined moment in the 02:00 bucket with its onset at `onset` seconds. */
  const refined = (onset: number, score: number): ExtensionPeak => ({
    ...peaks[0], offsetSeconds: 120, score, precisionSeconds: 1, refinementStatus: 'refined', reactionOnsetOffsetSeconds: onset,
  })
  /**
   * The 00:02:25 moment was picked (its card is open) and its row focused.
   * After a poll, no row is handed to another moment: the focused button
   * still shows 00:02:25 (or focus left a row that left), and the only card,
   * open or closing, is 00:02:25's, under its own row.
   */
  function expectPickStaysWithItsMoment(host: ParentNode, picked: HTMLButtonElement) {
    if (picked.isConnected) expect(picked.getAttribute('aria-label')).toContain('00:02:25')
    const focused = document.activeElement
    if (focused instanceof HTMLButtonElement && focused.classList.contains('pulse-moment-row-button')) {
      expect(focused.getAttribute('aria-label')).toContain('00:02:25')
    }
    const cards = [...host.querySelectorAll('[data-selected-moment-card="true"]')]
    expect(cards.map(card => card.getAttribute('aria-label'))).toEqual(['Selected moment at 00:02:25'])
    expect(cards[0].closest('.pulse-moment-slot')!.previousElementSibling!.getAttribute('aria-label')).toContain('00:02:25')
  }
  const live = (moments: ExtensionPeak[]) => (
    <MostReactedSection
      payload={makePayload({ peaks: [...moments, { ...peaks[0], offsetSeconds: 360, score: 50 }] })}
      backendUrl="https://api.example.test"
      pinnedOffsetSeconds={145}
      cardInList
      onJump={() => undefined}
      onAnalytics={() => undefined}
    />
  )
  const pickedRow = (host: ParentNode) => rows(host).find(row => row.getAttribute('aria-label')?.includes('00:02:25'))!

  it('keeps a picked moment\'s row when a new moment joins its bucket with an earlier onset', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = mount(live([refined(145, 90)]))
    const picked = pickedRow(host)
    act(() => picked.focus())
    act(() => { vi.advanceTimersByTime(500) })

    act(() => root!.render(live([refined(145, 90), refined(125, 80)])))
    expect(rows(host)).toHaveLength(3)
    expectPickStaysWithItsMoment(host, picked)
    expect(duplicateKeyWarnings(spy)).toBe(0)
    spy.mockRestore()
  })

  it('keeps a picked moment\'s row, focus and card when the other moment in its bucket refines past it', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = mount(live([refined(125, 80), refined(145, 90)]))
    const picked = pickedRow(host)
    act(() => picked.focus())
    act(() => { vi.advanceTimersByTime(500) })
    const slot = picked.nextElementSibling

    // The 00:02:05 moment refines to 00:02:40, after the picked one.
    act(() => root!.render(live([refined(160, 80), refined(145, 90)])))
    expect(rows(host)).toHaveLength(3)
    expectPickStaysWithItsMoment(host, picked)
    // Its own identity did not change, so its row stayed: no remount, no
    // replayed opening, focus kept.
    expect(pickedRow(host)).toBe(picked)
    expect(picked.nextElementSibling).toBe(slot)
    expect(slot!.classList.contains('pulse-moment-slot-opening')).toBe(false)
    expect(document.activeElement).toBe(picked)
    expect(duplicateKeyWarnings(spy)).toBe(0)
    spy.mockRestore()
  })

  it('keeps a picked moment\'s row when the other moment in its bucket refines past it (peaks fallback)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const recap = (moments: ExtensionPeak[]) => (
      <StreamRecapSection
        payload={makePayload({ isLive: false, vodId: 'vod-1', endedAt: '2026-06-11T13:00:00.000Z', peaks: [...moments, { ...peaks[0], offsetSeconds: 360, score: 50 }] })}
        backendUrl="https://api.example.test"
        uiState="ready"
        isLive={false}
        onJump={() => undefined}
        onAnalytics={() => undefined}
        onOpenAnalytics={() => undefined}
      />
    )
    const host = mount(recap([refined(125, 80), refined(145, 90)]))
    const picked = pickedRow(host)
    click(picked)
    act(() => picked.focus())

    act(() => root!.render(recap([refined(160, 80), refined(145, 90)])))
    expectPickStaysWithItsMoment(host, picked)
    expect(pickedRow(host)).toBe(picked)
    expect(document.activeElement).toBe(picked)
    expect(duplicateKeyWarnings(spy)).toBe(0)
    spy.mockRestore()
  })
})
