import { describe, expect, it } from 'vitest'
import { safeImageUrl, safeTwitchNavigationUrl } from '../src/shared/safeUrl.ts'

describe('safe URL boundaries', () => {
  it('allows the configured local backend port for proxy images', () => {
    expect(
      safeImageUrl('http://localhost:8081/emotes/example.webp', 'http://localhost:8081'),
    ).toBe('http://localhost:8081/emotes/example.webp')
  })

  it('rejects ports on trusted public image and navigation hosts', () => {
    expect(safeImageUrl('https://cdn.7tv.app:8443/emote/example.webp')).toBeUndefined()
    expect(safeTwitchNavigationUrl('https://clips.twitch.tv:8443/example')).toBeUndefined()
  })

  it('rejects non-HTTP image schemes, credentials, and non-configured local origins', () => {
    expect(safeImageUrl('javascript:alert(1)', 'https://api.streampulse.stream')).toBeUndefined()
    expect(safeImageUrl('https://user:pass@cdn.7tv.app/emote.webp')).toBeUndefined()
    expect(safeImageUrl('http://localhost:8090/emote.webp', 'http://localhost:8081')).toBeUndefined()
    expect(safeTwitchNavigationUrl('javascript:alert(1)')).toBeUndefined()
  })
})
