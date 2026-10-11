import { describe, expect, it } from 'vitest'
import { formatPulseApiError } from '../src/ui/pulseApiErrors.ts'
import { EXTENSION_RECONNECT_MESSAGE } from '../src/shared/backgroundResponse.ts'

describe('formatPulseApiError', () => {
  it('maps backfill capacity codes to readable copy', () => {
    expect(formatPulseApiError('backfill_at_capacity')).toMatch(/at capacity/i)
    expect(formatPulseApiError('pulse_backfill_at_capacity')).toMatch(/at capacity/i)
  })

  it('never passes unknown raw codes through to viewers (UX-5)', () => {
    // Callers show their own viewer-language fallback when this returns null.
    expect(formatPulseApiError('custom_failure')).toBeNull()
    expect(formatPulseApiError('extension_api_invalid_pulse_payload')).toBeNull()
    expect(formatPulseApiError('extension_api_timeout')).toBeNull()
    expect(formatPulseApiError('pulse 500')).toBeNull()
    expect(formatPulseApiError('Failed to fetch')).toBeNull()
  })

  it('keeps the extension reconnect sentence', () => {
    expect(formatPulseApiError(EXTENSION_RECONNECT_MESSAGE)).toBe(EXTENSION_RECONNECT_MESSAGE)
  })

  it('returns null for empty input', () => {
    expect(formatPulseApiError(null)).toBeNull()
    expect(formatPulseApiError('   ')).toBeNull()
  })
})
