import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ apiClient: vi.fn(), origin: 'https://api.streampulse.stream' }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: mocks.apiClient, getBackendUrl: () => mocks.origin }))
import { loadNewsroomProfiles, newsroomProfileUrl } from '../src/lib/newsroomProfiles'
const photo = 'https://static-cdn.jtvnw.net/jtv_user_pictures/test-profile.jpeg'
afterEach(() => { vi.clearAllMocks(); mocks.origin = 'https://api.streampulse.stream' })

describe('Newsroom creator identity enrichment', () => {
  it('accepts only credential-free Twitch profile images', () => {
    expect(newsroomProfileUrl(photo)).toBe(photo)
    for (const url of ['javascript:alert(1)', 'https://evil.example/a.png', `${photo}?token=secret`,
      photo.replace('jtvnw.net/', 'jtvnw.net:444/'),
      photo.replace('https://', 'https://user:secret@'), 'http://static-cdn.jtvnw.net/jtv_user_pictures/a.jpg']) {
      expect(newsroomProfileUrl(url)).toBeUndefined()
    }
  })

  it('requires exact creator identity and caches cosmetic metadata without metrics', async () => {
    mocks.apiClient.mockResolvedValue({ data: { login: 'CreatorOne', profileImage: photo, viewers: 999, isLive: true } })
    const accept = vi.fn()
    await loadNewsroomProfiles(['creatorone', 'CreatorOne'], new AbortController().signal, accept)
    expect(accept).toHaveBeenCalledExactlyOnceWith('creatorone', photo)
    expect(mocks.apiClient).toHaveBeenCalledWith('https://api.streampulse.stream/v1/channels/creatorone', expect.objectContaining({ credentials: 'omit', redirect: 'error', timeoutMs: 3500, maxResponseBytes: 65536 }))
    await loadNewsroomProfiles(['creatorone'], new AbortController().signal, accept)
    expect(mocks.apiClient).toHaveBeenCalledTimes(1)
    mocks.apiClient.mockResolvedValue({ data: { login: 'someone_else', profileImage: photo } })
    await loadNewsroomProfiles(['creatortwo'], new AbortController().signal, accept)
    expect(accept).not.toHaveBeenCalledWith('creatortwo', expect.anything())
  })

  it('caps a batch at20 creators, with at most3 in flight and no late abort callback', async () => {
    let active = 0
    let peak = 0
    mocks.apiClient.mockImplementation(async (path: string) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 1))
      active -= 1
      return { data: { login: path.split('/').pop(), profileImage: photo } }
    })
    const accept = vi.fn()
    await loadNewsroomProfiles(Array.from({ length: 50 }, (_, i) => `bounded${i}`), new AbortController().signal, accept)
    expect(mocks.apiClient).toHaveBeenCalledTimes(20)
    expect(peak).toBe(3)
    expect(accept).toHaveBeenCalledTimes(20)
    const controller = new AbortController()
    mocks.apiClient.mockImplementation(async () => { controller.abort(); return { data: { login: 'latecreator', profileImage: photo } } })
    accept.mockClear()
    await loadNewsroomProfiles(['latecreator'], controller.signal, accept)
    expect(accept).not.toHaveBeenCalled()
  })

  it('shares an exact-login request without letting one subscriber cancel another', async () => {
    let finish!: (value: unknown) => void
    mocks.apiClient.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const first = new AbortController()
    const second = new AbortController()
    const acceptFirst = vi.fn(), acceptSecond = vi.fn()
    const one = loadNewsroomProfiles(['sharedcreator'], first.signal, acceptFirst)
    const two = loadNewsroomProfiles(['SharedCreator'], second.signal, acceptSecond)
    await Promise.resolve()
    expect(mocks.apiClient).toHaveBeenCalledTimes(1)
    first.abort()
    await one
    expect(mocks.apiClient.mock.calls[0][1].signal.aborted).toBe(false)
    finish({ data: { login: 'sharedcreator', profileImage: photo } })
    await two
    expect(acceptFirst).not.toHaveBeenCalled()
    expect(acceptSecond).toHaveBeenCalledExactlyOnceWith('sharedcreator', photo)
  })

  it('aborts unobserved work and does not cache a cancelled result over its replacement', async () => {
    const finishes: Array<(value: unknown) => void> = []
    mocks.apiClient.mockImplementation(() => new Promise(resolve => { finishes.push(resolve) }))
    const controller = new AbortController()
    const abandoned = loadNewsroomProfiles(['retryprofile'], controller.signal, vi.fn())
    await Promise.resolve()
    controller.abort()
    await abandoned
    expect(mocks.apiClient.mock.calls[0][1].signal.aborted).toBe(true)
    const accept = vi.fn()
    const retry = loadNewsroomProfiles(['retryprofile'], new AbortController().signal, accept)
    await Promise.resolve()
    expect(mocks.apiClient).toHaveBeenCalledTimes(2)
    finishes[1]({ data: { login: 'retryprofile', profileImage: photo } })
    await retry
    finishes[0]({ data: { login: 'retryprofile', profileImage: photo.replace('test-profile', 'obsolete') } })
    await Promise.resolve()
    await loadNewsroomProfiles(['retryprofile'], new AbortController().signal, accept)
    expect(mocks.apiClient).toHaveBeenCalledTimes(2)
    expect(accept).toHaveBeenLastCalledWith('retryprofile', photo)
  })

  it('does not share requests or cached identities across API origins', async () => {
    const finishes: Array<(value: unknown) => void> = []
    mocks.apiClient.mockImplementation(() => new Promise(resolve => { finishes.push(resolve) }))
    const accept = vi.fn()
    const first = loadNewsroomProfiles(['originscope'], new AbortController().signal, accept)
    mocks.origin = 'https://other-api.example'
    const second = loadNewsroomProfiles(['originscope'], new AbortController().signal, accept)
    await Promise.resolve()
    expect(mocks.apiClient.mock.calls.map(call => call[0])).toEqual([
      'https://api.streampulse.stream/v1/channels/originscope',
      'https://other-api.example/v1/channels/originscope',
    ])
    finishes[0]({ data: { login: 'originscope', profileImage: photo } })
    finishes[1]({ data: { login: 'originscope', profileImage: photo.replace('test-profile', 'other') } })
    await Promise.all([first, second])
    mocks.origin = 'https://api.streampulse.stream'
    await loadNewsroomProfiles(['originscope'], new AbortController().signal, accept)
    expect(accept).toHaveBeenLastCalledWith('originscope', photo)
    expect(mocks.apiClient).toHaveBeenCalledTimes(2)
  })

  it('caps aggregate pending identities across simultaneous surfaces', async () => {
    const finishes: Array<() => void> = []
    mocks.apiClient.mockImplementation((url: string) => new Promise(resolve => {
      finishes.push(() => resolve({ data: { login: url.split('/').pop(), profileImage: photo } }))
    }))
    const accept = vi.fn()
    const work = Array.from({ length: 30 }, (_, i) => loadNewsroomProfiles([`aggregate${i}`], new AbortController().signal, accept))
    await Promise.resolve()
    expect(mocks.apiClient).toHaveBeenCalledTimes(20)
    finishes.forEach(finish => finish())
    await Promise.all(work)
    expect(accept).toHaveBeenCalledTimes(20)
  })
})
