import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MomentFeedbackError, addStreamComment, deleteStreamComment, listStreamComments, loadMomentFeedback, momentAtKey,
  momentFeedbackOff, momentMinuteAt, momentPagePath, parseMomentAtKey, ratingTallyText, reportStreamComment,
  setMomentRating, wholeSecondUtc,
} from '../src/lib/momentFeedback'
import { momentFeedbackEnabled, momentPageEnabled, momentPageReturnPath } from '../src/lib/momentPageFlag'
import { clipFeedbackErrorText, loadClipFeedback, ClipFeedbackError } from '../src/lib/clipFeedback'

const CSRF = 'b'.repeat(64)
const STREAM = '9000001'
const AT = '20261114T2031Z'
const FROM = '2026-11-14T20:26:00Z'
const TO = '2026-11-14T20:36:00Z'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const feedbackBody = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1, streamId: STREAM, momentAt: '2026-11-14T20:31:00Z',
  stream: { login: 'fakechan01', displayName: 'FakeChan01', profileImageUrl: '', category: 'Just Chatting', startedAt: '2026-11-14T20:00:00Z' },
  window: { from: FROM, to: TO },
  clips: [], ratings: { yes: 6 }, you: { signedIn: false, canWrite: false }, comments: { total: 0 }, hidden: false, ...over,
})
const commentBody = (n: number) => ({
  id: uuid(n), at: '2026-11-14T20:31:05Z', body: `hi ${n}`, createdAt: '2026-11-14T20:32:00Z',
  author: { login: 'fakeviewer01', displayName: 'FakeViewer01', profileImageUrl: '' }, mine: false, reportedByYou: false,
})

let calls: Array<{ url: string; init?: RequestInit }>
function respond(make: () => Response) {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { calls.push({ url: String(input), init }); return make() }))
}
const headerOf = (init: RequestInit | undefined, name: string) => (init?.headers as Record<string, string> | undefined)?.[name]

beforeEach(() => { Object.defineProperty(document, 'cookie', { configurable: true, get: () => `__Host-pulse_csrf=${CSRF}`, set: () => {} }) })
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); Reflect.deleteProperty(document, 'cookie') })

describe('moment keys', () => {
  it('round-trips a minute', () => {
    const ms = Date.UTC(2026, 10, 14, 20, 31)
    expect(momentAtKey(ms)).toBe(AT)
    expect(parseMomentAtKey(AT)).toBe(ms)
  })
  it('refuses the wrong shapes', () => {
    for (const bad of ['20261114T2031', '20261114T2031z', '20261314T2031Z', '20261114T2561Z', '', '2026-11-14T20:31Z']) expect(parseMomentAtKey(bad)).toBeNull()
  })
  it('floors the key to the minute', () => {
    expect(momentAtKey(Date.UTC(2026, 10, 14, 20, 31, 59, 999))).toBe(AT)
  })
  it('mirrors the backend minute: ceil, and a start with no offset truncates', () => {
    const start = Date.UTC(2026, 10, 14, 20, 0, 30)
    expect(momentMinuteAt(start, 0)).toBe(Date.UTC(2026, 10, 14, 20, 0, 0))
    expect(momentMinuteAt(start, -5)).toBe(Date.UTC(2026, 10, 14, 20, 0, 0))
    expect(momentMinuteAt(start, 30)).toBe(Date.UTC(2026, 10, 14, 20, 1, 0))
    expect(momentMinuteAt(start, 2430)).toBe(Date.UTC(2026, 10, 14, 20, 41, 0))
  })
  it('builds the page path', () => { expect(momentPagePath(STREAM, AT)).toBe(`/analytics/moments/${STREAM}/${AT}`) })
  it('writes whole seconds, never .000', () => {
    expect(wholeSecondUtc(Date.UTC(2026, 10, 14, 20, 31, 5, 999))).toBe('2026-11-14T20:31:05Z')
    expect(wholeSecondUtc(Date.UTC(2026, 10, 14, 20, 31, 5))).toBe('2026-11-14T20:31:05Z')
  })
})

describe('ratingTallyText', () => {
  it('shows the yes count below 10 ratings', () => { expect(ratingTallyText({ yes: 6 })).toBe('6 said yes') })
  it('shows the share from 10', () => { expect(ratingTallyText({ yes: 14, total: 18, share: 0.778 })).toBe('78% said yes · 18 ratings') })
})

