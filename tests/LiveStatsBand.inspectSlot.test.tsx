import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ExtensionPeak, PulsePayload } from '../src/shared/messages.ts'
import { LiveStatsBand } from '../src/ui/LiveStatsBand.tsx'

function makePayload(peaks: ExtensionPeak[]): PulsePayload {
  return {
    login: 'test',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 600,
    startedAt: '2026-06-11T12:00:00.000Z',
    rollups: Array.from({ length: 10 }, (_, i) => ({
      offsetSeconds: i * 60,
      chatCount: 20 + i,
      sevenTvEmoteCount: 4,
      totalEmoteCount: 8 + i,
    })),
    lanes: { composite: [], chat: [], seventv: [] },
    recap: null,
    peaks,
    topEmotes: [{ id: '1', name: 'KEKW', count: 12 }],
  }
}

const refinedPeak: ExtensionPeak = {
  offsetSeconds: 120,
  score: 92,
  reasons: ['chat_spike'],
  reasonLabel: 'Chat spike',
  dominantSignal: 'chat',
  chatCount: 40,
  emoteCount: 3,
  precisionSeconds: 1,
  reactionOnsetOffsetSeconds: 128,
  seekOffsetSeconds: 124,
}

describe('LiveStatsBand chart layout', () => {
  it('keeps Stream Activity, Games Played, chart, and picker in order', () => {
    const payload = makePayload([refinedPeak])
    payload.games = [
      {
        id: 'game-1',
        categoryId: '509658',
        gameName: 'Just Chatting',
        offsetSeconds: 0,
        durationSeconds: 600,
      },
      {
        id: 'game-2',
        categoryId: '516575',
        gameName: 'VALORANT',
        offsetSeconds: 480,
        durationSeconds: 120,
      },
    ]
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={payload}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={null}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    const activityIdx = markup.indexOf('Stream activity')
    const gamesIdx = markup.indexOf('data-games-played="true"')
    const chartIdx = markup.indexOf('data-testid="pulse-overview-chart"')
    const plotIdx = markup.indexOf('Plot on chart')
    expect(activityIdx).toBeGreaterThan(-1)
    expect(gamesIdx).toBeGreaterThan(-1)
    expect(chartIdx).toBeGreaterThan(-1)
    expect(plotIdx).toBeGreaterThan(-1)
    expect(activityIdx).toBeLessThan(gamesIdx)
    expect(gamesIdx).toBeLessThan(chartIdx)
    expect(chartIdx).toBeLessThan(plotIdx)
  })

  it('pins the chart index without rendering the removed legacy moment tray', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={7_200}
        pinOffsetSeconds={128}
        hasVodContext
        onJumpMoment={vi.fn()}
        onJumpToOffset={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-locked-index="2"')
    expect(markup).toContain('data-chart-scrubber="true"')
    expect(markup).not.toContain('data-chart-minute-card="true"')
    expect(markup).toContain('Plot on chart')
  })

  it('updates the pinned chart index when the selected offset changes', () => {
    const first = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={120}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    const second = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={240}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(first).toContain('data-chart-locked-index="2"')
    expect(second).toContain('data-chart-locked-index="4"')
  })

  it('keeps the chart scrubber available while idle', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={null}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-scrubber="true"')
    expect(markup).toContain('data-chart-mode="signals"')
    expect(markup).not.toContain('data-chart-minute-card="true"')
  })

  it('does not add a sticky legacy inspection slot over Most Reacted', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={128}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).not.toContain('data-selected-minute-slot="true"')
    expect(markup).not.toContain('data-chart-minute-card="true"')
  })

  it('keeps the chart lock visible for a quiet minute', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={480}
        hasVodContext
        onJumpMoment={vi.fn()}
        onJumpToOffset={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-chart-scrubber="true"')
    expect(markup).toContain('data-chart-mode="detail"')
    expect(markup).toContain('data-chart-locked-index="8"')
    expect(markup).not.toContain('data-chart-minute-card="true"')
    expect(markup).toContain('Plot on chart')
  })
})
