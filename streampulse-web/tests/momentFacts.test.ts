import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../src/lib/apiClient', () => ({ apiClient: request }))
import { loadMomentFacts, momentFactsFromAnswer } from '../src/lib/momentFacts'
import { MomentFeedbackError, momentAtKey, momentMinuteAt, parseMomentAtKey } from '../src/lib/momentFeedback'
import { setMomentNowForTests } from '../src/lib/momentCommentSpan'
import { forgetFailedMomentReads, resetMomentReads } from '../src/lib/momentReads'

const ID = '900000001'
/** An ended stream as the public stream route answers it (PortalStreamRecord under `stream`). */
const ended = {
  stream: { streamId: ID, login: 'Creator_1', displayName: 'Creator One', category: 'Just Chatting', categoryId: '509658',
    startedAt: '2026-11-19T12:00:30.400Z', endedAt: '2026-11-19T13:15:20.900Z', vodId: '2600000001' },
  vodId: '2600000001',
}
/** The same stream while live: the route leaves endedAt out. */
const live = { stream: { streamId: ID, login: 'creator_1', startedAt: '2026-11-19T12:00:30.400Z' } }

const serve = (data: unknown) => request.mockResolvedValue({ data, status: 200 })
const refusal = async (read: Promise<unknown>) => {
  const error = await read.then(() => null, (failure: unknown) => failure)
  expect(error).toBeInstanceOf(MomentFeedbackError)
  const { status, code } = error as MomentFeedbackError
  return { status, code }
}

