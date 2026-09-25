import { describe, expect, it } from 'vitest'
import { backgroundErrorCode, backgroundErrorMessage } from '../src/shared/backgroundResponse.ts'

describe('background response failure envelopes', () => {
  it('recognizes bare and negative envelopes', () => {
    expect(backgroundErrorCode({ error: 'unauthorized_sender' })).toBe('unauthorized_sender')
    expect(backgroundErrorCode({ ok: false })).toBe('request_failed')
    expect(backgroundErrorCode({ ok: true })).toBeNull()
  })

  it('maps sensitive runtime failures to bounded UI copy', () => {
    expect(backgroundErrorMessage({ error: 'unauthorized_sender' }, 'fallback')).toBe(
      'This action is available from the secure settings page.',
    )
    expect(backgroundErrorMessage({ error: 'https://private.example/internal' }, 'fallback')).toBe('fallback')
    expect(backgroundErrorMessage({ ok: false }, 'fallback')).toBe('fallback')
  })
})
