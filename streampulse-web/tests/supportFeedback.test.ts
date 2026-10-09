import { describe, expect, it } from 'vitest'
import {
  SUPPORT_DESCRIPTION_MAX,
  SUPPORT_SUBJECT_MAX,
  buildSupportCaseBody,
  createSupportIdempotency,
  deriveSupportSubject,
  supportFailureOutcome,
  supportSuccessOutcome,
  truncateUtf8,
  supportShortReference,
  turnstileErrorIsSiteConfig,
  turnstileErrorRetryable,
  utf8ByteLength,
  validateFeedbackDraft,
  validateSupportForm,
  type FeedbackDraft,
} from '../src/lib/supportForm'

const draft = (over: Partial<FeedbackDraft> = {}): FeedbackDraft => ({
  kind: 'bug', message: 'Pulse tab is blank on xqc', email: '', consent: true, contactConsent: false, ...over,
})

describe('UTF-8 byte counting', () => {
  it('counts bytes the way the backend len() does, not UTF-16 units', () => {
    expect(utf8ByteLength('abc')).toBe(3)
    expect(utf8ByteLength('é')).toBe(2)
    expect(utf8ByteLength('€')).toBe(3)
    expect(utf8ByteLength('😀')).toBe(4)
    expect('😀'.length).toBe(2)
    expect(utf8ByteLength('👩‍💻')).toBe(11)
  })

  it('truncates on character boundaries only', () => {
    expect(truncateUtf8('abc', 10)).toBe('abc')
    expect(truncateUtf8('ab😀', 5)).toBe('ab')
    expect(truncateUtf8('ab😀', 6)).toBe('ab😀')
    expect(truncateUtf8('éé', 3)).toBe('é')
    for (const value of ['😀'.repeat(50), 'é'.repeat(80), 'a€😀'.repeat(30)]) {
      for (const max of [0, 1, 2, 3, 5, 7, 119, 120]) {
        const out = truncateUtf8(value, max)
        expect(utf8ByteLength(out)).toBeLessThanOrEqual(max)
        expect(value.startsWith(out)).toBe(true)
        expect(out).not.toMatch(/[\uD800-\uDBFF]$/)
      }
    }
  })

  it('validates subject and description in bytes', () => {
    const base = { category: 'bug', subject: 's', description: 'd', consent: true, turnstileToken: 'tok' }
    // 40 emoji = 80 UTF-16 units but 160 bytes: over the subject limit.
    expect(validateSupportForm({ ...base, subject: '😀'.repeat(40) })).toEqual({ ok: false, error: 'invalid_subject' })
    expect(validateSupportForm({ ...base, subject: '😀'.repeat(30) })).toEqual({ ok: true })
    expect(validateSupportForm({ ...base, description: '😀'.repeat(1001) })).toEqual({ ok: false, error: 'invalid_description' })
    expect(validateSupportForm({ ...base, description: '😀'.repeat(1000) })).toEqual({ ok: true })
  })
})

describe('subject derivation', () => {
  it('uses the whole message when it fits, on one line', () => {
    expect(deriveSupportSubject('  Pulse tab\n\nis blank  ')).toBe('Pulse tab is blank')
  })

  it('cuts long messages between words and marks the cut inside the byte limit', () => {
    const message = 'The Pulse tab stays blank on every channel I open, even after reloading the extension, restarting Chrome twice today and clearing the cache'
    expect(utf8ByteLength(message)).toBeGreaterThan(SUPPORT_SUBJECT_MAX)
    const subject = deriveSupportSubject(message)
    expect(utf8ByteLength(subject)).toBeLessThanOrEqual(SUPPORT_SUBJECT_MAX)
    expect(subject.endsWith('…')).toBe(true)
    expect(message.startsWith(subject.slice(0, -1))).toBe(true)
    expect(subject.slice(0, -1).endsWith(' ')).toBe(false)
    expect(message.charAt(subject.length - 1)).toBe(' ')
  })

  it('stays within 120 bytes for multi-byte text and one giant word', () => {
    for (const message of ['😀'.repeat(200), 'é'.repeat(500), 'x'.repeat(500), `${'日本語のテキスト '.repeat(30)}`]) {
      const subject = deriveSupportSubject(message)
      expect(subject.length).toBeGreaterThan(0)
      expect(utf8ByteLength(subject)).toBeLessThanOrEqual(SUPPORT_SUBJECT_MAX)
      expect(subject).not.toMatch(/[\uD800-\uDBFF]…?$/)
    }
  })
})

