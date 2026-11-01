import { describe, expect, it } from 'vitest'
import { buildTwitchTimestampLink, parseVodTimestamp } from '../src/lib/twitchTimestampLink'

describe('whole-second VOD time parsing', () => {
  it.each([['0', 0], ['00:00', 0], ['83', 83], ['1:23:45', 5025], ['23:45', 1425], ['90:00', 5400], ['1h23m45s', 5025], ['90m', 5400], [' 2H3M ', 7380]])('parses %s', (input, seconds) => {
    expect(parseVodTimestamp(input as string)).toBe(seconds)
  })
  it.each(['', '-1', '1.5', '8:15pm', '1:60:00', '1:00:60', '12:9', '1m2h', '1s1s', 'Infinity', '1e6', '9'.repeat(80)])('rejects ambiguous or unsafe time %s', input => {
    expect(parseVodTimestamp(input)).toBeNull()
  })
})

describe('clean Twitch timestamp links', () => {
  it('builds a numeric-ID link and normalizes equivalent times', () => {
    expect(buildTwitchTimestampLink('2916038039', '1:23:45')).toEqual({ ok: true, videoId: '2916038039', seconds: 5025,
      displayTime: '1:23:45', url: 'https://www.twitch.tv/videos/2916038039?t=1h23m45s' })
  })
  it.each(['https://www.twitch.tv/videos/2916038039', 'https://twitch.tv/videos/2916038039/', 'https://m.twitch.tv/videos/2916038039', 'twitch.tv/videos/2916038039'])('accepts the Twitch VOD source %s', input => {
    expect(buildTwitchTimestampLink(input, '0')).toMatchObject({ ok: true, url: 'https://www.twitch.tv/videos/2916038039?t=0h0m0s' })
  })
  it('uses an existing time only when the start-time field is blank and drops unrelated parameters', () => {
    const source = 'https://www.twitch.tv/videos/2916038039?t=12m3s&utm_source=someone#private'
    expect(buildTwitchTimestampLink(source, '')).toMatchObject({ ok: true, seconds: 723, url: 'https://www.twitch.tv/videos/2916038039?t=0h12m3s' })
    expect(buildTwitchTimestampLink(source, '5')).toMatchObject({ ok: true, seconds: 5 })
  })
  it.each(['', '0', '000123', 'https://twitch.tv/caedrel', 'https://clips.twitch.tv/Example', 'http://twitch.tv/videos/123',
    'https://twitch.tv.evil.example/videos/123', 'https://twitch.tv@evil.example/videos/123', 'https://user:pass@twitch.tv/videos/123',
    'https://twitch.tv:8443/videos/123', 'javascript:alert(1)', 'https://twitch.tv/videos/123/another', 'https://twitch.tv/videos/123?t=1s&t=2s'])('rejects a non-VOD or ambiguous source %s', source => {
    expect(buildTwitchTimestampLink(source, '0')).toMatchObject({ ok: false, field: 'video' })
  })
  it('reports time errors separately from video errors', () => {
    expect(buildTwitchTimestampLink('123', '-10')).toMatchObject({ ok: false, field: 'time' })
    expect(buildTwitchTimestampLink('123', '')).toMatchObject({ ok: false, field: 'time' })
  })
})
