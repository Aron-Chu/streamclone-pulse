import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsMinuteRollup } from '../../apiTypes.ts'
import { minuteDataRecap } from '../../utils/minuteDataMoments.ts'
import { momentRowEdgeLabel } from '../../utils/momentRowDisplay.ts'
import {
  MOMENTS_LATE_LINE,
  RECAP_FALLBACK_LINE,
  RECAP_UNAVAILABLE_LINE,
  SessionMomentsFallbackNotice,
  SessionMomentsLoading,
} from './SessionMomentsStates.tsx'
import { StreamRecapPanel } from './StreamRecapPanel.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const STARTED = '2026-07-16T18:00:00.000Z'
const minute = (offsetMinutes: number, chatCount: number, extra: Partial<AnalyticsMinuteRollup> = {}): AnalyticsMinuteRollup => ({
  minuteTs: new Date(Date.parse(STARTED) + offsetMinutes * 60_000).toISOString(),
  chatCount,
  totalEmoteCount: Math.round(chatCount / 2),
  viewerAvg: 1000,
  ...extra,
})

describe('SessionMomentsLoading (L1, SESSION-MOMENTS-10)', () => {
  it('holds one large and two small grey cards, then says it is still loading after about 5 s', () => {
    vi.useFakeTimers()
    const { container } = render(<SessionMomentsLoading framed={false} />)
    const section = container.querySelector('[data-moments-loading]')
    expect(section?.getAttribute('aria-busy')).toBe('true')
    expect(container.querySelectorAll('.ssr-sk')).toHaveLength(3)
    expect(container.querySelectorAll('.ssr-sk--hero')).toHaveLength(1)
    expect(container.querySelector('.ssr-sk-flat')).not.toBeNull()
    expect(screen.queryByText(MOMENTS_LATE_LINE)).toBeNull()
    act(() => { vi.advanceTimersByTime(4_999) })
    expect(screen.queryByText(MOMENTS_LATE_LINE)).toBeNull()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('status').textContent).toBe('Still loading. Live data can take a moment.')
  })

  it('draws 16:9 cards when the moments will carry VOD frames', () => {
    const { container } = render(<SessionMomentsLoading framed />)
    expect(container.querySelector('.ssr-sk-flat')).toBeNull()
  })
})

describe('SessionMomentsFallbackNotice (R1, SESSION-MOMENTS-4)', () => {
  it('says the rows are ranked from minute data, and Try again retries once at a time', () => {
    const onRetry = vi.fn()
    const { rerender } = render(<SessionMomentsFallbackNotice ranked retrying={false} failedAgain={false} onRetry={onRetry} />)
    expect(screen.getByRole('status').textContent).toBe('Recap unavailable, ranked from minute data')
    expect(RECAP_FALLBACK_LINE).toBe('Recap unavailable, ranked from minute data')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    rerender(<SessionMomentsFallbackNotice ranked retrying failedAgain={false} onRetry={onRetry} />)
    // round 4: busy while the retry runs
    const button = screen.getByRole('button', { name: 'Trying again…' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    expect(button.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
    rerender(<SessionMomentsFallbackNotice ranked retrying={false} failedAgain onRetry={onRetry} />)
    expect(screen.getByRole('status').textContent).toBe('Recap unavailable, ranked from minute data Still unavailable.')
  })

  it('says only that the recap is unavailable when the minutes hold no moments yet', () => {
    render(<SessionMomentsFallbackNotice ranked={false} retrying={false} failedAgain={false} onRetry={() => {}} />)
    expect(screen.getByRole('status').textContent).toBe(RECAP_UNAVAILABLE_LINE)
  })
})

describe('minuteDataRecap (R1)', () => {
  it('ranks minute-only moments from the minutes, with their figures', () => {
    const rollups = [minute(10, 20), minute(11, 22), minute(12, 400), minute(13, 25), minute(14, 21), minute(15, 19)]
    const recap = minuteDataRecap({ streamId: 's1', rollups, streamStartedAt: STARTED })
    expect(recap?.streamId).toBe('s1')
    expect(recap?.topMoments?.length).toBeGreaterThan(0)
    const top = recap!.topMoments![0]!
    expect(top.precisionSeconds).toBe(60)
    expect(top.offsetSeconds).toBe(12 * 60)
    expect(top.chatCount).toBe(400)
    expect(top.viewerCount).toBe(1000)
  })

  it('has nothing to rank without minutes', () => {
    expect(minuteDataRecap({ streamId: 's1', rollups: [], streamStartedAt: STARTED })).toBeNull()
  })
})

describe('stream edge tags (E1, SESSION-MOMENTS-7/8)', () => {
  it('names the edge a moment falls in: the backend flag first, else the opening five minutes', () => {
    expect(momentRowEdgeLabel({ offsetSeconds: 120 })).toBe('Stream start')
    expect(momentRowEdgeLabel({ offsetSeconds: 3600 })).toBeNull()
    expect(momentRowEdgeLabel({ offsetSeconds: 3600, streamEdge: 'closing' })).toBe('Stream end')
  })

  it('keeps a recap figure in the opening edge, with a quiet tag beside it', () => {
    const { container } = render(
      <StreamRecapPanel
        recap={{ streamId: 's1', topMoments: [{ offsetSeconds: 600, score: 40 }], biggestChatSpike: { offsetSeconds: 120, chatPerMin: 900 } }}
        streamEdges={{ openingUntil: 300, closingFrom: -1 }}
        onJumpToOffset={() => {}}
      />,
    )
    expect(container.textContent).toContain('900 chat/min')
    expect(container.querySelector('[data-stream-recap-edge]')?.textContent).toBe('Stream start')
    expect(screen.getByRole('button', { name: /^Biggest spike at about 0:02:00, Stream start, 900 chat messages a minute/ })).toBeTruthy()
  })
})
