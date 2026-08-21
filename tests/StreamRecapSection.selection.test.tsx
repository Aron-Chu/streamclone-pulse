import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ExtensionPeak, PulsePayload, PulseStreamRecap } from '../src/shared/messages.ts'
import { StreamRecapSection } from '../src/ui/StreamRecapSection.tsx'

const rankedPeak: ExtensionPeak = {
  offsetSeconds: 185,
  score: 91,
  reasons: ['emote_spike'],
  reasonLabel: 'Emote spike',
  dominantSignal: 'emote',
  chatCount: 80,
  emoteCount: 42,
}

function makePayload(recap: PulseStreamRecap | null): PulsePayload {
  return {
    login: 'fixturechan',
    isLive: false,
    tracking: false,
    streamId: 'stream-offline-selection',
    startedAt: '2026-08-15T12:00:00.000Z',
    endedAt: '2026-08-15T12:12:00.000Z',
    durationSeconds: 720,
    currentOffsetSeconds: 720,
    rollups: Array.from({ length: 12 }, (_, index) => ({
      offsetSeconds: index * 60,
      chatCount: 20 + index,
      sevenTvEmoteCount: 3 + index,
      totalEmoteCount: 5 + index,
      viewerAvg: 1_000 + index * 10,
      viewerSamples: 1,
    })),
    lanes: { composite: [], chat: [], seventv: [] },
    peaks: [rankedPeak],
    topEmotes: [],
    recap,
    games: [],
  }
}

function renderRecap(payload: PulsePayload): string {
  return renderToStaticMarkup(
    <StreamRecapSection
      payload={payload}
      backendUrl="https://api.streampulse.stream"
      uiState="ready"
      isLive={false}
      onJump={vi.fn()}
      onAnalytics={vi.fn()}
      onOpenAnalytics={vi.fn()}
    />,
  )
}

describe('StreamRecapSection selection defaults', () => {
  it('lists recap Top moments without pinning the highest-ranked moment', () => {
    const recap: PulseStreamRecap = {
      streamId: 'stream-offline-selection',
      login: 'fixturechan',
      durationSeconds: 720,
      totalMessages: 360,
      peakChatPerMin: 80,
      topMoments: [{
        offsetSeconds: rankedPeak.offsetSeconds,
        score: rankedPeak.score,
        reasons: rankedPeak.reasons,
        chatCount: rankedPeak.chatCount,
        emoteCount: rankedPeak.emoteCount,
      }],
      topEmotes: [],
      clipCandidates: [],
    }

    const markup = renderRecap(makePayload(recap))
    expect(markup).toContain('Top moments')
    expect(markup).not.toContain('Selected moment')
    expect(markup).toContain('data-chart-pinned="false"')
  })

  it('keeps the offline fallback unselected even when ranked peaks exist', () => {
    const markup = renderRecap(makePayload(null))
    expect(markup).toContain('Top moments')
    expect(markup).not.toContain('Selected moment')
    expect(markup).toContain('data-chart-pinned="false"')
  })
})
