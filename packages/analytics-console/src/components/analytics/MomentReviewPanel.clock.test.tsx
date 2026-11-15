import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { streamEdgesFor } from '@streampulse/pulse-core'
import type { AnalyticsMinuteRollup } from '../../apiTypes.ts'
import { MomentReviewPanel } from './MomentReviewPanel.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: false }) }))

afterEach(() => cleanup())

const startedAt = '2026-07-31T00:00:00.000Z'
const rollups = Array.from({ length: 30 }, (_, index) => ({
  minuteTs: new Date(Date.parse(startedAt) + index * 60_000).toISOString(),
  viewerAvg: 1000,
  chatCount: index % 5 === 0 ? 400 + index * 10 : 20,
  totalEmoteCount: index % 5 === 0 ? 120 + index : 2,
  emotes: {},
})) as unknown as AnalyticsMinuteRollup[]

// Round 2 (calibration): the minute-data rows write 'about' as the family's quiet span, not inside the time,
// and carry the list's edge tag.
it('prints a quiet "about" before the minute and the edge tag at either end of the stream', () => {
  const { container } = render(
    <MomentReviewPanel rollups={rollups} streamStartedAt={startedAt} streamEdges={streamEdgesFor(29 * 60, true)}
      selectedRollup={null} onSelectRollup={vi.fn()} embedded />,
  )
  const rows = [...container.querySelectorAll<HTMLElement>('[data-moment-scroll-anchor]')]
  expect(rows.length).toBeGreaterThan(2)
  for (const row of rows) {
    const clock = row.querySelector('.ssr-at')!
    expect(clock.querySelector('.ssr-ab')?.textContent).toBe('about')
    expect(clock.querySelector('.ssr-off')?.textContent).toMatch(/^\d+:\d\d:00$/)
    expect(clock.querySelector('.ssr-off')?.textContent).not.toMatch(/about/)
  }
  const tags = rows.map(row => row.querySelector('[data-moment-stream-edge]')?.textContent ?? null)
  // minutes 0 (opening) and 20, 25 (the last 10 minutes of data that ends at 0:29:00) carry a tag; 5-15 do not
  const byMinute = new Map(rows.map((row, i) => [row.querySelector('.ssr-off')!.textContent, tags[i]]))
  expect(byMinute.get('0:00:00')).toBe('Stream start')
  expect(byMinute.get('0:25:00')).toBe('Stream end')
  expect(byMinute.get('0:10:00')).toBeNull()
})
