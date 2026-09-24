import { describe, expect, it } from 'vitest'
import { twitchProfileImageRendition } from '../src/lib/twitchProfileImage'

describe('twitchProfileImageRendition', () => {
  it('requests the smaller square rendition of a Twitch profile image', () => {
    expect(twitchProfileImageRendition('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x300.png', 70))
      .toBe('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png')
    expect(twitchProfileImageRendition('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-600x600.jpeg', 150))
      .toBe('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-150x150.jpeg')
  })

  it('leaves other URLs and already-small renditions unchanged', () => {
    expect(twitchProfileImageRendition('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png', 150))
      .toBe('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-70x70.png')
    expect(twitchProfileImageRendition('https://static-cdn.jtvnw.net/jtv_user_pictures/fixture-profile.png', 70))
      .toBe('https://static-cdn.jtvnw.net/jtv_user_pictures/fixture-profile.png')
    expect(twitchProfileImageRendition('https://example.test/a-profile_image-300x300.png', 70))
      .toBe('https://example.test/a-profile_image-300x300.png')
    expect(twitchProfileImageRendition('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x150.png', 70))
      .toBe('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-profile_image-300x150.png')
    expect(twitchProfileImageRendition(undefined, 70)).toBeUndefined()
  })
})
