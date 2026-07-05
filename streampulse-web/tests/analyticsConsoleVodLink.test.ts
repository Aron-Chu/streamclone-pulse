import { describe, expect, it } from 'vitest'
import {
  buildTwitchVodUrl,
  resolveAnalyticsVodId,
  resolveVodLinkState,
} from '../../../twitch-7tv-clone/packages/analytics-console/src/utils/twitchVodUrl.ts'

describe('resolveAnalyticsVodId', () => {
  it('falls back to recap vod id when stream detail has none', () => {
    expect(
      resolveAnalyticsVodId(
        { vodId: undefined, stream: { vodId: '1' } },
        '2809816759',
      ),
    ).toBe('2809816759')
  })
})

describe('resolveVodLinkState', () => {
  it('links when vod id is on stream detail', () => {
    const state = resolveVodLinkState({
      detail: {
        vodId: '123',
        stream: { vodId: '123', endedAt: null },
      },
    })
    expect(state.status).toBe('linked')
    expect(state.vodId).toBe('123')
    expect(buildTwitchVodUrl(state.vodId!, 125)).toContain('123')
    expect(buildTwitchVodUrl(state.vodId!, 125)).toContain('t=2m5s')
  })

  it('explains live sessions without a vod id', () => {
    const state = resolveVodLinkState({
      detail: {
        state: 'live',
        stream: { endedAt: null },
      },
      isLiveCollector: true,
    })
    expect(state.status).toBe('live')
    expect(state.label).toMatch(/live/i)
  })

  it('marks ended sessions with no vod as unavailable', () => {
    const state = resolveVodLinkState({
      detail: {
        state: 'historical',
        stream: {
          endedAt: '2026-06-01T06:00:00Z',
        },
      },
    })
    expect(state.status).toBe('unavailable')
    expect(state.detail.toLowerCase()).toContain('deleted')
  })
})
