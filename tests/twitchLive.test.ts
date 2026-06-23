import { describe, expect, it } from 'vitest'
import { effectivePulseIsLive, pulsePayloadForDisplay } from '../src/ui/effectivePulseLive.ts'
import type { PulsePayload } from '../src/shared/messages.ts'

describe('effectivePulseIsLive', () => {
  const payload: PulsePayload = {
    login: 'test',
    isLive: false,
    tracking: true,
    currentOffsetSeconds: 0,
    rollups: [],
    lanes: { composite: [], chat: [], seventv: [] },
    peaks: [],
    recap: null,
  }

  it('uses Twitch page live on channel pages', () => {
    expect(
      effectivePulseIsLive(payload, true, { kind: 'channel', login: 'test', vodId: null }),
    ).toBe(true)
  })

  it('does not override VOD pages', () => {
    expect(
      effectivePulseIsLive(payload, true, { kind: 'vod', login: 'test', vodId: '1' }),
    ).toBe(false)
  })

  it('clears stale recap for display while backend catches up', () => {
    const withRecap = {
      ...payload,
      recap: {
        streamId: '1',
        login: 'test',
        durationSeconds: 100,
        totalMessages: 1,
        peakChatPerMin: 1,
        topMoments: [],
        topEmotes: [],
        clipCandidates: [],
      },
    }
    const display = pulsePayloadForDisplay(withRecap, true, { kind: 'channel', login: 'test', vodId: null })
    expect(display.isLive).toBe(true)
    expect(display.recap).toBeNull()
  })
})
