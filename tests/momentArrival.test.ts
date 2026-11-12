import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MOMENT_ARRIVAL_STORAGE_KEY,
  MOMENT_ARRIVAL_TTL_MS,
  arrivalFromLink,
  parseTwitchTime,
  rememberMomentArrival,
  resetMomentArrivalPage,
  takeMomentArrival,
} from '../src/shared/momentArrival.ts'

const VOD_ID = '2903671992'

function stubStorage() {
  const items = new Map<string, unknown>()
  const local = {
    get: vi.fn(async (key: string) => (items.has(key) ? { [key]: items.get(key) } : {})),
    set: vi.fn(async (values: Record<string, unknown>) => { for (const [key, value] of Object.entries(values)) items.set(key, value) }),
    remove: vi.fn(async (key: string) => { items.delete(key) }),
  }
  vi.stubGlobal('chrome', { storage: { local } })
  return { items, local }
}

describe('parseTwitchTime', () => {
  it('reads the forms Twitch writes', () => {
    expect(parseTwitchTime('1h4m39s')).toBe(3_879)
    expect(parseTwitchTime('3879s')).toBe(3_879)
    expect(parseTwitchTime('3879')).toBe(3_879)
    expect(parseTwitchTime('4m')).toBe(240)
    expect(parseTwitchTime('2h')).toBe(7_200)
  })

  it('refuses anything else', () => {
    expect(parseTwitchTime('')).toBeNull()
    expect(parseTwitchTime('soon')).toBeNull()
    expect(parseTwitchTime('1x2')).toBeNull()
    expect(parseTwitchTime('-30')).toBeNull()
  })
})

describe('arrivalFromLink', () => {
  it('takes a timestamped link to this VOD on the VOD clock', () => {
    expect(arrivalFromLink(`https://www.twitch.tv/videos/${VOD_ID}?t=1h4m39s`, VOD_ID))
      .toEqual({ vodId: VOD_ID, offsetSeconds: 3_879, clock: 'vod', source: 'link' })
    expect(arrivalFromLink(`https://twitch.tv/videos/${VOD_ID}/?t=90s`, VOD_ID)?.offsetSeconds).toBe(90)
  })

  it('ignores another host, another VOD, no time and a zero time', () => {
    expect(arrivalFromLink(`https://evil.example/videos/${VOD_ID}?t=90s`, VOD_ID)).toBeNull()
    expect(arrivalFromLink(`https://twitch.tv.evil.example/videos/${VOD_ID}?t=90s`, VOD_ID)).toBeNull()
    expect(arrivalFromLink('https://www.twitch.tv/videos/111?t=90s', VOD_ID)).toBeNull()
    expect(arrivalFromLink(`https://www.twitch.tv/videos/${VOD_ID}`, VOD_ID)).toBeNull()
    expect(arrivalFromLink(`https://www.twitch.tv/videos/${VOD_ID}?t=0s`, VOD_ID)).toBeNull()
    expect(arrivalFromLink('not a url', VOD_ID)).toBeNull()
  })
})

describe('the arrival note', () => {
  beforeEach(() => resetMomentArrivalPage(null))
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('is read once for its own VOD, on the stream clock', async () => {
    const { items } = stubStorage()
    await rememberMomentArrival({ vodId: VOD_ID, offsetSeconds: 754.6, source: 'library', login: 'Jerma985', streamId: '42', title: 'Big laugh' })
    const stored = items.get(MOMENT_ARRIVAL_STORAGE_KEY) as { savedAtMs: number }

    const found = await takeMomentArrival(VOD_ID, stored.savedAtMs + 1_000)
    expect(found).toEqual({ vodId: VOD_ID, offsetSeconds: 754, clock: 'stream', source: 'library', login: 'jerma985', streamId: '42', title: 'Big laugh' })
    expect(items.has(MOMENT_ARRIVAL_STORAGE_KEY)).toBe(false)
    expect(await takeMomentArrival(VOD_ID, stored.savedAtMs + 2_000)).toBeNull()
  })

  it('is dropped, not used, once two minutes old', async () => {
    const { items } = stubStorage()
    await rememberMomentArrival({ vodId: VOD_ID, offsetSeconds: 60, source: 'popup' })
    const stored = items.get(MOMENT_ARRIVAL_STORAGE_KEY) as { savedAtMs: number }

    expect(await takeMomentArrival(VOD_ID, stored.savedAtMs + MOMENT_ARRIVAL_TTL_MS + 1)).toBeNull()
    expect(items.has(MOMENT_ARRIVAL_STORAGE_KEY)).toBe(false)
  })

  it('stays for its own VOD when another VOD opens first', async () => {
    const { items } = stubStorage()
    await rememberMomentArrival({ vodId: VOD_ID, offsetSeconds: 60, source: 'panel' })

    expect(await takeMomentArrival('111')).toBeNull()
    expect(items.has(MOMENT_ARRIVAL_STORAGE_KEY)).toBe(true)
  })

  it('writes nothing without a VOD or a second', async () => {
    const { local } = stubStorage()
    await rememberMomentArrival({ vodId: null, offsetSeconds: 60, source: 'library' })
    await rememberMomentArrival({ vodId: 'v123', offsetSeconds: 60, source: 'library' })
    await rememberMomentArrival({ vodId: VOD_ID, offsetSeconds: null, source: 'library' })
    await rememberMomentArrival({ vodId: VOD_ID, offsetSeconds: -1, source: 'library' })
    expect(local.set).not.toHaveBeenCalled()
  })

  it('ignores a malformed note', async () => {
    const { items } = stubStorage()
    items.set(MOMENT_ARRIVAL_STORAGE_KEY, { vodId: VOD_ID, offsetSeconds: 60, clock: 'vod', source: 'link', savedAtMs: Date.now() })
    expect(await takeMomentArrival(VOD_ID)).toBeNull()
  })

  it('falls back to the link the page opened on, once', async () => {
    stubStorage()
    resetMomentArrivalPage(`https://www.twitch.tv/videos/${VOD_ID}?t=2m`)

    expect(await takeMomentArrival(VOD_ID)).toEqual({ vodId: VOD_ID, offsetSeconds: 120, clock: 'vod', source: 'link' })
    // A later VOD in the same tab was not opened from that link.
    expect(await takeMomentArrival(VOD_ID)).toBeNull()
  })

  it('prefers the note to the link', async () => {
    stubStorage()
    resetMomentArrivalPage(`https://www.twitch.tv/videos/${VOD_ID}?t=2m`)
    await rememberMomentArrival({ vodId: VOD_ID, offsetSeconds: 600, source: 'library' })

    expect((await takeMomentArrival(VOD_ID))?.source).toBe('library')
  })

  it('still uses the link when storage throws', async () => {
    vi.stubGlobal('chrome', { storage: { local: { get: vi.fn(async () => { throw new Error('gone') }) } } })
    resetMomentArrivalPage(`https://www.twitch.tv/videos/${VOD_ID}?t=45`)

    expect((await takeMomentArrival(VOD_ID))?.offsetSeconds).toBe(45)
  })
})
