import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectedMomentCompactCard } from './SelectedMomentCompactCard.tsx'

vi.mock('../../hooks/useConsoleMotion.ts', () => ({
  useConsoleMotion: () => ({ motionEnabled: false }),
}))

afterEach(() => cleanup())

describe('SelectedMomentCompactCard time', () => {
  it('shows the pinned minute on the stream clock, like the readout and the axis', () => {
    const startedAt = '2026-10-07T00:00:00.000Z'
    // 5h 52m 7s into the stream.
    const rollup = { minuteTs: '2026-10-07T05:52:07.000Z', chatCount: 700, totalEmoteCount: 120 }
    const { container } = render(
      <SelectedMomentCompactCard
        rollup={rollup}
        rollups={[rollup]}
        startedAt={startedAt}
        vodLinkState={{ status: 'unavailable', label: 'VOD unavailable', detail: '' } as never}
      />,
    )
    // The strip's unpadded h:mm:ss (mockup), still matched by the e2e `(\d+):(\d\d):(\d\d)`.
    expect(container.querySelector('[data-selected-moment-time]')?.textContent).toBe('5:52:07')
    expect(container.textContent).not.toContain('5h52m7s')
    expect(screen.getByRole('region', { name: 'Bucket selected: 5:52:07' })).toBeTruthy()
  })

  it('names the pinned minute, not a Pulse moment matched in the next minute', () => {
    const startedAt = '2026-10-07T00:00:00.000Z'
    // Pinned 6:39:07; the nearest Pulse moment (within the 90s match) is at 6:40:07, outside this minute.
    const rollup = { minuteTs: '2026-10-07T06:39:07.000Z', chatCount: 700, totalEmoteCount: 120 }
    const recapMoment = { offsetSeconds: 6 * 3600 + 40 * 60 + 7, score: 80, reasons: ['chat'] }
    const { container } = render(
      <SelectedMomentCompactCard
        rollup={rollup}
        rollups={[rollup]}
        startedAt={startedAt}
        recapMoment={recapMoment as never}
        vodLinkState={{ status: 'unavailable', label: 'VOD unavailable', detail: '' } as never}
      />,
    )
    expect(container.querySelector('[data-selected-moment-time]')?.textContent).toBe('6:39:07')
    // The moment is outside the bar, so the strip doesn't list it.
    expect(container.querySelector('[data-strip-moment]')).toBeNull()
    expect(container.querySelector('.bkc-mom .r')?.textContent).toBe('none')
  })
})
