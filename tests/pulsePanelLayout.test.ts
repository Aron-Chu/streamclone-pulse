import { describe, expect, it } from 'vitest'
import { resolvePulsePanelSections } from '../src/ui/pulsePanelLayout.ts'
import type { PulsePayload } from '../src/shared/messages.ts'

function basePayload(overrides: Partial<PulsePayload> = {}): PulsePayload {
  return {
    login: 'test',
    isLive: true,
    tracking: true,
    currentOffsetSeconds: 600,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    peaks: [],
    recap: null,
    ...overrides,
  }
}

describe('resolvePulsePanelSections', () => {
  it('shows live band and most reacted on live streams', () => {
    const sections = resolvePulsePanelSections(basePayload(), {
      liveHeatVisible: true,
      warming: false,
    })
    expect(sections.showLiveStatsBand).toBe(true)
    expect(sections.showMostReacted).toBe(true)
    expect(sections.showRecap).toBe(false)
    expect(sections.showWarming).toBe(false)
  })

  it('does not show recap on live streams even if recap payload is stale', () => {
    const sections = resolvePulsePanelSections(
      basePayload({
        recap: {
          streamId: '1',
          login: 'test',
          durationSeconds: 3600,
          totalMessages: 100,
          peakChatPerMin: 40,
          topMoments: [{ offsetSeconds: 60, score: 95, reasons: ['chat_spike'] }],
          topEmotes: [{ code: 'KEKW', count: 10, provider: 'seventv' }],
          clipCandidates: [],
        },
      }),
      { liveHeatVisible: true, warming: false },
    )
    expect(sections.showRecap).toBe(false)
    expect(sections.showMostReacted).toBe(true)
  })

  it('shows recap only when stream ended', () => {
    const sections = resolvePulsePanelSections(
      basePayload({
        isLive: false,
        recap: {
          streamId: '1',
          login: 'test',
          durationSeconds: 3600,
          totalMessages: 100,
          peakChatPerMin: 40,
          topMoments: [{ offsetSeconds: 60, score: 95, reasons: ['chat_spike'] }],
          topEmotes: [{ code: 'KEKW', count: 10 }],
          clipCandidates: [],
        },
      }),
      { liveHeatVisible: false, warming: false },
    )
    expect(sections.showRecap).toBe(true)
    expect(sections.showLiveStatsBand).toBe(false)
    expect(sections.showMostReacted).toBe(false)
  })

  it('shows warming on live streams before heat is visible', () => {
    const sections = resolvePulsePanelSections(basePayload(), {
      liveHeatVisible: false,
      warming: true,
    })
    expect(sections.showWarming).toBe(true)
    expect(sections.showMostReacted).toBe(false)
    expect(sections.showRecap).toBe(false)
  })

  it('treats Twitch page live as live even when backend is stale', () => {
    const sections = resolvePulsePanelSections(
      basePayload({ isLive: false, recap: null }),
      { liveHeatVisible: false, warming: true, pageIsLive: true },
    )
    expect(sections.showLiveStatsBand).toBe(true)
    expect(sections.showOffline).toBe(false)
    expect(sections.showRecap).toBe(false)
  })

  it('does not show offline block; past streams section handles offline context', () => {
    const sections = resolvePulsePanelSections(
      basePayload({ isLive: false, tracking: false, recap: null }),
      { liveHeatVisible: false, warming: false, pageIsLive: false },
    )
    expect(sections.showOffline).toBe(false)
  })
})
