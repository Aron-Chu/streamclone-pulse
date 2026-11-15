import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import { MomentRow } from '../src/ui/components/moments/MomentRow'
import { formatMomentOccurrence } from '../src/lib/liveWire'

const base: DiscoveryMoment = {
  key: 'stream-1:20974',
  login: 'creator',
  streamId: 'stream-1',
  offsetSeconds: 5 * 3600 + 49 * 60 + 34,
  at: Date.parse('2026-09-22T16:50:00Z'),
  label: 'Chat spike',
  provenance: 'hub',
}

function show(moment: DiscoveryMoment) {
  return render(<MemoryRouter><MomentRow moment={moment} selected={false} onSelect={() => {}} /></MemoryRouter>)
}

afterEach(cleanup)
/** The row's time into the stream as read, 'about' and all ('about' has its own quiet span since 11-14). */
const offset = () => document.querySelector('.moments-result-offset')?.textContent

describe('moment row timing', () => {
  it('shows the occurrence as an absolute labelled time beside a labelled broadcast offset', () => {
    const { container } = show(base)
    const time = container.querySelector('time')
    expect(time?.getAttribute('datetime')).toBe('2026-09-22T16:50:00.000Z')
    expect(time?.textContent).toContain('2026')
    // The reader's own zone, named: not a fixed UTC label.
    expect(time?.textContent).toBe(formatMomentOccurrence('2026-09-22T16:50:00.000Z'))
    expect(offset()).toBe('about 5:49:00 into broadcast')
  })

  it('formats the occurrence in the reader zone, so an evening moment keeps its own date', () => {
    // 03:30 UTC on Sep 23 is the evening of Sep 22 in Phoenix (UTC-7).
    expect(formatMomentOccurrence('2026-09-23T03:30:00.000Z', 'America/Phoenix')).toBe('Sep 22, 2026, 8:30 PM MST')
    expect(formatMomentOccurrence('2026-09-23T03:30:00.000Z', 'Europe/Berlin')).toBe('Sep 23, 2026, 5:30 AM GMT+2')
    expect(formatMomentOccurrence('2026-09-23T03:30:00.000Z', 'UTC')).toBe('Sep 23, 2026, 3:30 AM UTC')
  })

  it('shows relative age alongside the absolute occurrence and broadcast offset', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-22T17:00:00Z'))
    try {
      show(base)
      expect(screen.getByText('10 min ago')).toBeTruthy()
      expect(offset()).toBe('about 5:49:00 into broadcast')
    } finally {
      now.mockRestore()
    }
  })

  it('updates relative age while the same result row stays open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-22T17:00:00Z'))
    try {
      const { unmount } = show(base)
      expect(screen.getByText('10 min ago')).toBeTruthy()
      act(() => vi.advanceTimersByTime(60_000))
      expect(screen.getByText('11 min ago')).toBeTruthy()
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the occurrence visible when a source supplies Unix seconds', () => {
    const { container } = show({ ...base, at: base.at! / 1000 })
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-22T16:50:00.000Z')
  })

  it('writes the clock h:mm:ss with a quiet about, since a row knows only its minute (K1)', () => {
    const { container } = show({ ...base, offsetSeconds: 42 * 60 + 10 })
    expect(offset()).toBe('about 0:42:00 into broadcast')
    // 'about' in its own quiet span; the time stays in the clock's own span beside it (11-14)
    expect(container.querySelector('.moments-result-offset > .moments-result-about')?.textContent).toBe('about')
  })

  it('says a time ahead of this device rather than a negative age', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-22T16:40:00Z'))
    try {
      show(base)
      expect(screen.getByText('Time ahead of this device')).toBeTruthy()
    } finally {
      now.mockRestore()
    }
  })

  it.each([undefined, NaN, Infinity, 0])('states when occurrence time %s is unavailable', at => {
    const { container } = show({ ...base, at })
    expect(container.querySelector('time')).toBeNull()
    expect(screen.getByText('Occurrence time unavailable')).toBeTruthy()
    expect(offset()).toBe('about 5:49:00 into broadcast')
  })
})

const ready = (multiplier: number) => ({ state: 'ready', currentPerMin: 300, earlierPerMin: 50, multiplier }) as const
describe('moment row: early in the stream (X1, E1)', () => {
  it('tags a stream start moment and shows no × for it', () => {
    const { container } = show({ ...base, offsetSeconds: 120, comparison: { emotes: ready(6), chat: ready(2) } as unknown as DiscoveryMoment['comparison'], reactionSignal: 'emotes' })
    expect(screen.getByText('Stream start')).toBeTruthy()
    expect(container.querySelector('.moments-result-ratio')).toBeNull()
  })

  it('says early in the stream for its first 20 minutes past the start tag, still with no ×', () => {
    const { container } = show({ ...base, offsetSeconds: 15 * 60, comparison: { emotes: ready(6), chat: ready(2) } as unknown as DiscoveryMoment['comparison'], reactionSignal: 'emotes' })
    expect(screen.getByText('Early in the stream')).toBeTruthy()
    expect(container.querySelector('.moments-result-ratio')).toBeNull()
  })

  it('shows the × in pulse-core words from 20 minutes in (Z06)', () => {
    const { container } = show({ ...base, offsetSeconds: 25 * 60, comparison: { emotes: ready(6.24), chat: ready(2) } as unknown as DiscoveryMoment['comparison'], reactionSignal: 'emotes' })
    expect(container.querySelector('.moments-result-ratio')?.textContent).toBe('6.2× more emotes')
    expect(screen.queryByText('Early in the stream')).toBeNull()
  })

  it('lets the backend flag win: a flagged closing minute says "Stream end" beside its × (round 2)', () => {
    const { container } = show({ ...base, offsetSeconds: 3 * 3600, streamEdge: 'closing', comparison: { emotes: ready(6.24), chat: ready(2) } as unknown as DiscoveryMoment['comparison'], reactionSignal: 'emotes' })
    expect(screen.getByText('Stream end')).toBeTruthy()
    expect(container.querySelector('.moments-result-ratio')?.textContent).toBe('6.2× more emotes')
  })
})
