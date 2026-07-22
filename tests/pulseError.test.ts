import { describe, expect, it } from 'vitest'
import { resolveOverlayErrorState, sanitizePulseErrorMessage } from '../src/shared/pulseError.ts'

describe('pulse error lifecycle', () => {
  it('uses an explicit error', () => {
    expect(resolveOverlayErrorState('old_error', {}, 'new_error')).toBe('new_error')
  })

  it('clears a stale error when a payload recovers', () => {
    expect(resolveOverlayErrorState('old_error', {}, undefined)).toBeUndefined()
  })

  it('retains the prior error when no payload or error arrives', () => {
    expect(resolveOverlayErrorState('old_error', null, undefined)).toBe('old_error')
  })

  it('bounds and normalizes worker error text', () => {
    expect(sanitizePulseErrorMessage('  first\nsecond  ')).toBe('first second')
    expect(sanitizePulseErrorMessage('x'.repeat(250))).toHaveLength(200)
  })
})
