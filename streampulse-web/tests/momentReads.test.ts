import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: request }))
import { answerLogin, forgetFailedMomentReads, inTurn, isMomentStreamId, isMomentVideoId, loadMomentRecap, loadMomentStream, primeMomentStream, resetMomentReads } from '../src/lib/momentReads'

const stream = { channel: 'creator', stream: { streamId: '900000001', login: 'creator', startedAt: '2026-11-19T12:00:00Z' } }
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('Moment reads', () => {
  beforeEach(() => { request.mockReset(); resetMomentReads() })
  afterEach(() => vi.useRealTimers())

  it('reads a stream once, however many pieces ask, and keeps streams apart', async () => {
    request.mockResolvedValue({ data: stream })
    const [first, second] = await Promise.all([loadMomentStream('900000001'), loadMomentStream('900000001')])
    expect(first).toBe(second)
    await loadMomentStream('900000001')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/v1/portal/analytics/streams/900000001', { timeoutMs: 8000 })
    await loadMomentStream('900000002')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('keeps a stream answer the Moments list already read, so the Moment page reads it no more', async () => {
    primeMomentStream('900000001', stream)
    await expect(loadMomentStream('900000001')).resolves.toBe(stream)
    expect(request).not.toHaveBeenCalled()
  })

  it('keeps no primed answer for another stream, and lets a held answer win', async () => {
    primeMomentStream('900000002', stream)
    request.mockResolvedValue({ data: stream })
    await loadMomentStream('900000002')
    expect(request).toHaveBeenCalledTimes(1)
    const fresher = { ...stream, vodId: '123' }
    primeMomentStream('900000001', stream)
    primeMomentStream('900000001', fresher)
    await expect(loadMomentStream('900000001')).resolves.toBe(stream)
  })

  it('reads a recap once per stream, with its size cap', async () => {
    request.mockResolvedValue({ data: { login: 'creator', streamId: '900000001', topMoments: [] } })
    await Promise.all([loadMomentRecap('900000001'), loadMomentRecap('900000001')])
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith('/v1/portal/analytics/streams/900000001/recap', { timeoutMs: 8000, maxResponseBytes: 524288 })
  })

  it('keeps a failed read a few seconds, so the page opening after a warm asks no more; Try again forgets it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
    request.mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { status: 503 }))
    request.mockRejectedValueOnce(Object.assign(new Error('Recap unavailable'), { status: 503 }))
    await expect(loadMomentStream('900000001')).rejects.toThrow('Service unavailable')
    await expect(loadMomentRecap('900000001')).rejects.toThrow('Recap unavailable')
    // The page's own first reads, right after: the same failures, no new requests.
    await expect(loadMomentStream('900000001')).rejects.toThrow('Service unavailable')
    await expect(loadMomentRecap('900000001')).rejects.toThrow('Recap unavailable')
    expect(request).toHaveBeenCalledTimes(2)
    request.mockResolvedValue({ data: stream })
    forgetFailedMomentReads('900000001')
    await expect(loadMomentStream('900000001')).resolves.toEqual(stream)
    await expect(loadMomentRecap('900000001')).resolves.toEqual(stream)
    expect(request).toHaveBeenCalledTimes(4)
    // Try again forgets only failures: a held answer stays.
    forgetFailedMomentReads('900000001')
    await loadMomentStream('900000001')
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('asks again once a failure is a few seconds old', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
    request.mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { status: 503 }))
    await expect(loadMomentStream('900000001')).rejects.toThrow('Service unavailable')
    vi.setSystemTime(new Date('2026-11-19T12:00:04Z'))
    await expect(loadMomentStream('900000001')).rejects.toThrow('Service unavailable')
    vi.setSystemTime(new Date('2026-11-19T12:00:06Z'))
    request.mockResolvedValue({ data: stream })
    await expect(loadMomentStream('900000001')).resolves.toEqual(stream)
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('lets the Moments list prime a stream whose read just failed', async () => {
    request.mockRejectedValueOnce(Object.assign(new Error('Service unavailable'), { status: 503 }))
    await expect(loadMomentStream('900000001')).rejects.toThrow('Service unavailable')
    primeMomentStream('900000001', stream)
    await expect(loadMomentStream('900000001')).resolves.toBe(stream)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each([null, 'text', 7])('treats an answer that is not an object (%s) as a failed read', async data => {
    request.mockResolvedValue({ data })
    await expect(loadMomentStream('900000001')).rejects.toThrow(TypeError)
    await expect(loadMomentRecap('900000001')).rejects.toThrow(TypeError)
  })

  it('reads a stream again once its answer is two minutes old (a live stream may have ended)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
    request.mockResolvedValue({ data: stream })
    await loadMomentStream('900000001')
    vi.setSystemTime(new Date('2026-11-19T12:01:59Z'))
    await loadMomentStream('900000001')
    expect(request).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-11-19T12:02:01Z'))
    await loadMomentStream('900000001')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('shares a read still on its way, however long it takes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
    let answer!: (value: unknown) => void
    request.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const first = loadMomentStream('900000001')
    vi.setSystemTime(new Date('2026-11-19T12:05:00Z'))
    const second = loadMomentStream('900000001')
    answer({ data: stream })
    expect(await first).toBe(await second)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('runs at most two row reads at once; the rest wait their turn', async () => {
    const answers: Array<(value: unknown) => void> = []
    request.mockImplementation(() => new Promise(resolve => { answers.push(resolve) }))
    const reads = ['1', '2', '3', '4'].map(id => loadMomentStream(`90000000${id}`, true))
    await settle()
    expect(request).toHaveBeenCalledTimes(2)
    answers[0]!({ data: stream })
    await settle()
    expect(request).toHaveBeenCalledTimes(3)
    answers[1]!({ data: stream })
    answers[2]!({ data: stream })
    await settle()
    expect(request).toHaveBeenCalledTimes(4)
    answers[3]!({ data: stream })
    await expect(Promise.all(reads)).resolves.toHaveLength(4)
  })

  it('hands a finished read’s turn to the next waiter, so a newcomer cannot make it three at once', async () => {
    let now = 0
    let most = 0
    const finish: Array<() => void> = []
    const read = () => new Promise<void>(resolve => {
      now += 1
      most = Math.max(most, now)
      finish.push(() => { now -= 1; resolve() })
    })
    const reads = [inTurn(read), inTurn(read), inTurn(read)]
    await settle()
    expect(now).toBe(2)
    // A new read asked in the same moment the first one finishes waits behind the one already queued.
    finish[0]!()
    queueMicrotask(() => { reads.push(inTurn(read)) })
    await settle()
    expect(most).toBe(2)
    expect(now).toBe(2)
    finish[1]!()
    await settle()
    expect(most).toBe(2)
    finish[2]!()
    finish[3]!()
    await Promise.all(reads)
    expect(now).toBe(0)
    // Every turn came back: two new reads start at once.
    void inTurn(read)
    void inTurn(read)
    await settle()
    expect(now).toBe(2)
    finish[4]!()
    finish[5]!()
  })

  it('does not hold up a page read behind row reads', async () => {
    const answers: Array<(value: unknown) => void> = []
    request.mockImplementation(() => new Promise(resolve => { answers.push(resolve) }))
    void loadMomentStream('900000001', true)
    void loadMomentStream('900000002', true)
    void loadMomentStream('900000003')
    await settle()
    expect(request).toHaveBeenCalledTimes(3)
    expect(request).toHaveBeenLastCalledWith('/v1/portal/analytics/streams/900000003', { timeoutMs: 8000 })
    answers.forEach(answer => answer({ data: stream }))
  })
})

describe('the stream answer’s login', () => {
  it('is the channel the answer names, lower case', () => {
    expect(answerLogin({ stream: { login: 'Creator_1' } })).toBe('creator_1')
    expect(answerLogin({ channel: 'creator', stream: { channel: 'Creator', login: 'creator' } })).toBe('creator')
    expect(answerLogin({ channel: 'creator' })).toBe('creator')
  })
  it.each([
    [{}],
    [{ stream: { streamId: '900000001' } }],
    [{ stream: { login: '' } }],
    [{ stream: { login: 'not a login' } }],
    [{ stream: { login: 'a'.repeat(26) } }],
    [{ channel: 'creator', stream: { login: 'someone_else' } }],
    [{ channel: 7 as unknown as string }],
  ])('is null when the answer names no Twitch login, or two different ones (%j)', data => {
    expect(answerLogin(data)).toBeNull()
  })
})

describe('Moment ids', () => {
  it('takes a stream id of 1 to 20 digits, and nothing else', () => {
    for (const id of ['1', '9000001', '9'.repeat(20)]) expect(isMomentStreamId(id)).toBe(true)
    for (const id of ['', '9'.repeat(21), '12a', ' 123', '123 ', '-1', '1.5', '１２３', 123, null, undefined]) expect(isMomentStreamId(id)).toBe(false)
  })

  it('takes a video id of 1 to 30 digits, and nothing else', () => {
    for (const id of ['1', '123456789', '9'.repeat(30)]) expect(isMomentVideoId(id)).toBe(true)
    for (const id of ['', '9'.repeat(31), 'v123', '123/456', '123\n', 123, null]) expect(isMomentVideoId(id)).toBe(false)
  })
})
