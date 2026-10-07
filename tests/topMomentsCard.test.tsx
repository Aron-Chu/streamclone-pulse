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
import { MOMENT_CARD_HEIGHT } from '../src/ui/momentCardLayout.ts'
import { liveHeatPointKey, resolveMostReactedHeat } from '../src/ui/mostReacted.ts'

// SavedMoments (recap) lists bookmarks through the background worker.
vi.mock('../src/content/bridge.ts', () => ({
  sendBackgroundMessage: vi.fn(async () => ({ type: 'BOOKMARKS', items: [] })),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Top Moments has one card, right above its list, that keeps its height. It
 * shows the strongest moment until a moment is picked, in the list or as a
 * ranked moment on the chart; a pick swaps its contents in place and × goes
 * back to the strongest. Nothing changes height, so the picked row never
 * moves. A minute picked on the chart keeps its card under the chart. One
 * selection shows in one place.
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
/** The next poll of manyPayload: a new 00:18 moment outranks all eight. */
const outrankedPayload = { ...manyPayload, peaks: [{ ...manyPeaks[0], offsetSeconds: 1080, score: 100 }, ...manyPeaks] }

/**
 * The panel's wiring of the two sections, as Overlay has it: one pinned
 * moment, shown in Top Moments; a chart minute clears it. Callbacks are
 * stable, as in Overlay: LiveStatsBand resets the pin when its onPinOffset
 * changes.
 */
function Panel({ onJumpToOffset = () => undefined, onOpenAnalytics = () => undefined, payload = defaultPayload }: {
  onJumpToOffset?: (offsetSeconds: number) => void
  onOpenAnalytics?: (offsetSeconds?: number) => void
  payload?: PulsePayload
}) {
  const [chartPin, setChartPin] = useState<number | null>(null)
  const [momentPin, setMomentPin] = useState<number | null>(null)
  const pinMoment = useCallback((offsetSeconds: number | null) => {
    setMomentPin(offsetSeconds)
    setChartPin(offsetSeconds)
  }, [])
  const pinChart = useCallback((offsetSeconds: number | null) => {
    setChartPin(offsetSeconds)
    setMomentPin(null)
  }, [])
  return (
    <div>
      <LiveStatsBand
        payload={payload}
        backendUrl="https://api.example.test"
        isLive
        currentOffsetSeconds={600}
        pinOffsetSeconds={chartPin}
        selectedMomentOffsetSeconds={momentPin}
        cardInList
        onPinOffset={pinChart}
        onMomentSelect={peak => pinMoment(reactionAnalyticalOffset(peak))}
        onJumpToOffset={onJumpToOffset}
        onOpenAnalytics={onOpenAnalytics}
      />
      <MostReactedSection
        payload={payload}
        backendUrl="https://api.example.test"
        pinnedOffsetSeconds={momentPin}
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
/** The Top Moments card (its wrapper, which stays mounted). */
const topCard = (host: ParentNode) => host.querySelector<HTMLElement>('[data-top-moment-card]')
const topCardLabel = (host: ParentNode) => topCard(host)?.querySelector('[data-selected-moment-card="true"]')?.getAttribute('aria-label')
const chartCard = (host: ParentNode) => {
  const slot = host.querySelector('[data-chart-inspector-owner="activity-chart"]')
  return slot && !slot.classList.contains('pulse-moment-slot-exit') ? slot : null
}
/** Cards that show a selection (not the strongest-moment default, not one collapsing out). */
const selectionCards = (host: ParentNode) => [
  ...host.querySelectorAll('[aria-label^="Selected moment at"], [data-chart-minute-card="true"]'),
].filter(card => !card.closest('.pulse-moment-slot-exit'))
const clearButton = (host: ParentNode) => topCard(host)!.querySelector('[aria-label="Clear selected moment"]')
/** The list's Show more / Show less control. */
const expander = (host: ParentNode) => [...host.querySelectorAll<HTMLButtonElement>('button')]
  .find(button => /^Show (less|\d+ more moments?)/.test(button.textContent ?? ''))!
const click = (element: Element) => act(() => (element as HTMLElement).click())
const key = (element: Element, value: string) => act(() => {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }))
})

describe('Top Moments card (live panel)', () => {
  it('shows the strongest moment right above the list until a moment is picked', () => {
    const host = mount(<Panel />)
    const card = topCard(host)!
    expect(card.getAttribute('data-top-moment-card')).toBe('strongest')
    expect(topCardLabel(host)).toMatch(/^Strongest moment at 00:02/)
    expect(clearButton(host)).toBeNull()
    // Directly above the rows, and the same height whatever it shows.
    expect(card.nextElementSibling).toBe(rows(host)[0].parentElement)
    expect(card.style.minHeight).toBe(`${MOMENT_CARD_HEIGHT}px`)
    expect(rows(host).every(row => row.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(chartCard(host)).toBeNull()
    expect(selectionCards(host)).toHaveLength(0)
  })

  it('swaps a list pick into the same card, leaves the rows alone and locks the chart', () => {
    const host = mount(<Panel />)
    const card = topCard(host)!
    const list = rows(host)
    const [, second] = list

    click(second)

    expect(topCard(host)).toBe(card)
    expect(card.getAttribute('data-top-moment-card')).toBe('selected')
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:04/)
    expect(card.style.minHeight).toBe(`${MOMENT_CARD_HEIGHT}px`)
    // No card opens in the list: the rows are the same buttons, in the same place.
    expect(rows(host)).toEqual(list)
    expect(second.parentElement!.querySelectorAll('[data-moment-inspector-card]')).toHaveLength(0)
    expect(card.nextElementSibling).toBe(second.parentElement)
    expect(chartCard(host)).toBeNull()
    expect(selectionCards(host)).toHaveLength(1)
    // The chart marks and locks the picked minute.
    expect(host.querySelector('[data-chart-readout-state="selected"]')).not.toBeNull()
    expect(host.querySelector('svg[data-chart-locked-index]')).not.toBeNull()
  })

  it('keeps aria-pressed and focus on the picked row, which controls the card', () => {
    const host = mount(<Panel />)
    const [first, second] = rows(host)
    const cardId = topCard(host)!.id
    expect(cardId).not.toBe('')
    expect(rows(host).map(row => row.getAttribute('aria-controls'))).toEqual([cardId, cardId, cardId])
    expect(rows(host).filter(row => row.hasAttribute('aria-expanded'))).toHaveLength(0)

    act(() => second.focus())
    click(second)

    expect(document.activeElement).toBe(second)
    expect(second.getAttribute('aria-pressed')).toBe('true')
    expect(first.getAttribute('aria-pressed')).toBe('false')
  })

  it('shows a ranked moment picked on the chart in the card, and keeps a minute under the chart', () => {
    const host = mount(<Panel />)

    // The strongest-moment shortcut sits with the chart and picks its top marker.
    click(host.querySelector('[data-featured-moment="true"]')!)
    expect(topCard(host)!.getAttribute('data-top-moment-card')).toBe('selected')
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:02/)
    expect(chartCard(host)).toBeNull()
    expect(rows(host)[0].getAttribute('aria-pressed')).toBe('true')
    expect(selectionCards(host)).toHaveLength(1)

    // A raw minute picked on the plot opens under the chart; Top Moments goes
    // back to its strongest moment.
    const plot = host.querySelector('[data-chart-scrubber="true"]')!
    key(plot, 'Home')
    key(plot, 'Enter')
    expect(chartCard(host)?.getAttribute('data-chart-inspector-kind')).toBe('minute')
    expect(topCard(host)!.getAttribute('data-top-moment-card')).toBe('strongest')
    expect(rows(host).every(row => row.getAttribute('aria-pressed') === 'false')).toBe(true)
    expect(selectionCards(host)).toHaveLength(1)

    // A list pick takes the selection back from the chart.
    click(rows(host)[2])
    expect(chartCard(host)).toBeNull()
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:06/)
    expect(selectionCards(host)).toHaveLength(1)
  })

  it('goes back to the strongest with Escape or ×, returning focus to the row', () => {
    const host = mount(<Panel />)
    const [, second] = rows(host)

    click(second)
    const jump = topCard(host)!.querySelector<HTMLButtonElement>('[data-moment-inspector-action="jump"]')!
    act(() => jump.focus())
    key(jump, 'Escape')
    expect(document.activeElement).toBe(second)
    expect(second.getAttribute('aria-pressed')).toBe('false')
    expect(topCard(host)!.getAttribute('data-top-moment-card')).toBe('strongest')
    expect(selectionCards(host)).toHaveLength(0)

    click(second)
    click(clearButton(host)!)
    expect(document.activeElement).toBe(second)
    expect(topCardLabel(host)).toMatch(/^Strongest moment at 00:02/)
    expect(selectionCards(host)).toHaveLength(0)
  })

  it('jumps and opens analytics for the moment it shows, the strongest included', () => {
    const onJumpToOffset = vi.fn()
    const onOpenAnalytics = vi.fn()
    const host = mount(<Panel onJumpToOffset={onJumpToOffset} onOpenAnalytics={onOpenAnalytics} />)
    const action = (name: string) => topCard(host)!.querySelector(`[data-moment-inspector-action="${name}"]`)!

    expect(action('jump').textContent).toContain('Jump in player')
    click(action('jump'))
    click(action('analytics'))
    click(rows(host)[2])
    click(action('jump'))
    click(action('analytics'))

    expect(onJumpToOffset.mock.calls).toEqual([[120], [360]])
    expect(onOpenAnalytics.mock.calls).toEqual([[120], [360]])
  })

  it('leaves an expanded 7TV panel open for ranked picks and folds it for a chart minute', () => {
    const host = mount(<Panel payload={makePayload({ topEmotes: [{ id: '1', name: 'KEKW', count: 12 }] })} />)
    const toggle = host.querySelector<HTMLButtonElement>('.pulse-seven-tv-toggle')!
    click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    click(rows(host)[1])
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    click(host.querySelector('[data-featured-moment="true"]')!)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    const plot = host.querySelector('[data-chart-scrubber="true"]')!
    key(plot, 'Home')
    key(plot, 'Enter')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('hands the selection to the chart when a poll drops the picked moment', () => {
    const host = mount(<Panel />)
    click(rows(host)[1])
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:04/)

    // The next poll no longer ranks the 00:04 moment.
    act(() => root!.render(<Panel payload={makePayload({ peaks: [peaks[0], peaks[2]] })} />))
    expect(chartCard(host)?.getAttribute('data-chart-inspector-kind')).toBe('minute')
    expect(topCard(host)!.getAttribute('data-top-moment-card')).toBe('strongest')
    expect(selectionCards(host)).toHaveLength(1)
    expect(host.querySelector('[data-chart-readout-state="selected"]')).not.toBeNull()
  })

  it('keeps the row, its focus and the card mounted while a poll refines the moment', () => {
    const host = mount(<Panel />)
    const row = rows(host)[1]
    const card = topCard(host)
    act(() => row.focus())
    click(row)

    const refined = makePayload({
      peaks: [peaks[0], { ...peaks[1], reactionApexOffsetSeconds: 251, refinementStatus: 'refined' }, peaks[2]],
    })
    // The refinement changes the moment's selection identity...
    const identity = (data: PulsePayload) => liveHeatPointKey(data.streamId, resolveMostReactedHeat(data).points[1])
    expect(identity(refined)).not.toBe(identity(payload))
    act(() => root!.render(<Panel payload={refined} />))

    // ...but not its row or the card: no remount, focus kept.
    expect(rows(host)[1]).toBe(row)
    expect(topCard(host)).toBe(card)
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:04/)
    expect(document.activeElement).toBe(row)
  })

  it('keeps focus on an action of the card when a poll changes the moment it shows', () => {
    const host = mount(<Panel />)
    const action = (name: string) => topCard(host)!.querySelector<HTMLButtonElement>(`[data-moment-inspector-action="${name}"]`)!
    const jump = action('jump')
    act(() => jump.focus())

    // The next poll ranks a new strongest moment; the card shows it on the
    // same nodes, so Jump keeps focus.
    const stronger = { ...peaks[0], offsetSeconds: 480, score: 99 }
    act(() => root!.render(<Panel payload={makePayload({ peaks: [stronger, ...peaks] })} />))
    expect(topCardLabel(host)).toMatch(/^Strongest moment at 00:08/)
    expect(action('jump')).toBe(jump)
    expect(document.activeElement).toBe(jump)

    // The same when a poll refines a picked moment.
    click(rows(host)[2])
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:04/)
    const analytics = action('analytics')
    act(() => analytics.focus())
    const refined = { ...peaks[1], reactionApexOffsetSeconds: 251, refinementStatus: 'refined' }
    act(() => root!.render(<Panel payload={makePayload({ peaks: [stronger, peaks[0], refined, peaks[2]] })} />))
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:04/)
    expect(action('analytics')).toBe(analytics)
    expect(document.activeElement).toBe(analytics)
    // The details still fade in on the swap.
    expect(topCard(host)!.querySelector('.pulse-moment-card-swap')).not.toBeNull()
  })

  it('keeps a pick past the fold listed at the end, and × then moves focus to Show more', () => {
    const host = mount(<Panel payload={manyPayload} />)
    expect(rows(host)).toHaveLength(5)
    expect(expander(host).textContent).toContain('Show 3 more moments')

    click(expander(host))
    click(rows(host)[6])
    click(expander(host))
    // Collapsed again, the picked row stays listed after the first five.
    expect(rows(host)).toHaveLength(6)
    expect(rows(host)[5].getAttribute('aria-pressed')).toBe('true')
    expect(rows(host)[5].getAttribute('aria-label')).toContain('00:14')
    expect(expander(host).textContent).toContain('Show 2 more moments')
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:14/)

    // The row leaves with the pick; focus goes on to Show more.
    click(clearButton(host)!)
    expect(rows(host)).toHaveLength(5)
    expect(expander(host).textContent).toContain('Show 3 more moments')
    expect(document.activeElement).toBe(expander(host))
    expect(topCard(host)!.getAttribute('data-top-moment-card')).toBe('strongest')
  })

  it('keeps a picked row, its focus and its press when a poll ranks it past the fold', () => {
    const host = mount(<Panel payload={manyPayload} />)
    const picked = rows(host)[4]
    expect(picked.getAttribute('aria-label')).toContain('00:10')
    act(() => picked.focus())
    click(picked)

    // The next poll ranks a new, stronger moment first: the pick is sixth.
    act(() => root!.render(<Panel payload={outrankedPayload} />))
    expect(rows(host)).toHaveLength(6)
    expect(rows(host)[0].getAttribute('aria-label')).toContain('00:18')
    expect(rows(host)[5]).toBe(picked)
    expect(document.activeElement).toBe(picked)
    expect(picked.getAttribute('aria-pressed')).toBe('true')
    expect(expander(host).textContent).toContain('Show 3 more moments')
    expect(topCardLabel(host)).toMatch(/^Selected moment at 00:10/)
  })

  it('moves focus to Show more when a poll ranks a focused row past the fold', () => {
    const host = mount(<Panel payload={manyPayload} />)
    const row = rows(host)[4]
    act(() => row.focus())

    act(() => root!.render(<Panel payload={outrankedPayload} />))
    expect(rows(host)).toHaveLength(5)
    expect(row.isConnected).toBe(false)
    expect(document.activeElement).toBe(expander(host))
  })

  it('shows no card and announces nothing it controls on the read-only landing rows', () => {
    const host = mount(
      <MostReactedSection payload={payload} backendUrl="https://api.example.test" demoMode onJump={() => undefined} onAnalytics={() => undefined} />,
    )
    expect(rows(host)).toHaveLength(3)
    expect(topCard(host)).toBeNull()
    expect(rows(host).filter(row => row.hasAttribute('aria-controls') || row.hasAttribute('aria-expanded'))).toHaveLength(0)
  })
})

