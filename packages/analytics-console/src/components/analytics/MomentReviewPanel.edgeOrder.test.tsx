import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  OPENING_STREAM_EDGE,
  momentClockDisplay,
  rollupFallbackMomentCandidates,
  streamEdgesFor,
} from '@streampulse/pulse-core'
import type { AnalyticsMinuteRollup } from '../../apiTypes.ts'
import type { ReplayHeatmapPoint } from '../../types/heatmap.ts'
import { MomentReviewPanel } from './MomentReviewPanel.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({ useConsoleMotion: () => ({ motionEnabled: false }) }))

afterEach(() => cleanup())

const startedAt = '2026-07-31T00:00:00.000Z'
const minuteTs = (minute: number) => new Date(Date.parse(startedAt) + minute * 60_000).toISOString()
// The biggest spikes sit at the stream's start (0:00) and end (0:25, inside the last 10 minutes of data that
// ends at 0:29), so by score alone they lead the rail; 0:10 and 0:15 are smaller mid-stream spikes.
const spikes: Record<number, [chat: number, emotes: number]> = {
  0: [3000, 900],
  25: [2500, 800],
  10: [2000, 600],
  15: [1800, 550],
}
const rollups = Array.from({ length: 30 }, (_, index) => ({
  minuteTs: minuteTs(index),
  viewerAvg: 1000,
  chatCount: spikes[index]?.[0] ?? 20,
  totalEmoteCount: spikes[index]?.[1] ?? 2,
  emotes: {},
})) as unknown as AnalyticsMinuteRollup[]

function railRows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-moment-scroll-anchor]')].map(row => ({
    time: row.querySelector('.ssr-off')!.textContent,
    edge: row.querySelector('[data-moment-stream-edge]')?.textContent ?? null,
  }))
}

// Round 5 (E1 parity): the fallback rail ranks Stream start / Stream end moments after every other moment.
it('ranks the stream-edge minutes after every other moment, score order kept within each group', () => {
  const { container } = render(
    <MomentReviewPanel rollups={rollups} streamStartedAt={startedAt} streamEdges={streamEdgesFor(29 * 60, true)}
      selectedRollup={null} onSelectRollup={vi.fn()} embedded />,
  )
  const rows = railRows(container)
  const firstEdge = rows.findIndex(row => row.edge != null)
  expect(firstEdge).toBeGreaterThan(0)
  expect(rows.slice(firstEdge).every(row => row.edge != null)).toBe(true)
  // Within each group the rail keeps pulse-core's score order.
  const scoreOrder = rollupFallbackMomentCandidates(rollups, undefined, startedAt)
    .map(candidate => momentClockDisplay({ offsetSeconds: candidate.offsetSeconds }).text)
  const edgeTimes = new Set(['0:00:00', '0:20:00', '0:25:00'])
  expect(edgeTimes.has(scoreOrder[0])).toBe(true)
  expect(rows.slice(0, firstEdge).map(row => row.time)).toEqual(['0:10:00', '0:15:00'])
  expect(rows.slice(0, firstEdge).map(row => row.time)).toEqual(scoreOrder.filter(time => !edgeTimes.has(time)))
  expect(rows.slice(firstEdge).map(row => row.time)).toEqual(scoreOrder.filter(time => edgeTimes.has(time)))
})

function heatmapPoint(minute: number, score: number, extra: Record<string, unknown> = {}): ReplayHeatmapPoint {
  return {
    minuteTs: minuteTs(minute),
    offsetSeconds: minute * 60,
    durationSeconds: 60,
    score,
    reactionScore: score,
    confidence: 0.9,
    reason: 'chat_spike',
    topEmotes: [],
    vodId: null,
    streamId: 'synthetic-stream',
    ...extra,
  } as unknown as ReplayHeatmapPoint
}

it('lets the backend streamEdge flag win over the offset, for both the order and the tag', () => {
  const heatmapPoints = [
    heatmapPoint(0, 90),
    heatmapPoint(10, 80, { streamEdge: 'closing' }),
    heatmapPoint(15, 50),
    heatmapPoint(20, 40),
  ]
  const { container } = render(
    <MomentReviewPanel rollups={rollups} heatmapPoints={heatmapPoints} streamStartedAt={startedAt}
      streamEdges={OPENING_STREAM_EDGE} selectedRollup={null} onSelectRollup={vi.fn()} embedded />,
  )
  expect(railRows(container)).toEqual([
    { time: '0:15:00', edge: null },
    { time: '0:20:00', edge: null },
    { time: '0:00:00', edge: 'Stream start' },
    { time: '0:10:00', edge: 'Stream end' },
  ])
})
