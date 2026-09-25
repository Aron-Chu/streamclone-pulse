import { describe, expect, it } from 'vitest'
import {
  pulseSurfaceStatusLabel,
  resolvePulsePanelSections,
  resolvePulsePanelSurfaceState,
} from '../src/ui/pulsePanelLayout.ts'
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
      pulseLiveAccess: 'full_live',
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

  it('treats Twitch page live as live for tracked channels when backend is stale', () => {
    const sections = resolvePulsePanelSections(
      basePayload({ isLive: false, recap: null }),
      { liveHeatVisible: false, warming: true, pageIsLive: true, pulseLiveAccess: 'full_live' },
    )
    expect(sections.showLiveStatsBand).toBe(true)
    expect(sections.showWarming).toBe(true)
    expect(sections.showOffline).toBe(false)
    expect(sections.showRecap).toBe(false)
  })

  it('shows Pulse Lite warming only when untracked despite stale peaks', () => {
    const sections = resolvePulsePanelSections(
      basePayload({
        tracking: false,
        isLive: true,
        peaks: [{ offsetSeconds: 60, score: 95, reason: 'chat_spike', chatCount: 100, emoteCount: 50 }],
      }),
      { liveHeatVisible: true, warming: false, pageIsLive: true },
    )
    expect(sections.showLiveStatsBand).toBe(false)
    expect(sections.showMostReacted).toBe(false)
    expect(sections.showWarming).toBe(true)
  })

  it('shows recap when finished recap exists even if Twitch page looks live', () => {
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
      { liveHeatVisible: true, warming: false, pageIsLive: true },
    )
    expect(sections.showRecap).toBe(true)
    expect(sections.showLiveStatsBand).toBe(false)
    expect(sections.showMostReacted).toBe(false)
  })

  it('keeps late tracked rollups chart-visible when access is late_session', () => {
    const sections = resolvePulsePanelSections(basePayload(), {
      liveHeatVisible: true,
      warming: false,
      pulseLiveAccess: 'late_session',
    })
    expect(sections.showLiveStatsBand).toBe(true)
    expect(sections.showMostReacted).toBe(true)
  })

  it('shows an explicit offline state when no recap exists', () => {
    const sections = resolvePulsePanelSections(
      basePayload({ isLive: false, tracking: false, recap: null }),
      { liveHeatVisible: false, warming: false, pageIsLive: false },
    )
    expect(sections.surfaceState).toBe('offline_empty')
    expect(sections.showOffline).toBe(true)
  })
})

describe('resolvePulsePanelSurfaceState', () => {
  it.each([
    ['loading', { payload: null, error: null }],
    ['error', { payload: null, error: 'request failed' }],
    ['identity_mismatch', { payload: basePayload({ resolutionState: 'identity_mismatch' }) }],
    ['unsupported', { payload: basePayload(), pulseSupported: false }],
    ['live_tracked', { payload: basePayload(), pulseLiveAccess: 'full_live' as const }],
    ['live_late', { payload: basePayload(), pulseLiveAccess: 'late_session' as const }],
    ['live_untracked', { payload: basePayload(), pulseLiveAccess: 'not_tracked' as const }],
    ['offline_recap', {
      payload: basePayload({
        isLive: false,
        recap: { streamId: '1', login: 'test', durationSeconds: 60, totalMessages: 1, peakChatPerMin: 1, topMoments: [], topEmotes: [], clipCandidates: [] },
      }),
      pulseLiveAccess: 'offline' as const,
    }],
    ['offline_empty', { payload: basePayload({ isLive: false, recap: null }), pulseLiveAccess: 'offline' as const }],
  ] as const)('resolves %s without a blank fall-through', (expected, input) => {
    expect(resolvePulsePanelSurfaceState(input)).toBe(expected)
  })

  it('treats broadcaster mismatch errors as identity state even with a cached payload', () => {
    expect(resolvePulsePanelSurfaceState({
      payload: basePayload(),
      error: '409 broadcaster_mismatch',
      pulseLiveAccess: 'full_live',
    })).toBe('identity_mismatch')
  })

  it('reserves Not tracked for genuine live-untracked state', () => {
    expect(pulseSurfaceStatusLabel('live_untracked')).toBe('Not tracked')
    expect(pulseSurfaceStatusLabel('offline_empty')).not.toBe('Not tracked')
    expect(pulseSurfaceStatusLabel('offline_recap')).toBe('Replay ready')
    expect(pulseSurfaceStatusLabel('error')).toBe('Unavailable')
  })
})
