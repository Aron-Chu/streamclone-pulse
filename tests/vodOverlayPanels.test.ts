import { describe, expect, it } from 'vitest'
import { shouldShowVodMissingCard, vodPageShowsLiveChart } from '../src/ui/vodOverlayPanels.ts'

describe('shouldShowVodMissingCard', () => {
  it('hides the empty Replay Pulse card when live analytics are already on the VOD page', () => {
    expect(shouldShowVodMissingCard({
      isVodPage: true,
      hasRecapPanel: false,
      showingLiveAnalytics: true,
    })).toBe(false)
  })

  it('hides the empty card when recap is showing', () => {
    expect(shouldShowVodMissingCard({
      isVodPage: true,
      hasRecapPanel: true,
      showingLiveAnalytics: false,
    })).toBe(false)
  })

  it('shows the empty card only when the VOD page has no recap and no live analytics', () => {
    expect(shouldShowVodMissingCard({
      isVodPage: true,
      hasRecapPanel: false,
      showingLiveAnalytics: false,
    })).toBe(true)
  })

  it('keeps the missing card when this VOD is unindexed even if another recap is on screen', () => {
    expect(shouldShowVodMissingCard({
      isVodPage: true,
      hasRecapPanel: true,
      showingLiveAnalytics: false,
      vodCoverageStatus: 'missing',
    })).toBe(true)
  })
})

describe('vodPageShowsLiveChart', () => {
  it('shows the live chart on a VOD when Pulse already has rollups', () => {
    expect(vodPageShowsLiveChart({
      login: 'xqc',
      isLive: true,
      tracking: true,
      currentOffsetSeconds: 600,
      rollups: [{ offsetSeconds: 0, chatCount: 4, sevenTvEmoteCount: 1, totalEmoteCount: 1 }],
      lanes: { composite: [], chat: [], seventv: [] },
      recap: null,
    })).toBe(true)
  })

  it('does not treat a finished recap as a live chart', () => {
    expect(vodPageShowsLiveChart({
      login: 'xqc',
      isLive: false,
      tracking: false,
      currentOffsetSeconds: 600,
      rollups: [{ offsetSeconds: 0, chatCount: 4, sevenTvEmoteCount: 1, totalEmoteCount: 1 }],
      lanes: { composite: [], chat: [], seventv: [] },
      recap: {
        streamId: '1',
        login: 'xqc',
        durationSeconds: 600,
        totalMessages: 4,
        peakChatPerMin: 4,
        topMoments: [],
        topEmotes: [],
        clipCandidates: [],
      },
    })).toBe(false)
  })
})
