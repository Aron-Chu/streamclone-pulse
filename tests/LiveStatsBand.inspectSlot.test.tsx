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

describe('LiveStatsBand inspect slot', () => {
  it('keeps Games Played above Stream Activity and the attached chart footer', () => {
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
    const gamesIdx = markup.indexOf('data-games-played="true"')
    const activityIdx = markup.indexOf('Stream activity')
    const plotIdx = markup.indexOf('Plot emotes')
    expect(gamesIdx).toBeGreaterThan(-1)
    expect(activityIdx).toBeGreaterThan(gamesIdx)
    expect(plotIdx).toBeGreaterThan(activityIdx)
  })

  it('hosts Selected moment under the zoom-hint region, not the compact Jump strip', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={7_200}
        pinOffsetSeconds={128}
        selectedReactionMoment={{
          minuteTs: '2026-06-11T12:02:00.000Z',
          offsetSeconds: 128,
          score: 92,
          reason: 'chat_spike',
          reasonLabel: 'Chat spike',
          chatCount: 40,
          emoteCount: 3,
          topEmotes: [],
          collecting: false,
          seekOffsetSeconds: 124,
        }}
        hasVodContext
        onJumpMoment={vi.fn()}
        onJumpToOffset={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(markup).toContain('data-selected-minute-slot="true"')
    expect(markup).toContain('Selected moment')
    expect(markup).not.toContain('data-chart-minute-card="true"')
    expect(markup).toContain('Plot emotes')
    const slotIdx = markup.indexOf('data-selected-minute-slot="true"')
    const plotIdx = markup.indexOf('Plot emotes')
    expect(slotIdx).toBeGreaterThan(-1)
    expect(slotIdx).toBeGreaterThan(plotIdx)
  })

  it('keeps Selected moment locked when only the reaction moment identity changes', () => {
    const momentA = {
      minuteTs: '2026-06-11T12:02:00.000Z',
      offsetSeconds: 120,
      score: 92,
      reason: 'chat_spike' as const,
      reasonLabel: 'Chat spike',
      chatCount: 40,
      emoteCount: 3,
      topEmotes: [],
      collecting: false,
    }
    const momentB = {
      ...momentA,
      minuteTs: '2026-06-11T12:04:00.000Z',
      offsetSeconds: 240,
      score: 80,
      reason: 'seventv_spike' as const,
      reasonLabel: 'Emote spike',
      chatCount: 22,
      emoteCount: 18,
    }
    const first = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={120}
        selectedReactionMoment={momentA}
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
        selectedReactionMoment={momentB}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    expect(first).toContain('data-selected-minute-slot="true"')
    expect(second).toContain('data-selected-minute-slot="true"')
    expect(first).toContain('Selected moment')
    expect(second).toContain('Selected moment')
    expect(second).toContain('Emote spike')
  })

  it('reserves only the compact inspection footprint while idle', () => {
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
    expect(markup).toContain('data-selected-minute-slot="true"')
    expect(markup).toContain('data-inspection-tray-state="idle"')
    expect(markup).toContain('Hover to preview · click to lock')
    expect(markup).not.toContain('Moment details and top emotes appear here')
    expect(markup).not.toContain('data-chart-minute-card="true"')
  })

  it('does not keep the selected-minute slot sticky over Most Reacted', () => {
    const markup = renderToStaticMarkup(
      <LiveStatsBand
        payload={makePayload([refinedPeak])}
        backendUrl="http://localhost:8081"
        currentOffsetSeconds={600}
        pinOffsetSeconds={128}
        selectedReactionMoment={{
          minuteTs: '2026-06-11T12:02:00.000Z',
          offsetSeconds: 128,
          score: 92,
          reason: 'chat_spike',
          reasonLabel: 'Chat spike',
          chatCount: 40,
          emoteCount: 3,
          topEmotes: [],
          collecting: false,
          seekOffsetSeconds: 124,
        }}
        onJumpMoment={vi.fn()}
        onOpenAnalytics={vi.fn()}
        onPinOffset={vi.fn()}
      />,
    )
    const slotIdx = markup.indexOf('data-selected-minute-slot="true"')
    expect(slotIdx).toBeGreaterThan(-1)
    const slotChunk = markup.slice(slotIdx, slotIdx + 280)
    expect(slotChunk).not.toMatch(/position:\s*sticky/)
    expect(slotChunk).not.toMatch(/z-index:\s*3/)
  })

  it('keeps the chart lock visible while the inspection tray stays truthful for a quiet minute', () => {
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
    expect(markup).toContain('data-selected-minute-slot="true"')
    expect(markup).toContain('data-inspection-tray-state="idle"')
    expect(markup).toContain('data-chart-mode="detail"')
    expect(markup).toContain('data-chart-locked-index="8"')
    expect(markup).not.toContain('data-chart-minute-card="true"')
    expect(markup).toContain('Plot emotes')
  })
})