describe('a Moment’s read-only facts', () => {
  beforeEach(() => { request.mockReset(); resetMomentReads(); setMomentNowForTests(() => Date.parse('2026-11-19T14:00:10Z')) })
  afterEach(() => setMomentNowForTests(null))

  it('reads only the public stream route, and builds the page’s facts from it', async () => {
    serve(ended)
    const facts = await loadMomentFacts(ID, '20261119T1240Z')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(`/v1/portal/analytics/streams/${ID}`, { timeoutMs: 8000 })
    expect(facts).toEqual({
      streamId: ID,
      momentAt: '2026-11-19T12:40:00Z',
      stream: { login: 'creator_1', displayName: 'Creator One', profileImageUrl: '', category: 'Just Chatting',
        startedAt: '2026-11-19T12:00:30Z', endedAt: '2026-11-19T13:15:20Z' },
      window: { from: '2026-11-19T12:40:00Z', to: '2026-11-19T12:41:00Z' },
      clips: [],
      hidden: false,
    })
  })

  it('shares the stream read with the rest of the page', async () => {
    serve(ended)
    await Promise.all([loadMomentFacts(ID, '20261119T1240Z'), loadMomentFacts(ID, '20261119T1241Z')])
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('names the channel by its login when the stream has no display name, and carries no category it lacks', async () => {
    serve({ stream: { ...ended.stream, displayName: '', category: undefined } })
    const facts = await loadMomentFacts(ID, '20261119T1240Z')
    expect(facts.stream.displayName).toBe('creator_1')
    expect(facts.stream.category).toBe('')
  })

  describe('which minutes are in the stream', () => {
    it('takes the minute the stream started in, though the start is part way through it', async () => {
      serve(ended)
      const facts = await loadMomentFacts(ID, '20261119T1200Z')
      expect(facts.momentAt).toBe('2026-11-19T12:00:00Z')
      // Whole seconds, floored, as the feedback read writes it.
      expect(facts.stream.startedAt).toBe('2026-11-19T12:00:30Z')
      expect(await refusal(loadMomentFacts(ID, '20261119T1159Z'))).toEqual({ status: 400, code: 'invalid_moment' })
    })
    it('takes the minute the stream ended in, and not the one after', async () => {
      serve(ended)
      expect((await loadMomentFacts(ID, '20261119T1315Z')).window).toEqual({ from: '2026-11-19T13:15:00Z', to: '2026-11-19T13:16:00Z' })
      expect(await refusal(loadMomentFacts(ID, '20261119T1316Z'))).toEqual({ status: 400, code: 'invalid_moment' })
    })
    it('takes a minute that starts exactly at the end', async () => {
      serve({ stream: { ...ended.stream, endedAt: '2026-11-19T13:15:00Z' } })
      expect((await loadMomentFacts(ID, '20261119T1315Z')).stream.endedAt).toBe('2026-11-19T13:15:00Z')
    })
    it('takes a live stream’s minutes up to now, with five minutes for a viewer clock that runs behind, and no later', async () => {
      serve(live)
      const facts = await loadMomentFacts(ID, '20261119T1400Z')
      expect(facts.stream.endedAt).toBeNull()
      // The viewer's clock says 14:00:10; the server may already have measured 14:03.
      expect((await loadMomentFacts(ID, '20261119T1403Z')).window.from).toBe('2026-11-19T14:03:00Z')
      expect((await loadMomentFacts(ID, '20261119T1405Z')).window.from).toBe('2026-11-19T14:05:00Z')
      expect(await refusal(loadMomentFacts(ID, '20261119T1406Z'))).toEqual({ status: 400, code: 'invalid_moment' })
    })
    it('reads an endedAt of null as live too', async () => {
      serve({ stream: { ...live.stream, endedAt: null } })
      expect((await loadMomentFacts(ID, '20261119T1400Z')).stream.endedAt).toBeNull()
    })
  })

  describe('a stream it cannot place', () => {
    it.each([
      ['another stream', { stream: { ...ended.stream, streamId: '900000002' } }],
      ['no stream', {}],
      ['no login', { stream: { ...ended.stream, login: '' } }],
      ['a login that is not a Twitch login', { stream: { ...ended.stream, login: 'not a login' } }],
      ['two different logins', { channel: 'someone_else', stream: ended.stream }],
    ])('is not found for %s', async (_, data) => {
      serve(data)
      expect(await refusal(loadMomentFacts(ID, '20261119T1240Z'))).toEqual({ status: 404, code: 'stream_not_found' })
    })
    it.each([400, 404])('is not found when the stream route answers %i', async status => {
      request.mockRejectedValue({ kind: 'bad_request', message: 'Not found', status })
      expect(await refusal(loadMomentFacts(ID, '20261119T1240Z'))).toEqual({ status: 404, code: 'stream_not_found' })
    })
    it.each([
      ['no start', { stream: { ...ended.stream, startedAt: undefined } }],
      ['a start that is not a time', { stream: { ...ended.stream, startedAt: 'soon' } }],
      ['an end that is not a time', { stream: { ...ended.stream, endedAt: 'later' } }],
    ])('says the answer was not usable for %s', async (_, data) => {
      serve(data)
      expect(await refusal(loadMomentFacts(ID, '20261119T1240Z'))).toEqual({ status: 503, code: 'unexpected_answer' })
    })
    it('passes any other failure on as it came, and reads again on Try again', async () => {
      const outage = { kind: 'server', message: 'Service unavailable', status: 503 }
      request.mockRejectedValueOnce(outage)
      await expect(loadMomentFacts(ID, '20261119T1240Z')).rejects.toBe(outage)
      serve(ended)
      // The page's Try again forgets the kept failure first (MomentWatchPage).
      forgetFailedMomentReads(ID)
      await expect(loadMomentFacts(ID, '20261119T1240Z')).resolves.toMatchObject({ momentAt: '2026-11-19T12:40:00Z' })
      expect(request).toHaveBeenCalledTimes(2)
    })
  })

  it.each([
    ['12345a', '20261119T1240Z', 'invalid_stream'],
    ['', '20261119T1240Z', 'invalid_stream'],
    [ID, '20261119T1260Z', 'invalid_moment'],
    [ID, '2026-11-19T12:40Z', 'invalid_moment'],
  ])('reads nothing for an address that is not one (%s / %s)', async (streamId, momentAt, code) => {
    expect(await refusal(loadMomentFacts(streamId, momentAt))).toEqual({ status: 400, code })
    expect(request).not.toHaveBeenCalled()
  })

  it('stops waiting when its signal stops, and starts no read once stopped', async () => {
    const stopped = new AbortController()
    stopped.abort()
    await expect(loadMomentFacts(ID, '20261119T1240Z', stopped.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
    let answer!: (value: unknown) => void
    request.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const leaving = new AbortController()
    const read = loadMomentFacts(ID, '20261119T1240Z', leaving.signal)
    leaving.abort()
    await expect(read).rejects.toMatchObject({ name: 'AbortError' })
    answer({ data: ended, status: 200 })
  })

  describe('links built from an offset open the minute the backend keys it by', () => {
    const wholeStart = { stream: { ...ended.stream, startedAt: '2026-11-19T12:00:00.000Z' } }
    /** The page's own check: the offset the backend keyed the Moment by is o or o - 1. */
    const offsetsToTry = (facts: { momentAt: string; stream: { startedAt: string } }) => {
      const o = Math.max(0, Math.floor((Date.parse(facts.momentAt) - Date.parse(facts.stream.startedAt)) / 1000))
      return [o, o - 1]
    }
    it.each([
      [59, '20261119T1201Z'],
      [60, '20261119T1201Z'],
      [61, '20261119T1202Z'],
    ])('offset %i from a whole-minute start opens %s', async (offsetSeconds, key) => {
      serve(wholeStart)
      const minute = momentMinuteAt(Date.parse(wholeStart.stream.startedAt), offsetSeconds)
      expect(momentAtKey(minute)).toBe(key)
      expect(parseMomentAtKey(key)).toBe(minute)
      const facts = await loadMomentFacts(ID, key)
      expect(Date.parse(facts.momentAt)).toBe(minute)
      if (offsetSeconds !== 61) expect(offsetsToTry(facts)).toContain(offsetSeconds)
    })
    it('finds the offset again from a start with fractional seconds', async () => {
      serve(ended)
      // The minute 12:01 is 29.6 s after 12:00:30.400: the backend keys it at offset 29.
      const key = momentAtKey(momentMinuteAt(Date.parse(ended.stream.startedAt), 29))
      expect(key).toBe('20261119T1201Z')
      const facts = await loadMomentFacts(ID, key)
      expect(offsetsToTry(facts)).toEqual([30, 29])
    })
    it('opens the first minute for offset zero', async () => {
      serve(ended)
      const key = momentAtKey(momentMinuteAt(Date.parse(ended.stream.startedAt), 0))
      expect(key).toBe('20261119T1200Z')
      await expect(loadMomentFacts(ID, key)).resolves.toMatchObject({ momentAt: '2026-11-19T12:00:00Z' })
    })
  })

  it('places a minute on an answer already read, at a given now', () => {
    expect(momentFactsFromAnswer(ID, Date.parse('2026-11-19T14:00:00Z'), live, Date.parse('2026-11-19T14:00:00Z')).momentAt).toBe('2026-11-19T14:00:00Z')
    // A live stream's minutes run to now plus five minutes of clock skew.
    expect(momentFactsFromAnswer(ID, Date.parse('2026-11-19T14:00:00Z'), live, Date.parse('2026-11-19T13:59:59Z')).momentAt).toBe('2026-11-19T14:00:00Z')
    expect(() => momentFactsFromAnswer(ID, Date.parse('2026-11-19T14:05:00Z'), live, Date.parse('2026-11-19T13:59:59Z'))).toThrow(MomentFeedbackError)
    expect(() => momentFactsFromAnswer(ID, Date.parse('2026-11-19T12:40:30Z'), ended, Date.now())).toThrow(MomentFeedbackError)
  })
})
