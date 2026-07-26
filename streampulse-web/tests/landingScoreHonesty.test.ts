import { describe, expect, it } from 'vitest'
import {
  buildExtModel,
  buildLiveSignalModel,
  buildPreview,
} from '../src/ui/components/landing/landingData'
import type { PublicHub } from '../src/lib/publicHub'
import { resolveLivePulseMoments } from '../src/lib/figmaSessionAnalytics'

function hubWithMoments(): PublicHub {
  return {
    generatedAt: new Date().toISOString(),
    poolSize: 3,
    corpus: {} as PublicHub['corpus'],
    coverage: {} as PublicHub['coverage'],
    activity: {
      windowMinutes: 30,
      channelCount: 1,
      points: Array.from({ length: 12 }, (_, i) => ({
        t: Date.now() - (12 - i) * 60_000,
        chat: 100 + i * 40,
        emotes: 40 + i * 10,
        seventv: 20 + i * 5,
        viewers: 1000 + i * 20,
      })),
    },
    emoteIntel: {} as PublicHub['emoteIntel'],
    topEmotes: [{ name: 'KEKW', count: 12, sharePct: 40 }],
    topMovers: [],
    liveChannels: [
      {
        login: 'xqc',
        displayName: 'xQc',
        viewers: 1200,
        chatPerMin: 80,
        seventvPerMin: 40,
        emotesPerMin: 55,
        trendPct: 4,
        category: 'Just Chatting',
      },
    ],
    moments: [
      {
        kind: 'chat_spike',
        login: 'xqc',
        label: 'Chat surging',
        detail: 'KEKW',
        magnitude: 86,
        at: Math.floor(Date.now() / 1000),
      },
    ],
    livePulseMoments: [],
    featuredSession: { state: 'empty', reason: 'no_qualifying_session' },
  } as unknown as PublicHub
}

describe('landing score honesty', () => {
  it('does not invent Pulse / moment scores from hub magnitude or chat/emote rates', () => {
    const hub = hubWithMoments()
    const preview = buildPreview(hub)
    const ext = buildExtModel(hub)
    const live = buildLiveSignalModel(hub)

    expect(preview.moments[0]).not.toHaveProperty('score')
    expect(ext.reacted[0]).not.toHaveProperty('score')
    expect(live?.moments[0]).not.toHaveProperty('score')
    expect(live?.featuredMoment).not.toHaveProperty('score')
  })

  it('never labels client-derived landing values as Pulse score or moment score', () => {
    const hub = hubWithMoments()
    const serialized = JSON.stringify({
      preview: buildPreview(hub),
      ext: buildExtModel(hub),
      live: buildLiveSignalModel(hub),
    })
    expect(serialized.toLowerCase()).not.toMatch(/pulse score|moment score/)
  })
})

describe('hub moments fallback score honesty', () => {
  it('does not map hub magnitude into a reaction / Pulse score', () => {
    const hub = hubWithMoments()
    const result = resolveLivePulseMoments(hub)
    expect(result.source).toBe('legacy_fallback')
    expect(result.moments[0]?.score).toBeUndefined()
    expect(result.moments[0]?.score).not.toBe(86)
  })
})
