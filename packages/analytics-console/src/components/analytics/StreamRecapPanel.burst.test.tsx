import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
    // Chip, time and text all describe the rollup peak (xqcL, 534 at 03:00:00).
    expect(text).toContain('xqcL')
    expect(text).toContain('03:00:00')
    expect(text).toContain('· xqcL (534)')
    expect(text).not.toContain('catPls')
    expect(text).not.toContain('493')
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
    expect(text).toContain('· catPls (493)')
    expect(text).toContain('00:10:00')
  })
})
