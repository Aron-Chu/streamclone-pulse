import { describe, expect, it, vi } from 'vitest'
import { newsroomProfileUrl, getCachedNewsroomProfile, loadNewsroomProfiles } from '../src/lib/newsroomProfiles'

const { apiClientMock } = vi.hoisted(() => ({ apiClientMock: vi.fn() }))

vi.mock('../src/lib/momentsApiClient', () => ({
  apiClient: apiClientMock,
  getBackendUrl: () => 'https://api.example.test',
}))

describe('newsroomProfiles', () => {
  it('validates allowed Twitch CDN profile images including default pictures', () => {
    expect(newsroomProfileUrl('https://static-cdn.jtvnw.net/jtv_user_pictures/abc-300x300.png')).toBe(
      'https://static-cdn.jtvnw.net/jtv_user_pictures/abc-300x300.png',
    )
    expect(
      newsroomProfileUrl('https://static-cdn.jtvnw.net/user-default-pictures-uv/deaf_pipe_300x300.png'),
    ).toBe('https://static-cdn.jtvnw.net/user-default-pictures-uv/deaf_pipe_300x300.png')
  })

  it('rejects disallowed, unsafe, or malformed URLs', () => {
    expect(newsroomProfileUrl('http://static-cdn.jtvnw.net/jtv_user_pictures/insecure.png')).toBeUndefined()
    expect(newsroomProfileUrl('https://evil.com/jtv_user_pictures/fake.png')).toBeUndefined()
    expect(newsroomProfileUrl('https://static-cdn.jtvnw.net/other_path/avatar.png')).toBeUndefined()
    expect(newsroomProfileUrl('https://user:pass@static-cdn.jtvnw.net/jtv_user_pictures/creds.png')).toBeUndefined()
    expect(newsroomProfileUrl('https://static-cdn.jtvnw.net/jtv_user_pictures/avatar.png?tracker=1')).toBeUndefined()
    expect(newsroomProfileUrl('https://static-cdn.jtvnw.net/jtv_user_pictures/avatar.png#hash')).toBeUndefined()
    expect(newsroomProfileUrl('')).toBeUndefined()
    expect(newsroomProfileUrl(null)).toBeUndefined()
    expect(newsroomProfileUrl(123)).toBeUndefined()
  })

  it('returns undefined for uncached logins', () => {
    expect(getCachedNewsroomProfile('unknown_user_12345')).toBeUndefined()
  })

  it('reuses a successful exact-login profile from the bounded cache', async () => {
    const url = 'https://static-cdn.jtvnw.net/jtv_user_pictures/cache-proof-300x300.png'
    apiClientMock.mockResolvedValueOnce({ data: { login: 'cacheproof', profileImageUrl: url } })
    const onProfile = vi.fn()
    await loadNewsroomProfiles(['CacheProof'], new AbortController().signal, onProfile)
    expect(onProfile).toHaveBeenCalledWith('cacheproof', url)
    expect(getCachedNewsroomProfile('CACHEPROOF')).toBe(url)

    apiClientMock.mockClear()
    await loadNewsroomProfiles(['cacheproof'], new AbortController().signal, onProfile)
    expect(apiClientMock).not.toHaveBeenCalled()
  })
})
