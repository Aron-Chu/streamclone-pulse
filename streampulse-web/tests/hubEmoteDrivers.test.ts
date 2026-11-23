import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HUB_EMOTE_DRIVERS_EMPTY_MS,
  hubEmoteDriversPath,
  hubEmoteDriversServed,
  readHubEmoteDrivers,
  readHubEmoteDriversAnswer,
  requestHubEmoteDrivers,
  resetHubEmoteDriversForTests,
  type HubEmoteDriversQuery,
} from '../src/lib/hubEmoteDrivers'

vi.mock('../src/lib/apiClient', async (original) => ({
  ...await original<typeof import('../src/lib/apiClient')>(),
  getBackendUrl: () => 'https://api.streampulse.stream',
}))

const BUCKET = Date.UTC(2026, 10, 20, 18, 0)
const LUL: HubEmoteDriversQuery = { bucketT: BUCKET, activityWindow: '24h', name: 'LUL', provider: 'twitch', limit: 5 }

const row = (login: string, emoteUses: number, emoteMinuteUses?: number, extra: Record<string, unknown> = {}) => ({
  login,
  displayName: login.toUpperCase(),
  streamId: `s-${login}`,
  offsetSeconds: 600,
  at: BUCKET + 60_000,
  score: 1,
  label: 'Emote spike',
  topEmotes: [{ name: 'LUL', provider: 'twitch', count: emoteMinuteUses ?? emoteUses }],
  emoteUses,
  ...(emoteMinuteUses == null ? {} : { emoteMinuteUses }),
  ...extra,
})

function body(moments: unknown[], extra: Record<string, unknown> = {}) {
  return {
    bucketT: BUCKET, bucketStart: '', bucketEnd: '', hubGeneratedAt: '', source: 'corpus_historical',
    status: moments.length ? 'ready' : 'empty', activityWindowMinutes: 1440,
    emote: { name: 'LUL', provider: 'twitch' }, moments, ...extra,
  }
}

const json = (status: number, payload: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...headers } })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetHubEmoteDriversForTests()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('hubEmoteDriversPath', () => {
  it('sends the bucket, window, emote, provider and limit, encoded', () => {
    expect(hubEmoteDriversPath(LUL)).toBe(`/v1/public/hub/emote-drivers?bucketT=${BUCKET}&activityWindow=24h&emote=LUL&provider=twitch&limit=5`)
    expect(hubEmoteDriversPath({ ...LUL, name: 'D:', provider: 'ffz' })).toContain('emote=D%3A&provider=ffz')
    expect(hubEmoteDriversPath({ ...LUL, name: 'a&b=c' })).toContain('emote=a%26b%3Dc&')
  })
})

describe('readHubEmoteDriversAnswer', () => {
  it('keeps rows with a channel and uses, with the minute uses defaulting to the total', () => {
    const answer = readHubEmoteDriversAnswer(body([row('alpha', 120, 20), row('bravo', 30), row('', 99), row('charlie', 0)]))
    expect(answer.status).toBe('ready')
    if (answer.status !== 'ready') return
    expect(answer.rows.map((r) => [r.login, r.emoteUses, r.emoteMinuteUses])).toEqual([['alpha', 120, 20], ['bravo', 30, 30]])
  })

  it('is empty without rows, and unserved for an outage or a body that is not this route', () => {
    expect(readHubEmoteDriversAnswer(body([]))).toEqual({ status: 'empty' })
    expect(readHubEmoteDriversAnswer(body([], { reason: 'store_unavailable' }))).toEqual({ status: 'unserved' })
    expect(readHubEmoteDriversAnswer(body([], { status: 'unavailable' }))).toEqual({ status: 'unserved' })
    expect(readHubEmoteDriversAnswer({ error: 'nope' })).toEqual({ status: 'unserved' })
    expect(readHubEmoteDriversAnswer('<html>')).toEqual({ status: 'unserved' })
  })
})

describe('requestHubEmoteDrivers', () => {
  it('asks once, shares the call, and answers from the tab after', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, body([row('alpha', 120, 20), row('bravo', 65, 40)]))))
    const [a, b] = await Promise.all([requestHubEmoteDrivers(LUL), requestHubEmoteDrivers(LUL)])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`https://api.streampulse.stream${hubEmoteDriversPath(LUL)}`)
    expect(a).toEqual(b)
    expect(a.status === 'ready' && a.rows.map((r) => r.login)).toEqual(['alpha', 'bravo'])
    expect(readHubEmoteDrivers(LUL)).toEqual(a)
    await requestHubEmoteDrivers(LUL)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // another emote, provider or bucket is another question
    fetchMock.mockImplementation(() => Promise.resolve(json(200, body([]))))
    await requestHubEmoteDrivers({ ...LUL, provider: 'seventv' })
    await requestHubEmoteDrivers({ ...LUL, name: 'KEKW' })
    await requestHubEmoteDrivers({ ...LUL, bucketT: BUCKET + 360_000 })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('keeps an empty answer two minutes', async () => {
    fetchMock.mockResolvedValue(json(200, body([])))
    expect(await requestHubEmoteDrivers(LUL)).toEqual({ status: 'empty' })
    expect(readHubEmoteDrivers(LUL)).toEqual({ status: 'empty' })
    expect(readHubEmoteDrivers(LUL, Date.now() + HUB_EMOTE_DRIVERS_EMPTY_MS + 1_000)).toBeNull()
  })

  it('remembers a backend without the route, and stops asking it', async () => {
    fetchMock.mockResolvedValue(json(404, { error: 'not found' }))
    expect(await requestHubEmoteDrivers(LUL)).toEqual({ status: 'unserved' })
    expect(hubEmoteDriversServed()).toBe(false)
    expect(readHubEmoteDrivers({ ...LUL, name: 'KEKW' })).toEqual({ status: 'unserved' })
    expect(await requestHubEmoteDrivers({ ...LUL, name: 'KEKW' })).toEqual({ status: 'unserved' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('answers unserved for one failed call, without remembering it', async () => {
    fetchMock.mockResolvedValue(json(400, { error: 'invalid_emote' }))
    expect(await requestHubEmoteDrivers(LUL)).toEqual({ status: 'unserved' })
    expect(hubEmoteDriversServed()).toBe(true)
    expect(readHubEmoteDrivers(LUL)).toBeNull()
    fetchMock.mockResolvedValue(json(503, { error: 'hub_emote_drivers_unavailable' }))
    expect(await requestHubEmoteDrivers(LUL)).toEqual({ status: 'unserved' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('holds the origin back after a 429', async () => {
    fetchMock.mockResolvedValue(json(429, { error: 'rate_limited' }, { 'Retry-After': '20' }))
    expect(await requestHubEmoteDrivers(LUL)).toEqual({ status: 'unserved' })
    expect(await requestHubEmoteDrivers({ ...LUL, name: 'KEKW' })).toEqual({ status: 'unserved' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(hubEmoteDriversServed()).toBe(true)
  })

  it('rejects only on abort, and the shared call still lands for the others', async () => {
    let answer!: (r: Response) => void
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => { answer = resolve }))
    const ctrl = new AbortController()
    const first = requestHubEmoteDrivers(LUL, ctrl.signal)
    const second = requestHubEmoteDrivers(LUL)
    ctrl.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    answer(json(200, body([row('alpha', 9)])))
    expect((await second).status).toBe('ready')
    await expect(requestHubEmoteDrivers(LUL, ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })
})