describe('requests', () => {
  it('sends the CSRF header on a write, a same-origin path and the verdict', async () => {
    respond(() => Response.json(feedbackBody({ ratings: { yes: 7 }, you: { signedIn: true, canWrite: true, verdict: 'real' } })))
    const out = await setMomentRating(STREAM, AT, 'real')
    expect(calls[0].url).toBe(`/v1/account/streams/${STREAM}/moments/${AT}/rating`)
    expect(calls[0].init?.method).toBe('PUT')
    expect(calls[0].init?.credentials).toBe('same-origin')
    expect(headerOf(calls[0].init, 'X-Pulse-CSRF')).toBe(CSRF)
    expect(calls[0].init?.body).toBe('{"verdict":"real"}')
    expect(out.you.verdict).toBe('real')
  })
  it('takes a rating back with DELETE', async () => {
    respond(() => Response.json(feedbackBody()))
    await setMomentRating(STREAM, AT, null)
    expect(calls[0].init?.method).toBe('DELETE')
  })
  it('sends no CSRF header on a read', async () => {
    respond(() => Response.json(feedbackBody()))
    const out = await loadMomentFeedback(STREAM, AT)
    expect(calls[0].url).toBe(`/v1/account/streams/${STREAM}/moments/${AT}/feedback`)
    expect(headerOf(calls[0].init, 'X-Pulse-CSRF')).toBeUndefined()
    expect(out.ratings).toEqual({ yes: 6, total: null, share: null })
  })
  it('maps 403 twitch_required to the code', async () => {
    respond(() => Response.json({ error: 'twitch_required' }, { status: 403 }))
    await expect(setMomentRating(STREAM, AT, 'real')).rejects.toMatchObject({ status: 403, code: 'twitch_required' })
    await expect(setMomentRating(STREAM, AT, 'real')).rejects.toBeInstanceOf(MomentFeedbackError)
  })
  it('reads Retry-After first, then the body retryAfterSeconds, capped', async () => {
    const post = () => addStreamComment(STREAM, '2026-11-14T20:31:00Z', 'x')
    respond(() => Response.json({ error: 'try_later', retryAfterSeconds: 90 }, { status: 429, headers: { 'Retry-After': '30' } }))
    await expect(post()).rejects.toMatchObject({ status: 429, retryAfterSeconds: 30 })
    respond(() => Response.json({ error: 'try_later', retryAfterSeconds: 90 }, { status: 429 }))
    await expect(post()).rejects.toMatchObject({ retryAfterSeconds: 90 })
    respond(() => Response.json({ error: 'try_later', retryAfterSeconds: 1e9 }, { status: 429 }))
    await expect(post()).rejects.toMatchObject({ retryAfterSeconds: 86_400 })
    respond(() => Response.json({ error: 'try_later', retryAfterSeconds: -4 }, { status: 429 }))
    await expect(post()).rejects.toMatchObject({ retryAfterSeconds: undefined })
  })
  it('treats an answer for another stream or minute, or a wrong schema, as unexpected', async () => {
    const wrong = [{ streamId: 'abc' }, { streamId: '1'.repeat(21) }, { streamId: 9000001 }, { momentAt: '2026-11-14T20:32:00Z' }, { schemaVersion: 2 }]
    for (const bad of wrong) {
      respond(() => Response.json(feedbackBody(bad)))
      await expect(loadMomentFeedback(STREAM, AT)).rejects.toMatchObject({ status: 503, code: 'unexpected_answer' })
    }
  })
  it('accepts an alias answer and carries the canonical stream id', async () => {
    respond(() => Response.json(feedbackBody({ streamId: '9000002' })))
    expect((await loadMomentFeedback(STREAM, AT)).streamId).toBe('9000002')
    respond(() => Response.json(feedbackBody({ streamId: '9000002', ratings: { yes: 7 }, you: { signedIn: true, canWrite: true, verdict: 'real' } })))
    expect((await setMomentRating(STREAM, AT, 'real')).streamId).toBe('9000002')
  })
  it('shows a share only from 10 ratings, whatever was sent', async () => {
    respond(() => Response.json(feedbackBody({ ratings: { yes: 4, total: 9, share: 0.44 } })))
    expect((await loadMomentFeedback(STREAM, AT)).ratings).toEqual({ yes: 4, total: null, share: null })
  })
  it('lists comments with the query in order from, to, cursor', async () => {
    respond(() => Response.json({ schemaVersion: 1, items: [commentBody(1)], total: 1, nextCursor: 'abc_-1' }))
    const page = await listStreamComments(STREAM, FROM, TO, 'abc_-1')
    expect(calls[0].url).toBe(`/v1/account/streams/${STREAM}/comments?from=2026-11-14T20%3A26%3A00Z&to=2026-11-14T20%3A36%3A00Z&cursor=abc_-1`)
    expect(page.items[0].id).toBe(uuid(1))
    expect(page.nextCursor).toBe('abc_-1')
  })
  it('posts a comment and reads the 201', async () => {
    respond(() => Response.json(commentBody(2), { status: 201 }))
    const out = await addStreamComment(STREAM, '2026-11-14T20:31:05Z', 'hi 2')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.body).toBe('{"at":"2026-11-14T20:31:05Z","body":"hi 2"}')
    expect(out.body).toBe('hi 2')
  })
  it('deletes and reports through the comment routes', async () => {
    respond(() => new Response(null, { status: 204 }))
    await deleteStreamComment(uuid(3))
    expect(calls[0].url).toBe(`/v1/account/stream-comments/${uuid(3)}`)
    expect(calls[0].init?.method).toBe('DELETE')
    await reportStreamComment(uuid(3), 'spam')
    expect(calls[1].url).toBe(`/v1/account/stream-comments/${uuid(3)}/report`)
    expect(calls[1].init?.body).toBe('{"reason":"spam"}')
  })
  it('refuses a malformed input before fetching', async () => {
    respond(() => Response.json({}))
    const bad: Array<[string, () => Promise<unknown>]> = [
      ['invalid_stream', () => loadMomentFeedback('12a', AT)],
      ['invalid_stream', () => loadMomentFeedback('1'.repeat(21), AT)],
      ['invalid_moment', () => loadMomentFeedback(STREAM, '20261114T2031')],
      ['invalid_moment', () => loadMomentFeedback(STREAM, '20261314T2031Z')],
      ['invalid_window', () => listStreamComments(STREAM, '2026-11-14T20:26:00.000Z', TO)],
      ['invalid_window', () => listStreamComments(STREAM, FROM, '2026-11-14T20:36:00+00:00')],
      ['invalid_cursor', () => listStreamComments(STREAM, FROM, TO, 'a b')],
      ['invalid_cursor', () => listStreamComments(STREAM, FROM, TO, 'a'.repeat(269))],
      ['invalid_at', () => addStreamComment(STREAM, '2026-11-14T20:31:05.000Z', 'x')],
      ['invalid_comment_id', () => deleteStreamComment('nope')],
      ['invalid_comment_id', () => reportStreamComment('ABCDEF00-0000-4000-8000-000000000001', 'spam')],
    ]
    for (const [code, run] of bad) await expect(run()).rejects.toMatchObject({ status: 400, code })
    expect(calls).toHaveLength(0)
  })
})

