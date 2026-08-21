import { describe, expect, it } from 'vitest'
import {
  buildTwitchVodUrl,
  resolveAnalyticsVodId,
  resolveVodLinkState,
} from './twitchVodUrl.ts'

describe('Twitch VOD links', () => {
  it('uses the validated VOD id and stream-relative offset', () => {
    expect(buildTwitchVodUrl('2834270468', 240)).toBe(
      'https://www.twitch.tv/videos/2834270468?t=4m0s',
    )
  })

  it('rejects arbitrary video URLs instead of embedding them in a Twitch path', () => {
    expect(buildTwitchVodUrl('https://www.twitch.tv/videos/2834444095', 240)).toBe(
      'https://www.twitch.tv',
    )
    expect(resolveAnalyticsVodId({ vodId: 'https://www.twitch.tv/videos/2834444095' })).toBeUndefined()
    expect(resolveVodLinkState({
      fallbackVodId: 'https://www.twitch.tv/videos/2834444095',
      channelIsLive: false,
    }).status).toBe('unavailable')
  })
})