describe('Top Moments card in static markup', () => {
  it('shows a moment picked on the chart in the card above the list', () => {
    const html = renderToStaticMarkup(
      <MostReactedSection
        payload={payload}
        backendUrl="https://api.example.test"
        pinnedOffsetSeconds={240}
        onJump={() => undefined}
        onAnalytics={() => undefined}
      />,
    )
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html.match(/data-top-moment-card=/g)).toHaveLength(1)
    expect(html).toContain('data-top-moment-card="selected"')
    expect(html).toMatch(/aria-label="Selected moment at 00:04/)
    // The card comes before the first row.
    expect(html.indexOf('data-top-moment-card')).toBeLessThan(html.indexOf('pulse-moment-row-button'))
  })

  it('shows the strongest moment, whatever the sort, when nothing is pinned', () => {
    const html = renderToStaticMarkup(
      <MostReactedSection payload={payload} backendUrl="https://api.example.test" onJump={() => undefined} onAnalytics={() => undefined} />,
    )
    expect(html).toContain('data-top-moment-card="strongest"')
    expect(html).toMatch(/aria-label="Strongest moment at 00:02/)
    expect(html).not.toContain('Clear selected moment')
  })
})

describe('chart inspector with Top Moments shown', () => {
  it('takes the card back when the pinned moment is no longer in the payload', () => {
    // Top Moments pinned 08:00, which this payload no longer ranks as a moment.
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

  it('marks the minute but leaves a ranked moment\'s card to Top Moments', () => {
    const props = {
      payload,
      backendUrl: 'https://api.example.test',
      currentOffsetSeconds: 600,
      pinOffsetSeconds: 240,
      selectedMomentOffsetSeconds: 240,
    }
    const shown = renderToStaticMarkup(<LiveStatsBand {...props} cardInList />)
    const hidden = renderToStaticMarkup(<LiveStatsBand {...props} />)

    expect(shown).not.toContain('data-chart-inspector-owner')
    expect(shown).toContain('data-chart-readout-state="selected"')
    // Without Top Moments on the panel, the chart shows the moment itself.
    expect(hidden).toContain('data-chart-inspector-kind="moment"')
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
  const recap = (data: PulsePayload) => (
    <StreamRecapSection
      payload={data}
      backendUrl="https://api.example.test"
      uiState="ready"
      isLive={false}
      onJump={() => undefined}
      onAnalytics={() => undefined}
      onOpenAnalytics={() => undefined}
    />
  )
  /** The card a chart pick opens above the Top moments caption. */
  const slotCard = (host: ParentNode) => [...host.querySelectorAll('.pulse-moment-slot:not(.pulse-moment-slot-exit)')]

  for (const variant of [
    { name: 'recap', payload: recapPayload },
    { name: 'peaks fallback', payload: { ...recapPayload, recap: null } },
  ]) {
    it(`swaps list picks into the card above the list and keeps chart picks in their own card (${variant.name})`, () => {
      const host = mount(recap(variant.payload))
      const list = rows(host)
      const card = topCard(host)!
      expect(list.length).toBeGreaterThanOrEqual(3)
      // The first moment starts highlighted, shown as the strongest.
      expect(card.getAttribute('data-top-moment-card')).toBe('strongest')
      expect(topCardLabel(host)).toMatch(/^Strongest moment at 00:02/)
      expect(list[0].getAttribute('aria-pressed')).toBe('true')
      expect(card.nextElementSibling).toBe(list[0].parentElement)
      expect(list.map(row => row.getAttribute('aria-controls'))).toEqual(list.map(() => card.id))
      expect(selectionCards(host)).toHaveLength(0)

      // Picking the highlighted first row changes no key, but still selects it.
      click(list[0])
      expect(topCardLabel(host)).toMatch(/^Selected moment at 00:02/)
      expect(clearButton(host)).not.toBeNull()
      click(clearButton(host)!)
      expect(card.getAttribute('data-top-moment-card')).toBe('strongest')

      click(list[1])
      expect(topCard(host)).toBe(card)
      expect(topCardLabel(host)).toMatch(/^Selected moment at 00:04/)
      expect(rows(host)).toEqual(list)
      expect(slotCard(host)).toHaveLength(0)
      expect(selectionCards(host)).toHaveLength(1)

      click(list[2])
      expect(topCardLabel(host)).toMatch(/^Selected moment at 00:06/)
      expect(selectionCards(host)).toHaveLength(1)

      // A chart pick opens its own card above the list, as before.
      const plot = host.querySelector('[data-chart-scrubber="true"]')!
      key(plot, 'Home')
      key(plot, 'Enter')
      expect(slotCard(host)).toHaveLength(1)
      expect(slotCard(host)[0].compareDocumentPosition(list[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(card.getAttribute('data-top-moment-card')).toBe('strongest')
      expect(selectionCards(host)).toHaveLength(1)

      click(list[0])
      expect(topCardLabel(host)).toMatch(/^Selected moment at 00:02/)
      expect(slotCard(host)).toHaveLength(0)
      act(() => list[0].focus())
      key(list[0], 'Escape')
      expect(document.activeElement).toBe(list[0])
      expect(card.getAttribute('data-top-moment-card')).toBe('strongest')
      expect(selectionCards(host)).toHaveLength(0)
    })
  }

  for (const variant of ['recap', 'peaks fallback'] as const) {
    it(`keeps a pick past the fold listed at the end, and × or Escape then moves focus to Show more (${variant})`, () => {
      const moments = manyPeaks.map(({ offsetSeconds, score }) => ({ offsetSeconds, score, reasons: ['chat_spike'], chatCount: 40, emoteCount: 3 }))
      const host = mount(recap({
        ...manyPayload,
        isLive: false,
        vodId: 'vod-1',
        endedAt: '2026-06-11T13:00:00.000Z',
        recap: variant === 'recap'
          ? { streamId: 'stream-1', login: 'test', durationSeconds: 3600, totalMessages: 4000, peakChatPerMin: 90, topMoments: moments, topEmotes: [], clipCandidates: [] }
          : null,
      }))
      expect(rows(host)).toHaveLength(5)
      click(expander(host))
      click(rows(host)[6])
      click(expander(host))

      // Collapsed again, the picked row stays listed after the first five.
      expect(rows(host)).toHaveLength(6)
      expect(rows(host)[5].getAttribute('aria-pressed')).toBe('true')
      expect(expander(host).textContent).toContain('Show 2 more moments')
      expect(topCardLabel(host)).toMatch(/^Selected moment at 00:14/)
      expect(selectionCards(host)).toHaveLength(1)

      // The row leaves with the pick; focus goes on to Show more.
      click(clearButton(host)!)
      expect(rows(host)).toHaveLength(5)
      expect(document.activeElement).toBe(expander(host))
      expect(topCard(host)!.getAttribute('data-top-moment-card')).toBe('strongest')

      // Escape on the kept row does the same.
      click(expander(host))
      click(rows(host)[6])
      click(expander(host))
      const kept = rows(host)[5]
      act(() => kept.focus())
      key(kept, 'Escape')
      expect(kept.isConnected).toBe(false)
      expect(rows(host)).toHaveLength(5)
      expect(document.activeElement).toBe(expander(host))
      expect(topCard(host)!.getAttribute('data-top-moment-card')).toBe('strongest')
    })
  }
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
    // A card that a poll or a chart pick opens leaves the panel where it is.
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
   * The 00:02:25 moment was picked and its row focused. After a poll, no row
   * is handed to another moment: the focused button still shows 00:02:25 (or
   * focus left a row that left), the pressed row is 00:02:25's, and the card
   * still shows 00:02:25.
   */
  function expectPickStaysWithItsMoment(host: ParentNode, picked: HTMLButtonElement) {
    if (picked.isConnected) expect(picked.getAttribute('aria-label')).toContain('00:02:25')
    const focused = document.activeElement
    if (focused instanceof HTMLButtonElement && focused.classList.contains('pulse-moment-row-button')) {
      expect(focused.getAttribute('aria-label')).toContain('00:02:25')
    }
    expect(rows(host).filter(row => row.getAttribute('aria-pressed') === 'true').map(row => row.getAttribute('aria-label')))
      .toEqual([expect.stringContaining('00:02:25')])
    expect(topCardLabel(host)).toBe('Selected moment at 00:02:25')
  }
  const live = (moments: ExtensionPeak[]) => (
    <MostReactedSection
      payload={makePayload({ peaks: [...moments, { ...peaks[0], offsetSeconds: 360, score: 50 }] })}
      backendUrl="https://api.example.test"
      pinnedOffsetSeconds={145}
      onJump={() => undefined}
      onAnalytics={() => undefined}
    />
  )
  const pickedRow = (host: ParentNode) => rows(host).find(row => row.getAttribute('aria-label')?.includes('00:02:25'))!

  it('keeps a picked moment\'s row when a new moment joins its bucket with an earlier onset', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = mount(live([refined(145, 90)]))
    const picked = pickedRow(host)
    act(() => picked.focus())

    act(() => root!.render(live([refined(145, 90), refined(125, 80)])))
    expect(rows(host)).toHaveLength(3)
    expectPickStaysWithItsMoment(host, picked)
    expect(duplicateKeyWarnings(spy)).toBe(0)
    spy.mockRestore()
  })

  it('keeps a picked moment\'s row, focus and card when the other moment in its bucket refines past it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const host = mount(live([refined(125, 80), refined(145, 90)]))
    const picked = pickedRow(host)
    const card = topCard(host)
    act(() => picked.focus())

    // The 00:02:05 moment refines to 00:02:40, after the picked one.
    act(() => root!.render(live([refined(160, 80), refined(145, 90)])))
    expect(rows(host)).toHaveLength(3)
    expectPickStaysWithItsMoment(host, picked)
    // Its own identity did not change, so its row and the card stayed: no
    // remount, focus kept.
    expect(pickedRow(host)).toBe(picked)
    expect(topCard(host)).toBe(card)
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
