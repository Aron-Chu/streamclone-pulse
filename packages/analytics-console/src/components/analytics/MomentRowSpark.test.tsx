import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AnalyticsMinuteRollup } from '../../apiTypes.ts'
import {
  momentRowRate,
  momentRowSeries,
  momentRowSparkBars,
} from '../../utils/momentRowDisplay.ts'
import { MomentRowSpark, momentRowSparkNote } from './MomentRowSpark.tsx'

const START = '2026-10-14T06:46:35Z'
const startMs = Date.parse(START)
// Minutes on the wall clock, the way the API sends them: the first full minute is 25 s into the stream.
const minuteAt = (index: number) => new Date(Math.ceil(startMs / 60_000) * 60_000 + index * 60_000).toISOString()
const offsetOf = (index: number) => Math.trunc((Date.parse(minuteAt(index)) - startMs) / 1000)

function rollups(count: number, fn: (index: number) => Partial<AnalyticsMinuteRollup>): AnalyticsMinuteRollup[] {
  return Array.from({ length: count }, (_, index) => ({ minuteTs: minuteAt(index), ...fn(index) }))
}

describe('momentRowSparkBars (moment-rows.js spikeSVG)', () => {
  it('takes the measured minutes 8 minutes either side and marks the moment minute', () => {
    const rows = rollups(40, (i) => ({ chatCount: 100 + i, totalEmoteCount: 10 * i }))
    const moment = offsetOf(20)
    const bars = momentRowSparkBars({ offsetSeconds: moment, rollups: rows, streamStartedAt: START, series: 'emotes' })
    expect(bars).toHaveLength(17)
    expect(bars.map((bar) => bar.slot)).toEqual(Array.from({ length: 17 }, (_, i) => i))
    expect(bars.filter((bar) => bar.at)).toEqual([{ slot: 8, value: 200, at: true }])
    expect(bars[0]).toEqual({ slot: 0, value: 120, at: false })
  })

  it('uses chat for a chat spike and leaves missing or unmeasured minutes out', () => {
    expect(momentRowSeries('chat_spike')).toBe('chat')
    expect(momentRowSeries('seventv_spike')).toBe('emotes')
    expect(momentRowSeries(undefined)).toBe('emotes')
    const rows = rollups(20, (i) => (i === 9 ? { missing: true, chatCount: 999 } : i === 11 ? {} : { chatCount: 50 + i }))
    const bars = momentRowSparkBars({ offsetSeconds: offsetOf(10), rollups: rows, streamStartedAt: START, series: 'chat' })
    const slots = bars.map((bar) => bar.slot)
    expect(slots).not.toContain(7) // minute 9: missing
    expect(slots).not.toContain(9) // minute 11: no chat count
    expect(bars.find((bar) => bar.at)?.value).toBe(60)
    expect(bars.some((bar) => bar.value === 999)).toBe(false)
  })

  it('is empty without a stream start or rollups', () => {
    expect(momentRowSparkBars({ offsetSeconds: 600, rollups: [], streamStartedAt: START, series: 'emotes' })).toEqual([])
    expect(momentRowSparkBars({ offsetSeconds: 600, rollups: rollups(3, () => ({ chatCount: 1 })), streamStartedAt: undefined, series: 'chat' })).toEqual([])
  })

  it('reads an absent emote total from the minute map, never a missing minute', () => {
    expect(momentRowRate({ minuteTs: minuteAt(0), emotes: { LOL: 3, HUH: 4 } }, 'emotes')).toBe(7)
    expect(momentRowRate({ minuteTs: minuteAt(0), totalEmoteCount: 0 }, 'emotes')).toBe(0)
    expect(momentRowRate({ minuteTs: minuteAt(0), missing: true, chatCount: 5 }, 'chat')).toBeNull()
    expect(momentRowRate(null, 'chat')).toBeNull()
  })
})

describe('MomentRowSpark', () => {
  it('draws one rect per bar in the 170x60 box, the moment bar highlighted', () => {
    const { container } = render(
      <MomentRowSpark
        series="chat"
        bars={[
          { slot: 0, value: 50, at: false },
          { slot: 8, value: 100, at: true },
          { slot: 9, value: 0, at: false },
        ]}
      />,
    )
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('class')).toBe('ssr-msp chat')
    expect(svg.getAttribute('viewBox')).toBe('0 0 170 60')
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    const rects = Array.from(svg.querySelectorAll('rect'))
    expect(rects).toHaveLength(2) // a zero minute draws nothing
    expect(rects[0]!.getAttribute('x')).toBe('1.0')
    expect(rects[0]!.getAttribute('height')).toBe('30.0')
    expect(rects[1]!.getAttribute('class')).toBe('at')
    expect(rects[1]!.getAttribute('x')).toBe('81.0')
    expect(rects[1]!.getAttribute('width')).toBe('8.0')
    expect(rects[1]!.getAttribute('height')).toBe('60.0')
  })

  it('keeps a tiny minute visible at 1.5 units', () => {
    const { container } = render(
      <MomentRowSpark series="emotes" bars={[{ slot: 1, value: 1, at: false }, { slot: 2, value: 1000, at: true }]} />,
    )
    expect(container.querySelector('rect')!.getAttribute('height')).toBe('1.5')
  })

  it("explains the bars in the mockup's words", () => {
    expect(momentRowSparkNote('emotes')).toBe(
      'Emotes per minute, 8 minutes either side; the highlighted bar is this moment. Moments are ranked by reaction score, so it need not be the tallest.',
    )
    expect(momentRowSparkNote('chat')).toMatch(/^Chat messages per minute/)
  })
})