describe('feedback draft and request body', () => {
  it('maps the two choices onto backend categories', () => {
    expect(buildSupportCaseBody(draft({ kind: 'bug' })).category).toBe('bug')
    expect(buildSupportCaseBody(draft({ kind: 'suggestion' })).category).toBe('suggestion')
  })

  it('sends contact consent only with an email, and always explicit consent', () => {
    expect(buildSupportCaseBody(draft())).toEqual({
      category: 'bug', subject: 'Pulse tab is blank on xqc', description: 'Pulse tab is blank on xqc', consent: true,
    })
    const withEmail = buildSupportCaseBody(draft({ email: ' me@example.com ', contactConsent: true }))
    expect(withEmail).toMatchObject({ email: 'me@example.com', contact_consent: true })
  })

  it('reports field problems before sending', () => {
    expect(validateFeedbackDraft(draft())).toBeNull()
    expect(validateFeedbackDraft(draft({ message: '   ' }))).toBe('message_required')
    expect(validateFeedbackDraft(draft({ message: '😀'.repeat(SUPPORT_DESCRIPTION_MAX / 4 + 1) }))).toBe('message_too_long')
    expect(validateFeedbackDraft(draft({ message: '😀'.repeat(SUPPORT_DESCRIPTION_MAX / 4) }))).toBeNull()
    expect(validateFeedbackDraft(draft({ consent: false }))).toBe('consent_required')
    expect(validateFeedbackDraft(draft({ email: 'nope' }))).toBe('invalid_email')
    expect(validateFeedbackDraft(draft({ email: 'me@example.com' }))).toBe('contact_consent_required')
    expect(validateFeedbackDraft(draft({ email: 'me@example.com', contactConsent: true }))).toBeNull()
  })
})

describe('idempotency key rotation', () => {
  function tracker() {
    let n = 0
    return createSupportIdempotency(() => `key-${++n}`)
  }

  it('reuses the key while the body is unchanged (a retry)', () => {
    const ids = tracker()
    const body = buildSupportCaseBody(draft())
    expect(ids.keyFor(body)).toBe('key-1')
    expect(ids.keyFor(buildSupportCaseBody(draft()))).toBe('key-1')
  })

  it('starts a new key whenever any part of the body changes', () => {
    const ids = tracker()
    expect(ids.keyFor(buildSupportCaseBody(draft()))).toBe('key-1')
    expect(ids.keyFor(buildSupportCaseBody(draft({ message: 'Pulse tab is blank on xqc!' })))).toBe('key-2')
    expect(ids.keyFor(buildSupportCaseBody(draft({ message: 'Pulse tab is blank on xqc!', kind: 'suggestion' })))).toBe('key-3')
    expect(ids.keyFor(buildSupportCaseBody(draft({ message: 'Pulse tab is blank on xqc!', kind: 'suggestion', email: 'a@b.co', contactConsent: true })))).toBe('key-4')
    // Going back to an earlier body is still a change from the last attempt.
    expect(ids.keyFor(buildSupportCaseBody(draft()))).toBe('key-5')
  })

  it('starts a new key after a successful send, even for identical text', () => {
    const ids = tracker()
    const body = buildSupportCaseBody(draft())
    expect(ids.keyFor(body)).toBe('key-1')
    ids.reset()
    expect(ids.keyFor(body)).toBe('key-2')
  })
})

