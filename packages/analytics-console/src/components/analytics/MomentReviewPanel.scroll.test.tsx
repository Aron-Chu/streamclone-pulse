import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AnalyticsMinuteRollup } from '../../apiTypes.ts'
import { MomentReviewPanel } from './MomentReviewPanel.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

// jsdom has no scrollIntoView; the test installs a spy and must take it off again.
const ownScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (ownScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', ownScrollIntoView)
  else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

const startedAt = '2026-07-31T00:00:00.000Z'
const rollups = Array.from({ length: 30 }, (_, index) => ({
  minuteTs: new Date(Date.parse(startedAt) + index * 60_000).toISOString(),
  viewerAvg: 1000,
  chatCount: index % 5 === 0 ? 400 + index * 10 : 20,
  totalEmoteCount: index % 5 === 0 ? 120 + index : 2,
  emotes: {},
})) as unknown as AnalyticsMinuteRollup[]

const ROW_HEIGHT = 56
const BOX_TOP = 100
const BOX_HEIGHT = 120

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) } as DOMRect
}

function renderPanel() {
  // jsdom has no CSS namespace; minute timestamps need no escaping in a quoted selector.
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  const props = { rollups, streamStartedAt: startedAt, onSelectRollup: vi.fn(), embedded: true }
  const view = render(<MomentReviewPanel {...props} selectedRollup={null} />)
  const anchors = Array.from(view.container.querySelectorAll<HTMLElement>('[data-moment-scroll-anchor]'))
  const list = anchors[0]?.parentElement
  if (!list || anchors.length < 3) throw new Error('ranked moment rows did not render')
  // The list is a 120 px tall scroll box at y=100; rows stack below it.
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect(BOX_TOP, BOX_HEIGHT))
  anchors.forEach((anchor, index) => {
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(rect(BOX_TOP + index * ROW_HEIGHT, ROW_HEIGHT))
  })
  const scrollTo = vi.fn()
  Object.defineProperty(list, 'scrollTo', { configurable: true, value: scrollTo })
  const scrollIntoView = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
  const windowScroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  const select = (index: number) => {
    const minuteTs = anchors[index]!.getAttribute('data-minute-ts')!
    const rollup = rollups.find(entry => entry.minuteTs === minuteTs)!
    view.rerender(<MomentReviewPanel {...props} selectedRollup={rollup} />)
  }
  return { anchors, scrollTo, scrollIntoView, windowScroll, select }
}

it('reveals a selected ranked minute by scrolling only the list, never the page', () => {
  const { anchors, scrollTo, scrollIntoView, windowScroll, select } = renderPanel()

  select(anchors.length - 1)

  // scrollIntoView also scrolls every scrolling ancestor. On phones the list is
  // stacked under the chart, so it dragged the page down past the chart.
  expect(scrollIntoView).not.toHaveBeenCalled()
  expect(windowScroll).not.toHaveBeenCalled()
  const rowBottom = BOX_TOP + anchors.length * ROW_HEIGHT
  expect(scrollTo).toHaveBeenCalledTimes(1)
  expect(scrollTo).toHaveBeenCalledWith({ top: rowBottom - (BOX_TOP + BOX_HEIGHT), behavior: 'instant' })
})

it('leaves the list alone when the selected row is already visible', () => {
  const { scrollTo, scrollIntoView, select } = renderPanel()

  select(0)

  expect(scrollIntoView).not.toHaveBeenCalled()
  expect(scrollTo).not.toHaveBeenCalled()
})
