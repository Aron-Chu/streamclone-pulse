import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadTimestampFeedback, TIMESTAMP_SURVEY_ID, type TimestampFeedbackChoice } from '../src/lib/timestampFeedback'
import { createPublicCaptureClient } from '../src/lib/productAnalyticsCapture'

const questionId = 'abdddff1-2324-4c7c-b0cf-a3aff55cc37f'
function survey() {
  return { id: TIMESTAMP_SURVEY_ID, type: 'api', schedule: 'always', current_iteration: null,
    linked_flag_key: null, targeting_flag_key: null, internal_targeting_flag_key: 'survey-targeting-test', conditions: null,
    questions: [{ id: questionId, type: 'single_choice', optional: false, hasOpenChoice: false,
      question: 'Did this tool help you create the Twitch timestamp link you needed?', choices: ['Yes', 'Not yet'] }] }
}
function response(s = survey()) { return { ok: true, text: async () => JSON.stringify({ surveys: [s] }) } as Response }
const beacon = vi.fn(() => true)
let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  beacon.mockReset().mockReturnValue(true)
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
  fetchMock = vi.fn().mockResolvedValue(response())
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function load(permitted = () => true, signal = new AbortController().signal) {
  return loadTimestampFeedback('phc_testonly', 'temporary-page-id', permitted, signal)
}
async function payloads() {
  return Promise.all((beacon.mock.calls as unknown as [string, Blob][]).map(async ([url, blob]) => {
    expect(url).toBe('https://i.streampulse.stream/i/v0/e/')
    const value = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob)
    })
    return JSON.parse(value)
  }))
}

describe('consented anonymous API survey contract', () => {
  it('does not contact PostHog without permission or after cancellation', async () => {
    expect(await load(() => false)).toBeNull()
    const controller = new AbortController(); controller.abort()
    expect(await load(() => true, controller.signal)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the current page ID, exact native question contract and no profile/seen storage', async () => {
    const client = createPublicCaptureClient('phc_testonly', category => category === 'tool')
    client.capturePage('tool')
    const session = await client.openTimestampFeedback(new AbortController().signal)
    expect(session).not.toBeNull()
    expect(beacon).toHaveBeenCalledTimes(1) // Lookup alone does not count as shown.
    session!.shown(); session!.shown(); expect(session!.submit('Yes')).toBe(true)
    session!.submit('Yes'); session!.dismiss()
    const events = await payloads()
    expect(events.map(e => e.event)).toEqual(['portal_public_page_viewed', 'survey shown', 'survey sent'])
    expect(new Set(events.map(e => e.distinct_id)).size).toBe(1)
    const sent = events[2]!
    expect(sent.properties).toEqual({ page_category: 'tool', tool: 'twitch_vod_timestamp_link',
      $survey_id: TIMESTAMP_SURVEY_ID, $survey_iteration: 0,
      $survey_submission_id: expect.stringMatching(/^[0-9a-f-]{36}$/), $survey_completed: true,
      $survey_questions: [{ id: questionId, question: survey().questions[0]!.question }],
      [`$survey_response_${questionId}`]: 'Yes', $process_person_profile: false, $geoip_disable: true })
    expect(JSON.stringify(events)).not.toMatch(/\$set|\$current_url|\$ip|referrer|video_id|timestamp_input|responded\/|dismissed\//)
    expect(Object.keys(localStorage)).toEqual([]); expect(Object.keys(sessionStorage)).toEqual([])
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://i.streampulse.stream/api/surveys/?token=phc_testonly')
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', redirect: 'error' })
  })

  it('reuses the full payload and submission ID for explicit retry, and rejects changed/free-text answers', async () => {
    const session = (await load())!
    expect(session.submit('private text' as TimestampFeedbackChoice)).toBe(false)
    beacon.mockReturnValue(false)
    expect(session.submit('Not yet')).toBe(false)
    expect(session.submit('Yes')).toBe(false)
    beacon.mockReturnValue(true)
    expect(session.submit('Not yet')).toBe(true)
    expect(session.submit('Not yet')).toBe(true)
    const events = await payloads()
    expect(events).toHaveLength(2)
    expect(events[0]).toEqual(events[1])
    expect(events[0].properties[`$survey_response_${questionId}`]).toBe('Not yet')
  })

  it('dismisses only a shown unanswered survey, once', async () => {
    const session = (await load())!
    session.shown(); session.dismiss(); session.dismiss()
    expect(session.submit('Yes')).toBe(false)
    expect((await payloads()).map(e => e.event)).toEqual(['survey shown', 'survey dismissed'])
  })

  it('invalidates a loaded session on withdrawal/stop, even if consent is later allowed again', async () => {
    let allowed = true
    const client = createPublicCaptureClient('phc_testonly', () => allowed)
    const session = (await client.openTimestampFeedback(new AbortController().signal))!
    allowed = false; client.stop(); allowed = true
    expect(session.shown()).toBe(false); expect(session.submit('Yes')).toBe(false); session.dismiss()
    expect(beacon).not.toHaveBeenCalled()
  })

  it('aborts an in-flight lookup and discards a late response', async () => {
    let finish!: (value: Response) => void
    fetchMock.mockImplementation(() => new Promise<Response>(resolve => { finish = resolve }))
    const controller = new AbortController()
    const pending = load(() => true, controller.signal)
    controller.abort(); finish(response())
    expect(await pending).toBeNull()
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true)
    expect(beacon).not.toHaveBeenCalled()
  })

  it('bounds a hung lookup without sending survey events', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const pending = load()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(await pending).toBeNull()
    expect(beacon).not.toHaveBeenCalled()
  })

  it.each(['once', 'targeted', 'conditions', 'question', 'free-text', 'choices'])('refuses an unreviewed %s definition', async change => {
    const s = survey()
    if (change === 'once') s.schedule = 'once'
    if (change === 'targeted') s.linked_flag_key = 'new-flag' as never
    if (change === 'conditions') s.conditions = { url: 'private' } as never
    if (change === 'question') s.questions[0]!.id = 'changed-question'
    if (change === 'free-text') s.questions[0]!.hasOpenChoice = true
    if (change === 'choices') s.questions[0]!.choices.push('private-answer')
    fetchMock.mockResolvedValue(response(s))
    expect(await load()).toBeNull()
    expect(beacon).not.toHaveBeenCalled()
  })
})
