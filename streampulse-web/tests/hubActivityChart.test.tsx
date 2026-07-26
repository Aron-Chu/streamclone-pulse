import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HubActivityChart } from '../src/ui/components/hub/HubActivityChart'

describe('HubActivityChart chat measurement honesty', () => {
  it('draws a gap band for explicit false but not an absent legacy flag', () => {
    const end = Math.floor((Date.now() - 5 * 60_000) / 60_000) * 60_000
    const { container, rerender } = render(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 0, seventv: 0, viewers: 100, hasChatRollup: true, bucketComplete: true },
          { t: end, chat: 0, seventv: 0, viewers: 100, hasChatRollup: false, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelectorAll('.gap-fill--chat-rollup')).toHaveLength(1)
    expect(container.textContent).toContain('No IRC chat rollups in this stretch')
    expect(container.querySelector('.now')).toBeNull()

    rerender(
      <HubActivityChart
        points={[
          { t: end - 60_000, chat: 0, seventv: 0, viewers: 100, hasChatRollup: true, bucketComplete: true },
          { t: end, chat: 0, seventv: 0, viewers: 100, bucketComplete: true },
        ]}
        windowMinutes={2}
        channelCount={1}
      />,
    )

    expect(container.querySelectorAll('.gap-fill--chat-rollup')).toHaveLength(0)
  })
})
