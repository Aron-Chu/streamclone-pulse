import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ExtensionPeak, PulsePayload } from '../src/shared/messages.ts'
import { MostReactedSection } from '../src/ui/MostReactedSection.tsx'

function makePayload(peaks: ExtensionPeak[]): PulsePayload {
  return {
    login: 'test',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 600,
    startedAt: '2026-06-11T12:00:00.000Z',
    rollups: Array.from({ length: 8 }, (_, i) => ({
      offsetSeconds: i * 60,
      chatCount: 20 + i,
      sevenTvEmoteCount: 4,
      totalEmoteCount: 8 + i,
    })),
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    peaks,
  }
}

const peaks: ExtensionPeak[] = [
  {
    offsetSeconds: 120,
    score: 92,
    reasons: ['chat_spike'],
    reasonLabel: 'Chat spike',
    dominantSignal: 'chat',
    chatCount: 40,
    emoteCount: 3,
  },
  {
    offsetSeconds: 240,
    score: 80,
    reasons: ['seventv_spike'],
    reasonLabel: 'Emote spike',
    dominantSignal: 'seventv',
    chatCount: 22,
    emoteCount: 18,
  },
]

describe('MostReactedSection layout', () => {
  it('lists Top Moments without hosting Selected moment (LiveStatsBand owns that card)', () => {
    const markup = renderToStaticMarkup(
      <MostReactedSection
        payload={makePayload(peaks)}
        backendUrl="http://localhost:8081"
        pinnedOffsetSeconds={120}
        onPinOffset={vi.fn()}
        onSelectMoment={vi.fn()}
      />,
    )
    expect(markup).not.toContain('Selected moment')
    expect(markup).not.toContain('Selected minute')
    expect(markup).toContain('pulse-moment-row-button')
    expect(markup).toContain('pulse-moment-row-selected')
    expect(markup).toContain('pulse-moment-row')
    expect((markup.match(/aria-pressed="true"/g) ?? [])).toHaveLength(1)
    expect((markup.match(/aria-pressed="false"/g) ?? [])).toHaveLength(1)
  })
})
