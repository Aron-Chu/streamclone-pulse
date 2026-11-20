import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamEdgesFor } from '@streampulse/pulse-core'
import { StreamRecapPanel } from './StreamRecapPanel.tsx'

afterEach(() => cleanup())

// A stream that started at 12:00:28 has its first full chat minute at 12:01:00, so the backend's recap
// offset for that minute is 32 s. The figure's time is the second its VOD link seeks to.
const edges = streamEdgesFor(3 * 60 * 60, true)

function renderSpike(offsetSeconds: number, withJump: boolean) {
  return render(
    <StreamRecapPanel
      recap={{
        streamId: 's1',
        totalMessages: 4_200,
        biggestChatSpike: { offsetSeconds, chatPerMin: 180 },
        funniestEmoteBurst: { offsetSeconds, code: 'catJAM', count: 90 },
      }}
      vodId="900000001"
      vodAlignSeconds={0}
      vodDurationSeconds={4 * 60 * 60}
      streamEdges={edges}
      onJumpToOffset={withJump ? vi.fn() : undefined}
    />,
  )
}

function rowText(container: HTMLElement, startsWith: string): string {
  const row = [...container.querySelectorAll('div, button')].find(element =>
    element.textContent?.includes(startsWith) && !element.querySelector('div, button'))!
  expect(row).toBeTruthy()
  return row.textContent!.replace(/\s+/g, ' ')
}

describe('StreamRecapPanel figure clock', () => {
  it('shows the second the VOD link seeks to, not the minute floor', () => {
    const { container } = renderSpike(32, true)
    expect(rowText(container, 'Biggest spike at')).toContain('Biggest spike at about 0:00:32')
    expect(rowText(container, 'Emote burst at')).toContain('Emote burst at about 0:00:32')
    const vodLinks = [...container.querySelectorAll<HTMLAnchorElement>('a')].map(a => a.href)
    expect(vodLinks).toEqual([
      'https://www.twitch.tv/videos/900000001?t=32s',
      'https://www.twitch.tv/videos/900000001?t=32s',
    ])
    expect(screen.getByRole('button', { name: 'Biggest spike at about 0:00:32, 180 chat messages a minute' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Emote burst at about 0:00:32, catJAM, 90 uses' })).toBeTruthy()
  })

  it('keeps the second inside a later minute too', () => {
    const { container } = renderSpike(92, false)
    expect(rowText(container, 'Biggest spike at')).toContain('Biggest spike at about 0:01:32')
    const timeLink = container.querySelector<HTMLAnchorElement>('[data-stream-recap-highlights] a')!
    expect(timeLink.textContent).toBe('0:01:32')
    expect(timeLink.href).toBe('https://www.twitch.tv/videos/900000001?t=1m32s')
  })

  it('says Stream start only at 0', () => {
    const atZero = renderSpike(0, true)
    expect(rowText(atZero.container, 'Biggest spike at')).toContain('Biggest spike at about 0:00:00')
    const tags = [...atZero.container.querySelectorAll('[data-stream-recap-edge]')].map(tag => tag.textContent)
    expect(tags).toEqual(['Stream start', 'Stream start'])
    expect(screen.getByRole('button', { name: 'Biggest spike at about 0:00:00, Stream start, 180 chat messages a minute' })).toBeTruthy()
    cleanup()

    const inOpeningMinutes = renderSpike(32, true)
    expect(inOpeningMinutes.container.querySelector('[data-stream-recap-edge]')).toBeNull()
    expect(rowText(inOpeningMinutes.container, 'Biggest spike at')).not.toContain('Stream start')
  })

  it('keeps an exact onset exact and tags Stream start by the second it shows', () => {
    const { container } = render(
      <StreamRecapPanel
        recap={{
          streamId: 's1',
          totalMessages: 4_200,
          biggestChatSpike: { offsetSeconds: 0, chatPerMin: 180 },
          funniestEmoteBurst: {
            offsetSeconds: 0, code: 'catJAM', count: 90, reactionOnsetOffsetSeconds: 13, precisionSeconds: 1,
          } as never,
        }}
        vodId="900000001"
        vodAlignSeconds={0}
        vodDurationSeconds={4 * 60 * 60}
        streamEdges={edges}
        onJumpToOffset={vi.fn()}
      />,
    )
    expect(rowText(container, 'Emote burst at')).toContain('Emote burst at 0:00:13')
    expect(screen.getByRole('button', { name: 'Emote burst at 0:00:13, catJAM, 90 uses' })).toBeTruthy()
    const tags = [...container.querySelectorAll('[data-stream-recap-edge]')].map(tag => tag.textContent)
    expect(tags).toEqual(['Stream start'])
  })

  it('keeps the Stream end tag in the closing minutes', () => {
    const { container } = renderSpike(3 * 60 * 60 - 60, true)
    expect(rowText(container, 'Biggest spike at')).toContain('Biggest spike at about 2:59:00')
    const tags = [...container.querySelectorAll('[data-stream-recap-edge]')].map(tag => tag.textContent)
    expect(tags).toEqual(['Stream end', 'Stream end'])
  })
})
