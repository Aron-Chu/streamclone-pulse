import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PulseStreamRecap } from '../../apiTypes.ts'
import { StreamRecapPanel } from './StreamRecapPanel.tsx'

afterEach(() => cleanup())

const moments = [{ offsetSeconds: 600, score: 51 }, { offsetSeconds: 1800, score: 42 }]

function panel(recap: PulseStreamRecap, catalog: Parameters<typeof StreamRecapPanel>[0]['topEmotesCatalog'] = []) {
  const { container } = render(<StreamRecapPanel recap={recap} topEmotesCatalog={catalog} />)
  return container.querySelector('[data-stream-recap-panel]')
}

describe('StreamRecapPanel with nothing to show', () => {
  it('draws no card for a recap with moments only (they are listed below it, not in it)', () => {
    expect(panel({ streamId: 's1', topMoments: moments, totalMessages: 0, peakChatPerMin: 0, topEmotes: [] })).toBeNull()
  })

  it('draws the card for any one of totals, a spike, a burst or emotes', () => {
    expect(panel({ streamId: 's1', topMoments: moments, totalMessages: 1200 })).not.toBeNull()
    cleanup()
    expect(panel({ streamId: 's1', topMoments: moments, biggestChatSpike: { offsetSeconds: 600, chatPerMin: 90 } })).not.toBeNull()
    cleanup()
    expect(panel({ streamId: 's1', topMoments: moments, funniestEmoteBurst: { offsetSeconds: 600, code: 'LUL', count: 40 } })).not.toBeNull()
    cleanup()
    expect(panel({ streamId: 's1', topMoments: moments, topEmotes: [{ code: 'LUL', count: 40 }] })).not.toBeNull()
    cleanup()
    // the page's emote list stands in for the recap's own
    expect(panel(
      { streamId: 's1', topMoments: moments },
      [{ key: 'twitch:425618:LUL', name: 'LUL', provider: 'twitch', count: 40 }] as never,
    )).not.toBeNull()
  })

  it('still draws nothing for a spike alone without moments, as before', () => {
    expect(panel({ streamId: 's1', biggestChatSpike: { offsetSeconds: 600, chatPerMin: 90 } })).toBeNull()
  })
})