describe('momentFeedbackOff', () => {
  it('is true for a 404 that is not a missing stream', () => {
    expect(momentFeedbackOff(new MomentFeedbackError(404, 'not_found'))).toBe(true)
    expect(momentFeedbackOff(new MomentFeedbackError(404))).toBe(true)
  })
  it('is false for a missing stream and for other errors', () => {
    expect(momentFeedbackOff(new MomentFeedbackError(404, 'stream_not_found'))).toBe(false)
    expect(momentFeedbackOff(new MomentFeedbackError(404, 'comment_not_found'))).toBe(false)
    expect(momentFeedbackOff(new MomentFeedbackError(403, 'not_found'))).toBe(false)
    expect(momentFeedbackOff(new Error('x'))).toBe(false)
  })
})

describe('clip feedback after the request move', () => {
  it('still throws ClipFeedbackError', async () => {
    respond(() => Response.json({ error: 'twitch_required' }, { status: 403 }))
    const error = await loadClipFeedback('BraveClipSlug-abc_1').catch(e => e)
    expect(error).toBeInstanceOf(ClipFeedbackError)
    expect(clipFeedbackErrorText(error)).toMatch(/Twitch/)
  })
})

describe('moment page return path', () => {
  const path = `/analytics/moments/123/${AT}`
  it('is off without the flags', () => {
    expect(momentPageEnabled()).toBe(false)
    expect(momentFeedbackEnabled()).toBe(false)
    expect(momentPageReturnPath(path)).toBeNull()
  })
  it('needs both the page and its ratings and comments: either switch alone gives no return', () => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    expect(momentPageEnabled()).toBe(true)
    expect(momentPageReturnPath(path)).toBeNull()
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', 'on')
    expect(momentFeedbackEnabled()).toBe(true)
    expect(momentPageEnabled()).toBe(false)
    expect(momentPageReturnPath(path)).toBeNull()
  })
  it.each(['', 'off', '0', 'true', 'ON'])('reads VITE_PUBLIC_MOMENT_FEEDBACK=%j as off', value => {
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', value)
    expect(momentFeedbackEnabled()).toBe(false)
  })
  it('is on for on and 1, and takes only the exact shape', () => {
    for (const on of ['on', '1']) {
      vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', on)
      vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', on)
      expect(momentPageEnabled()).toBe(true)
      expect(momentFeedbackEnabled()).toBe(true)
      expect(momentPageReturnPath(path)).toBe(path)
    }
    vi.stubEnv('VITE_PUBLIC_MOMENT_PAGE', 'on')
    vi.stubEnv('VITE_PUBLIC_MOMENT_FEEDBACK', 'on')
    const bad = ['/analytics/moments/123/x', `${path}?x=1`, `${path}#x`, `${path}/`, `/analytics/moments/12a/${AT}`,
      `/analytics/moments/${'1'.repeat(21)}/${AT}`, '/analytics/moments/123/20261399T9999Z', '/analytics/moments/123/20260230T1200Z', '/analytics/moments/123/20261114T2460Z', `/analytics/moments/123/${AT.toLowerCase()}`, `/analytics/moments/123/%32${AT}`, `//evil.test${path}`, null, 5]
    for (const value of bad) expect(momentPageReturnPath(value)).toBeNull()
  })
})