describe('send outcomes', () => {
  it('counts only a returned case ID as sent', () => {
    expect(supportSuccessOutcome({ case_id: '7c1e4b2a-93d5-4f08-b6a1-2e9c5d70f4ab' })).toEqual({ kind: 'sent', caseId: '7c1e4b2a-93d5-4f08-b6a1-2e9c5d70f4ab' })
    expect(supportSuccessOutcome({})).toEqual({ kind: 'failed' })
    expect(supportSuccessOutcome({ case_id: '' })).toEqual({ kind: 'failed' })
    expect(supportSuccessOutcome(null)).toEqual({ kind: 'failed' })
  })

  it.each([
    [{ status: 429, code: 'rate_limited', retryAfterMs: 30_000 }, { kind: 'rate_limited', retryAfterMs: 30_000 }],
    [{ status: 429, code: 'rate_limited' }, { kind: 'rate_limited', retryAfterMs: null }],
    [{ status: 503, code: 'disabled' }, { kind: 'unavailable' }],
    [{ status: 503, code: 'missing_turnstile_secret' }, { kind: 'unavailable' }],
    [{ status: 503, code: 'missing_limiter' }, { kind: 'unavailable' }],
    [{ status: 503, code: 'missing_store' }, { kind: 'unavailable' }],
    [{ status: 503, code: 'missing_delivery_adapter' }, { kind: 'unavailable' }],
    [{ status: 503, code: 'store_error' }, { kind: 'failed' }],
    [{ status: 502 }, { kind: 'failed' }],
    [{ status: 500, code: 'internal' }, { kind: 'failed' }],
    [{ status: 400, code: 'turnstile_failed' }, { kind: 'check_failed' }],
    [{ status: 400, code: 'invalid_turnstile_token' }, { kind: 'check_failed' }],
    [{ status: 400, code: 'invalid_description' }, { kind: 'rejected', field: 'message' }],
    [{ status: 400, code: 'invalid_subject' }, { kind: 'rejected', field: 'message' }],
    [{ status: 413, code: 'payload_too_large' }, { kind: 'rejected', field: 'message' }],
    [{ status: 400, code: 'invalid_email' }, { kind: 'rejected', field: 'email' }],
    [{ status: 400, code: 'contact_consent_required' }, { kind: 'rejected', field: 'email' }],
    [{ status: 400, code: 'consent_required' }, { kind: 'rejected', field: null }],
    [{ status: 400, code: 'missing_idempotency_key' }, { kind: 'rejected', field: null }],
    [{ status: 0, kind: 'unreachable' }, { kind: 'failed' }],
    [{ status: 0, kind: 'timeout' }, { kind: 'failed' }],
    [new Error('boom'), { kind: 'failed' }],
  ])('maps %j to %j', (error, outcome) => {
    expect(supportFailureOutcome(error)).toEqual(outcome)
  })
})

describe('Turnstile widget errors', () => {
  // Cloudflare's client-side error table: Retry "Yes" for timeouts, the iframe
  // failing to load and the generic challenge failures; "No" for configuration.
  it.each(['110600', '110620', '200500', '300030', '300010', '600010', 600010])('%j is worth a fresh challenge', (code) => {
    expect(turnstileErrorRetryable(code)).toBe(true)
  })

  it.each(['110100', '110110', '110200', '200100', '400020', '400021', '400070', '100000', '110500', '', 'abc', undefined, null])(
    '%j is not',
    (code) => {
      expect(turnstileErrorRetryable(code)).toBe(false)
    },
  )

  // Our own setup (parameters, site key, domain) shows the unavailable panel;
  // anything else that no retry fixes is this browser blocking the check.
  it.each(['102001', '106010', '110100', '110110', '110200', '110420', '400020', '400030', '400070'])('%j is our site configuration', (code) => {
    expect(turnstileErrorIsSiteConfig(code)).toBe(true)
  })

  it.each(['110500', '110510', '110600', '200100', '200500', '300030', '600010', '100000', '120000', '', undefined, null])('%j is not', (code) => {
    expect(turnstileErrorIsSiteConfig(code)).toBe(false)
  })
})

describe('supportShortReference', () => {
  it('is the first 8 characters of the case ID, upper-cased', () => {
    expect(supportShortReference('ecf01b0b-4d2a-4c1e-9f3b-5a6b7c8d9e0f')).toBe('ECF01B0B')
    expect(supportShortReference(' d91b5942-fc50-410a-9b7e-82754d3feaf2 ')).toBe('D91B5942')
    expect(supportShortReference('c1')).toBe('C1')
  })
})
