import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionRecapMomentsStrip } from './SessionRecapMomentsStrip.tsx'

describe('SessionRecapMomentsStrip analytical identity', () => {
  it('uses analytical offsets for display selection and hover', () => {
    const onSelectOffset = vi.fn()
    const onPreviewOffset = vi.fn()
    render(
      <SessionRecapMomentsStrip
        recap={{
          streamId: 'stream-1',
          topMoments: [
            {
              offsetSeconds: 600,
              reactionOnsetOffsetSeconds: 608,
              seekOffsetSeconds: 580,
              precisionSeconds: 1,
              score: 90,
              reasons: ['chat_spike'],
              chatCount: 100,
            },
          ],
        }}
        selectedOffsetSeconds={0}
        onSelectOffset={onSelectOffset}
        onPreviewOffset={onPreviewOffset}
      />,
    )

    const row = screen.getByText('Chat spike').closest('button')
    expect(row).not.toBeNull()
    fireEvent.mouseEnter(row!)
    fireEvent.click(row!)

    expect(onPreviewOffset).toHaveBeenCalledWith(608)
    expect(onSelectOffset).toHaveBeenCalledWith(608)
    expect(screen.getByText('00:10:08')).toBeTruthy()
  })
})
