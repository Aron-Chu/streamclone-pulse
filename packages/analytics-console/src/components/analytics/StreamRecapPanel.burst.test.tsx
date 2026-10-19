import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StreamRecapPanel } from './StreamRecapPanel.tsx'

afterEach(() => cleanup())

const streamStartedAt = '2026-10-07T00:00:00.000Z'
const xqcLKey = 'seventv:01H0000000000000000000XQCL:xqcL'

describe('StreamRecapPanel emote burst row', () => {
  it('names the same emote, count and time in the chip and the text', () => {
    const { container } = render(
      <StreamRecapPanel
        recap={{
          streamId: 's1',
          totalMessages: 1000,
          // The backend burst is smaller than the busiest rollup minute.
          funniestEmoteBurst: { offsetSeconds: 44_647, code: 'catPls', count: 493 },
        }}
        rollups={[
          { minuteTs: '2026-10-07T03:00:00.000Z', chatCount: 400, emotes: { [xqcLKey]: 534 } },
          { minuteTs: '2026-10-07T03:05:00.000Z', chatCount: 100, emotes: { [xqcLKey]: 20 } },
        ] as never}
        streamStartedAt={streamStartedAt}
      />,
    )
    const row = [...container.querySelectorAll('div, button')].find(element =>
      element.textContent?.includes('Emote burst at') && !element.querySelector('div, button'))!
    expect(row).toBeTruthy()
    const text = row.textContent!.replace(/\s+/g, ' ')
    // One row (d3-v2 session-original): "Emote burst at 3:00:00 [chip]". The
    // chip and the time both describe the rollup peak (xqcL, 534 at 3:00:00).
    expect(text).toContain('Emote burst at 3:00:00')
    const chip = row.querySelector('[data-stream-recap-burst-chip]')!
    expect(chip).toBeTruthy()
    expect(chip.textContent).toContain('xqcL')
    expect(chip.textContent).toContain('534')
    expect(text).not.toContain('catPls')
    expect(text).not.toContain('493')
  })

  it('reads the spike as one row with its rate, and labels the jump buttons in full', () => {
    const onJump = vi.fn()
    const { container } = render(
      <StreamRecapPanel
        recap={{
          streamId: 's1',
          totalMessages: 1000,
          biggestChatSpike: { offsetSeconds: 19_080, chatPerMin: 757 },
          funniestEmoteBurst: { offsetSeconds: 23_280, code: 'BAND', count: 402 },
        }}
        streamStartedAt={streamStartedAt}
        vodId="2899924626"
        vodAlignSeconds={0}
        vodDurationSeconds={40_000}
        onJumpToOffset={onJump}
      />,
    )
    const spike = screen.getByRole('button', { name: 'Biggest spike at 5:18:00, 757 chat messages a minute' })
    expect(spike.textContent!.replace(/\s+/g, ' ')).toBe('Biggest spike at 5:18:00 · 757 chat/min')
    const burst = screen.getByRole('button', { name: 'Emote burst at 6:28:00, BAND, 402 uses' })
    // The chip's letter fallback (no image URL here) is part of its text.
    expect(burst.textContent!.replace(/\s+/g, ' ')).toMatch(/^Emote burst at 6:28:00 B?BAND402$/)
    // The VOD link sits beside each row, not inside the button.
    const vodLinks = [...container.querySelectorAll<HTMLAnchorElement>('[data-stream-recap-row] > a')]
    expect(vodLinks.map(link => link.textContent)).toEqual(['VOD ↗', 'VOD ↗'])
    expect(vodLinks[0]!.className).toContain('text-teal-200')
    expect(vodLinks[0]!.className).not.toMatch(/(^|\s)underline(\s|$)/)
    fireEvent.click(burst)
    expect(onJump).toHaveBeenCalledWith(23_280)
  })

  it('keeps the backend burst when no rollup minute beats it', () => {
    const { container } = render(
      <StreamRecapPanel
        recap={{
          streamId: 's1',
          totalMessages: 1000,
          funniestEmoteBurst: { offsetSeconds: 600, code: 'catPls', count: 493 },
        }}
        rollups={[
          { minuteTs: '2026-10-07T03:00:00.000Z', chatCount: 400, emotes: { [xqcLKey]: 50 } },
        ] as never}
        streamStartedAt={streamStartedAt}
      />,
    )
    const text = container.textContent!.replace(/\s+/g, ' ')
    expect(text).toContain('Emote burst at 0:10:00')
    const chip = container.querySelector('[data-stream-recap-burst-chip]')!
    expect(chip.textContent).toContain('catPls')
    expect(chip.textContent).toContain('493')
  })
})
