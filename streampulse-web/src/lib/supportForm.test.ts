import { describe, expect, it } from 'vitest'
import {
  TURNSTILE_SCRIPT_SRC,
  createSupportIdempotencyKey,
  supportBackendRoot,
  supportFormAvailability,
  validateSupportForm,
} from './supportForm'

describe('supportForm validation', () => {
  it('accepts a minimal valid bug report with challenge token', () => {
    const result = validateSupportForm({
      category: 'bug',
      subject: 'Overlay missing',
      description: 'Pulse tab does not show',
      consent: true,
      turnstileToken: 'tok',
    })
    expect(result).toEqual({ ok: true })
  })

  it('requires turnstile token before submit', () => {
    expect(
      validateSupportForm({
        category: 'bug',
        subject: 'Overlay missing',
        description: 'Pulse tab does not show',
        consent: true,
      }),
    ).toEqual({ ok: false, error: 'turnstile_required' })
  })

  it('rejects privacy categories with redirect code', () => {
    expect(
      validateSupportForm({
        category: 'privacy',
        subject: 'Delete my data',
        description: 'Please remove my data',
        consent: true,
        turnstileToken: 'tok',
      }),
    ).toEqual({ ok: false, error: 'privacy_redirect' })
  })

  it('rejects security categories', () => {
    expect(
      validateSupportForm({
        category: 'security',
        subject: 'Vuln',
        description: 'Found something',
        consent: true,
        turnstileToken: 'tok',
      }),
    ).toEqual({ ok: false, error: 'security_not_accepted' })
  })

  it('requires contact consent when email is set', () => {
    expect(
      validateSupportForm({
        category: 'bug',
        subject: 's',
        description: 'd',
        consent: true,
        email: 'user@example.com',
        contactConsent: false,
        turnstileToken: 'tok',
      }),
    ).toEqual({ ok: false, error: 'contact_consent_required' })
  })

  it('marks form unavailable without Turnstile site key', () => {
    expect(supportFormAvailability('')).toBe('unavailable')
    expect(supportFormAvailability(undefined)).toBe('unavailable')
    expect(supportFormAvailability('sitekey')).toBe('ready')
  })

  it('creates non-empty idempotency keys', () => {
    const a = createSupportIdempotencyKey()
    const b = createSupportIdempotencyKey()
    expect(a.length).toBeGreaterThan(8)
    expect(b.length).toBeGreaterThan(8)
  })

  it('defaults backend root to hosted API', () => {
    expect(supportBackendRoot(undefined)).toBe('https://api.streampulse.stream')
    expect(supportBackendRoot('https://api.example/')).toBe('https://api.example')
  })

  it('pins Turnstile script to Cloudflare challenges origin', () => {
    expect(TURNSTILE_SCRIPT_SRC).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js')
  })
})
