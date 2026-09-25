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

  it('keeps ranked rows compact and leaves inspection to the chart', () => {
    const html = renderToStaticMarkup(
      <MostReactedSection
        payload={makePayload({
          peaks: [{
            ...peak,
            topEmotes: [
              { name: 'HyperMegaLongEmoteName', count: 1_234, imageUrl: 'https://cdn.example/long.png' },
              { name: 'LUL', count: 17, imageUrl: 'https://cdn.example/lul.png' },
              { name: 'catJAM', count: 9, imageUrl: 'https://cdn.example/catjam.png' },
              { name: 'fourthHidden', count: 1, imageUrl: 'https://cdn.example/hidden.png' },
            ],
          }],
        })}
        backendUrl="https://api.streampulse.stream"
        pinnedOffsetSeconds={120}
        onJump={() => undefined}
        onAnalytics={() => undefined}
      />,
    )

    expect(html).toContain('aria-label="HyperMegaLongEmoteName"')
    expect(html).toContain('aria-label="LUL"')
    expect(html).toContain('aria-label="catJAM"')
    expect(html).not.toContain('fourthHidden')
    expect(html).not.toContain('data-moment-inspector-card="true"')
    expect(html).not.toContain('data-selected-minute-slot="true"')
  })

  it('omits the emote row entirely when a ranked moment has no breakdown', () => {
    const html = renderToStaticMarkup(
      <MostReactedSection
        payload={makePayload({ peaks: [{ ...peak, topEmotes: [] }] })}
        backendUrl="https://api.streampulse.stream"
        pinnedOffsetSeconds={120}
        onJump={() => undefined}
        onAnalytics={() => undefined}
      />,
    )

    expect(html).not.toContain('data-moment-inspector-card="true"')
    expect(html).not.toContain('No emote breakdown')
  })

  it('marks only the exact pinned row when two moments are within 90 seconds', () => {
    const html = renderToStaticMarkup(
      <MostReactedSection
        payload={makePayload({
          isLive: false,
          peaks: [
            peak,
            { ...peak, offsetSeconds: 180, score: 88, reasons: ['emote_spike'], reasonLabel: 'Emote spike' },
          ],
        })}
        backendUrl="https://api.streampulse.stream"
        pinnedOffsetSeconds={180}
        onJump={() => undefined}
        onAnalytics={() => undefined}
      />,
    )

    expect((html.match(/aria-pressed="true"/g) ?? [])).toHaveLength(1)
    expect(html).toContain('aria-label="Select minute bucket 00:03')
    expect(html).not.toContain('Approx.')
    expect(html).not.toContain('approximately')
  })

  it('shows an honest empty state when no peak contract or derived moment exists', () => {
    const html = renderSection(makePayload({
      peaks: undefined,
      rollups: [],
    }))

    expect(html).toContain('data-most-reacted-state="empty"')
    expect(html).toContain('No reaction moments yet')
  })

  it('highlights the selected row without duplicating the chart inspector', () => {
    const idle = renderSection(makePayload({ peaks: [peak] }))
    const active = renderToStaticMarkup(
      <MostReactedSection
        payload={makePayload({ peaks: [peak] })}
        backendUrl="https://api.streampulse.stream"
        pinnedOffsetSeconds={120}
        onJump={() => undefined}
        onAnalytics={() => undefined}
      />,
    )

    expect(idle).not.toContain('data-moment-inspector-card="true"')
    expect(active).not.toContain('data-moment-inspector-card="true"')
    expect(active.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(active).toContain('data-most-reacted-count="true"')
    expect(active).toContain('Top moments')
  })

  it('uses a stacked metadata row for the narrow Most Reacted header', () => {
    const html = renderSection(makePayload({ peaks: [peak] }))

    expect(html).toContain('data-pulse-section-heading="stacked"')
    expect(html).toContain('data-pulse-section-meta="true"')
    expect(html).toContain('data-most-reacted-count="true"')
    expect(html).toContain('Top moments')
    expect(html).toContain('Chat and emote spikes')
  })

  it('marks the list disclosure as a chart action so it preserves a locked minute', () => {
    const html = renderSection(makePayload({
      peaks: Array.from({ length: 12 }, (_, index) => ({
        ...peak,
        offsetSeconds: index * 60,
        score: 100 - index,
      })),
    }))

    expect(html).toContain('data-most-reacted-expand="true"')
    expect(html).toContain('data-chart-action="true"')
    expect(html).toContain('aria-expanded="false"')
  })
})
