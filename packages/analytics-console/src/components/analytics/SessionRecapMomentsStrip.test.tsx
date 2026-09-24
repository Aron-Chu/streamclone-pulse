import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SessionRecapMomentsStrip } from './SessionRecapMomentsStrip.tsx'

describe('SessionRecapMomentsStrip analytical identity', () => {
  it('shows the exact minute statistics and pins the review above the list', () => {
    render(
      <SessionRecapMomentsStrip
        recap={{ streamId: 'stream-1', topMoments: [{
          offsetSeconds: 600, score: 27, reasons: ['emote_spike'],
          chatCount: 641, emoteCount: 22,
          topEmotes: [{ code: 'StaleSnapshot', count: 10 }],
        }] }}
        rollups={[{ minuteTs: '2026-09-08T18:10:00Z', chatCount: 416,
          totalEmoteCount: 94, emotes: { stabeBlue: 71 } }]}
        streamStartedAt="2026-09-08T18:00:00Z"
        selectedOffsetSeconds={600}
        onSelectOffset={vi.fn()}
        selectedDetail={<a href="https://www.twitch.tv/videos/123?t=9m56s">Watch source</a>}
      />,
    )
    const row = screen.getByRole('button', { name: /416 chat\/min/ })
    expect(row.textContent).toContain('94 emotes/min')
    expect(row.textContent).not.toContain('641')
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByTitle('StaleSnapshot: 10 uses')).toBeNull()
    expect(screen.getByTitle('stabeBlue: 71 uses')).toBeTruthy()

    // The review card is pinned above the scrolling list, not injected between
    // rows — expanding in place reflowed every lower-ranked row on each click.
    const pinned = document.querySelector('[data-moment-review-pinned]')
    expect(pinned?.textContent).toContain('Watch source')
    expect(pinned!.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(row.nextElementSibling).toBeNull()
  })

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
