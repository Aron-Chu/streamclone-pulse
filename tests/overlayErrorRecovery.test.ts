import { describe, expect, it } from 'vitest'
import {
  resolveOverlayErrorState,
  sanitizePulseErrorMessage,
} from '../src/shared/pulseError.ts'

describe('sanitizePulseErrorMessage', () => {
  it('bounds and trims raw strings', () => {
    expect(sanitizePulseErrorMessage('  backend blew up  ')).toBe('backend blew up')
    expect(sanitizePulseErrorMessage('x'.repeat(500)).length).toBe(200)
  })

  it('falls back for empty or non-string values', () => {
    expect(sanitizePulseErrorMessage('')).toBe('fetch_failed')
    expect(sanitizePulseErrorMessage(null)).toBe('fetch_failed')
    expect(sanitizePulseErrorMessage(new Error('timeout'))).toBe('timeout')
  })
})

describe('resolveOverlayErrorState', () => {
  it('keeps an explicit error including empty clear', () => {
    expect(resolveOverlayErrorState('stale', null, 'fetch_failed')).toBe('fetch_failed')
    expect(resolveOverlayErrorState('stale', null, '')).toBe('')
  })

  it('clears stale error when a valid payload arrives without an error argument', () => {
    expect(
      resolveOverlayErrorState('fetch_failed', { login: 'fixturechan' } as never, undefined),
    ).toBeUndefined()
  })

  it('preserves stale error when payload is null and error is omitted', () => {
    expect(resolveOverlayErrorState('fetch_failed', null, undefined)).toBe('fetch_failed')
  })
})
