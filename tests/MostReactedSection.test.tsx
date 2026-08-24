import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ExtensionPeak, PulsePayload } from '../src/shared/messages.ts'
import { MostReactedSection } from '../src/ui/MostReactedSection.tsx'

function makePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'test',
    streamId: 'stream-1',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 600,
    startedAt: '2026-06-11T12:00:00.000Z',
    rollups: Array.from({ length: 7 }, (_, index) => ({
      offsetSeconds: index * 60,
      chatCount: 10 + index,
      sevenTvEmoteCount: 2,
      totalEmoteCount: 4 + index,
    })),
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    ...overrides,
  }
}

function renderSection(payload: PulsePayload): string {
  return renderToStaticMarkup(
    <MostReactedSection
      payload={payload}
      backendUrl="https://api.streampulse.stream"
      onJump={() => undefined}
      onSave={() => undefined}
      onAnalytics={() => undefined}
    />,
  )
}

const peak: ExtensionPeak = {
  offsetSeconds: 120,
  score: 92,
  reasons: ['chat_spike'],
  reasonLabel: 'Chat spike',
  dominantSignal: 'chat',
  chatCount: 40,
  emoteCount: 3,
}

describe('MostReactedSection', () => {
  it('keeps an explicit empty-peaks response visible as a collecting state', () => {
    const html = renderSection(makePayload({ peaks: [] }))

    expect(html).toContain('data-testid="most-reacted-status"')
    expect(html).toContain('data-most-reacted-state="collecting"')
    expect(html).toContain('Collecting reaction moments')
    expect(html).toContain('7 completed minutes recorded.')
  })

  it('renders ranked moments when authoritative peaks are present', () => {
    const html = renderSection(makePayload({ peaks: [peak] }))

    expect(html).not.toContain('data-testid="most-reacted-status"')
    expect(html).toContain('Chat spike')
    expect(html).toContain('pulse-moment-row-button')
  })

  it('shows an honest empty state when no peak contract or derived moment exists', () => {
    const html = renderSection(makePayload({
      peaks: undefined,
      rollups: [],
    }))

    expect(html).toContain('data-most-reacted-state="empty"')
    expect(html).toContain('No reaction moments yet')
  })

  it('keeps a compact inspection slot mounted so selecting a moment cannot move the list', () => {
    const idle = renderSection(makePayload({ peaks: [peak] }))
    const active = renderToStaticMarkup(
      <MostReactedSection
        payload={makePayload({ peaks: [peak] })}
        backendUrl="https://api.streampulse.stream"
        pinnedOffsetSeconds={120}
        onJump={() => undefined}
        onSave={() => undefined}
        onAnalytics={() => undefined}
      />,
    )

    expect(idle).toContain('data-selected-minute-slot="true"')
    expect(active).toContain('data-selected-minute-slot="true"')
    expect(idle).toContain('data-inspection-tray-state="idle"')
    expect(active).toContain('data-inspection-tray-state="active"')
    expect(active).toContain('Clear selected moment')
    expect(active).toContain('height:72px')
  })
})
