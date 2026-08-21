import { describe, expect, it } from 'vitest'
import { scrapeVodChannelLoginFromText } from '../src/content/vodChannelLogin.ts'

describe('scrapeVodChannelLoginFromText', () => {
  it('reads owner.login from Twitch page embeds', () => {
    const html = '{"owner":{"id":"71092938","login":"xqc","displayName":"xQc"}}'
    expect(scrapeVodChannelLoginFromText(html)).toBe('xqc')
  })

  it('reads broadcaster.login and channelLogin keys', () => {
    expect(scrapeVodChannelLoginFromText('{"broadcaster":{"login":"kaicenat"}}')).toBe('kaicenat')
    expect(scrapeVodChannelLoginFromText('"channelLogin":"jynxzi"')).toBe('jynxzi')
  })

  it('ignores Twitch system routes in href fallbacks', () => {
    const html = 'href="/directory" href="https://www.twitch.tv/videos/123" href="/xqc"'
    expect(scrapeVodChannelLoginFromText(html)).toBe('xqc')
  })

  it('returns null when no channel login is present', () => {
    expect(scrapeVodChannelLoginFromText('{"video":{"id":"2842747774"}}')).toBeNull()
  })
})
