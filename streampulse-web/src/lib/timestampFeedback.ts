/** Fixed, voluntary PostHog API survey. No SDK, profile writes or seen storage. */
export const TIMESTAMP_SURVEY_ID = '01a19b69-e783-0000-f952-9dc7175673e4'
const QUESTION_ID = 'abdddff1-2324-4c7c-b0cf-a3aff55cc37f'
const QUESTION = 'Did this tool help you create the Twitch timestamp link you needed?'
const CHOICES = ['Yes', 'Not yet'] as const
const HOST = 'https://i.streampulse.stream'
export type TimestampFeedbackChoice = (typeof CHOICES)[number]
export interface TimestampFeedbackSession {
  readonly question: string
  readonly choices: readonly TimestampFeedbackChoice[]
  shown(): boolean
  submit(choice: TimestampFeedbackChoice): boolean
  dismiss(): void
}

function definition(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const surveys = (value as { surveys?: unknown }).surveys
  if (!Array.isArray(surveys)) return null
  const matches = surveys.filter(s => s?.id === TIMESTAMP_SURVEY_ID)
  if (matches.length !== 1) return null
  const s = matches[0]
  // A repeatable, explicitly opened survey does not require person/seen flags.
  // Never silently ignore targeting added later by an operator.
  if (s.type !== 'api' || s.schedule !== 'always' || s.archived === true ||
    s.linked_flag_key != null || s.targeting_flag_key != null || s.linked_flag != null ||
    s.targeting_flag != null || s.linked_flag_id != null || s.targeting_flag_id != null ||
    (s.conditions != null && (typeof s.conditions !== 'object' || Array.isArray(s.conditions) || Object.keys(s.conditions).length !== 0))) return null
  const iteration = s.current_iteration ?? 0
  if (!Number.isSafeInteger(iteration) || iteration < 0 || !Array.isArray(s.questions) || s.questions.length !== 1) return null
  const q = s.questions[0]
  if (q?.id !== QUESTION_ID || q.type !== 'single_choice' || q.question !== QUESTION ||
    q.optional === true || q.hasOpenChoice === true || !Array.isArray(q.choices) ||
    q.choices.length !== CHOICES.length || q.choices.some((c: unknown, i: number) => c !== CHOICES[i])) return null
  return iteration
}

export async function loadTimestampFeedback(
  token: string, distinctId: string, permitted: () => boolean, signal: AbortSignal,
): Promise<TimestampFeedbackSession | null> {
  if (signal.aborted || !permitted()) return null
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 4_000)
  let iteration: number | null
  try {
    const url = new URL('/api/surveys/', HOST)
    url.searchParams.set('token', token)
    const response = await fetch(url, {
      signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer',
      cache: 'no-store', redirect: 'error',
    })
    if (!response.ok || !permitted() || signal.aborted) return null
    const text = await response.text()
    if (text.length > 131_072 || !permitted() || signal.aborted) return null
    iteration = definition(JSON.parse(text))
  } catch { return null }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', abort) }
  if (iteration === null || !permitted() || signal.aborted) return null

  const submissionId = crypto.randomUUID()
  let terminal: 'submitted' | 'dismissed' | null = null
  let shown = false
  let pending: { choice: TimestampFeedbackChoice; body: string } | undefined
  const allowed = () => !signal.aborted && permitted()
  function body(event: string, details: Record<string, unknown> = {}): string {
    return JSON.stringify({
      api_key: token, distinct_id: distinctId, uuid: crypto.randomUUID(), timestamp: new Date().toISOString(), event,
      properties: {
        page_category: 'tool', tool: 'twitch_vod_timestamp_link',
        $survey_id: TIMESTAMP_SURVEY_ID, $survey_iteration: iteration,
        ...details, $process_person_profile: false, $geoip_disable: true,
      },
    })
  }
  function send(payload: string): boolean {
    if (!allowed()) return false
    try { return navigator.sendBeacon(HOST + '/i/v0/e/', new Blob([payload], { type: 'application/json' })) }
    catch { return false }
  }
  return {
    question: QUESTION, choices: CHOICES,
    shown: () => {
      if (shown || terminal || !allowed()) return false
      shown = true
      return send(body('survey shown'))
    },
    submit: choice => {
      if (!allowed() || !CHOICES.includes(choice)) return false
      if (terminal) return terminal === 'submitted'
      if (pending && pending.choice !== choice) return false
      pending ??= { choice, body: body('survey sent', {
        $survey_submission_id: submissionId, $survey_completed: true,
        $survey_questions: [{ id: QUESTION_ID, question: QUESTION }],
        [`$survey_response_${QUESTION_ID}`]: choice,
      }) }
      // Explicit retries reuse both identifiers and the entire original payload.
      if (!send(pending.body)) return false
      terminal = 'submitted'
      return true
    },
    dismiss: () => {
      if (terminal) return
      terminal = 'dismissed'
      if (shown) send(body('survey dismissed'))
    },
  }
}
