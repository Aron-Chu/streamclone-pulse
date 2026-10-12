import { describe, expect, it, vi } from 'vitest'
import { slimHubSnapshot, type HubSnapshot } from '../src/shared/hubSnapshot.ts'
import { loadHubSnapshot, type HubSnapshotDeps } from '../src/background/hubSnapshot.ts'
import { parseBackgroundRequest } from '../src/shared/parseBackgroundRequest.ts'
import { emoteImage } from '../src/popup/popupModel.ts'

const channel = (login: string, chatPerMin: number, extra: Record<string, unknown> = {}) => ({
  streamId: '320581609948', login, displayName: login.toUpperCase(), category: 'Just Chatting',
  profileImageUrl: `https://static-cdn.jtvnw.net/jtv_user_pictures/${login}-profile_image-300x300.png`,
  viewers: 1_000, chatPerMin, emotesPerMin: 10, coverageState: 'synced', ...extra,
})

const RAW = {
  generatedAt: '2026-10-03T03:07:26.324Z',
  poolSize: 998,
  activity: { livePoolViewerSum: 882_821, points: [] },
  emoteIntel: { emotesPerMin: 6141.37 },
  topEmotes: Array.from({ length: 14 }, (_, index) => ({ name: `E${index}`, imageUrl: `https://cdn.7tv.app/emote/01ID${index}/4x.webp`, count: 100 - index, animated: index % 2 === 0 })),
  liveChannels: [
    channel('quiet', 20),
    channel('busiest', 466),
    channel('statsonly', 900, { coverageState: 'stats_only' }),
    channel('second', 405),
    channel('bad login!', 999),
    channel('third', 309),
    channel('fourth', 241),
  ],
}

describe('slimHubSnapshot', () => {
  it('keeps the busiest chats Pulse is reading, the top twelve emotes and the network totals', () => {
    const snapshot = slimHubSnapshot(RAW)!
    expect(snapshot).toMatchObject({ generatedAt: RAW.generatedAt, liveChannels: 998, viewers: 882_821, emotesPerMin: 6141.37 })
    expect(snapshot.channels.map(c => c.login)).toEqual(['busiest', 'second', 'third'])
    expect(snapshot.channels[0]).toEqual({
      login: 'busiest', displayName: 'BUSIEST', category: 'Just Chatting',
      avatarUrl: 'https://static-cdn.jtvnw.net/jtv_user_pictures/busiest-profile_image-70x70.png',
      viewers: 1_000, chatPerMin: 466,
    })
    expect(snapshot.topEmotes).toHaveLength(12)
    expect(snapshot.topEmotes[0]).toEqual({ name: 'E0', imageUrl: 'https://cdn.7tv.app/emote/01ID0/4x.webp', count: 100, animated: true })
  })

  it('rejects unusable bodies and tolerates missing optional parts', () => {
    expect(slimHubSnapshot(null)).toBeNull()
    expect(slimHubSnapshot([])).toBeNull()
    expect(slimHubSnapshot({ poolSize: 10 })).toBeNull()
    expect(slimHubSnapshot({ generatedAt: 'x', poolSize: -1 })).toBeNull()
    expect(slimHubSnapshot({ generatedAt: 'x', poolSize: 0 })).toEqual({ generatedAt: 'x', liveChannels: 0, viewers: null, emotesPerMin: null, topEmotes: [], channels: [] })
    const odd = slimHubSnapshot({ ...RAW, topEmotes: [{ name: '', count: 5 }, { name: 'Zero', count: 0 }, { name: 'Ok', count: 3, imageUrl: 42 }] })!
    expect(odd.topEmotes).toEqual([{ name: 'Ok', imageUrl: null, count: 3, animated: false }])
  })
})

describe('loadHubSnapshot', () => {
  const snapshot = slimHubSnapshot(RAW) as HubSnapshot
  const deps = (over: Partial<HubSnapshotDeps> = {}): HubSnapshotDeps => {
    let stored: Awaited<ReturnType<HubSnapshotDeps['read']>> = null
    return {
      now: () => 1_000_000,
      root: async () => 'https://api.streampulse.stream',
      fetchHub: vi.fn(async () => RAW),
      read: async () => stored,
      write: async value => { stored = value },
      ...over,
    }
  }

  it('fetches once, then serves the cached snapshot for a minute', async () => {
    const d = deps()
    expect(await loadHubSnapshot(d)).toEqual(snapshot)
    expect(await loadHubSnapshot(d)).toEqual(snapshot)
    expect(d.fetchHub).toHaveBeenCalledTimes(1)
    d.now = () => 1_000_000 + 61_000
    await loadHubSnapshot(d)
    expect(d.fetchHub).toHaveBeenCalledTimes(2)
  })

  it('shares one request between popups opened together', async () => {
    const d = deps()
    await Promise.all([loadHubSnapshot(d), loadHubSnapshot(d), loadHubSnapshot(d)])
    expect(d.fetchHub).toHaveBeenCalledTimes(1)
  })

  it('falls back to a recent snapshot when the hub is down, but not to an old one or another server', async () => {
    const d = deps()
    await loadHubSnapshot(d)
    d.fetchHub = vi.fn(async () => { throw new Error('hub 503') })
    d.now = () => 1_000_000 + 5 * 60_000
    expect(await loadHubSnapshot(d)).toEqual(snapshot)
    d.now = () => 1_000_000 + 11 * 60_000
    await expect(loadHubSnapshot(d)).rejects.toThrow('hub 503')
    d.now = () => 1_000_000 + 30_000
    d.root = async () => 'http://localhost:8081'
    await expect(loadHubSnapshot(d)).rejects.toThrow('hub 503')
  })

  it('does not cache a body it could not read', async () => {
    const d = deps({ fetchHub: vi.fn(async () => ({ nope: true })) })
    await expect(loadHubSnapshot(d)).rejects.toThrow('hub_invalid')
    expect(await d.read()).toBeNull()
  })
})

describe('popup messages', () => {
  it('accepts the hub and recent-moments reads', () => {
    expect(parseBackgroundRequest({ type: 'HUB_SNAPSHOT' })).toEqual({ type: 'HUB_SNAPSHOT' })
    expect(parseBackgroundRequest({ type: 'MY_MOMENTS', action: 'recent' })).toEqual({ type: 'MY_MOMENTS', action: 'recent' })
    expect(parseBackgroundRequest({ type: 'MY_MOMENTS', action: 'recent', extra: 1 })).toBeNull()
  })
})

describe('emoteImage', () => {
  it('serves 7TV and Twitch emotes at popup size with a still frame for reduced motion', () => {
    expect(emoteImage('https://cdn.7tv.app/emote/01FZ975PV8000B4AWRZNMVNEXN/4x.webp')).toEqual({
      src: 'https://cdn.7tv.app/emote/01FZ975PV8000B4AWRZNMVNEXN/2x.webp',
      still: 'https://cdn.7tv.app/emote/01FZ975PV8000B4AWRZNMVNEXN/2x_static.webp',
    })
    expect(emoteImage('https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/2.0')).toEqual({
      src: 'https://static-cdn.jtvnw.net/emoticons/v2/425618/default/dark/2.0',
      still: 'https://static-cdn.jtvnw.net/emoticons/v2/425618/static/dark/2.0',
    })
    expect(emoteImage('https://cdn.betterttv.net/emote/abc/2x.webp')).toEqual({ src: 'https://cdn.betterttv.net/emote/abc/2x.webp', still: null })
    expect(emoteImage('https://evil.example/emote.png')).toBeNull()
  })
})
