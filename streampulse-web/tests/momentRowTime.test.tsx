import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscoveryMoment } from '../src/lib/discoveryMoments'
import { MomentRow } from '../src/ui/components/moments/MomentRow'

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

describe('moment row timing', () => {
  it('shows the occurrence as an absolute labelled time beside a labelled broadcast offset', () => {
    const { container } = show(base)
    const time = container.querySelector('time')
    expect(time?.getAttribute('datetime')).toBe('2026-09-22T16:50:00.000Z')
    expect(time?.textContent).toContain('2026')
    expect(time?.textContent).toContain('UTC')
    expect(screen.getByText('5:49:34 into broadcast')).toBeTruthy()
  })

  it('shows relative age alongside the absolute occurrence and broadcast offset', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-22T17:00:00Z'))
    try {
      show(base)
      expect(screen.getByText('10m ago')).toBeTruthy()
      expect(screen.getByText('5:49:34 into broadcast')).toBeTruthy()
    } finally {
      now.mockRestore()
    }
  })

  it('updates relative age while the same result row stays open', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-09-22T17:00:00Z'))
    try {
      const { unmount } = show(base)
      expect(screen.getByText('10m ago')).toBeTruthy()
      act(() => vi.advanceTimersByTime(60_000))
      expect(screen.getByText('11m ago')).toBeTruthy()
      unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the occurrence visible when a source supplies Unix seconds', () => {
    const { container } = show({ ...base, at: base.at! / 1000 })
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2026-09-22T16:50:00.000Z')
  })

  it.each([undefined, NaN, Infinity, 0])('states when occurrence time %s is unavailable', at => {
    const { container } = show({ ...base, at })
    expect(container.querySelector('time')).toBeNull()
    expect(screen.getByText('Occurrence time unavailable')).toBeTruthy()
    expect(screen.getByText('5:49:34 into broadcast')).toBeTruthy()
  })
})
