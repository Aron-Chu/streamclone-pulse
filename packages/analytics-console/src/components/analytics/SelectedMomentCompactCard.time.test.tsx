import { cleanup, render } from '@testing-library/react'
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
    expect(container.querySelector('[data-selected-moment-time]')?.textContent).toBe('05:52:07')
    expect(container.textContent).not.toContain('5h52m7s')
    // The compact form stays in the region label.
    expect(container.querySelector('[data-selected-moment-card]')?.getAttribute('aria-label'))
      .toBe('Selected moment at 5h52m7s')
  })
})
